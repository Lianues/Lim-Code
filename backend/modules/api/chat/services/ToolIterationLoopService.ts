/**
 * LimCode - 工具迭代循环服务
 *
 * 封装工具调用循环的核心逻辑，统一处理：
 * - handleChatStream
 * - handleToolConfirmation
 * - handleRetryStream
 * - handleEditAndRetryStream
 * 中的工具调用循环部分
 */

import type { ChannelManager } from '../../../channel/ChannelManager';
import type { ConversationManager } from '../../../conversation/ConversationManager';
import type { CheckpointRecord } from '../../../checkpoint';
import type { Content } from '../../../conversation/types';
import type { BaseChannelConfig } from '../../../config/configs/base';
import type { GenerateResponse } from '../../../channel/types';
import { ChannelError, ErrorType } from '../../../channel/types';
import { PromptManager } from '../../../prompt';
import { t } from '../../../../i18n';
import type { CheckpointService } from './CheckpointService';

import type {
    ChatStreamChunkData,
    ChatStreamCompleteData,
    ChatStreamErrorData,
    ChatStreamToolIterationData,
    ChatStreamCheckpointsData,
    ChatStreamToolConfirmationData,
    ChatStreamToolsExecutingData,
    PendingToolCall
} from '../types';

import { StreamResponseProcessor, isAsyncGenerator, type ProcessedChunkData } from '../handlers/StreamResponseProcessor';
import type { ToolCallParserService } from './ToolCallParserService';
import type { MessageBuilderService } from './MessageBuilderService';
import type { TokenEstimationService } from './TokenEstimationService';
import type { ContextTrimService } from './ContextTrimService';
import type { ToolExecutionService, ToolExecutionFullResult } from './ToolExecutionService';

/**
 * 工具迭代循环配置
 */
export interface ToolIterationLoopConfig {
    /** 对话 ID */
    conversationId: string;
    /** 配置 ID */
    configId: string;
    /** 渠道配置 */
    config: BaseChannelConfig;
    /** 取消信号 */
    abortSignal?: AbortSignal;
    /** 是否是首条消息（影响系统提示词刷新策略） */
    isFirstMessage?: boolean;
    /** 最大迭代次数（-1 表示无限制） */
    maxIterations: number;
    /** 起始迭代次数（默认 0） */
    startIteration?: number;
    /** 是否创建模型消息前的检查点 */
    createBeforeModelCheckpoint?: boolean;
}

/**
 * 工具迭代循环输出类型（流式）
 */
export type ToolIterationLoopOutput =
    | ChatStreamChunkData
    | ChatStreamCompleteData
    | ChatStreamErrorData
    | ChatStreamToolIterationData
    | ChatStreamCheckpointsData
    | ChatStreamToolConfirmationData
    | ChatStreamToolsExecutingData;

/**
 * 非流式工具循环结果
 */
export interface NonStreamToolLoopResult {
    /** 最终的 AI 回复内容（如果未超过最大迭代次数） */
    content?: Content;
    /** 是否超过最大工具迭代次数 */
    exceededMaxIterations: boolean;
}

/**
 * 工具迭代循环服务
 *
 * 封装工具调用循环的核心逻辑，减少 ChatHandler 中的重复代码
 */
export class ToolIterationLoopService {
    private promptManager: PromptManager;

    constructor(
        private channelManager: ChannelManager,
        private conversationManager: ConversationManager,
        private toolCallParserService: ToolCallParserService,
        private messageBuilderService: MessageBuilderService,
        private tokenEstimationService: TokenEstimationService,
        private contextTrimService: ContextTrimService,
        private toolExecutionService: ToolExecutionService,
        private checkpointService: CheckpointService
    ) {
        this.promptManager = new PromptManager();
    }

    /**
     * 设置提示词管理器（允许外部注入已初始化的实例）
     */
    setPromptManager(promptManager: PromptManager): void {
        this.promptManager = promptManager;
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
        await this.contextTrimService.clearTrimState(conversationId);
    }

    /**
     * 运行工具迭代循环（流式）
     *
     * 这是核心方法，封装了工具调用循环的完整逻辑
     *
     * @param loopConfig 循环配置
     * @yields 流式响应数据
     */
    async *runToolLoop(
        loopConfig: ToolIterationLoopConfig
    ): AsyncGenerator<ToolIterationLoopOutput> {
        const {
            conversationId,
            configId,
            config,
            abortSignal,
            isFirstMessage = false,
            maxIterations,
            startIteration = 0,
            createBeforeModelCheckpoint = true
        } = loopConfig;

        let iteration = startIteration;

        // -1 表示无限制
        while (maxIterations === -1 || iteration < maxIterations) {
            iteration++;

            // 1. 检查是否已取消
            if (abortSignal?.aborted) {
                yield {
                    conversationId,
                    cancelled: true as const
                } as any;
                return;
            }

            // 2. 创建模型消息前的检查点（如果配置了）
            if (createBeforeModelCheckpoint) {
                const checkpointData = await this.createBeforeModelCheckpoint(
                    conversationId,
                    iteration
                );
                if (checkpointData) {
                    yield checkpointData;
                }
            }

            // 3. 获取对话历史（应用上下文裁剪）
            const historyOptions = this.messageBuilderService.buildHistoryOptions(config);
            const { history } = await this.contextTrimService.getHistoryWithContextTrimInfo(
                conversationId,
                config,
                historyOptions
            );

            // 4. 获取静态系统提示词（可被 API provider 缓存）
            // 静态部分包含：操作系统、时区、用户语言、工作区路径、工具定义
            const dynamicSystemPrompt = (isFirstMessage && iteration === 1)
                ? this.promptManager.refreshAndGetPrompt()
                : this.promptManager.getSystemPrompt();  // 静态内容不需要强制刷新

            // 5. 获取动态上下文消息（每次都获取，会被插入到最后一组 user 消息之前）
            // 动态部分包含：当前时间、文件树、标签页、活动编辑器、诊断、固定文件
            // 这些内容不存储到后端历史，仅在发送时临时插入到连续的最后一组用户主动发送消息之前
            // 插入位置由 formatter 内部计算，确保与处理后的 history 一致
            const dynamicContextMessages = this.promptManager.getDynamicContextMessages();

            // 6. 记录请求开始时间
            const requestStartTime = Date.now();

            // 7. 调用 AI
            const response = await this.channelManager.generate({
                configId,
                history,
                abortSignal,
                dynamicSystemPrompt,
                dynamicContextMessages
            });

            // 8. 处理响应
            let finalContent: Content;

            if (isAsyncGenerator(response)) {
                // 流式响应处理
                const processor = new StreamResponseProcessor({
                    requestStartTime,
                    providerType: config.type as 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom',
                    abortSignal,
                    conversationId
                });

                // 处理流并 yield 每个 chunk
                for await (const chunkData of processor.processStream(response)) {
                    yield chunkData;
                }

                // 检查是否被取消
                if (processor.isCancelled()) {
                    const partialContent = processor.getContent();
                    if (partialContent.parts.length > 0) {
                        await this.conversationManager.addContent(conversationId, partialContent);
                    }
                    // CancelledData 不在对外的流式类型联合中，这里使用 any 交由上层处理
                    yield processor.getCancelledData() as any;
                    return;
                }

                finalContent = processor.getContent();
            } else {
                // 非流式响应处理
                const processor = new StreamResponseProcessor({
                    requestStartTime,
                    providerType: config.type as 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom',
                    abortSignal,
                    conversationId
                });

                const { content, chunkData } = processor.processNonStream(response as GenerateResponse);
                finalContent = content;
                yield chunkData;
            }

            // 9. 转换工具调用格式
            this.toolCallParserService.convertXMLToolCallsToFunctionCalls(finalContent);
            this.toolCallParserService.ensureFunctionCallIds(finalContent);

            // 10. 保存 AI 响应到历史
            if (finalContent.parts.length > 0) {
                await this.conversationManager.addContent(conversationId, finalContent);
            }

            // 11. 检查是否有工具调用
            const functionCalls = this.toolCallParserService.extractFunctionCalls(finalContent);

            if (functionCalls.length === 0) {
                // 没有工具调用，创建模型消息后的检查点并返回完成数据
                const modelMessageCheckpoints: CheckpointRecord[] = [];
                const checkpoint = await this.checkpointService.createModelMessageCheckpoint(
                    conversationId,
                    'after'
                );
                if (checkpoint) {
                    modelMessageCheckpoints.push(checkpoint);
                }

                // 返回完成数据
                yield {
                    conversationId,
                    content: finalContent,
                    checkpoints: modelMessageCheckpoints
                };
                return;
            }

            // 12. 有工具调用，检查是否需要确认
            const toolsNeedingConfirmation = this.toolExecutionService.getToolsNeedingConfirmation(functionCalls);

            if (toolsNeedingConfirmation.length > 0) {
                // 有工具需要确认，发送确认请求到前端
                const pendingToolCalls: PendingToolCall[] = toolsNeedingConfirmation.map(call => ({
                    id: call.id,
                    name: call.name,
                    args: call.args
                }));

                yield {
                    conversationId,
                    pendingToolCalls,
                    content: finalContent,
                    awaitingConfirmation: true as const
                };

                // 暂停执行，等待前端调用 handleToolConfirmation
                return;
            }

            // 12. 不需要确认，直接执行工具
            const currentHistory = await this.conversationManager.getHistoryRef(conversationId);
            const messageIndex = currentHistory.length - 1;

            // 工具执行前先发送计时信息（让前端立即显示）
            yield {
                conversationId,
                content: finalContent,
                toolsExecuting: true as const,
                pendingToolCalls: functionCalls.map(call => ({
                    id: call.id,
                    name: call.name,
                    args: call.args
                }))
            };

            // 13. 执行工具调用
            const executionResult = await this.toolExecutionService.executeFunctionCallsWithResults(
                functionCalls,
                conversationId,
                messageIndex,
                config,
                abortSignal
            );
            
            // 13.5 检查是否已取消（可能在工具执行期间被用户删除消息）
            if (abortSignal?.aborted) {
                yield {
                    conversationId,
                    cancelled: true as const
                } as any;
                return;
            }

            // 14. 将函数响应添加到历史
            const functionResponseParts = executionResult.multimodalAttachments
                ? [...executionResult.multimodalAttachments, ...executionResult.responseParts]
                : executionResult.responseParts;

            await this.conversationManager.addContent(conversationId, {
                role: 'user',
                parts: functionResponseParts,
                isFunctionResponse: true
            });
            
            // 注：工具响应消息的 token 计数将在下一次循环的 getHistoryWithContextTrimInfo 中
            // 与系统提示词、动态上下文一起并行计算

            // 16. 检查是否有工具被取消
            const hasCancelled = executionResult.toolResults.some(r => (r.result as any).cancelled);
            if (hasCancelled) {
                // 有工具被取消，发送最终的 toolIteration 后结束
                yield {
                    conversationId,
                    content: finalContent,
                    toolIteration: true as const,
                    toolResults: executionResult.toolResults,
                    checkpoints: executionResult.checkpoints
                };
                return;
            }

            // 17. 发送 toolIteration 信号
            yield {
                conversationId,
                content: finalContent,
                toolIteration: true as const,
                toolResults: executionResult.toolResults,
                checkpoints: executionResult.checkpoints
            };

            // 继续循环，让 AI 处理函数结果
        }

        // 达到最大迭代次数
        yield {
            conversationId,
            error: {
                code: 'MAX_TOOL_ITERATIONS',
                message: t('modules.api.chat.errors.maxToolIterations', { maxIterations })
            }
        };
    }

    /**
     * 运行非流式工具循环
     *
     * 用于 handleChat / handleRetry / handleEditAndRetry 等非流式场景，
     * 不产生流式 chunk，仅返回最终内容或标记超出最大迭代次数。
     */
    async runNonStreamLoop(
        conversationId: string,
        configId: string,
        config: BaseChannelConfig,
        maxIterations: number
    ): Promise<NonStreamToolLoopResult> {
        let iteration = 0;
        const historyOptions = this.messageBuilderService.buildHistoryOptions(config);

        // -1 表示无限制
        while (maxIterations === -1 || iteration < maxIterations) {
            iteration++;

            // 获取对话历史（应用总结过滤和上下文阈值裁剪）
            const history = await this.contextTrimService.getHistoryWithContextTrim(
                conversationId,
                config,
                historyOptions
            );

            // 调用 AI（非流式）
            const response = await this.channelManager.generate({
                configId,
                history
            });

            // 类型守卫：确保是 GenerateResponse
            if (!('content' in response)) {
                throw new Error('Unexpected stream response from generate()');
            }

            const generateResponse = response as GenerateResponse;
            const finalContent = generateResponse.content;

            // 转换 XML 工具调用为 functionCall 格式（如果有）
            this.toolCallParserService.convertXMLToolCallsToFunctionCalls(finalContent);
            // 为没有 id 的 functionCall 添加唯一 id（Gemini 格式不返回 id）
            this.toolCallParserService.ensureFunctionCallIds(finalContent);

            // 保存 AI 响应到历史
            if (finalContent.parts.length > 0) {
                await this.conversationManager.addContent(conversationId, finalContent);
            }

            // 检查是否有工具调用
            const functionCalls = this.toolCallParserService.extractFunctionCalls(finalContent);

            if (functionCalls.length === 0) {
                // 没有工具调用，结束循环并返回
                return {
                    content: finalContent,
                    exceededMaxIterations: false
                };
            }

            // 有工具调用，执行工具并添加结果
            // 获取当前消息索引（AI 响应刚刚添加到历史）
            const currentHistory = await this.conversationManager.getHistoryRef(conversationId);
            const messageIndex = currentHistory.length - 1;

            const functionResponses = await this.toolExecutionService.executeFunctionCalls(
                functionCalls,
                conversationId,
                messageIndex
            );

            // 将函数响应添加到历史（作为 user 消息，标记为函数响应）
            await this.conversationManager.addContent(conversationId, {
                role: 'user',
                parts: functionResponses,
                isFunctionResponse: true
            });
            
            // 注：工具响应消息的 token 计数将在下一次循环的 getHistoryWithContextTrimInfo 中
            // 与系统提示词、动态上下文一起并行计算

            // 继续循环，让 AI 处理函数结果
        }

        // 达到最大迭代次数
        return {
            exceededMaxIterations: true
        };
    }

    /**
     * 创建模型消息前的检查点
     *
     * @param conversationId 对话 ID
     * @param iteration 当前迭代次数
     * @returns 检查点数据（用于 yield）或 null
     */
    private async createBeforeModelCheckpoint(
        conversationId: string,
        iteration: number
    ): Promise<ChatStreamCheckpointsData | null> {
        const checkpoint = await this.checkpointService.createModelMessageCheckpoint(
            conversationId,
            'before',
            iteration
        );
        if (!checkpoint) {
            return null;
        }

        return {
            conversationId,
            checkpoints: [checkpoint],
            checkpointOnly: true as const
        };
    }
}
