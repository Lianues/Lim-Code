/**
 * LimCode - Chat 流程服务（应用服务层）
 *
 * 负责编排单次 Chat 调用的核心业务逻辑：
 * - 配置校验
 * - 对话存在性检查
 * - 用户消息写入 & checkpoint
 * - 工具调用循环（委托 ToolIterationLoopService / ToolExecutionService）
 */

import { t } from '../../../../i18n';
import type { ConfigManager } from '../../../config/ConfigManager';
import type { ChannelManager } from '../../../channel/ChannelManager';
import type { ConversationManager } from '../../../conversation/ConversationManager';
import type { SettingsManager } from '../../../settings/SettingsManager';
import type { BaseChannelConfig } from '../../../config/configs/base';
import { ChannelError, ErrorType } from '../../../channel/types';
import type { ContentPart } from '../../../conversation/types';
import type { CheckpointRecord } from '../../../checkpoint';

import type {
  ChatRequestData,
  RetryRequestData,
  EditAndRetryRequestData,
  ToolConfirmationResponseData,
  DeleteToMessageRequestData,
  DeleteToMessageSuccessData,
  DeleteToMessageErrorData,
  ChatSuccessData,
  ChatErrorData,
  ChatStreamChunkData,
  ChatStreamCompleteData,
  ChatStreamErrorData,
  ChatStreamToolIterationData,
  ChatStreamCheckpointsData,
  ChatStreamToolConfirmationData,
  ChatStreamToolsExecutingData,
} from '../types';

import type { MessageBuilderService } from './MessageBuilderService';
import type { TokenEstimationService } from './TokenEstimationService';
import type { ToolIterationLoopService } from './ToolIterationLoopService';
import type { CheckpointService } from './CheckpointService';
import type { DiffInterruptService } from './DiffInterruptService';
import type { OrphanedToolCallService } from './OrphanedToolCallService';
import type { ToolExecutionService } from './ToolExecutionService';
import type { ToolCallParserService } from './ToolCallParserService';

export type ChatStreamOutput =
  | ChatStreamChunkData
  | ChatStreamCompleteData
  | ChatStreamErrorData
  | ChatStreamToolIterationData
  | ChatStreamCheckpointsData
  | ChatStreamToolConfirmationData
  | ChatStreamToolsExecutingData;

export class ChatFlowService {
  constructor(
    private configManager: ConfigManager,
    private conversationManager: ConversationManager,
    private settingsManager: SettingsManager | undefined,
    private messageBuilderService: MessageBuilderService,
    private tokenEstimationService: TokenEstimationService,
    private toolIterationLoopService: ToolIterationLoopService,
    private checkpointService: CheckpointService,
    private diffInterruptService: DiffInterruptService,
    private orphanedToolCallService: OrphanedToolCallService,
    private toolExecutionService: ToolExecutionService,
    private toolCallParserService: ToolCallParserService,
  ) {}

  /**
   * 获取单回合最大工具调用次数
   */
  private getMaxToolIterations(): number {
    return this.settingsManager?.getMaxToolIterations() ?? 20;
  }

  /**
   * 确保对话存在（不存在则创建）
   */
  private async ensureConversation(conversationId: string): Promise<void> {
    await this.conversationManager.getHistory(conversationId);
  }

  /**
   * 非流式 Chat 流程
   */
  async handleChat(request: ChatRequestData): Promise<ChatSuccessData | ChatErrorData> {
    const { conversationId, configId, message } = request;

    // 1. 确保对话存在（自动创建）
    await this.ensureConversation(conversationId);

    // 2. 验证配置
    const config = await this.configManager.getConfig(configId);
    if (!config) {
      return {
        success: false,
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: t('modules.api.chat.errors.configNotFound', { configId }),
        },
      };
    }

    if (!config.enabled) {
      return {
        success: false,
        error: {
          code: 'CONFIG_DISABLED',
          message: t('modules.api.chat.errors.configDisabled', { configId }),
        },
      };
    }

    // 3. 添加用户消息到历史（包含附件）
    const userParts = this.messageBuilderService.buildUserMessageParts(message, request.attachments);
    await this.conversationManager.addMessage(conversationId, 'user', userParts, {
      isUserInput: true
    });

    // 4. 工具调用循环（委托给 ToolIterationLoopService，非流式）
    const maxToolIterations = this.getMaxToolIterations();
    const loopResult = await this.toolIterationLoopService.runNonStreamLoop(
      conversationId,
      configId,
      config,
      maxToolIterations,
    );

    if (loopResult.exceededMaxIterations) {
      return {
        success: false,
        error: {
          code: 'MAX_TOOL_ITERATIONS',
          message: t('modules.api.chat.errors.maxToolIterations', { maxIterations: maxToolIterations }),
        },
      };
    }

    return {
      success: true,
      content: loopResult.content!,
    };
  }

  /**
   * 非流式 Retry 流程
   */
  async handleRetry(request: RetryRequestData): Promise<ChatSuccessData | ChatErrorData> {
    const { conversationId, configId } = request;

    // 1. 确保对话存在
    await this.ensureConversation(conversationId);

    // 2. 验证配置
    const config = await this.configManager.getConfig(configId);
    if (!config) {
      return {
        success: false,
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: t('modules.api.chat.errors.configNotFound', { configId }),
        },
      };
    }

    if (!config.enabled) {
      return {
        success: false,
        error: {
          code: 'CONFIG_DISABLED',
          message: t('modules.api.chat.errors.configDisabled', { configId }),
        },
      };
    }

    // 3. 工具调用循环（委托给 ToolIterationLoopService，非流式）
    const maxToolIterations = this.getMaxToolIterations();
    const loopResult = await this.toolIterationLoopService.runNonStreamLoop(
      conversationId,
      configId,
      config,
      maxToolIterations,
    );

    if (loopResult.exceededMaxIterations) {
      return {
        success: false,
        error: {
          code: 'MAX_TOOL_ITERATIONS',
          message: t('modules.api.chat.errors.maxToolIterations', { maxIterations: maxToolIterations }),
        },
      };
    }

    return {
      success: true,
      content: loopResult.content!,
    };
  }

  /**
   * 非流式 EditAndRetry 流程
   */
  async handleEditAndRetry(
    request: EditAndRetryRequestData,
  ): Promise<ChatSuccessData | ChatErrorData> {
    const { conversationId, messageIndex, newMessage, configId } = request;

    // 1. 确保对话存在
    await this.ensureConversation(conversationId);

    // 2. 验证配置
    const config = await this.configManager.getConfig(configId);
    if (!config) {
      return {
        success: false,
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: t('modules.api.chat.errors.configNotFound', { configId }),
        },
      };
    }

    if (!config.enabled) {
      return {
        success: false,
        error: {
          code: 'CONFIG_DISABLED',
          message: t('modules.api.chat.errors.configDisabled', { configId }),
        },
      };
    }

    // 3. 验证消息索引和角色
    const message = await this.conversationManager.getMessage(conversationId, messageIndex);
    if (!message) {
      return {
        success: false,
        error: {
          code: 'MESSAGE_NOT_FOUND',
          message: t('modules.api.chat.errors.messageNotFound', { messageIndex }),
        },
      };
    }

    if (message.role !== 'user') {
      return {
        success: false,
        error: {
          code: 'INVALID_MESSAGE_ROLE',
          message: t('modules.api.chat.errors.canOnlyEditUserMessage', { role: message.role }),
        },
      };
    }

    // 4. 更新消息内容，并标记为动态提示词插入点
    await this.conversationManager.updateMessage(conversationId, messageIndex, {
      parts: [{ text: newMessage }],
      isUserInput: true,
      // 清除旧的 token 计数，强制重新计算
      tokenCountByChannel: {}
    });
    
    // 注：编辑后消息的 token 计数将在 getHistoryWithContextTrimInfo 中
    // 与系统提示词、动态上下文一起并行计算

    // 5. 删除后续所有消息（messageIndex+1 及之后）和关联的检查点
    const historyRef = await this.conversationManager.getHistoryRef(conversationId);
    if (messageIndex + 1 < historyRef.length) {
      await this.checkpointService.deleteCheckpointsFromIndex(conversationId, messageIndex + 1);
      await this.conversationManager.deleteToMessage(conversationId, messageIndex + 1);
    }
    
    // 5.5 清除裁剪状态（编辑后应重新计算裁剪）
    await this.toolIterationLoopService.clearTrimState(conversationId);

    // 6. 工具调用循环（委托给 ToolIterationLoopService，非流式）
    const maxToolIterations = this.getMaxToolIterations();
    const loopResult = await this.toolIterationLoopService.runNonStreamLoop(
      conversationId,
      configId,
      config,
      maxToolIterations,
    );

    if (loopResult.exceededMaxIterations) {
      return {
        success: false,
        error: {
          code: 'MAX_TOOL_ITERATIONS',
          message: t('modules.api.chat.errors.maxToolIterations', { maxIterations: maxToolIterations }),
        },
      };
    }

    return {
      success: true,
      content: loopResult.content!,
    };
  }

  /**
   * 流式 Chat 流程
   */
  async *handleChatStream(
    request: ChatRequestData,
  ): AsyncGenerator<ChatStreamOutput> {
    const { conversationId, configId, message } = request;

    // 1. 确保对话存在
    await this.ensureConversation(conversationId);

    // 2. 验证配置
    const config = await this.configManager.getConfig(configId);
    if (!config) {
      yield {
        conversationId,
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: t('modules.api.chat.errors.configNotFound', { configId }),
        },
      };
      return;
    }

    if (!config.enabled) {
      yield {
        conversationId,
        error: {
          code: 'CONFIG_DISABLED',
          message: t('modules.api.chat.errors.configDisabled', { configId }),
        },
      };
      return;
    }

    // 3. 中断之前未完成的 diff 等待并关闭编辑器
    this.diffInterruptService.markUserInterrupt();
    await this.diffInterruptService.cancelAllPending();
    
    // 3.5 拒绝所有未响应的工具调用（在添加用户消息之前）
    // 这确保 functionResponse 会被插入到工具调用消息之后，用户消息之前
    await this.conversationManager.rejectAllPendingToolCalls(conversationId);

    // 4. 为用户消息创建存档点（如果配置了执行前）
    const beforeUserCheckpoint = await this.checkpointService.createUserMessageCheckpoint(
      conversationId,
      'before',
    );
    if (beforeUserCheckpoint) {
      // 立即发送用户消息前存档点到前端
      yield {
        conversationId,
        checkpoints: [beforeUserCheckpoint],
        checkpointOnly: true as const,
      } satisfies ChatStreamCheckpointsData;
    }

    // 5. 添加用户消息到历史（包含附件）
    const userParts = this.messageBuilderService.buildUserMessageParts(message, request.attachments);
    await this.conversationManager.addMessage(conversationId, 'user', userParts, {
      isUserInput: true
    });
    
    // 注：用户消息的 token 计数将在 ContextTrimService.getHistoryWithContextTrimInfo 中
    // 与系统提示词、动态上下文一起并行计算，节省时间

    // 6. 为用户消息创建存档点（如果配置了执行后）
    const afterUserCheckpoint = await this.checkpointService.createUserMessageCheckpoint(
      conversationId,
      'after',
    );
    if (afterUserCheckpoint) {
      yield {
        conversationId,
        checkpoints: [afterUserCheckpoint],
        checkpointOnly: true as const,
      } satisfies ChatStreamCheckpointsData;
    }

    // 7. 重置中断标记
    this.diffInterruptService.resetUserInterrupt();

    // 8. 判断是否是首条消息（需要刷新动态系统提示词）
    const currentHistoryCheck = await this.conversationManager.getHistoryRef(conversationId);
    const isFirstMessage = currentHistoryCheck.length === 1; // 只有刚添加的用户消息

    // 9. 工具调用循环（委托给 ToolIterationLoopService）
    const maxToolIterations = this.getMaxToolIterations();

    for await (const output of this.toolIterationLoopService.runToolLoop({
      conversationId,
      configId,
      config,
      abortSignal: request.abortSignal,
      isFirstMessage,
      maxIterations: maxToolIterations,
    })) {
      yield output as ChatStreamOutput;
    }
  }

  /**
   * 流式 Retry 流程
   */
  async *handleRetryStream(
    request: RetryRequestData,
  ): AsyncGenerator<ChatStreamOutput> {
    const { conversationId, configId } = request;

    // 1. 确保对话存在
    await this.ensureConversation(conversationId);

    // 2. 验证配置
    const config = await this.configManager.getConfig(configId);
    if (!config) {
      yield {
        conversationId,
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: t('modules.api.chat.errors.configNotFound', { configId }),
        },
      };
      return;
    }

    if (!config.enabled) {
      yield {
        conversationId,
        error: {
          code: 'CONFIG_DISABLED',
          message: t('modules.api.chat.errors.configDisabled', { configId }),
        },
      };
      return;
    }

    // 3. 中断之前未完成的 diff 等待并关闭编辑器
    this.diffInterruptService.markUserInterrupt();
    await this.diffInterruptService.cancelAllPending();
    
    // 3.5 拒绝所有未响应的工具调用
    await this.conversationManager.rejectAllPendingToolCalls(conversationId);

    // 4. 检查并处理孤立的函数调用
    const orphanedFunctionCalls =
      await this.orphanedToolCallService.checkAndExecuteOrphanedFunctionCalls(conversationId);
    if (orphanedFunctionCalls) {
      // 注：工具响应消息的 token 计数将在 getHistoryWithContextTrimInfo 中并行计算
      
      // 发送孤立函数调用的执行结果到前端
      yield {
        conversationId,
        content: orphanedFunctionCalls.functionCallContent,
        toolIteration: true as const,
        toolResults: orphanedFunctionCalls.toolResults,
      } satisfies ChatStreamToolIterationData;
    }

    // 5. 重置中断标记
    this.diffInterruptService.resetUserInterrupt();

    // 6. 判断是否需要刷新动态系统提示词
    const retryHistoryCheck = await this.conversationManager.getHistoryRef(conversationId);
    const isRetryFirstMessage =
      retryHistoryCheck.length === 1 && retryHistoryCheck[0].role === 'user';

    // 7. 工具调用循环（委托给 ToolIterationLoopService）
    const maxToolIterations = this.getMaxToolIterations();

    for await (const output of this.toolIterationLoopService.runToolLoop({
      conversationId,
      configId,
      config,
      abortSignal: request.abortSignal,
      isFirstMessage: isRetryFirstMessage,
      maxIterations: maxToolIterations,
      // 重试场景原本没有模型消息前检查点，这里显式关闭以保持行为一致
      createBeforeModelCheckpoint: false,
    })) {
      yield output as ChatStreamOutput;
    }
  }

  /**
   * 流式 EditAndRetry 流程
   */
  async *handleEditAndRetryStream(
    request: EditAndRetryRequestData,
  ): AsyncGenerator<ChatStreamOutput> {
    const { conversationId, messageIndex, newMessage, configId } = request;

    // 1. 确保对话存在
    await this.ensureConversation(conversationId);

    // 2. 验证配置
    const config = await this.configManager.getConfig(configId);
    if (!config) {
      yield {
        conversationId,
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: t('modules.api.chat.errors.configNotFound', { configId }),
        },
      };
      return;
    }

    if (!config.enabled) {
      yield {
        conversationId,
        error: {
          code: 'CONFIG_DISABLED',
          message: t('modules.api.chat.errors.configDisabled', { configId }),
        },
      };
      return;
    }

    // 3. 验证消息索引和角色
    const message = await this.conversationManager.getMessage(conversationId, messageIndex);
    if (!message) {
      yield {
        conversationId,
        error: {
          code: 'MESSAGE_NOT_FOUND',
          message: t('modules.api.chat.errors.messageNotFound', { messageIndex }),
        },
      };
      return;
    }

    if (message.role !== 'user') {
      yield {
        conversationId,
        error: {
          code: 'INVALID_MESSAGE_ROLE',
          message: t('modules.api.chat.errors.canOnlyEditUserMessage', { role: message.role }),
        },
      };
      return;
    }

    // 4. 中断之前未完成的 diff 等待并关闭编辑器
    this.diffInterruptService.markUserInterrupt();
    await this.diffInterruptService.cancelAllPending();
    
    // 4.5 拒绝所有未响应的工具调用
    await this.conversationManager.rejectAllPendingToolCalls(conversationId);

    // 5. 删除该消息及后续所有消息的检查点
    await this.checkpointService.deleteCheckpointsFromIndex(conversationId, messageIndex);

    // 6. 为编辑后的用户消息创建存档点（执行前）
    const beforeEditCheckpoint = await this.checkpointService.createUserMessageCheckpoint(
      conversationId,
      'before',
      messageIndex,
    );
    if (beforeEditCheckpoint) {
      yield {
        conversationId,
        checkpoints: [beforeEditCheckpoint],
        checkpointOnly: true as const,
      } satisfies ChatStreamCheckpointsData;
    }

    // 7. 更新消息内容（包含附件），并标记为动态提示词插入点
    const editParts = this.messageBuilderService.buildUserMessageParts(newMessage, request.attachments);
    await this.conversationManager.updateMessage(conversationId, messageIndex, {
      parts: editParts,
      isUserInput: true,
      // 清除旧的 token 计数，强制重新计算
      tokenCountByChannel: {}
    });
    
    // 注：编辑后消息的 token 计数将在 getHistoryWithContextTrimInfo 中
    // 与系统提示词、动态上下文一起并行计算

    // 8. 删除后续所有消息
    const historyRef = await this.conversationManager.getHistoryRef(conversationId);
    if (messageIndex + 1 < historyRef.length) {
      await this.conversationManager.deleteToMessage(conversationId, messageIndex + 1);
    }
    
    // 8.5 清除裁剪状态（编辑后应重新计算裁剪）
    await this.toolIterationLoopService.clearTrimState(conversationId);

    // 9. 为编辑后的用户消息创建存档点（执行后）
    const afterEditCheckpoint = await this.checkpointService.createUserMessageCheckpoint(
      conversationId,
      'after',
      messageIndex,
    );
    if (afterEditCheckpoint) {
      yield {
        conversationId,
        checkpoints: [afterEditCheckpoint],
        checkpointOnly: true as const,
      } satisfies ChatStreamCheckpointsData;
    }

    // 10. 重置中断标记
    this.diffInterruptService.resetUserInterrupt();

    // 11. 判断是否是编辑首条消息（需要刷新动态系统提示词）
    const isEditFirstMessage = messageIndex === 0;

    // 12. 工具调用循环（委托给 ToolIterationLoopService）
    const maxToolIterations = this.getMaxToolIterations();

    for await (const output of this.toolIterationLoopService.runToolLoop({
      conversationId,
      configId,
      config,
      abortSignal: request.abortSignal,
      isFirstMessage: isEditFirstMessage,
      maxIterations: maxToolIterations,
    })) {
      yield output as ChatStreamOutput;
    }
  }

  /**
   * 工具确认流程
   */
  async *handleToolConfirmation(
    request: ToolConfirmationResponseData,
  ): AsyncGenerator<ChatStreamOutput> {
    const { conversationId, configId, toolResponses } = request;

    // 1. 确保对话存在
    await this.ensureConversation(conversationId);

    // 2. 验证配置
    const config = await this.configManager.getConfig(configId);
    if (!config) {
      yield {
        conversationId,
        error: {
          code: 'CONFIG_NOT_FOUND',
          message: t('modules.api.chat.errors.configNotFound', { configId }),
        },
      };
      return;
    }

    // 3. 获取历史中最后一条 model 消息的函数调用
    const history = await this.conversationManager.getHistoryRef(conversationId);
    if (history.length === 0) {
      yield {
        conversationId,
        error: {
          code: 'NO_HISTORY',
          message: t('modules.api.chat.errors.noHistory'),
        },
      };
      return;
    }

    const lastMessage = history[history.length - 1];
    if (lastMessage.role !== 'model') {
      yield {
        conversationId,
        error: {
          code: 'INVALID_STATE',
          message: t('modules.api.chat.errors.lastMessageNotModel'),
        },
      };
      return;
    }

    const functionCalls = this.toolCallParserService.extractFunctionCalls(lastMessage);
    if (functionCalls.length === 0) {
      yield {
        conversationId,
        error: {
          code: 'NO_FUNCTION_CALLS',
          message: t('modules.api.chat.errors.noFunctionCalls'),
        },
      };
      return;
    }

    // 4. 分离确认和拒绝的工具调用
    const confirmedCalls = functionCalls.filter(call => {
      const response = toolResponses.find(r => r.id === call.id);
      return response?.confirmed;
    });
    const rejectedCalls = functionCalls.filter(call => {
      const response = toolResponses.find(r => r.id === call.id);
      return !response?.confirmed;
    });

    const messageIndex = history.length - 1;

    // 5. 执行确认的工具调用
    let confirmedResult: {
      responseParts: ContentPart[];
      toolResults: Array<{ id: string; name: string; result: Record<string, unknown> }>;
      checkpoints: CheckpointRecord[];
      multimodalAttachments?: ContentPart[];
    } = {
      responseParts: [],
      toolResults: [],
      checkpoints: [],
    };

    if (confirmedCalls.length > 0) {
      // 工具执行前先发送计时信息（让前端立即显示）
      yield {
        conversationId,
        content: lastMessage,
        toolsExecuting: true as const,
        pendingToolCalls: confirmedCalls.map(call => ({
          id: call.id,
          name: call.name,
          args: call.args,
        })),
      } satisfies ChatStreamToolsExecutingData;

      confirmedResult = await this.toolExecutionService.executeFunctionCallsWithResults(
        confirmedCalls,
        conversationId,
        messageIndex,
        config,
        request.abortSignal,
      );
    }

    // 6. 处理拒绝的工具调用（标记 rejected 并添加 functionResponse）
    const rejectedResults: Array<{ id: string; name: string; result: Record<string, unknown> }> = [];

    if (rejectedCalls.length > 0) {
      // 使用 rejectToolCalls 标记 rejected 并添加 functionResponse
      const rejectedIds = rejectedCalls.map(call => call.id);
      await this.conversationManager.rejectToolCalls(conversationId, messageIndex, rejectedIds);
      
      // 构建拒绝结果用于前端显示
      for (const call of rejectedCalls) {
        rejectedResults.push({
          id: call.id,
          name: call.name,
          result: {
            success: false,
            error: t('modules.api.chat.errors.userRejectedTool'),
            rejected: true,
          },
        });
      }
    }

    // 7. 合并结果
    const allToolResults = [...confirmedResult.toolResults, ...rejectedResults];
    const allCheckpoints = confirmedResult.checkpoints;

    // 8. 发送工具执行结果
    yield {
      conversationId,
      content: lastMessage,
      toolIteration: true as const,
      toolResults: allToolResults,
      checkpoints: allCheckpoints,
    } satisfies ChatStreamToolIterationData;

    // 9. 将确认的函数响应添加到历史（拒绝的已由 rejectToolCalls 添加）
    if (confirmedResult.responseParts.length > 0) {
      const confirmFunctionResponseParts =
        confirmedResult.multimodalAttachments && confirmedResult.multimodalAttachments.length > 0
          ? [...confirmedResult.multimodalAttachments, ...confirmedResult.responseParts]
          : confirmedResult.responseParts;

      await this.conversationManager.addContent(conversationId, {
        role: 'user',
        parts: confirmFunctionResponseParts,
        isFunctionResponse: true,
      });
    }

    // 9.5 如果有用户批注，添加为新的用户消息
    if (request.annotation && request.annotation.trim()) {
      await this.conversationManager.addContent(conversationId, {
        role: 'user',
        parts: [{ text: request.annotation.trim() }],
      });
    }
    
    // 注：工具响应和批注消息的 token 计数将在 getHistoryWithContextTrimInfo 中
    // 与系统提示词、动态上下文一起并行计算

    // 10. 继续 AI 对话（让 AI 处理工具结果）
    const maxToolIterations = this.getMaxToolIterations();

    for await (const output of this.toolIterationLoopService.runToolLoop({
      conversationId,
      configId,
      config,
      abortSignal: request.abortSignal,
      // 工具确认后的继续对话不视为首条消息
      isFirstMessage: false,
      maxIterations: maxToolIterations,
      // 原逻辑未在确认后的循环中创建模型消息前检查点，这里保持一致
      createBeforeModelCheckpoint: false,
    })) {
      yield output as ChatStreamOutput;
    }
  }

  /**
   * 删除到指定消息的流程
   */
  async handleDeleteToMessage(
    request: DeleteToMessageRequestData,
  ): Promise<DeleteToMessageSuccessData | DeleteToMessageErrorData> {
    const { conversationId, targetIndex } = request;

    // 1. 确保对话存在
    await this.ensureConversation(conversationId);

    // 2. 中断之前未完成的 diff 等待
    this.diffInterruptService.markUserInterrupt();
    
    // 3. 取消所有待处理的 diff（关闭编辑器并恢复文件）
    await this.diffInterruptService.cancelAllPending();
    
    // 4. 拒绝所有未响应的工具调用并持久化
    await this.conversationManager.rejectAllPendingToolCalls(conversationId);

    try {
      // 5. 删除关联的检查点
      await this.checkpointService.deleteCheckpointsFromIndex(conversationId, targetIndex);

      // 6. 删除消息
      const deletedCount = await this.conversationManager.deleteToMessage(conversationId, targetIndex);
      
      // 7. 清除裁剪状态（回退后应重新计算裁剪）
      await this.toolIterationLoopService.clearTrimState(conversationId);

      return {
        success: true,
        deletedCount,
      };
    } finally {
      // 8. 重置 diff 中断标记
      this.diffInterruptService.resetUserInterrupt();
    }
  }
}
