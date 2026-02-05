/**
 * LimCode - 上下文裁剪服务
 *
 * 负责管理对话历史的上下文裁剪逻辑：
 * - 识别对话回合
 * - 计算上下文阈值
 * - 裁剪超出阈值的历史消息
 * - 查找总结消息
 *
 * 设计原则：
 * - 使用累加的单条消息 token 数，而不是 API 返回的累计值，避免上下文振荡
 * - 保证历史以 user 消息开始（Gemini API 要求）
 * - 总结消息之前的历史会被过滤
 * - 裁剪状态持久化到会话的 custom metadata 中
 * - 每次计算时会检查是否可以恢复更多历史（思考 token 减少、设置变更时）
 *
 * Token 计算包含：
 * - 系统提示词（静态模板）
 * - 动态上下文（文件树、诊断信息、固定文件等实际填充内容）
 * - 对话历史消息
 */

import type { Content } from '../../../conversation/types';
import type { ConversationManager, GetHistoryOptions } from '../../../conversation/ConversationManager';
import type { PromptManager } from '../../../prompt';
import type { BaseChannelConfig } from '../../../config/configs/base';
import type { ConversationRound, ContextTrimInfo } from '../utils';
import type { TokenEstimationService } from './TokenEstimationService';
import type { MessageBuilderService } from './MessageBuilderService';

/**
 * 回合 Token 信息（内部使用）
 */
interface RoundTokenInfo {
    /** 回合起始索引 */
    startIndex: number;
    /** 回合结束索引 */
    endIndex: number;
    /** 系统提示词 + effectiveStartIndex 到这个回合结束的累计 token 数 */
    cumulativeTokens: number;
}

/**
 * 持久化的裁剪状态
 * 
 * 存储在会话的 custom metadata 中，key 为 'trimState'
 */
interface PersistedTrimState {
    /** 裁剪起始索引 */
    trimStartIndex: number;
}

/** 裁剪状态在 custom metadata 中的 key */
const TRIM_STATE_KEY = 'trimState';

export class ContextTrimService {
    constructor(
        private conversationManager: ConversationManager,
        private promptManager: PromptManager,
        private tokenEstimationService: TokenEstimationService,
        private messageBuilderService: MessageBuilderService
    ) {}
    
    /**
     * 获取持久化的裁剪状态
     */
    private async getTrimState(conversationId: string): Promise<PersistedTrimState | null> {
        const state = await this.conversationManager.getCustomMetadata(conversationId, TRIM_STATE_KEY);
        return state as PersistedTrimState | null;
    }
    
    /**
     * 保存裁剪状态到持久化存储
     */
    private async saveTrimState(conversationId: string, state: PersistedTrimState): Promise<void> {
        await this.conversationManager.setCustomMetadata(conversationId, TRIM_STATE_KEY, state);
    }
    
    /**
     * 清除指定会话的裁剪状态
     * 
     * 在以下情况下应调用：
     * - 删除消息
     * - 回退到检查点
     * - 编辑消息
     * 
     * @param conversationId 会话 ID
     */
    async clearTrimState(conversationId: string): Promise<void> {
        await this.conversationManager.setCustomMetadata(conversationId, TRIM_STATE_KEY, null);
    }

    /**
     * 识别对话回合
     *
     * 回合定义：
     * - 从一个非函数响应的用户消息开始
     * - 到下一个非函数响应的用户消息之前结束
     * - 每个回合记录该回合内最后一个助手消息的 totalTokenCount
     *
     * @param history 对话历史
     * @returns 回合列表
     */
    identifyRounds(history: Content[]): ConversationRound[] {
        const rounds: ConversationRound[] = [];
        let currentRoundStart = -1;
        let currentRoundTokenCount: number | undefined;
        
        for (let i = 0; i < history.length; i++) {
            const message = history[i];
            
            if (message.role === 'user' && !message.isFunctionResponse) {
                // 找到一个非函数响应的用户消息，这是一个新回合的开始
                if (currentRoundStart !== -1) {
                    // 保存上一个回合
                    rounds.push({
                        startIndex: currentRoundStart,
                        endIndex: i,
                        tokenCount: currentRoundTokenCount
                    });
                }
                // 开始新回合
                currentRoundStart = i;
                currentRoundTokenCount = undefined;
            } else if (message.role === 'model') {
                // 记录助手消息的 token 数
                if (message.usageMetadata?.totalTokenCount !== undefined) {
                    currentRoundTokenCount = message.usageMetadata.totalTokenCount;
                }
            }
        }
        
        // 保存最后一个回合
        if (currentRoundStart !== -1) {
            rounds.push({
                startIndex: currentRoundStart,
                endIndex: history.length,
                tokenCount: currentRoundTokenCount
            });
        }
        
        return rounds;
    }

    /**
     * 计算上下文阈值
     *
     * 支持两种格式：
     * - 数值：直接使用
     * - 百分比字符串：如 "80%"，计算最大上下文的百分比
     *
     * @param threshold 阈值配置（数值或百分比字符串）
     * @param maxContextTokens 最大上下文 token 数
     * @returns 计算后的阈值
     */
    calculateThreshold(threshold: number | string, maxContextTokens: number): number {
        if (typeof threshold === 'number') {
            return threshold;
        }
        
        // 百分比格式，如 "80%"
        if (threshold.endsWith('%')) {
            const percent = parseFloat(threshold.replace('%', ''));
            if (!isNaN(percent) && percent > 0 && percent <= 100) {
                return Math.floor(maxContextTokens * percent / 100);
            }
        }
        
        // 默认返回 80% 的最大上下文
        return Math.floor(maxContextTokens * 0.8);
    }

    /**
     * 查找历史中最后一个总结消息的索引
     *
     * @param history 对话历史
     * @returns 最后一个总结消息的索引，如果没有则返回 -1
     */
    findLastSummaryIndex(history: Content[]): number {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].isSummary) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 计算上下文裁剪后应该从哪个索引开始获取历史
     *
     * 当最新助手消息的 totalTokenCount 超过阈值时，
     * 计算需要跳过的回合，返回应该开始的消息索引
     *
     * 注意：这个方法不删除任何消息，只是计算过滤的起始位置
     *
     * @param history 对话历史
     * @param config 渠道配置
     * @param latestTokenCount 最新助手消息的 totalTokenCount
     * @returns 应该开始获取历史的索引（0 表示不需要裁剪）
     */
    calculateContextTrimStartIndex(
        history: Content[],
        config: BaseChannelConfig,
        latestTokenCount: number
    ): number {
        // 检查是否启用上下文阈值检测
        if (!config.contextThresholdEnabled) {
            return 0;
        }
        
        // 获取最大上下文和阈值
        const maxContextTokens = (config as any).maxContextTokens || 128000;
        const thresholdConfig = config.contextThreshold ?? '80%';
        const threshold = this.calculateThreshold(thresholdConfig, maxContextTokens);
        
        // 如果未超过阈值，无需裁剪
        if (latestTokenCount <= threshold) {
            return 0;
        }
        
        // 识别回合
        const rounds = this.identifyRounds(history);
        
        // 至少需要保留当前回合（最后一个回合）
        if (rounds.length <= 1) {
            return 0;
        }
        
        // 估算每个回合的 token 数（基于最后一个有 token 记录的回合）
        // 简单策略：按回合数等比例估算
        const avgTokensPerRound = latestTokenCount / rounds.length;
        
        // 计算需要保留的回合数
        const targetTokens = threshold;
        const roundsToKeep = Math.max(1, Math.floor(targetTokens / avgTokensPerRound));
        
        // 需要跳过的回合数
        const roundsToSkip = Math.max(0, rounds.length - roundsToKeep);
        
        if (roundsToSkip === 0) {
            return 0;
        }
        
        // 返回应该开始的索引
        const startIndex = rounds[roundsToSkip].startIndex;
        
        return startIndex;
    }
    
    /**
     * 并行计算并更新消息的 token 数
     * 
     * @param conversationId 对话 ID
     * @param channelType 渠道类型
     * @param messages 需要计算的消息列表
     * @returns token 数数组
     */
    private async countAndUpdateMessageTokens(
        conversationId: string,
        channelType: string,
        messages: Array<{ index: number; message: Content }>
    ): Promise<number[]> {
        if (messages.length === 0) {
            return [];
        }
        
        // 使用 TokenEstimationService 的批量方法
        const messageIndices = messages.map(m => m.index);
        await this.tokenEstimationService.preCountUserMessageTokensBatch(
            conversationId,
            channelType,
            messageIndices
        );
        
        // 返回计算后的 token 数（从更新后的消息中获取）
        const updatedHistory = await this.conversationManager.getHistoryRef(conversationId);
        return messages.map(({ index }) => {
            const msg = updatedHistory[index];
            return msg?.tokenCountByChannel?.[channelType] ?? this.tokenEstimationService.estimateMessageTokens(msg);
        });
    }

    /**
     * 获取用于 API 调用的历史，应用总结过滤和上下文阈值裁剪
     *
     * 策略：
     * 1. 如果有总结消息，从最后一个总结消息开始获取历史
     * 2. 在此基础上，如果 token 数仍超过阈值，继续从总结后的回合中裁剪
     * 3. 使用每条消息的 tokenCountByChannel 来累加计算，避免上下文振荡
     * 4. 裁剪状态保存在内存中，避免重复触发裁剪
     * 5. 每次计算时检查是否可以恢复更多历史（思考 token 减少时）
     *
     * @param conversationId 对话 ID
     * @param config 渠道配置
     * @param historyOptions 历史选项
     * @returns 裁剪后的历史和裁剪信息
     */
    async getHistoryWithContextTrimInfo(
        conversationId: string,
        config: BaseChannelConfig,
        historyOptions: GetHistoryOptions
    ): Promise<ContextTrimInfo> {
        // 先获取完整的原始历史
        const fullHistory = await this.conversationManager.getHistoryRef(conversationId);
        
        // 如果历史为空，直接返回
        if (fullHistory.length === 0) {
            return { history: [], trimStartIndex: 0 };
        }
        
        // 获取当前渠道类型（gemini, openai, anthropic, custom）
        const channelType = config.type || 'custom';
        
        // 查找最后一个总结消息
        const lastSummaryIndex = this.findLastSummaryIndex(fullHistory);
        
        // 基础起始索引（只考虑 summary）
        const summaryStartIndex = lastSummaryIndex >= 0 ? lastSummaryIndex : 0;
        
        // 从持久化存储获取裁剪状态
        let savedState = await this.getTrimState(conversationId);
        
        // 检测回退：如果保存的 trimStartIndex 超出了当前历史长度，清除状态
        if (savedState && savedState.trimStartIndex >= fullHistory.length) {
            await this.clearTrimState(conversationId);
            savedState = null;
        }
        
        // 收集需要计算 token 的内容：系统提示词、动态上下文、缺失 token 数的用户消息
        const systemPrompt = this.promptManager.getSystemPrompt();
        let todoList: unknown = undefined;
        try {
            todoList = await this.conversationManager.getCustomMetadata(conversationId, 'todoList');
        } catch {
            todoList = undefined;
        }
        const dynamicContextText = this.promptManager.getDynamicContextText({ todoList });
        
        // 查找缺失 token 数的用户消息
        const missingTokenMessages: Array<{ index: number; message: Content }> = [];
        for (let i = 0; i < fullHistory.length; i++) {
            const message = fullHistory[i];
            if (message.role === 'user' && message.tokenCountByChannel?.[channelType] === undefined) {
                missingTokenMessages.push({ index: i, message });
            }
        }
        
        // 并行计算所有需要的 token 数
        const textsToCount = [systemPrompt, dynamicContextText];
        const messagesToCount = missingTokenMessages.map(m => m.message);
        
        // 并行执行文本计数和消息计数
        const [textTokenResults, messageTokenResults] = await Promise.all([
            this.tokenEstimationService.countTextTokensBatch(textsToCount, channelType),
            missingTokenMessages.length > 0
                ? this.countAndUpdateMessageTokens(conversationId, channelType, missingTokenMessages)
                : Promise.resolve([])
        ]);
        
        const [systemPromptTokens, dynamicContextTokens] = textTokenResults;
        
        // 系统提示词和动态上下文的总 token 数
        const promptTokens = systemPromptTokens + dynamicContextTokens;
        
        // 从 historyOptions 获取用户配置
        const sendHistoryThoughts = historyOptions.sendHistoryThoughts ?? false;
        const sendHistoryThoughtSignatures = historyOptions.sendHistoryThoughtSignatures ?? false;
        const sendCurrentThoughts = historyOptions.sendCurrentThoughts ?? false;
        const sendCurrentThoughtSignatures = historyOptions.sendCurrentThoughtSignatures ?? false;
        const historyThinkingRounds = historyOptions.historyThinkingRounds ?? -1;
        
        // 找到最后一个非函数响应的 user 消息索引（当前轮次的起点）
        let lastNonFunctionResponseUserIndex = -1;
        for (let i = fullHistory.length - 1; i >= 0; i--) {
            const message = fullHistory[i];
            if (message.role === 'user' && !message.isFunctionResponse) {
                lastNonFunctionResponseUserIndex = i;
                break;
            }
        }
        
        // 识别所有回合起始位置
        const roundStartIndices: number[] = [];
        for (let i = 0; i < fullHistory.length; i++) {
            const message = fullHistory[i];
            if (message.role === 'user' && !message.isFunctionResponse) {
                roundStartIndices.push(i);
            }
        }
        
        // 计算历史思考回合的有效范围（与 getHistoryForAPI 保持一致）
        let historyThoughtMinIndex = 0;
        let historyThoughtMaxIndex = lastNonFunctionResponseUserIndex;
        
        if (historyThinkingRounds === 0) {
            historyThoughtMinIndex = fullHistory.length;
            historyThoughtMaxIndex = -1;
        } else if (historyThinkingRounds > 0) {
            const totalRounds = roundStartIndices.length;
            if (totalRounds > 1) {
                const roundsToSkip = Math.max(0, totalRounds - 1 - historyThinkingRounds);
                if (roundsToSkip > 0 && roundsToSkip < totalRounds) {
                    historyThoughtMinIndex = roundStartIndices[roundsToSkip];
                }
            }
        }
        
        // 检查是否启用上下文阈值检测
        if (!config.contextThresholdEnabled) {
            // 未启用阈值检测，直接返回从 summary 开始的历史
            const history = await this.conversationManager.getHistoryForAPI(conversationId, {
                ...historyOptions,
                startIndex: summaryStartIndex
            });
            return { history, trimStartIndex: summaryStartIndex };
        }
        
        // 获取最大上下文和阈值
        const maxContextTokens = (config as any).maxContextTokens || 128000;
        const thresholdConfig = config.contextThreshold ?? '80%';
        const threshold = this.calculateThreshold(thresholdConfig, maxContextTokens);
        
        // ========== 核心逻辑：检查是否可以恢复更多历史 ==========
        // 首先计算从 summaryStartIndex 开始的完整 token 数
        const fullTokenResult = this.accumulateTokens(
            fullHistory,
            summaryStartIndex,
            lastNonFunctionResponseUserIndex,
            historyThoughtMinIndex,
            historyThoughtMaxIndex,
            sendHistoryThoughts,
            sendHistoryThoughtSignatures,
            sendCurrentThoughts,
            sendCurrentThoughtSignatures,
            promptTokens
        );
        
        // 如果完整历史不超过阈值，清除裁剪状态，返回完整历史
        if (fullTokenResult.estimatedTotalTokens <= threshold) {
            await this.clearTrimState(conversationId);
            const history = await this.conversationManager.getHistoryForAPI(conversationId, {
                ...historyOptions,
                startIndex: summaryStartIndex
            });
            return { history, trimStartIndex: summaryStartIndex };
        }
        
        // 完整历史超过阈值，需要裁剪
        // 如果有保存的裁剪状态，检查使用该状态后是否仍超过阈值
        if (savedState && savedState.trimStartIndex > summaryStartIndex) {
            const trimmedTokenResult = this.accumulateTokens(
                fullHistory,
                savedState.trimStartIndex,
                lastNonFunctionResponseUserIndex,
                historyThoughtMinIndex,
                historyThoughtMaxIndex,
                sendHistoryThoughts,
                sendHistoryThoughtSignatures,
                sendCurrentThoughts,
                sendCurrentThoughtSignatures,
                promptTokens
            );
            
            // 如果使用保存的状态后不超过阈值，直接使用
            if (trimmedTokenResult.estimatedTotalTokens <= threshold) {
                let trimmedHistory = await this.conversationManager.getHistoryForAPI(conversationId, {
                    ...historyOptions,
                    startIndex: savedState.trimStartIndex
                });
                
                // 确保历史以 user 消息开始
                let finalTrimStartIndex = savedState.trimStartIndex;
                if (trimmedHistory.length > 0 && trimmedHistory[0].role !== 'user') {
                    const firstUserIndex = trimmedHistory.findIndex(m => m.role === 'user');
                    if (firstUserIndex > 0) {
                        trimmedHistory = trimmedHistory.slice(firstUserIndex);
                        finalTrimStartIndex = savedState.trimStartIndex + firstUserIndex;
                    }
                }
                
                return { history: trimmedHistory, trimStartIndex: finalTrimStartIndex };
            }
            
            // 使用保存的状态后仍然超过阈值，需要进一步裁剪
            // 使用 trimmedTokenResult 的回合信息进行裁剪
            return await this.performContextTrim(
                conversationId,
                config,
                historyOptions,
                savedState.trimStartIndex,
                trimmedTokenResult.estimatedTotalTokens,
                promptTokens,
                trimmedTokenResult.roundTokenInfos,
                threshold,
                maxContextTokens
            );
        }
        
        // 没有保存的状态，或者状态无效，从 summaryStartIndex 开始裁剪
        return await this.performContextTrim(
            conversationId,
            config,
            historyOptions,
            summaryStartIndex,
            fullTokenResult.estimatedTotalTokens,
            promptTokens,
            fullTokenResult.roundTokenInfos,
            threshold,
            maxContextTokens
        );
    }

    /**
     * 累加消息的 token 数
     * 
     * @param promptTokens 系统提示词 + 动态上下文的总 token 数
     * @returns 累加结果
     */
    private accumulateTokens(
        fullHistory: Content[],
        effectiveStartIndex: number,
        lastNonFunctionResponseUserIndex: number,
        historyThoughtMinIndex: number,
        historyThoughtMaxIndex: number,
        sendHistoryThoughts: boolean,
        sendHistoryThoughtSignatures: boolean,
        sendCurrentThoughts: boolean,
        sendCurrentThoughtSignatures: boolean,
        promptTokens: number  // 系统提示词 + 动态上下文的总 token 数
    ): { estimatedTotalTokens: number; hasEstimatedTokens: boolean; roundTokenInfos: RoundTokenInfo[] } {
        let estimatedTotalTokens = promptTokens;
        let hasEstimatedTokens = promptTokens > 0;
        const roundTokenInfos: RoundTokenInfo[] = [];
        let currentRoundStartIndex = -1;
        
        // 只累加 effectiveStartIndex 之后的消息
        for (let i = effectiveStartIndex; i < fullHistory.length; i++) {
            const message = fullHistory[i];
            
            if (message.role === 'user') {
                // 检测新回合开始（非函数响应的用户消息）
                if (!message.isFunctionResponse) {
                    // 保存上一个回合的信息
                    if (currentRoundStartIndex !== -1) {
                        roundTokenInfos.push({
                            startIndex: currentRoundStartIndex,
                            endIndex: i,
                            cumulativeTokens: estimatedTotalTokens
                        });
                    }
                    currentRoundStartIndex = i;
                }
                
                // 用户消息：优先使用 estimatedTokenCount，否则估算
                const tokenCount = message.estimatedTokenCount ?? this.tokenEstimationService.estimateMessageTokens(message);
                estimatedTotalTokens += tokenCount;
                hasEstimatedTokens = true;
            } else if (message.role === 'model' && message.usageMetadata) {
                // model 消息：根据用户配置、消息内容和回合位置决定是否计算思考 token
                const isCurrentRound = i >= lastNonFunctionResponseUserIndex;
                const hasThought = this.messageBuilderService.hasThoughtContent(message.parts);
                const hasSignatures = this.messageBuilderService.hasThoughtSignatures(message.parts);
                
                let includeThoughtsToken = false;
                
                if (isCurrentRound) {
                    // 当前轮：根据当前轮配置和消息内容决定
                    includeThoughtsToken = (sendCurrentThoughts && hasThought) ||
                                          (sendCurrentThoughtSignatures && hasSignatures);
                } else {
                    // 历史轮：根据历史轮配置、消息内容和 historyThinkingRounds 决定
                    const isInHistoryThoughtRange = i >= historyThoughtMinIndex && i < historyThoughtMaxIndex;
                    if (isInHistoryThoughtRange) {
                        includeThoughtsToken = (sendHistoryThoughts && hasThought) ||
                                              (sendHistoryThoughtSignatures && hasSignatures);
                    }
                }
                
                const modelTokens = (message.usageMetadata.candidatesTokenCount ?? 0) +
                                   (includeThoughtsToken ? (message.usageMetadata.thoughtsTokenCount ?? 0) : 0);
                if (modelTokens > 0) {
                    estimatedTotalTokens += modelTokens;
                    hasEstimatedTokens = true;
                }
            } else if (message.role === 'model') {
                // model 消息没有 usageMetadata，估算 token 数
                const modelTokens = this.tokenEstimationService.estimateMessageTokens(message);
                estimatedTotalTokens += modelTokens;
                hasEstimatedTokens = true;
            }
        }
        
        // 保存最后一个回合
        if (currentRoundStartIndex !== -1) {
            roundTokenInfos.push({
                startIndex: currentRoundStartIndex,
                endIndex: fullHistory.length,
                cumulativeTokens: estimatedTotalTokens
            });
        }
        
        return { estimatedTotalTokens, hasEstimatedTokens, roundTokenInfos };
    }

    /**
     * 执行上下文裁剪
     * 
     * @param promptTokens 系统提示词 + 动态上下文的总 token 数
     */
    private async performContextTrim(
        conversationId: string,
        config: BaseChannelConfig,
        historyOptions: GetHistoryOptions,
        effectiveStartIndex: number,
        estimatedTotalTokens: number,
        promptTokens: number,  // 系统提示词 + 动态上下文的总 token 数
        roundsAfterStart: RoundTokenInfo[],
        threshold: number,
        maxContextTokens: number
    ): Promise<ContextTrimInfo> {
        // 至少需要保留当前回合（最后一个回合）
        if (roundsAfterStart.length <= 1) {
            const history = await this.conversationManager.getHistoryForAPI(conversationId, {
                ...historyOptions,
                startIndex: effectiveStartIndex
            });
            return { history, trimStartIndex: effectiveStartIndex };
        }
        
        // 计算额外裁剪的 token 数
        // 额外裁剪是基于最大上下文计算的
        // 例如：最大上下文 200k，阈值 80%（160k），额外裁剪 30%（60k）
        // 当超过 160k 时触发裁剪，裁剪目标 = 160k - 60k = 100k
        // 这样下次从 100k 增长到 160k 需要更多回合，避免频繁触发裁剪
        const extraCutConfig = config.contextTrimExtraCut ?? 0;
        const extraCut = this.calculateThreshold(extraCutConfig, maxContextTokens);
        
        // 实际保留目标 = 阈值 - 额外裁剪
        const targetTokens = Math.max(0, threshold - extraCut);
        
        // 使用自计算的累计 token 数来计算需要跳过多少回合
        let roundsToSkip = 0;
        
        // 从 k=1 开始尝试，k 表示要跳过的回合数（从第 k 个回合开始保留）
        for (let k = 1; k < roundsAfterStart.length; k++) {
            const skippedTokens = roundsAfterStart[k - 1].cumulativeTokens - promptTokens;
            const remainingTokens = estimatedTotalTokens - skippedTokens;
            
            if (remainingTokens <= targetTokens) {
                roundsToSkip = k;
                break;
            }
        }
        
        // 如果遍历完还没找到合适的裁剪点，且总 token 超过阈值，只保留最后一个回合
        if (roundsToSkip === 0 && estimatedTotalTokens > targetTokens) {
            roundsToSkip = roundsAfterStart.length - 1;
        }
        
        if (roundsToSkip === 0) {
            // 不需要额外裁剪，返回从起始索引开始的历史
            const history = await this.conversationManager.getHistoryForAPI(conversationId, {
                ...historyOptions,
                startIndex: effectiveStartIndex
            });
            return { history, trimStartIndex: effectiveStartIndex };
        }
        
        // 计算在原始历史中的起始索引
        const trimStartIndex = roundsAfterStart[roundsToSkip].startIndex;
        
        // 使用 startIndex 选项获取裁剪后的历史
        let trimmedHistory = await this.conversationManager.getHistoryForAPI(conversationId, {
            ...historyOptions,
            startIndex: trimStartIndex
        });
        let finalTrimStartIndex = trimStartIndex;
        
        // 确保历史以 user 消息开始（Gemini API 要求）
        if (trimmedHistory.length > 0 && trimmedHistory[0].role !== 'user') {
            const firstUserIndex = trimmedHistory.findIndex(m => m.role === 'user');
            if (firstUserIndex > 0) {
                trimmedHistory = trimmedHistory.slice(firstUserIndex);
                finalTrimStartIndex = trimStartIndex + firstUserIndex;
            }
        }
        
        // 保存裁剪状态到持久化存储
        await this.saveTrimState(conversationId, {
            trimStartIndex: finalTrimStartIndex
        });
        
        return { history: trimmedHistory, trimStartIndex: finalTrimStartIndex };
    }

    /**
     * 获取用于 API 调用的历史（保持向后兼容的简化版本）
     */
    async getHistoryWithContextTrim(
        conversationId: string,
        config: BaseChannelConfig,
        historyOptions: GetHistoryOptions
    ): Promise<Content[]> {
        const result = await this.getHistoryWithContextTrimInfo(conversationId, config, historyOptions);
        return result.history;
    }
}
