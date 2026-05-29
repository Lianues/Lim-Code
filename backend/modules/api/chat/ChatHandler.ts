/**
 * LimCode - 对话处理器
 *
 * 负责处理对话请求，协调各个模块
 */

import { t } from '../../../i18n';
import type { ConfigManager } from '../../config/ConfigManager';
import type { ChannelManager } from '../../channel/ChannelManager';
import type { ConversationManager } from '../../conversation/ConversationManager';
import type { DiffStorageManager } from '../../conversation/DiffStorageManager';
import type { ToolRegistry } from '../../../tools/ToolRegistry';
import type { CheckpointManager, CheckpointRecord } from '../../checkpoint';
import type { SettingsManager } from '../../settings/SettingsManager';
import type { SettingsChangeEvent, SettingsChangeListener } from '../../settings/types';
import type { McpManager } from '../../mcp/McpManager';
import { PromptManager } from '../../prompt';
import { StreamAccumulator } from '../../channel/StreamAccumulator';
import { TokenCountService, type TokenCountResult } from '../../channel/TokenCountService';
import type { Content, ContentPart, ChannelTokenCounts } from '../../conversation/types';
import type { UiStatusPayload } from '../../conversation/contextTypes';
import type { GetHistoryOptions } from '../../conversation/ConversationManager';
import type { BaseChannelConfig } from '../../config/configs/base';
import type { StreamChunk, GenerateResponse } from '../../channel/types';
import { ChannelError, ErrorType } from '../../channel/types';
import { getDiffManager } from '../../../tools/file/diffManager';
import { getMultimodalCapability, type MultimodalCapability, type ChannelType as UtilChannelType, type ToolMode as UtilToolMode } from '../../../tools/utils';
import type {
    ChatRequestData,
    ChatSuccessData,
    ChatErrorData,
    ChatStreamChunkData,
    ChatStreamCompleteData,
    ChatStreamErrorData,
    ChatStreamToolIterationData,
    ChatStreamCheckpointsData,
    ChatStreamToolConfirmationData,
    ChatStreamToolsExecutingData,
    ChatStreamToolStatusData,
    ChatStreamAutoSummaryData,
    ChatStreamAutoSummaryStatusData,
    ChatStreamContextCommandData,
    ToolConfirmationResponseData,
    PendingToolCall,
    RetryRequestData,
    EditAndRetryRequestData,
    DeleteToMessageRequestData,
    DeleteToMessageSuccessData,
    DeleteToMessageErrorData,
    AttachmentData,
    SummarizeContextRequestData,
    SummarizeContextSuccessData,
    SummarizeContextErrorData
} from './types';
import {
    generateToolCallId,
    type ConversationRound,
    type ContextTrimInfo,
    type FunctionCallInfo
} from './utils';
import { ToolCallParserService, MessageBuilderService, TokenEstimationService, ContextTrimService, ToolExecutionService, SummarizeService, ToolIterationLoopService, CheckpointService, OrphanedToolCallService, DiffInterruptService, ChatFlowService, ContextProjectionStore, ContextLedgerService, ContextStatusService, ContextOperationService, ContextCommandRegistry } from './services';
import { StreamResponseProcessor, isAsyncGenerator } from './handlers';

/** 默认最大工具调用循环次数（当设置管理器不可用时使用） */
const DEFAULT_MAX_TOOL_ITERATIONS = 20;

/**
 * 对话处理器
 *
 * 职责：
 * 1. 接收对话请求
 * 2. 保存用户消息到历史
 * 3. 调用 AI API
 * 4. 处理工具调用（自动执行并返回结果）
 * 5. 保存 AI 响应到历史
 * 6. 返回响应
 */
export class ChatHandler {
    private checkpointManager?: CheckpointManager;
    private settingsManager?: SettingsManager;
    private settingsChangeListener?: SettingsChangeListener;
    private mcpManager?: McpManager;
    private diffStorageManager?: DiffStorageManager;
    private promptManager: PromptManager;
    private tokenCountService: TokenCountService;
    private toolCallParserService: ToolCallParserService;
    private messageBuilderService: MessageBuilderService;
    private tokenEstimationService: TokenEstimationService;
    private contextTrimService: ContextTrimService;
    private toolExecutionService: ToolExecutionService;
    private summarizeService: SummarizeService;
    private toolIterationLoopService: ToolIterationLoopService;
    private checkpointService: CheckpointService;
    private orphanedToolCallService: OrphanedToolCallService;
    private diffInterruptService: DiffInterruptService;
    private contextProjectionStore: ContextProjectionStore;
    private contextLedgerService: ContextLedgerService;
    private contextStatusService: ContextStatusService;
    private contextOperationService: ContextOperationService;
    private contextCommandRegistry: ContextCommandRegistry;
    private chatFlowService: ChatFlowService;
    
    constructor(
        private configManager: ConfigManager,
        private channelManager: ChannelManager,
        private conversationManager: ConversationManager,
        private toolRegistry?: ToolRegistry
    ) {
        this.promptManager = new PromptManager();
        this.tokenCountService = new TokenCountService();
        this.toolCallParserService = new ToolCallParserService();
        this.messageBuilderService = new MessageBuilderService();
        this.tokenEstimationService = new TokenEstimationService(
            this.conversationManager,
            this.tokenCountService
        );
        this.contextTrimService = new ContextTrimService(
            this.conversationManager,
            this.promptManager,
            this.tokenEstimationService,
            this.messageBuilderService
        );
        this.checkpointService = new CheckpointService(
            this.conversationManager
        );
        this.toolExecutionService = new ToolExecutionService(
            this.toolRegistry,
            this.mcpManager,
            this.settingsManager,
            this.checkpointService
        );
        // 注入 conversationStore，供 todo_write 等工具持久化使用
        this.toolExecutionService.setConversationStore(this.conversationManager);
        this.summarizeService = new SummarizeService(
            this.configManager,
            this.channelManager,
            this.conversationManager,
            this.contextTrimService
        );
        const metadataRepository = this.conversationManager.getMetadataRepository();
        this.contextProjectionStore = new ContextProjectionStore(metadataRepository);
        this.contextLedgerService = new ContextLedgerService(metadataRepository);
        this.contextStatusService = new ContextStatusService(
            this.conversationManager,
            this.contextProjectionStore,
            this.contextLedgerService
        );
        this.contextOperationService = new ContextOperationService(
            this.conversationManager,
            this.configManager,
            this.summarizeService,
            this.contextTrimService,
            this.contextProjectionStore,
            this.contextLedgerService,
            this.contextStatusService
        );
        this.contextCommandRegistry = new ContextCommandRegistry(this.contextOperationService);
        this.toolIterationLoopService = new ToolIterationLoopService(
            this.channelManager,
            this.conversationManager,
            this.toolCallParserService,
            this.messageBuilderService,
            this.tokenEstimationService,
            this.contextTrimService,
            this.toolExecutionService,
            this.checkpointService
        );
        this.orphanedToolCallService = new OrphanedToolCallService(
            this.conversationManager,
            this.toolCallParserService,
            this.toolExecutionService
        );
        this.diffInterruptService = new DiffInterruptService();
        this.chatFlowService = new ChatFlowService(
            this.configManager,
            this.conversationManager,
            this.settingsManager,
            this.messageBuilderService,
            this.tokenEstimationService,
            this.toolIterationLoopService,
            this.checkpointService,
            this.diffInterruptService,
            this.orphanedToolCallService,
            this.toolExecutionService,
            this.toolCallParserService,
            this.contextCommandRegistry
        );
        // 设置 PromptManager 到 ToolIterationLoopService
        this.toolIterationLoopService.setPromptManager(this.promptManager);
        // 设置 SummarizeService 到 ToolIterationLoopService（用于自动总结）
        this.toolIterationLoopService.setSummarizeService(this.summarizeService);
        // 设置 TokenEstimationService 到 SummarizeService（用于估算待总结消息的 token 数）
        this.summarizeService.setTokenEstimationService(this.tokenEstimationService);
    }
    
    async getContextStatus(conversationId: string) {
        // 修改原因：`/context-status` 的产品形态应是前端诊断窗口读取后端状态，而不是走 chatStream 或模型对话路径。
        // 修改方式：ChatHandler 暴露只读状态查询，webview handler 可直接调用 ContextStatusService；不写入历史、不创建 checkpoint、不调用 LLM。
        // 修改目的：让上下文状态窗口成为纯观察入口，避免影响主对话上下文和流式状态。
        return await this.contextStatusService.getStatus(conversationId);
    }
    
    /**
     * 设置检查点管理器（可选）
     */
    setCheckpointManager(checkpointManager: CheckpointManager): void {
        this.checkpointManager = checkpointManager;
        this.checkpointService.setCheckpointManager(checkpointManager);
    }
    
    /**
     * 设置设置管理器（可选）
     */
    setSettingsManager(settingsManager: SettingsManager): void {
        // 避免重复注册 listener（setSettingsManager 可能被多次调用）
        if (this.settingsChangeListener && this.settingsManager) {
            this.settingsManager.removeChangeListener(this.settingsChangeListener);
        }
        
        const listener: SettingsChangeListener = this.settingsChangeListener ?? ((event: SettingsChangeEvent) => {
            const path = event.path;
            const pathStartsWithSystemPrompt =
                typeof path === 'string' && path.startsWith('toolsConfig.system_prompt');
            
            const toolsChangeContainsSystemPrompt =
                event.type === 'tools'
                && (
                    (typeof path === 'string' && path.includes('system_prompt'))
                    || (event.newValue && typeof event.newValue === 'object' && 'system_prompt' in (event.newValue as Record<string, unknown>))
                    || (event.oldValue && typeof event.oldValue === 'object' && 'system_prompt' in (event.oldValue as Record<string, unknown>))
                );
            
            if (pathStartsWithSystemPrompt || toolsChangeContainsSystemPrompt) {
                this.promptManager.invalidateCache();
            }
        });
        
        this.settingsChangeListener = listener;
        this.settingsManager = settingsManager;
        this.settingsManager.addChangeListener(listener);
        // 更新 tokenCountService 的代理设置
        this.tokenCountService.setProxyUrl(settingsManager.getEffectiveProxyUrl());
        // 更新 tokenEstimationService 的设置管理器
        this.tokenEstimationService.setSettingsManager(settingsManager);
        // 更新 toolExecutionService 的设置管理器
        this.toolExecutionService.setSettingsManager(settingsManager);
        // 更新 summarizeService 的设置管理器
        this.summarizeService.setSettingsManager(settingsManager);
        // 更新 checkpointService 的设置管理器
        this.checkpointService.setSettingsManager(settingsManager);
        // 更新 chatFlowService 的设置引用
        this.chatFlowService = new ChatFlowService(
            this.configManager,
            this.conversationManager,
            this.settingsManager,
            this.messageBuilderService,
            this.tokenEstimationService,
            this.toolIterationLoopService,
            this.checkpointService,
            this.diffInterruptService,
            this.orphanedToolCallService,
            this.toolExecutionService,
            this.toolCallParserService,
            this.contextCommandRegistry
        );
    }
    
    /**
     * 设置 MCP 管理器（可选）
     */
    setMcpManager(mcpManager: McpManager): void {
        this.mcpManager = mcpManager;
        this.toolExecutionService.setMcpManager(mcpManager);
    }

    /**
     * 获取共享工具执行服务。
     *
     * 修改原因：SubAgent 过去自己复制了一套工具执行逻辑，导致多模态、MCP、工具配置等主流程修复无法同步继承。
     * 修改方式：暴露只读 getter，让 SubAgent 执行器复用同一个 ToolExecutionService 实例；实际多模态能力仍由调用时传入的 SubAgent provider 配置决定。
     * 修改目的：共享工具执行内核，但不把 SubAgent 绑定到主模型的能力配置。
     */
    getToolExecutionService(): ToolExecutionService {
        return this.toolExecutionService;
    }
    
    /**
     * 设置 Diff 存储管理器（可选）
     * 用于抽离 apply_diff 工具的 originalContent/newContent 大字段
     */
    setDiffStorageManager(diffStorageManager: DiffStorageManager): void {
        this.diffStorageManager = diffStorageManager;
    }
    
    /**
     * 获取单回合最大工具调用次数
     * 从设置管理器读取，如果不可用则返回默认值
     */
    private getMaxToolIterations(): number {
        return this.settingsManager?.getMaxToolIterations() ?? DEFAULT_MAX_TOOL_ITERATIONS;
    }
    
    /**
     * 处理非流式对话请求
     * 支持工具调用循环：当 AI 返回工具调用时，自动执行工具并将结果返回给 AI
     *
     * @param request 对话请求数据
     * @returns 对话响应数据
     */
    async handleChat(request: ChatRequestData): Promise<ChatSuccessData | ChatErrorData> {
        try {
            return await this.chatFlowService.handleChat(request);
        } catch (error) {
            return {
                success: false,
                error: this.formatError(error)
            };
        }
    }
    
    /**
     * 格式化错误信息
     * 如果有详细错误信息（如 API 返回的响应体），直接追加显示
     */
    private formatError(error: unknown): { code: string; message: string } {
        if (error instanceof ChannelError) {
            let message = error.message;
            
            // 如果有详细错误信息，直接 JSON 序列化追加
            if (error.details) {
                try {
                    const detailsStr = typeof error.details === 'string'
                        ? error.details
                        : JSON.stringify(error.details, null, 2);
                    message = `${error.message}\n${detailsStr}`;
                } catch {
                    // 忽略序列化错误
                }
            }
            
            return {
                code: error.type || 'CHANNEL_ERROR',
                message
            };
        }
        
        const err = error as any;
        return {
            code: err.code || 'UNKNOWN_ERROR',
            message: err.message || t('modules.api.chat.errors.unknownError')
        };
    }
    
    /**
     * 处理流式对话请求（自动根据配置决定使用流式或非流式）
     * 支持工具调用循环：当 AI 返回工具调用时，自动执行工具并将结果返回给 AI
     *
     * @param request 对话请求数据
     * @returns 异步生成器，产生流式响应
     */
    async *handleChatStream(
        request: ChatRequestData
    ): AsyncGenerator<
        ChatStreamChunkData
        | ChatStreamCompleteData
        | ChatStreamErrorData
        | ChatStreamToolIterationData
        | ChatStreamCheckpointsData
        | ChatStreamToolConfirmationData
        | ChatStreamToolsExecutingData
        | ChatStreamToolStatusData
        | ChatStreamAutoSummaryData
        | ChatStreamAutoSummaryStatusData
        | ChatStreamContextCommandData
    > {
        try {
            for await (const chunk of this.chatFlowService.handleChatStream(request)) {
                yield chunk;
            }
        } catch (error) {
            // 检查是否是用户取消错误
            if (error instanceof ChannelError && error.type === ErrorType.CANCELLED_ERROR) {
                // 用户取消，yield cancelled 消息
                yield {
                    conversationId: request.conversationId,
                    cancelled: true as const
                } as any;
                return;
            }
            
            yield {
                conversationId: request.conversationId,
                error: this.formatError(error)
            };
        }
    }
    
    /**
     * 处理工具确认响应
     *
     * 当用户在前端确认或拒绝工具执行时调用此方法
     *
     * @param request 工具确认响应数据
     */
    async *handleToolConfirmation(
        request: ToolConfirmationResponseData
    ): AsyncGenerator<
        ChatStreamChunkData
        | ChatStreamCompleteData
        | ChatStreamErrorData
        | ChatStreamToolIterationData
        | ChatStreamCheckpointsData
        | ChatStreamToolConfirmationData
        | ChatStreamToolsExecutingData
        | ChatStreamToolStatusData
        | ChatStreamAutoSummaryData
        | ChatStreamAutoSummaryStatusData
    > {
        // 新实现：委托给 ChatFlowService 处理完整流程，保留统一的错误处理逻辑
        try {
            for await (const chunk of this.chatFlowService.handleToolConfirmation(request)) {
                yield chunk as any;
            }
            return;
        } catch (error) {
            // 检查是否是用户取消错误
            if (error instanceof ChannelError && error.type === ErrorType.CANCELLED_ERROR) {
                // 用户取消，yield cancelled 消息
                yield {
                    conversationId: request.conversationId,
                    cancelled: true as const
                } as any;
                return;
            }

            // 检查是否是取消导致的错误（信号已中止）
            if (request.abortSignal?.aborted) {
                yield {
                    conversationId: request.conversationId,
                    cancelled: true as const
                } as any;
                return;
            }

            yield {
                conversationId: request.conversationId,
                error: this.formatError(error)
            };
            return;
        }
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
    ): Promise<UiStatusPayload> {
        // 修改原因：旧 summarizeContext webview 入口直连 SummarizeService，只插入 summary 消息而不写 ledger/projection，和 slash /summarize 语义割裂。
        // 修改方式：保留旧方法名兼容 handler，但内部统一走 ContextOperationService.summarize。
        // 修改目的：任何用户可见的手动总结入口都产生同一套 ledger/projection，并能被下一轮 prompt assembly 使用。
        return await this.contextOperationService.summarize({
            conversationId: request.conversationId,
            configId: request.configId,
            actor: 'user',
            command: '/summarize',
            abortSignal: request.abortSignal
        });
    }

    async handleCompactContext(request: { conversationId: string; configId: string; abortSignal?: AbortSignal }) {
        // 修改原因：主界面压缩按钮需要与 slash `/compact` 共享同一套 ContextOperationService 语义，而不是绕过 ledger/projection 直接调用 SummarizeService。
        // 修改方式：ChatHandler 暴露普通 request/response 入口，内部调用 compact by policy。
        // 修改目的：让主按钮、slash compact 和后续状态刷新都基于同一份 projection/ledger 事实源。
        return await this.contextOperationService.compact({
            conversationId: request.conversationId,
            configId: request.configId,
            actor: 'user',
            command: '/compact',
            abortSignal: request.abortSignal
        });
    }
    
/**
     * 处理重试请求（非流式）
     * 支持工具调用循环
     *
     * @param request 重试请求数据
     * @returns 对话响应数据
     */
    async handleRetry(request: RetryRequestData): Promise<ChatSuccessData | ChatErrorData> {
        try {
            return await this.chatFlowService.handleRetry(request);
        } catch (error) {
            return {
                success: false,
                error: this.formatError(error)
            };
        }
    }
    
    /**
     * 处理重试请求（自动根据配置决定使用流式或非流式）
     * 支持工具调用循环
     *
     * @param request 重试请求数据
     * @returns 异步生成器，产生流式响应
     */
    async *handleRetryStream(
        request: RetryRequestData
    ): AsyncGenerator<
        ChatStreamChunkData
        | ChatStreamCompleteData
        | ChatStreamErrorData
        | ChatStreamToolIterationData
        | ChatStreamToolConfirmationData
        | ChatStreamToolsExecutingData
        | ChatStreamToolStatusData
        | ChatStreamAutoSummaryData
        | ChatStreamAutoSummaryStatusData
    > {
        try {
            for await (const chunk of this.chatFlowService.handleRetryStream(request)) {
                // ChatFlowService 返回的是 ChatStreamOutput 联合类型，这里向下兼容原有联合类型
                yield chunk as any;
            }
        } catch (error) {
            // 检查是否是用户取消错误
            if (error instanceof ChannelError && error.type === ErrorType.CANCELLED_ERROR) {
                // 用户取消，yield cancelled 消息
                yield {
                    conversationId: request.conversationId,
                    cancelled: true as const
                } as any;
                return;
            }
            
            yield {
                conversationId: request.conversationId,
                error: this.formatError(error)
            };
        }
    }
    
    /**
     * 处理编辑并重试请求（非流式）
     * 支持工具调用循环
     *
     * @param request 编辑并重试请求数据
     * @returns 对话响应数据
     */
    async handleEditAndRetry(
        request: EditAndRetryRequestData
    ): Promise<ChatSuccessData | ChatErrorData> {
        try {
            return await this.chatFlowService.handleEditAndRetry(request);
        } catch (error) {
            return {
                success: false,
                error: this.formatError(error)
            };
        }
    }
    
    /**
     * 处理编辑并重试请求（自动根据配置决定使用流式或非流式）
     * 支持工具调用循环
     *
     * @param request 编辑并重试请求数据
     * @returns 异步生成器，产生流式响应
     */
    async *handleEditAndRetryStream(
        request: EditAndRetryRequestData
    ): AsyncGenerator<
        ChatStreamChunkData
        | ChatStreamCompleteData
        | ChatStreamErrorData
        | ChatStreamToolIterationData
        | ChatStreamCheckpointsData
        | ChatStreamToolConfirmationData
        | ChatStreamToolsExecutingData
        | ChatStreamToolStatusData
        | ChatStreamAutoSummaryData
        | ChatStreamAutoSummaryStatusData
    > {
        try {
            for await (const chunk of this.chatFlowService.handleEditAndRetryStream(request)) {
                yield chunk as any;
            }
        } catch (error) {
            // 检查是否是用户取消错误
            if (error instanceof ChannelError && error.type === ErrorType.CANCELLED_ERROR) {
                // 用户取消，yield cancelled 消息
                yield {
                    conversationId: request.conversationId,
                    cancelled: true as const
                } as any;
                return;
            }
            
            yield {
                conversationId: request.conversationId,
                error: this.formatError(error)
            };
        }
    }
    
    /**
     * 处理删除到指定消息的请求
     *
     * @param request 删除请求数据
     * @returns 删除响应数据
     */
    async handleDeleteToMessage(
        request: DeleteToMessageRequestData
    ): Promise<DeleteToMessageSuccessData | DeleteToMessageErrorData> {
        try {
            return await this.chatFlowService.handleDeleteToMessage(request);
        } catch (error) {
            return {
                success: false,
                error: this.formatError(error)
            };
        }
    }

    /**
     * 在外部进行历史删除/回退后，刷新派生元数据（todoList / activeBuild 等）
     */
    async refreshDerivedMetadataAfterHistoryMutation(conversationId: string): Promise<void> {
        try {
            await this.chatFlowService.refreshDerivedMetadataAfterHistoryMutation(conversationId);
        } catch (error) {
            console.error('[ChatHandler] Failed to refresh derived metadata:', error);
        }
    }
    
    /**
     * 确保对话存在（不存在则创建）
     *
     * 由于 ConversationManager 现在无内存缓存，每次操作直接读写文件，
     * 只需调用 getHistory 即可触发自动创建逻辑（loadHistory 内部会处理）
     *
     * @param conversationId 对话 ID
     */
    private async ensureConversation(conversationId: string): Promise<void> {
        // getHistory 内部调用 loadHistory，如果对话不存在会自动创建
        await this.conversationManager.getHistory(conversationId);
    }
    
}
