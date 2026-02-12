/**
 * LimCode - 上下文总结服务
 *
 * 负责将对话历史压缩为总结消息
 */

import { t } from '../../../../i18n';
import type { ConfigManager } from '../../../config/ConfigManager';
import type {ChannelManager } from '../../../channel/ChannelManager';
import type { ConversationManager } from '../../../conversation/ConversationManager';
import type { SettingsManager } from '../../../settings/SettingsManager';
import type { Content } from '../../../conversation/types';
import type { GenerateResponse, StreamChunk } from '../../../channel/types';
import type { BaseChannelConfig } from '../../../config/configs/base';
import { StreamAccumulator } from '../../../channel/StreamAccumulator';
import type { ContextTrimService } from './ContextTrimService';
import type { TokenEstimationService } from './TokenEstimationService';
import type {
    SummarizeContextRequestData,
    SummarizeContextSuccessData,
    SummarizeContextErrorData
} from '../types';

/**
 * 上下文总结服务
 *
 * 职责：
 * 1. 处理上下文总结请求
 * 2. 识别需要总结的回合范围
 * 3. 清理历史消息中的内部字段
 * 4. 调用 AI 生成总结
 * 5. 管理总结消息的插入和删除
 */
export class SummarizeService {
    constructor(
        private configManager: ConfigManager,
        private channelManager: ChannelManager,
        private conversationManager: ConversationManager,
        private contextTrimService: ContextTrimService,
        private settingsManager?: SettingsManager,
        private tokenEstimationService?: TokenEstimationService
    ) {}

    /**
     * 设置 Token 估算服务
     */
    setTokenEstimationService(service: TokenEstimationService): void {
        this.tokenEstimationService = service;
    }

    /**
     * 设置设置管理器
     */
    setSettingsManager(settingsManager: SettingsManager): void {
        this.settingsManager = settingsManager;
    }

    /**
     * 处理上下文总结请求
     *
     * 将指定范围的对话历史压缩为一条总结消息
     *
     * @param request 总结请求数据
     * @returns 总结响应数据
     */
    async handleSummarizeContext(
        request: SummarizeContextRequestData
    ): Promise<SummarizeContextSuccessData | SummarizeContextErrorData> {
        try {
            const { conversationId, configId } = request;

            // 从设置中读取总结配置
            let configKeepRecentRounds = 2;  // 默认值
            let configSummarizePrompt = '';  // 默认值（空则使用内置提示词）
            let useSeparateModel = false;
            let summarizeChannelId = '';
            let summarizeModelId = '';

            if (this.settingsManager) {
                const summarizeConfig = this.settingsManager.getSummarizeConfig();
                if (summarizeConfig) {
                    if (typeof summarizeConfig.keepRecentRounds === 'number') {
                        configKeepRecentRounds = summarizeConfig.keepRecentRounds;
                    }
                    if (typeof summarizeConfig.summarizePrompt === 'string') {
                        configSummarizePrompt = summarizeConfig.summarizePrompt;
                    }
                    useSeparateModel = !!summarizeConfig.useSeparateModel;
                    summarizeChannelId = summarizeConfig.summarizeChannelId || '';
                    summarizeModelId = summarizeConfig.summarizeModelId || '';
                }
            }
            const keepRecentRounds = configKeepRecentRounds;

            // 1. 确保对话存在
            await this.conversationManager.getHistory(conversationId);

            // 2. 确定使用的渠道配置
            let actualConfigId = configId;
            let actualModelId: string | undefined;

            if (useSeparateModel && summarizeChannelId) {
                const summarizeConfig = await this.configManager.getConfig(summarizeChannelId);
                if (summarizeConfig && summarizeConfig.enabled) {
                    actualConfigId = summarizeChannelId;
                    if (summarizeModelId) {
                        actualModelId = summarizeModelId;
                    }
                    console.log(`[Summarize] Using dedicated model: channel=${summarizeChannelId}, model=${summarizeModelId || 'default'}`);
                } else {
                    console.log(`[Summarize] Dedicated channel not available, falling back to chat config`);
                }
            }

            // 3. 验证配置
            const config = await this.configManager.getConfig(actualConfigId);
            if (!config) {
                return {
                    success: false,
                    error: {
                        code: 'CONFIG_NOT_FOUND',
                        message: t('modules.api.chat.errors.configNotFound', { configId: actualConfigId })
                    }
                };
            }

            if (!config.enabled) {
                return {
                    success: false,
                    error: {
                        code: 'CONFIG_DISABLED',
                        message: t('modules.api.chat.errors.configDisabled', { configId: actualConfigId })
                    }
                };
            }

            // 4. 获取对话历史
            const fullHistory = await this.conversationManager.getHistoryRef(conversationId);

            // 5. 找到最后一个总结消息的位置
            // - 回合识别从最后一个总结消息之后开始（避免反复把旧对话算进“新回合”）
            // - 但真正发给 AI 做“合并总结”的内容，需要包含最后一个总结消息本身（用于承接之前的总结）
            const lastSummaryIndex = this.contextTrimService.findLastSummaryIndex(fullHistory);
            const historyStartIndex = lastSummaryIndex >= 0 ? lastSummaryIndex + 1 : 0;

            // 只对总结之后的历史进行回合识别
            const historyAfterSummary = fullHistory.slice(historyStartIndex);
            const rounds = this.contextTrimService.identifyRounds(historyAfterSummary);

            if (rounds.length <= keepRecentRounds) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_ENOUGH_ROUNDS',
                        message: t('modules.api.chat.errors.notEnoughRounds', { currentRounds: rounds.length, keepRounds: keepRecentRounds })
                    }
                };
            }

            // 6. 确定总结范围
            const roundsToSummarize = rounds.length - keepRecentRounds;

            if (roundsToSummarize <= 0) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_ENOUGH_CONTENT',
                        message: t('modules.api.chat.errors.notEnoughContent', { currentRounds: rounds.length, keepRounds: keepRecentRounds })
                    }
                };
            }

            // 计算总结范围的结束索引
            const summarizeEndIndexRelative = roundsToSummarize >= rounds.length
                ? historyAfterSummary.length
                : rounds[roundsToSummarize].startIndex;
            const summarizeEndIndex = historyStartIndex + summarizeEndIndexRelative;

            // 提取需要总结的消息：
            // - 如果存在旧总结，则用“旧总结 + 总结之后的新消息”作为输入，避免每次都把最早的原始对话重新发给 AI。
            // - 如果不存在旧总结，则从 0 开始。
            const summarizeInputStartIndex = lastSummaryIndex >= 0 ? lastSummaryIndex : 0;
            const messagesToSummarize = fullHistory.slice(summarizeInputStartIndex, summarizeEndIndex);

            // 计算“本次总结后，累计覆盖了多少条原始消息”
            const previousSummarizedCount = lastSummaryIndex >= 0
                ? (typeof fullHistory[lastSummaryIndex]?.summarizedMessageCount === 'number'
                    ? (fullHistory[lastSummaryIndex].summarizedMessageCount as number)
                    : lastSummaryIndex)
                : 0;
            // 这次新纳入总结的消息数量（不包含旧 summary 本身）
            const newlySummarizedCount = summarizeEndIndex - historyStartIndex;
            const totalSummarizedCount = previousSummarizedCount + newlySummarizedCount;

            if (messagesToSummarize.length === 0) {
                return {
                    success: false,
                    error: {
                        code: 'NO_MESSAGES_TO_SUMMARIZE',
                        message: t('modules.api.chat.errors.noMessagesToSummarize')
                    }
                };
            }

            // 7. 构建总结请求
            const defaultPrompt = t('modules.api.chat.prompts.defaultSummarizePrompt');
            const configuredManualPrompt = configSummarizePrompt.trim();
            const prompt = configuredManualPrompt || defaultPrompt;

            // 清理历史中不应发送给 API 的内部字段
            const cleanedMessages = this.cleanMessagesForSummarize(messagesToSummarize, config);

            // 构建历史
            const summaryRequestHistory: Content[] = [
                ...cleanedMessages,
                {
                    role: 'user',
                    parts: [{ text: prompt }]
                }
            ];

            // 8. 调用 AI 生成总结
            const generateOptions: {
                configId: string;
                history: Content[];
                abortSignal?: AbortSignal;
                skipTools: boolean;
                skipRetry: boolean;
                modelOverride?: string;
            } = {
                configId: actualConfigId,
                history: summaryRequestHistory,
                abortSignal: request.abortSignal,
                skipTools: true,
                skipRetry: true
            };

            if (actualModelId) {
                generateOptions.modelOverride = actualModelId;
            }

            const response = await this.channelManager.generate(generateOptions);

            // 处理响应
            let finalContent: Content;

            if (this.isAsyncGenerator(response)) {
                const accumulator = new StreamAccumulator();
                accumulator.setProviderType(config.type as 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom');

                for await (const chunk of response) {
                    if (request.abortSignal?.aborted) {
                        return {
                            success: false,
                            error: {
                                code: 'ABORTED',
                                message: t('modules.api.chat.errors.summarizeAborted')
                            }
                        };
                    }
                    accumulator.add(chunk);
                }

                finalContent = accumulator.getContent();
            } else {
                finalContent = (response as GenerateResponse).content;
            }

            // 9. 提取 token 信息
            const beforeTokenCount = finalContent.usageMetadata?.promptTokenCount;
            const afterTokenCount = finalContent.usageMetadata?.candidatesTokenCount;

            // 10. 提取总结文本
            const summaryText = finalContent.parts
                .filter(p => p.text && !p.thought)
                .map(p => p.text)
                .join('\n')
                .trim();

            if (!summaryText) {
                return {
                    success: false,
                    error: {
                        code: 'EMPTY_SUMMARY',
                        message: t('modules.api.chat.errors.emptySummary')
                    }
                };
            }

            // 11. 插入新的总结消息
            // 注意：这里不删除旧的总结消息。
            // 这样用户可以保留每一次总结的历史记录；同时后续上下文裁剪/下一次总结都会自动使用“最后一个总结消息”。
            const insertIndex = summarizeEndIndex;

            // 12. 创建总结消息并添加到历史
            const summaryContent: Content = {
                role: 'user',
                parts: [{ text: `${t('modules.api.chat.prompts.summaryPrefix')}\n\n${summaryText}` }],
                index: insertIndex,
                isSummary: true,
                summarizedMessageCount: totalSummarizedCount,
                usageMetadata: {
                    promptTokenCount: beforeTokenCount,
                    candidatesTokenCount: afterTokenCount
                }
            };

            await this.conversationManager.insertContent(conversationId, insertIndex, summaryContent);

            return {
                success: true,
                summaryContent,
                summarizedMessageCount: totalSummarizedCount,
                beforeTokenCount,
                afterTokenCount,
                insertIndex
            };

        } catch (error) {
            const err = error as any;
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.chat.errors.unknownError')
                }
            };
        }
    }

    /**
     * 清理消息中不应发送给 API 的内部字段
     */
    private cleanMessagesForSummarize(messages: Content[], config: BaseChannelConfig): Content[] {
        return messages.map(msg => ({
            ...msg,
            parts: msg.parts
                // 过滤掉思考内容
                .filter(part => !part.thought && !(part.thoughtSignatures && Object.keys(part).length === 1))
                .map(part => {
                    let cleanedPart = { ...part };

                    // 移除思考签名
                    if (cleanedPart.thoughtSignatures) {
                        const { thoughtSignatures, ...rest } = cleanedPart;
                        cleanedPart = rest;
                    }

                    // 清理 functionCall 中的 rejected 字段
                    if (cleanedPart.functionCall) {
                        const { rejected, ...cleanedFunctionCall } = cleanedPart.functionCall;
                        cleanedPart = {
                            ...cleanedPart,
                            functionCall: cleanedFunctionCall
                        };
                    }

                    // 清理 inlineData 中的元数据字段
                    if (cleanedPart.inlineData) {
                        if (config.type === 'gemini') {
                            const { id, name, ...cleanedInlineData } = cleanedPart.inlineData;
                            cleanedPart = {
                                ...cleanedPart,
                                inlineData: cleanedInlineData
                            };
                        } else {
                            const { id, name, displayName, ...cleanedInlineData } = cleanedPart.inlineData;
                            cleanedPart = {
                                ...cleanedPart,
                                inlineData: cleanedInlineData
                            };
                        }
                    }

                    // 清理 functionResponse.response 中的内部字段
                    if (cleanedPart.functionResponse?.response && typeof cleanedPart.functionResponse.response === 'object') {
                        let cleanedResponse = cleanedPart.functionResponse.response as Record<string, unknown>;
                        const { diffContentId, diffId, diffs, pendingDiffId, ...rest } = cleanedResponse;

                        if (rest.data && typeof rest.data === 'object') {
                            const { diffContentId: dataDiffContentId, diffId: dataDiffId, diffs: dataDiffs, pendingDiffId: dataPendingDiffId, ...dataRest } = rest.data as Record<string, unknown>;

                            if (Array.isArray(dataRest.results)) {
                                dataRest.results = (dataRest.results as Array<Record<string, unknown>>).map(item => {
                      if (item && typeof item === 'object') {
                                        const { diffContentId: itemDiffContentId, pendingDiffId: itemPendingDiffId, ...itemRest } = item;
                                        return itemRest;
                                    }
                                    return item;
                                });
                            }

                            rest.data = dataRest;
                        }

                        cleanedPart = {
                            ...cleanedPart,
                            functionResponse: {
                                ...cleanedPart.functionResponse,
                                response: rest
                            }
                        };
                    }

                    return cleanedPart;
                })
        }));
    }

    /**
     * 处理自动总结请求
     *
     * 与手动总结的区别：
     * 1. 使用专用的自动总结提示词（面向"接力继续"，包含 TODO、下一步等）
     * 2. 当待总结内容超出总结模型上下文时，保留最后一轮工具交互不总结
     * 3. 总结完成后循环自然继续，AI 看到总结中的 TODO 和进度即可无缝衔接
     *
     * @param conversationId 对话 ID
     * @param configId 当前使用的配置 ID
     * @param abortSignal 取消信号
     * @returns 总结结果
     */
    async handleAutoSummarize(
        conversationId: string,
        configId: string,
        abortSignal?: AbortSignal
    ): Promise<SummarizeContextSuccessData | SummarizeContextErrorData> {
        try {
            // 从设置中读取总结配置
            let keepRecentRounds = 2;
            let useSeparateModel = false;
            let summarizeChannelId = '';
            let configAutoSummarizePrompt = '';
            let summarizeModelId = '';

            if (this.settingsManager) {
                const summarizeConfig = this.settingsManager.getSummarizeConfig();
                if (summarizeConfig) {
                    if (typeof summarizeConfig.keepRecentRounds === 'number') {
                        keepRecentRounds = summarizeConfig.keepRecentRounds;
                    }
                    useSeparateModel = !!summarizeConfig.useSeparateModel;
                    summarizeChannelId = summarizeConfig.summarizeChannelId || '';
                    summarizeModelId = summarizeConfig.summarizeModelId || '';
                    if (typeof summarizeConfig.autoSummarizePrompt === 'string') {
                        configAutoSummarizePrompt = summarizeConfig.autoSummarizePrompt;
                    }
                }
            }

            // 1. 确定使用的渠道配置
            let actualConfigId = configId;
            let actualModelId: string | undefined;

            if (useSeparateModel && summarizeChannelId) {
                const summarizeConfig = await this.configManager.getConfig(summarizeChannelId);
                if (summarizeConfig && summarizeConfig.enabled) {
                    actualConfigId = summarizeChannelId;
                    if (summarizeModelId) {
                        actualModelId = summarizeModelId;
                    }
                    console.log(`[AutoSummarize] Using dedicated model: channel=${summarizeChannelId}, model=${summarizeModelId || 'default'}`);
                } else {
                    console.log(`[AutoSummarize] Dedicated channel not available, falling back to chat config`);
                }
            }

            // 2. 验证配置
            const config = await this.configManager.getConfig(actualConfigId);
            if (!config) {
                return {
                    success: false,
                    error: {
                        code: 'CONFIG_NOT_FOUND',
                        message: t('modules.api.chat.errors.configNotFound', { configId: actualConfigId })
                    }
                };
            }

            if (!config.enabled) {
                return {
                    success: false,
                    error: {
                        code: 'CONFIG_DISABLED',
                        message: t('modules.api.chat.errors.configDisabled', { configId: actualConfigId })
                    }
                };
            }

            // 3. 获取对话历史
            const fullHistory = await this.conversationManager.getHistoryRef(conversationId);

            // 4. 找到最后一个总结消息
            const lastSummaryIndex = this.contextTrimService.findLastSummaryIndex(fullHistory);
            const historyStartIndex = lastSummaryIndex >= 0 ? lastSummaryIndex + 1 : 0;

            // 只对总结之后的历史进行回合识别
            const historyAfterSummary = fullHistory.slice(historyStartIndex);
            const rounds = this.contextTrimService.identifyRounds(historyAfterSummary);

            if (rounds.length <= keepRecentRounds) {
                return {
                    success: false,
                    error: {
                        code: 'NOT_ENOUGH_ROUNDS',
                        message: t('modules.api.chat.errors.notEnoughRounds', { currentRounds: rounds.length, keepRounds: keepRecentRounds })
                    }
                };
            }

            // 5. 确定总结范围
            const roundsToSummarize = rounds.length - keepRecentRounds;
            const summarizeEndIndexRelative = roundsToSummarize >= rounds.length
                ? historyAfterSummary.length
                : rounds[roundsToSummarize].startIndex;
            const summarizeEndIndex = historyStartIndex + summarizeEndIndexRelative;

            // 提取需要总结的消息（包含旧总结以实现增量总结）
            const summarizeInputStartIndex = lastSummaryIndex >= 0 ? lastSummaryIndex : 0;
            let messagesToSummarize = fullHistory.slice(summarizeInputStartIndex, summarizeEndIndex);

            if (messagesToSummarize.length === 0) {
                return {
                    success: false,
                    error: {
                        code: 'NO_MESSAGES_TO_SUMMARIZE',
                        message: t('modules.api.chat.errors.noMessagesToSummarize')
                    }
                };
            }

            // 6. 检查待总结内容是否超出总结模型的上下文
            // 获取总结模型的最大上下文（预留 50% 给输出）
            const summarizeModelMaxContext = (config as any).maxContextTokens || 128000;
            const maxInputTokens = Math.floor(summarizeModelMaxContext * 0.5);

            // 估算待总结消息的 token 量
            const estimatedTokens = this.estimateMessagesTokens(messagesToSummarize);
            let insertIndex = summarizeEndIndex;

            if (estimatedTokens > maxInputTokens) {
                // 超出了总结模型上下文：保留最后一轮工具交互，缩小总结范围
                // 找到最后一对 functionCall + functionResponse
                let lastToolInteractionStart = -1;
                for (let i = messagesToSummarize.length - 1; i >= 0; i--) {
                    const msg = messagesToSummarize[i];
                    if (msg.role === 'model' && msg.parts.some(p => p.functionCall)) {
                        lastToolInteractionStart = i;
                        break;
                    }
                }

                if (lastToolInteractionStart > 0) {
                    // 把最后一轮工具交互排除在总结范围外
                    // 总结到该交互之前的所有消息
                    const newEndIndex = summarizeInputStartIndex + lastToolInteractionStart;
                    messagesToSummarize = fullHistory.slice(summarizeInputStartIndex, newEndIndex);
   insertIndex = newEndIndex;
                    console.log(`[AutoSummarize] Content exceeds context limit, excluding last tool interaction. New range: ${summarizeInputStartIndex}-${newEndIndex}`);
                }
                // 如果找不到工具交互或排除后仍然为空，继续用原始范围尝试（让 API 自己处理截断）
            }

            if (messagesToSummarize.length === 0) {
                return {
                    success: false,
                    error: {
                        code: 'NO_MESSAGES_TO_SUMMARIZE',
                        message: t('modules.api.chat.errors.noMessagesToSummarize')
                    }
                };
            }

            // 7. 计算累计覆盖的原始消息数
            const previousSummarizedCount = lastSummaryIndex >= 0
                ? (typeof fullHistory[lastSummaryIndex]?.summarizedMessageCount === 'number'
                    ? (fullHistory[lastSummaryIndex].summarizedMessageCount as number)
                    : lastSummaryIndex)
                : 0;
            const newlySummarizedCount = insertIndex - historyStartIndex;
            const totalSummarizedCount = previousSummarizedCount + newlySummarizedCount;

            // 8. 构建总结请求（自动总结提示词：优先用户配置，回退内置提示词）
            const defaultAutoPrompt = t('modules.api.chat.prompts.autoSummarizePrompt');
            const configuredAutoPrompt = configAutoSummarizePrompt.trim();
            const prompt = configuredAutoPrompt || defaultAutoPrompt;

            // 清理历史中不应发送给 API 的内部字段
            const cleanedMessages = this.cleanMessagesForSummarize(messagesToSummarize, config);

            const summaryRequestHistory: Content[] = [
                ...cleanedMessages,
                {
                    role: 'user',
                    parts: [{ text: prompt }]
                }
            ];

            // 9. 调用 AI 生成总结
            const generateOptions: {
                configId: string;
                history: Content[];
                abortSignal?: AbortSignal;
                skipTools: boolean;
                skipRetry: boolean;
                modelOverride?: string;
            } = {
                configId: actualConfigId,
                history: summaryRequestHistory,
                abortSignal,
                skipTools: true,
                skipRetry: true
            };

            if (actualModelId) {
                generateOptions.modelOverride = actualModelId;
            }

            console.log(`[AutoSummarize] Generating summary for conversation ${conversationId}, range: ${summarizeInputStartIndex}-${insertIndex}, messages: ${messagesToSummarize.length}`);
            const proxyUrl = this.settingsManager?.getEffectiveProxyUrl?.();
            console.log(`[AutoSummarize] Effective proxy: ${proxyUrl || 'none'}`);


            const response = await this.channelManager.generate(generateOptions);

            // 处理响应
            let finalContent: Content;

            if (this.isAsyncGenerator(response)) {
                const accumulator = new StreamAccumulator();
                accumulator.setProviderType(config.type as 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom');

                for await (const chunk of response) {
                    if (abortSignal?.aborted) {
                        return {
                            success: false,
                            error: {
                                code: 'ABORTED',
                                message: t('modules.api.chat.errors.summarizeAborted')
                            }
                        };
                    }
                    accumulator.add(chunk);
                }

                finalContent = accumulator.getContent();
            } else {
                finalContent = (response as GenerateResponse).content;
            }

            // 10. 提取 token 信息
            const beforeTokenCount = finalContent.usageMetadata?.promptTokenCount;
            const afterTokenCount = finalContent.usageMetadata?.candidatesTokenCount;

            // 11. 提取总结文本
            const summaryText = finalContent.parts
                .filter(p => p.text && !p.thought)
                .map(p => p.text)
                .join('\n')
                .trim();

            if (!summaryText) {
                return {
                    success: false,
                    error: {
                        code: 'EMPTY_SUMMARY',
                        message: t('modules.api.chat.errors.emptySummary')
                    }
                };
            }

            // 12. 创建总结消息并插入到历史
            const summaryContent: Content = {
                role: 'user',
                parts: [{ text: `${t('modules.api.chat.prompts.summaryPrefix')}\n\n${summaryText}` }],
                index: insertIndex,
                isSummary: true,
                isAutoSummary: true,
                summarizedMessageCount: totalSummarizedCount,
                usageMetadata: {
                    promptTokenCount: beforeTokenCount,
                    candidatesTokenCount: afterTokenCount
                }
            };

            await this.conversationManager.insertContent(conversationId, insertIndex, summaryContent);

            console.log(`[AutoSummarize] Summary inserted at index ${insertIndex}, summarized ${totalSummarizedCount} messages`);

            return {
                success: true,
                summaryContent,
                summarizedMessageCount: totalSummarizedCount,
                beforeTokenCount,
                afterTokenCount,
                insertIndex
            };

        } catch (error) {
            const err = error as any;
            console.error(`[AutoSummarize] Failed:`, err.message || err);
            return {
                success: false,
                error: {
                    code: err.code || 'UNKNOWN_ERROR',
                    message: err.message || t('modules.api.chat.errors.unknownError')
                }
            };
        }
    }

    /**
     * 估算一组消息的 token 数
     *
     * 用于判断待总结内容是否超出总结模型上下文。
     * 本地估算的安全系数由 TokenEstimationService 统一处理（1.5）。
     */
    private estimateMessagesTokens(messages: Content[]): number {
        let total = 0;
        for (const msg of messages) {
            if (this.tokenEstimationService) {
                total += this.tokenEstimationService.estimateMessageTokens(msg);
            } else {
                // 兜底：无 tokenEstimationService 时按统一安全系数 1.5 偏大估算
                const text = msg.parts.map(p => p.text || '').join('')
                total += Math.ceil(Math.ceil(text.length / 4) * 1.5) || 1
            }
        }
        return total;
    }

    /**
     * 检查是否是 AsyncGenerator
     */
    private isAsyncGenerator(obj: any): obj is AsyncGenerator<StreamChunk> {
        return obj && typeof obj[Symbol.asyncIterator] === 'function';
    }
}
