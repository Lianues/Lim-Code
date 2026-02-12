/**
 * Token 估算服务
 * 
 * 负责 Token 的预计算、估算和计数相关功能。
 * 
 * 职责：
 * - 预计算用户消息的 Token 数量
 * - 计算系统提示词的 Token 数量
 * - 估算消息的 Token 数量（文本和多模态）
 * - 规范化渠道类型
 */

import type { Content, ContentPart, ChannelTokenCounts } from '../../../conversation/types';
import type { ConversationManager } from '../../../conversation/ConversationManager';
import type { SettingsManager } from '../../../settings/SettingsManager';
import type { TokenCountService } from '../../../channel/TokenCountService';

/**
 * 规范化的渠道类型
 */
export type NormalizedChannelType = 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | undefined;

export class TokenEstimationService {
    /** 本地估算安全系数：统一按偏大估算，避免低估导致超上下文 */
    private static readonly LOCAL_ESTIMATE_SAFETY_FACTOR = 1.5;

    constructor(
        private conversationManager: ConversationManager,
        private tokenCountService: TokenCountService,
        private settingsManager?: SettingsManager
    ) {}

    /**
     * 设置 SettingsManager
     */
    setSettingsManager(settingsManager: SettingsManager): void {
        this.settingsManager = settingsManager;
    }

    /**
     * 本地文本 token 估算（统一按 1.5 安全系数偏大估算）
     */
    private estimateTextTokensLocal(text: string): number {
        const base = Math.ceil(text.length / 4);
        return this.applyLocalEstimateSafetyFactor(base);
    }

    /** 对本地估算结果应用统一安全系数 */
    private applyLocalEstimateSafetyFactor(tokens: number): number {
        return Math.max(1, Math.ceil(tokens * TokenEstimationService.LOCAL_ESTIMATE_SAFETY_FACTOR));
    }

    /**
     * 预计算用户消息的 Token 数量
     * 
     * 尝试使用 API 获取精确值，失败时使用估算。
     * 结果会保存到消息的 tokenCountByChannel 字段。
     * 
     * @param conversationId 会话 ID
     * @param channelType 渠道类型
     * @param messageIndex 消息索引（默认为最后一条消息）
     * @param forceRecount 是否强制重新计算
     */
    async preCountUserMessageTokens(
        conversationId: string,
        channelType?: string,
        messageIndex?: number,
        forceRecount?: boolean
    ): Promise<void> {
        if (!this.settingsManager) {
            return;
        }
        
        const history = await this.conversationManager.getHistoryRef(conversationId);
        
        if (history.length === 0) {
            return;
        }
        
        // 获取用户消息索引
        const targetIndex = messageIndex ?? history.length - 1;
        const targetMessage = history[targetIndex];
        
        if (!targetMessage || targetMessage.role !== 'user') {
            return;
        }
        
        // 检查是否已经有 token 数（除非强制重新计算）
        if (!forceRecount && targetMessage.tokenCountByChannel?.[channelType || ''] !== undefined) {
            return;
        }
        
        // 获取 Token 计数配置
        const tokenCountConfig = this.settingsManager.getTokenCountConfig();
        const normalizedChannelType = this.normalizeChannelType(channelType);
        
        let tokenCount: number | undefined;
        
        // 尝试调用 API 获取精确 token 数
        if (normalizedChannelType && tokenCountConfig[normalizedChannelType]?.enabled) {
            // 每次调用前更新代理设置（以便运行时更改代理生效）
            this.tokenCountService.setProxyUrl(this.settingsManager.getEffectiveProxyUrl());
            
            // 直接传入整个用户消息
            const result = await this.tokenCountService.countTokens(
                normalizedChannelType,
                tokenCountConfig,
                [targetMessage]
            );
            
            if (result.success && result.totalTokens !== undefined) {
                tokenCount = result.totalTokens;
            }
        }
        
        // 如果 API 调用失败或未配置，使用估算
        if (tokenCount === undefined) {
            tokenCount = this.estimateMessageTokens(targetMessage);
        }
        
        // 更新用户消息的 token 数
        const tokenCountByChannel: ChannelTokenCounts = targetMessage.tokenCountByChannel || {};
        if (channelType) {
            tokenCountByChannel[channelType] = tokenCount;
        }
        
        await this.conversationManager.updateMessage(conversationId, targetIndex, {
            tokenCountByChannel,
            estimatedTokenCount: tokenCount  // 向后兼容
        });
    }
    
    /**
     * 规范化渠道类型
     *
     * 将渠道类型映射为 TokenCountService 支持的类型
     * 
     * @param channelType 渠道类型
     * @returns 规范化的渠道类型
     */
    normalizeChannelType(channelType?: string): NormalizedChannelType {
        if (!channelType) return undefined;
        
        const type = channelType.toLowerCase();
        if (type === 'gemini') return 'gemini';
        if (type === 'openai') return 'openai';
        if (type === 'anthropic') return 'anthropic';
        if (type === 'openai-responses') return 'openai-responses';
        
        return undefined;
    }
    
    /**
     * 批量并行预计算多条消息的 Token 数量
     * 
     * 所有计数请求将并行执行，节省时间。
     * 
     * @param conversationId 会话 ID
     * @param channelType 渠道类型
     * @param messageIndices 消息索引数组
     * @param forceRecount 是否强制重新计算
     */
    async preCountUserMessageTokensBatch(
        conversationId: string,
        channelType: string | undefined,
        messageIndices: number[],
        forceRecount?: boolean
    ): Promise<void> {
        if (!this.settingsManager || messageIndices.length === 0) {
            return;
        }
        
        const history = await this.conversationManager.getHistoryRef(conversationId);
        
        if (history.length === 0) {
            return;
        }
        
        // 获取 Token 计数配置
        const tokenCountConfig = this.settingsManager.getTokenCountConfig();
        const normalizedChannelType = this.normalizeChannelType(channelType);
        
        // 收集需要计数的消息
        const messagesToCount: Array<{ index: number; message: Content }> = [];
        
        for (const index of messageIndices) {
            const message = history[index];
            if (!message || message.role !== 'user') {
                continue;
            }
            
            // 检查是否已经有 token 数（除非强制重新计算）
            if (!forceRecount && message.tokenCountByChannel?.[channelType || ''] !== undefined) {
                continue;
            }
            
            messagesToCount.push({ index, message });
        }
        
        if (messagesToCount.length === 0) {
            return;
        }
        
        // 更新代理设置
        this.tokenCountService.setProxyUrl(this.settingsManager.getEffectiveProxyUrl());
        
        // 检查是否启用 API 计数
        const useApiCount = normalizedChannelType && tokenCountConfig[normalizedChannelType]?.enabled;
        
        if (useApiCount) {
            // 并行调用 API 计数
            const countPromises = messagesToCount.map(({ message }) =>
                this.tokenCountService.countTokens(
                    normalizedChannelType!,
                    tokenCountConfig,
                    [message]
                )
            );
            
            const results = await Promise.all(countPromises);
            
            // 批量更新消息（一次读写，避免并行 updateMessage 覆盖写）
            const batchUpdates: Array<{ messageIndex: number; updates: Partial<Content> }> = [];

            for (let i = 0; i < messagesToCount.length; i++) {
                const { index, message } = messagesToCount[i];
                const result = results[i];

                let tokenCount: number;
                if (result.success && result.totalTokens !== undefined) {
                    tokenCount = result.totalTokens;
                } else {
                    // API 失败，使用估算
                    tokenCount = this.estimateMessageTokens(message);
                }

                const tokenCountByChannel: ChannelTokenCounts = { ...(message.tokenCountByChannel || {}) };
                if (channelType) {
                    tokenCountByChannel[channelType] = tokenCount;
                }

                batchUpdates.push({
                    messageIndex: index,
                    updates: {
                        tokenCountByChannel,
                        estimatedTokenCount: tokenCount
                    }
                });
            }

            await this.conversationManager.updateMessagesBatch(conversationId, batchUpdates);
        } else {
            // 不使用 API，直接估算并批量更新（一次读写，避免并行 updateMessage 覆盖写）
            const batchUpdates: Array<{ messageIndex: number; updates: Partial<Content> }> = [];

            for (const { index, message } of messagesToCount) {
                const tokenCount = this.estimateMessageTokens(message);

                const tokenCountByChannel: ChannelTokenCounts = { ...(message.tokenCountByChannel || {}) };
                if (channelType) {
                    tokenCountByChannel[channelType] = tokenCount;
                }

                batchUpdates.push({
                    messageIndex: index,
                    updates: {
                        tokenCountByChannel,
                        estimatedTokenCount: tokenCount
                    }
                });
            }

            await this.conversationManager.updateMessagesBatch(conversationId, batchUpdates);
        }
    }
    
    /**
     * 计算系统提示词的 token 数
     *
     * 尝试使用 API 计算精确值，失败时使用估算。
     *
     * @param systemPrompt 系统提示词
     * @param channelType 渠道类型
     * @returns token 数量
     */
    async countSystemPromptTokens(
        systemPrompt: string,
        channelType?: string
    ): Promise<number> {
        if (!this.settingsManager) {
            // 没有设置管理器，直接估算
            return this.estimateTextTokensLocal(systemPrompt);
        }
        
        const tokenCountConfig = this.settingsManager.getTokenCountConfig();
        const normalizedChannelType = this.normalizeChannelType(channelType);
        
        // 尝试调用 API 获取精确 token 数
        if (normalizedChannelType && tokenCountConfig[normalizedChannelType]?.enabled) {
            // 更新代理设置
            this.tokenCountService.setProxyUrl(this.settingsManager.getEffectiveProxyUrl());
            
            // 创建一个包含系统提示词的消息用于 token 计数
            const systemMessage: Content = {
                role: 'user',
                parts: [{ text: systemPrompt }]
            };
            
            const result = await this.tokenCountService.countTokens(
                normalizedChannelType,
                tokenCountConfig,
                [systemMessage]
            );
            
            if (result.success && result.totalTokens !== undefined) {
                return result.totalTokens;
            }
        }
        
        // 回退到估算
        return this.estimateTextTokensLocal(systemPrompt);
    }
    
    /**
     * 批量并行计算多个文本的 token 数
     *
     * 所有计数请求将并行执行，节省时间。
     *
     * @param texts 要计算的文本数组
     * @param channelType 渠道类型
     * @returns token 数量数组（与输入顺序一致）
     */
    async countTextTokensBatch(
        texts: (string | null | undefined)[],
        channelType?: string
    ): Promise<number[]> {
        if (!this.settingsManager) {
            // 没有设置管理器，直接估算
            return texts.map(text => text ? this.estimateTextTokensLocal(text) : 0);
        }
        
        const tokenCountConfig = this.settingsManager.getTokenCountConfig();
        const normalizedChannelType = this.normalizeChannelType(channelType);
        
        // 检查是否启用 API 计数
        const useApiCount = normalizedChannelType && tokenCountConfig[normalizedChannelType]?.enabled;
        
        if (!useApiCount) {
            // 不使用 API，直接估算
            return texts.map(text => text ? this.estimateTextTokensLocal(text) : 0);
        }
        
        // 更新代理设置
        this.tokenCountService.setProxyUrl(this.settingsManager.getEffectiveProxyUrl());
        
        // 筛选出需要计数的文本及其索引
        const textsToCount: Array<{ index: number; text: string }> = [];
        for (let i = 0; i < texts.length; i++) {
            if (texts[i]) {
                textsToCount.push({ index: i, text: texts[i]! });
            }
        }
        
        if (textsToCount.length === 0) {
            return texts.map(() => 0);
        }
        
        // 并行调用 API 计数
        const countPromises = textsToCount.map(({ text }) => {
            const message: Content = {
                role: 'user',
                parts: [{ text }]
            };
            return this.tokenCountService.countTokens(
                normalizedChannelType!,
                tokenCountConfig,
                [message]
            );
        });
        
        const results = await Promise.all(countPromises);
        
        // 构建结果数组
        const tokenCounts: number[] = texts.map(text => text ? this.estimateTextTokensLocal(text) : 0);
        
        // 填入 API 结果
        for (let i = 0; i < textsToCount.length; i++) {
            const { index } = textsToCount[i];
            const result = results[i];
            if (result.success && result.totalTokens !== undefined) {
                tokenCounts[index] = result.totalTokens;
            }
            // API 失败时保留估算值
        }
        
        return tokenCounts;
    }
    
    /**
     * 估算一条消息的 token 数
     *
     * 遍历消息的所有 parts，根据类型进行估算：
     * - text: 每 4 个字符约 1 token
     * - inlineData: 使用 estimateMultimodalTokens
     * - functionCall: JSON 序列化后每 4 字符约 1 token
     * - functionResponse: JSON 序列化后每 4 字符约 1 token
     *
     * @param message 消息
     * @returns 估算的 token 数
     */
    estimateMessageTokens(message: Content): number {
        let tokens = 0;
        
        for (const part of message.parts) {
            if (part.text) {
                tokens += Math.ceil(part.text.length / 4);
            }
            if (part.inlineData) {
                tokens += this.estimateMultimodalTokens(part.inlineData);
            }
            if (part.functionCall) {
                const argsStr = JSON.stringify(part.functionCall.args);
                tokens += Math.ceil((part.functionCall.name.length + argsStr.length) / 4);
            }
            if (part.functionResponse) {
                const responseStr = JSON.stringify(part.functionResponse.response);
                tokens += Math.ceil((part.functionResponse.name.length + responseStr.length) / 4);
                // 如果有 parts（多模态数据）
                if (part.functionResponse.parts) {
                    for (const responsePart of part.functionResponse.parts) {
                        if (responsePart.inlineData) {
                            tokens += this.estimateMultimodalTokens(responsePart.inlineData);
                        }
                    }
                }
            }
        }
        
        // 最小返回 1 token
        return this.applyLocalEstimateSafetyFactor(Math.max(1, tokens));
    }
    
    /**
     * 估算多媒体数据的 token 数
     *
     * 根据 mimeType 使用不同的估算策略：
     * - 图片: 固定 500 tokens（Gemini 实际 258-1032）
     * - 音频: 32 tokens/秒，按 base64 大小估算时长
     * - 视频: 295 tokens/秒（263 图像 + 32 音频），按 base64 大小估算时长
     * - 文档(PDF): 约 500 tokens/页，按 base64 大小估算页数
     * - 其他: 使用保守估算 1000 tokens
     *
     * @param inlineData 多媒体数据
     * @returns 估算的 token 数
     */
    estimateMultimodalTokens(inlineData: { mimeType: string; data: string }): number {
        const mimeType = inlineData.mimeType.toLowerCase();
        
        // 计算原始数据大小（base64 解码后约为原长度的 3/4）
        const base64Length = inlineData.data.length;
        const estimatedBytes = Math.floor(base64Length * 0.75);
        
        // 图片类型
        if (mimeType.startsWith('image/')) {
            // Gemini: 258-1032 tokens
            // OpenAI: 85-1105 tokens
            // Anthropic: 最大 1600 tokens
            // 使用中间值 500 tokens
            return 500;
        }
        
        // 音频类型
        if (mimeType.startsWith('audio/')) {
            // Gemini: 32 tokens/秒
            // 估算音频时长：
            // - MP3: 约 16 kbps = 2 KB/秒
            // - WAV: 约 176 kbps = 22 KB/秒
            // - 使用平均值 10 KB/秒
            const estimatedDurationSeconds = estimatedBytes / (10 * 1024);
            const audioTokens = Math.ceil(estimatedDurationSeconds * 32);
            // 设置合理的上下限
            return Math.max(100, Math.min(audioTokens, 50000));
        }
        
        // 视频类型
        if (mimeType.startsWith('video/')) {
            // Gemini: 263 tokens/秒 (视频帧) + 32 tokens/秒 (音频) = 295 tokens/秒
            // 估算视频时长：
            // - 压缩视频约 1 MB/分钟 = 17 KB/秒
            const estimatedDurationSeconds = estimatedBytes / (17 * 1024);
            const videoTokens = Math.ceil(estimatedDurationSeconds * 295);
            // 设置合理的上下限
            return Math.max(500, Math.min(videoTokens, 200000));
        }
        
        // 文档类型 (PDF, DOCX 等)
        if (mimeType === 'application/pdf' ||
            mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mimeType === 'application/msword') {
            // Gemini: 每页约 215-695 tokens
            // 估算页数：平均每页 PDF 约 50-100 KB
            const estimatedPages = Math.max(1, Math.ceil(estimatedBytes / (75 * 1024)));
            const docTokens = estimatedPages * 500;  // 每页 500 tokens
            return Math.max(500, Math.min(docTokens, 100000));
        }
        
        // 电子表格
        if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            mimeType === 'application/vnd.ms-excel' ||
            mimeType === 'text/csv') {
            // 按数据大小估算，每 KB 约 100 tokens
            const spreadsheetTokens = Math.ceil(estimatedBytes / 1024) * 100;
            return Math.max(200, Math.min(spreadsheetTokens, 50000));
        }
        
        // 纯文本
        if (mimeType.startsWith('text/')) {
            // 文本：每 4 个字符约 1 token
            return Math.ceil(estimatedBytes / 4);
        }
        
        // 其他类型：使用保守估算
        // 无法确定类型时，使用较大的固定值
        return 1000;
    }
}
