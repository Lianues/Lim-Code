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
    ChatStreamAutoSummaryData,
    ChatStreamAutoSummaryStatusData,
    ChatStreamToolConfirmationData,
    ChatStreamToolsExecutingData,
    ChatStreamToolStatusData,
    PendingToolCall
} from '../types';

import { StreamResponseProcessor, isAsyncGenerator, type ProcessedChunkData } from '../handlers/StreamResponseProcessor';
import type { FunctionCallInfo } from '../utils';
import type { ToolCallParserService } from './ToolCallParserService';
import type { MessageBuilderService } from './MessageBuilderService';
import type { TokenEstimationService } from './TokenEstimationService';
import type { ContextTrimService } from './ContextTrimService';
import type { ToolExecutionService, ToolExecutionFullResult, ToolExecutionProgressEvent } from './ToolExecutionService';
import type { SummarizeService } from './SummarizeService';

const CONVERSATION_PINNED_FILES_KEY = 'inputPinnedFiles';
const CONVERSATION_SKILLS_KEY = 'inputSkills';

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
    /** 模型覆盖（可选，仅对本轮循环生效） */
    modelOverride?: string;
    /** 取消信号 */
    abortSignal?: AbortSignal;
    /**
     * 总结请求专用取消信号（仅取消总结 API，不中断主对话请求）
     */
    summarizeAbortSignal?: AbortSignal;
    /** 是否是首条消息（影响系统提示词刷新策略） */
    isFirstMessage?: boolean;
    /** 最大迭代次数（-1 表示无限制） */
    maxIterations: number;
    /** 起始迭代次数（默认 0） */
    startIteration?: number;
    /** 是否创建模型消息前的检查点 */
    createBeforeModelCheckpoint?: boolean;
    /**
     * 是否是新回合的开始（默认 true）。
     * 新回合开始时会生成新的动态上下文并缓存到元数据；
     * 回合继续时（如工具确认后）从元数据读取缓存的动态上下文，保证回合内一致性。
     */
    isNewTurn?: boolean;
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
    | ChatStreamAutoSummaryData
    | ChatStreamAutoSummaryStatusData
    | ChatStreamToolConfirmationData
    | ChatStreamToolsExecutingData
    | ChatStreamToolStatusData;

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
    private summarizeService?: SummarizeService;

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
     * 设置总结服务（允许外部注入，避免循环依赖）
     */
    setSummarizeService(summarizeService: SummarizeService): void {
        this.summarizeService = summarizeService;
    }

    private async loadDynamicRuntimeContext(conversationId: string): Promise<{
        todoList?: unknown;
        pinnedFiles?: unknown;
        skills?: unknown;
    }> {
        const [todoList, pinnedFiles, skills] = await Promise.all([
            this.conversationManager.getCustomMetadata(conversationId, 'todoList').catch(() => undefined),
            this.conversationManager.getCustomMetadata(conversationId, CONVERSATION_PINNED_FILES_KEY).catch(() => undefined),
            this.conversationManager.getCustomMetadata(conversationId, CONVERSATION_SKILLS_KEY).catch(() => undefined)
        ]);

        return {
            todoList,
            pinnedFiles,
            skills
        };
    }
    
    /**
     * 找到当前回合的起始用户消息索引（最后一个 isUserInput=true 的 user 消息）
     */
    private findTurnStartMessageIndex(history: Content[]): number {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'user' && history[i].isUserInput) {
                return i;
            }
        }
        return -1;
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
     * 合并两个取消信号：任一信号触发都将中止返回信号
     *
     * 用于自动总结场景：
     * - 主请求取消（abortSignal）
     * - 仅取消总结（summarizeAbortSignal）
     */
    private mergeAbortSignals(
        primary?: AbortSignal,
        secondary?: AbortSignal
    ): AbortSignal | undefined {
        if (!primary) return secondary;
        if (!secondary) return primary;

        if (primary.aborted || secondary.aborted) {
            const controller = new AbortController();
            controller.abort();
            return controller.signal;
        }

        const controller = new AbortController();
        const onAbort = () => {
            primary.removeEventListener('abort', onAbort);
            secondary.removeEventListener('abort', onAbort);
            if (!controller.signal.aborted) {
                controller.abort();
            }
        };

        primary.addEventListener('abort', onAbort, { once: true });
        secondary.addEventListener('abort', onAbort, { once: true });
        return controller.signal;
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
            modelOverride,
            abortSignal,
            summarizeAbortSignal,
            isFirstMessage = false,
            maxIterations,
            startIteration = 0,
            createBeforeModelCheckpoint = true
        } = loopConfig;

        const isNewTurn = loopConfig.isNewTurn !== false;

        let iteration = startIteration;

        // 动态上下文在回合开始时生成一次，回合内所有迭代（包括工具确认后的继续）复用
        // 动态部分包含：当前时间、文件树、标签页、活动编辑器、诊断、固定文件、TODO、Skills
        // 这些内容不存储到后端历史，仅在发送时临时插入到连续的最后一组用户主动发送消息之前
        // 缓存存储在回合起始用户消息的 turnDynamicContext 字段上，确保每个回合独立
        let dynamicContextMessages: Content[];
        let dynamicContextText: string;

        // 获取历史以定位回合起始用户消息
        const historyRef = await this.conversationManager.getHistoryRef(conversationId);
        const turnStartIndex = this.findTurnStartMessageIndex(historyRef);

        if (isNewTurn || turnStartIndex < 0 || !historyRef[turnStartIndex]?.turnDynamicContext) {
            // 新回合开始 / 缓存不存在：生成动态上下文并存到回合起始用户消息上
            const runtimeContext = await this.loadDynamicRuntimeContext(conversationId);
            dynamicContextMessages = this.promptManager.getDynamicContextMessages(runtimeContext);
            dynamicContextText = this.promptManager.getDynamicContextText(runtimeContext);

            // 存到回合起始用户消息上
            if (turnStartIndex >= 0) {
                await this.conversationManager.updateMessage(conversationId, turnStartIndex, {
                    turnDynamicContext: dynamicContextText
                });
            }
        } else {
            // 回合继续（如工具确认后、重试等）：从缓存的纯文本重建
            dynamicContextText = historyRef[turnStartIndex].turnDynamicContext!;
            dynamicContextMessages = [{
                role: 'user' as const,
                parts: [{ text: dynamicContextText }]
            }];
        }

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
            const trimResult = await this.contextTrimService.getHistoryWithContextTrimInfo(
                conversationId,
                config,
                historyOptions,
                dynamicContextText,
                modelOverride
            );

            try {
                console.log(`[ContextTrim][Debug] loop.stream.trim_result ${JSON.stringify({
                    conversationId,
                    iteration,
                    modelOverride: modelOverride || null,
                    configModel: (config as any).model || null,
                    trimStartIndex: trimResult.trimStartIndex,
                    historyLength: trimResult.history.length,
                    needsAutoSummarize: !!trimResult.needsAutoSummarize
                })}`);
            } catch {}

            // 3.5 自动总结检测：如果需要总结，先执行总结再重新获取历史
            if (trimResult.needsAutoSummarize && this.summarizeService) {
                console.log(`[ToolLoop] Auto-summarize triggered for conversation ${conversationId}`);

                // 先通知前端显示“自动总结中”提示
                yield {
                    conversationId,
                    autoSummaryStatus: true as const,
                    status: 'started' as const
                } satisfies ChatStreamAutoSummaryStatusData;

                const autoSummarizeAbortSignal = this.mergeAbortSignals(abortSignal, summarizeAbortSignal);

                const summarizeResult = await this.summarizeService.handleAutoSummarize(
                    conversationId,
                    configId,
                    autoSummarizeAbortSignal
                );

                if (summarizeResult.success) {
                    console.log(`[ToolLoop] Auto-summarize completed, continuing loop`);

                    // 先通知前端插入总结消息，避免必须重载才能看到
                    if (typeof summarizeResult.insertIndex === 'number') {
                        yield {
                            conversationId,
                            autoSummary: true as const,
                            summaryContent: summarizeResult.summaryContent,
                            insertIndex: summarizeResult.insertIndex
                        } satisfies ChatStreamAutoSummaryData;
                    }

                    // 总结完成，隐藏“自动总结中”提示
                    yield {
                        conversationId,
                        autoSummaryStatus: true as const,
                        status: 'completed' as const
                    } satisfies ChatStreamAutoSummaryStatusData;

                    // 总结可能删除了存有 turnDynamicContext 缓存的用户消息，
                    // 需要将当前的动态上下文重新存到新历史的回合起始消息上，
                    // 确保后续迭代（如工具确认后的新 runToolLoop 调用）能读到缓存
                    const postSummarizeHistory = await this.conversationManager.getHistoryRef(conversationId);
                    const postSummarizeTurnIndex = this.findTurnStartMessageIndex(postSummarizeHistory);
                    if (postSummarizeTurnIndex >= 0 && !postSummarizeHistory[postSummarizeTurnIndex].turnDynamicContext) {
                        await this.conversationManager.updateMessage(conversationId, postSummarizeTurnIndex, {
                            turnDynamicContext: dynamicContextText
                        });
                    }

                    // 重新获取历史后再发起本轮 API 请求
                    continue;
                }

                if ('error' in summarizeResult) {
                    const summarizeError = summarizeResult.error;

                    // 主请求取消：直接结束整个对话请求
                    if (abortSignal?.aborted) {
                        yield {
                            conversationId,
                            cancelled: true as const
                        } as any;
                        return;
                    }

                    // 仅取消总结：不终止主请求，继续正常调用 AI
                    const isSummaryOnlyAborted = summarizeError.code === 'ABORTED';

                    // 总结失败，隐藏“自动总结中”提示
                    yield {
                        conversationId,
                        autoSummaryStatus: true as const,
                        status: 'failed' as const,
                        message: isSummaryOnlyAborted
                            ? t('modules.api.chat.errors.summarizeAborted')
                            : summarizeError.message
                    } satisfies ChatStreamAutoSummaryStatusData;

                    // 总结失败：记录日志，但不要阻塞当前轮对话，继续正常请求
                    console.warn(
                        `[ToolLoop] Auto-summarize failed (will continue without summarize): ${summarizeError.code} - ${summarizeError.message}`
                    );
                }
            }

            const { history } = trimResult;

            // 4. 获取静态系统提示词（可被 API provider 缓存）
            // 静态部分包含：操作系统、时区、用户语言、工作区路径、工具定义
            const dynamicSystemPrompt = (isFirstMessage && iteration === 1)
                ? this.promptManager.refreshAndGetPrompt()
                : this.promptManager.getSystemPrompt();  // 静态内容不需要强制刷新

            // 5. 记录请求开始时间
            const requestStartTime = Date.now();

            // 6. 调用 AI
            const response = await this.channelManager.generate({
                configId,
                history,
                abortSignal,
                dynamicSystemPrompt,
                dynamicContextMessages,
                modelOverride,
                conversationId
            });

            // 7. 处理响应
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

            // 12. 有工具调用：按 AI 输出顺序依次处理。
            // 规则：执行到第一个“需要用户批准”的工具时暂停；后续工具必须等待前置工具完成。

            // 找到第一个需要确认的工具（按顺序），并只自动执行它之前的前缀工具。
            const autoPrefix: FunctionCallInfo[] = [];
            let firstConfirmTool: FunctionCallInfo | null = null;

            for (const call of functionCalls) {
                if (this.toolExecutionService.toolNeedsConfirmation(call.name)) {
                    firstConfirmTool = call;
                    break;
                }
                autoPrefix.push(call);
            }

            let executionResult: ToolExecutionFullResult | undefined;

            if (autoPrefix.length > 0) {
                // 在执行循环开始前，立即发送包含所有待执行工具的初始 toolsExecuting
                // 让前端尽早看到完整的工具队列（第一个为 executing，其余为 queued）
                yield {
                    conversationId,
                    content: finalContent,
                    toolsExecuting: true as const,
                    pendingToolCalls: autoPrefix.map(c => ({
                        id: c.id,
                        name: c.name,
                        args: c.args
                    }))
                } satisfies ChatStreamToolsExecutingData;

                const currentHistory = await this.conversationManager.getHistoryRef(conversationId);
                const messageIndex = currentHistory.length - 1;

                // 执行工具调用（按顺序），并实时发送每个工具的开始/结束状态
                const gen = this.toolExecutionService.executeFunctionCallsWithProgress(
                    autoPrefix,
                    conversationId,
                    messageIndex,
                    config,
                    abortSignal
                );

                while (true) {
                    const { value, done } = await gen.next();
                    if (done) {
                        executionResult = value as ToolExecutionFullResult;
                        break;
                    }

                    const event = value as ToolExecutionProgressEvent;

                    if (event.type === 'start') {
                        // 计算当前工具及所有剩余待执行工具
                        const currentIndex = autoPrefix.findIndex(c => c.id === event.call.id);
                        const remaining = currentIndex !== -1 ? autoPrefix.slice(currentIndex) : [event.call];

                        // 工具执行前发送剩余队列信息（让前端实时显示执行进度）
                        yield {
                            conversationId,
                            content: finalContent,
                            toolsExecuting: true as const,
                            pendingToolCalls: remaining.map(c => ({
                                id: c.id,
                                name: c.name,
                                args: c.args
                            }))
                        } satisfies ChatStreamToolsExecutingData;
                        continue;
                    }

                    if (event.type === 'end') {
                        const r = event.toolResult.result as any;
                        let status: ChatStreamToolStatusData['tool']['status'] = 'success';
                        if (r?.success === false || r?.error || r?.cancelled || r?.rejected) {
                            status = 'error';
                        } else if (r?.data && r.data.appliedCount > 0 && r.data.failedCount > 0) {
                            status = 'warning';
                        }

                        yield {
                            conversationId,
                            toolStatus: true as const,
                            tool: {
                                id: event.call.id,
                                name: event.call.name,
                                status,
                                result: event.toolResult.result
                            }
                        } satisfies ChatStreamToolStatusData;
                    }
                }

                // 检查是否已取消
                if (abortSignal?.aborted) {
                    yield {
                        conversationId,
                        cancelled: true as const
                    } as any;
                    return;
                }

                // 将函数响应添加到历史
                const functionResponseParts = executionResult.multimodalAttachments
                    ? [...executionResult.multimodalAttachments, ...executionResult.responseParts]
                    : executionResult.responseParts;

                await this.conversationManager.addContent(conversationId, {
                    role: 'user',
                    parts: functionResponseParts,
                    isFunctionResponse: true
                });
            }

            // 13. 如果遇到需要确认的工具，则暂停并等待（仅等待当前这个“队首”工具）
            if (firstConfirmTool) {
                yield {
                    conversationId,
                    pendingToolCalls: [{
                        id: firstConfirmTool.id,
                        name: firstConfirmTool.name,
                        args: firstConfirmTool.args
                    }],
                    content: finalContent,
                    awaitingConfirmation: true as const,
                    // 把已自动执行的前缀结果同步给前端（用于刷新工具状态/结果展示）
                    toolResults: executionResult?.toolResults,
                    checkpoints: executionResult?.checkpoints
                };

                return;
            }

            // 14. 没有需要确认的工具，说明所有工具均已自动执行完成
            if (executionResult) {
                const hasCancelled = executionResult.toolResults.some(r => (r.result as any).cancelled);
                const hasUserConfirmation = executionResult.toolResults.some(r => (r.result as any).requiresUserConfirmation);
                if (hasCancelled || hasUserConfirmation) {
                    yield {
                        conversationId,
                        content: finalContent,
                        toolIteration: true as const,
                        toolResults: executionResult.toolResults,
                        checkpoints: executionResult.checkpoints
                    };
                    return;
                }

                yield {
                    conversationId,
                    content: finalContent,
                    toolIteration: true as const,
                    toolResults: executionResult.toolResults,
                    checkpoints: executionResult.checkpoints
                };
            }

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
        maxIterations: number,
        modelOverride?: string
    ): Promise<NonStreamToolLoopResult> {
        let iteration = 0;
        const historyOptions = this.messageBuilderService.buildHistoryOptions(config);

        // 在回合开始时一次性生成动态上下文，回合内所有迭代复用，并存到回合起始用户消息上
        const runtimeContext = await this.loadDynamicRuntimeContext(conversationId);
        const dynamicContextMessages = this.promptManager.getDynamicContextMessages(runtimeContext);
        // 预计算动态上下文文本，用于 ContextTrimService 的 token 计数
        const dynamicContextText = this.promptManager.getDynamicContextText(runtimeContext);

        // 存到回合起始用户消息上
        const historyRef = await this.conversationManager.getHistoryRef(conversationId);
        const turnStartIndex = this.findTurnStartMessageIndex(historyRef);
        if (turnStartIndex >= 0) {
            await this.conversationManager.updateMessage(conversationId, turnStartIndex, {
                turnDynamicContext: dynamicContextText
            });
        }

        // -1 表示无限制
        while (maxIterations === -1 || iteration < maxIterations) {
            iteration++;

            // 获取对话历史（应用总结过滤和上下文阈值裁剪）
            const trimResult = await this.contextTrimService.getHistoryWithContextTrimInfo(
                conversationId,
                config,
                historyOptions,
                dynamicContextText,
                modelOverride
            );

            try {
                console.log(`[ContextTrim][Debug] loop.nonstream.trim_result ${JSON.stringify({
                    conversationId,
                    iteration,
                    modelOverride: modelOverride || null,
                    configModel: (config as any).model || null,
                    trimStartIndex: trimResult.trimStartIndex,
                    historyLength: trimResult.history.length,
                    needsAutoSummarize: !!trimResult.needsAutoSummarize
                })}`);
            } catch {}

            // 自动总结检测
            if (trimResult.needsAutoSummarize && this.summarizeService) {
                console.log(`[ToolLoop/NonStream] Auto-summarize triggered for conversation ${conversationId}`);

                const summarizeResult = await this.summarizeService.handleAutoSummarize(
                    conversationId,
                    configId
                );

                if (summarizeResult.success) {
                    // 总结成功，重新获取历史
                    continue;
                }

                if ('error' in summarizeResult) {
                    const summarizeError = summarizeResult.error;

                    // 总结失败：不阻塞当前请求，继续使用现有历史
                    console.warn(
                        `[ToolLoop/NonStream] Auto-summarize failed (will continue without summarize): ${summarizeError.code} - ${summarizeError.message}`
                    );
                }
            }

            const history = trimResult.history;

            // 获取静态系统提示词（可被 API provider 缓存）
            const dynamicSystemPrompt = this.promptManager.getSystemPrompt();

            // 调用 AI（非流式）
            const response = await this.channelManager.generate({
                configId,
                history,
                dynamicSystemPrompt,
                dynamicContextMessages,
                modelOverride,
                conversationId
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
