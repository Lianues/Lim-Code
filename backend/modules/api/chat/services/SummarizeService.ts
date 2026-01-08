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
        private settingsManager?: SettingsManager
    ) {}

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

            // 5. 找到最后一个总结消息的位置，从该位置之后开始识别回合
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

            // 提取需要总结的消息
            const messagesToSummarize = fullHistory.slice(0, summarizeEndIndex);

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
            const prompt = configSummarizePrompt || defaultPrompt;

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

            // 11. 删除已存在的旧总结消息
            let insertIndex = summarizeEndIndex;
            const currentHistory = await this.conversationManager.getHistoryRef(conversationId);

            const summaryIndicesToDelete: number[] = [];
            for (let i = 0; i < summarizeEndIndex; i++) {
                if (currentHistory[i]?.isSummary) {
                    summaryIndicesToDelete.push(i);
                }
            }

            if (summaryIndicesToDelete.length > 0) {
                for (let i = summaryIndicesToDelete.length - 1; i >= 0; i--) {
                    const indexToDelete = summaryIndicesToDelete[i];
                    await this.conversationManager.deleteMessage(conversationId, indexToDelete);
                }
                insertIndex = summarizeEndIndex - summaryIndicesToDelete.length;
            }

            // 12. 创建总结消息并添加到历史
            const summaryContent: Content = {
                role: 'user',
                parts: [{ text: `${t('modules.api.chat.prompts.summaryPrefix')}\n\n${summaryText}` }],
                isSummary: true,
                summarizedMessageCount: messagesToSummarize.length,
                usageMetadata: {
                    promptTokenCount: beforeTokenCount,
                    candidatesTokenCount: afterTokenCount
                }
            };

            await this.conversationManager.insertContent(conversationId, insertIndex, summaryContent);

            return {
                success: true,
                summaryContent,
                summarizedMessageCount: messagesToSummarize.length,
                beforeTokenCount,
                afterTokenCount
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
                        const { diffContentId, diffId, diffs, ...rest } = cleanedResponse;

                        if (rest.data && typeof rest.data === 'object') {
                            const { diffContentId: dataDiffContentId, diffId: dataDiffId, diffs: dataDiffs, ...dataRest } = rest.data as Record<string, unknown>;

                            if (Array.isArray(dataRest.results)) {
                                dataRest.results = (dataRest.results as Array<Record<string, unknown>>).map(item => {
                      if (item && typeof item === 'object') {
                                        const { diffContentId: itemDiffContentId, ...itemRest } = item;
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
     * 检查是否是 AsyncGenerator
     */
    private isAsyncGenerator(obj: any): obj is AsyncGenerator<StreamChunk> {
        return obj && typeof obj[Symbol.asyncIterator] === 'function';
    }
}
