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
  ContinueWithAnnotationRequestData,
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
import { hasFileModificationToolInResults, getFileModificationToolIds } from '../utils';

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
    await this.conversationManager.addMessage(conversationId, 'user', userParts);

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

    // 4. 更新消息内容
    await this.conversationManager.updateMessage(conversationId, messageIndex, {
      parts: [{ text: newMessage }],
    });

    // 4.5 重新计算编辑后消息的 token 数
    await this.tokenEstimationService.preCountUserMessageTokens(
      conversationId,
      config.type,
      messageIndex,
      true,
    );

    // 5. 删除后续所有消息（messageIndex+1 及之后）和关联的检查点
    const historyRef = await this.conversationManager.getHistoryRef(conversationId);
    if (messageIndex + 1 < historyRef.length) {
      await this.checkpointService.deleteCheckpointsFromIndex(conversationId, messageIndex + 1);
      await this.conversationManager.deleteToMessage(conversationId, messageIndex + 1);
    }

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

    // 3. 中断之前未完成的 diff 等待
    this.diffInterruptService.markUserInterrupt();

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
    await this.conversationManager.addMessage(conversationId, 'user', userParts);

    // 5.1 预计算用户消息 token 数
    await this.tokenEstimationService.preCountUserMessageTokens(conversationId, config.type);

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

    // 3. 中断之前未完成的 diff 等待
    this.diffInterruptService.markUserInterrupt();

    // 4. 检查并处理孤立的函数调用
    const orphanedFunctionCalls =
      await this.orphanedToolCallService.checkAndExecuteOrphanedFunctionCalls(conversationId);
    if (orphanedFunctionCalls) {
      // 计算工具响应消息的 token 数
      await this.tokenEstimationService.preCountUserMessageTokens(conversationId, config.type);

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

    // 4. 中断之前未完成的 diff 等待
    this.diffInterruptService.markUserInterrupt();

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

    // 7. 更新消息内容（包含附件）
    const editParts = this.messageBuilderService.buildUserMessageParts(newMessage, request.attachments);
    await this.conversationManager.updateMessage(conversationId, messageIndex, {
      parts: editParts,
    });

    // 7.5 重新计算编辑后消息的 token 数
    await this.tokenEstimationService.preCountUserMessageTokens(
      conversationId,
      config.type,
      messageIndex,
      true,
    );

    // 8. 删除后续所有消息
    const historyRef = await this.conversationManager.getHistoryRef(conversationId);
    if (messageIndex + 1 < historyRef.length) {
      await this.conversationManager.deleteToMessage(conversationId, messageIndex + 1);
    }

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

    // 6. 处理拒绝的工具调用
    const rejectedParts: ContentPart[] = [];
    const rejectedResults: Array<{ id: string; name: string; result: Record<string, unknown> }> = [];

    for (const call of rejectedCalls) {
      const rejectionResponse = {
        success: false,
        error: t('modules.api.chat.errors.userRejectedTool'),
        rejected: true,
      };

      rejectedResults.push({
        id: call.id,
        name: call.name,
        result: rejectionResponse,
      });

      rejectedParts.push({
        functionResponse: {
          name: call.name,
          response: rejectionResponse,
          id: call.id,
        },
      });
    }

    // 7. 合并结果
    const allToolResults = [...confirmedResult.toolResults, ...rejectedResults];
    const allResponseParts = [...confirmedResult.responseParts, ...rejectedParts];
    const allCheckpoints = confirmedResult.checkpoints;

    // 8. 将函数响应添加到历史（必须在 toolIteration / continueWithAnnotation 之前完成）
    // 否则前端若过早触发 continueWithAnnotation，会导致历史缺少 tool result。
    const confirmFunctionResponseParts =
      confirmedResult.multimodalAttachments && confirmedResult.multimodalAttachments.length > 0
        ? [...confirmedResult.multimodalAttachments, ...allResponseParts]
        : allResponseParts;

    await this.conversationManager.addContent(conversationId, {
      role: 'user',
      parts: confirmFunctionResponseParts,
      isFunctionResponse: true,
    });

    // 计算工具响应消息的 token 数
    await this.tokenEstimationService.preCountUserMessageTokens(conversationId, config.type);

    // 9. 检查是否包含文件修改工具（apply_diff / write_file）
    const hasDiffTools = hasFileModificationToolInResults(allToolResults);
    const diffToolIds = getFileModificationToolIds(allToolResults);

    if (hasDiffTools) {
      // 有 diff 工具：需要等待用户确认（保存/拒绝）并在确认后由前端调用 continueWithAnnotation
      const pendingAnnotation = request.annotation && request.annotation.trim()
        ? request.annotation.trim()
        : undefined;

      yield {
        conversationId,
        content: lastMessage,
        toolIteration: true as const,
        toolResults: allToolResults,
        checkpoints: allCheckpoints,
        needAnnotation: true as const,
        pendingDiffToolIds: diffToolIds,
        pendingAnnotation
      } satisfies ChatStreamToolIterationData;

      return;
    }

    // 10. 没有 diff 工具：如果有用户批注，直接加入历史并告知前端已使用
    const annotation = request.annotation?.trim();
    const hasAnnotation = !!annotation;

    if (hasAnnotation) {
      await this.conversationManager.addContent(conversationId, {
        role: 'user',
        parts: [{ text: annotation! }],
      });
      await this.tokenEstimationService.preCountUserMessageTokens(conversationId, config.type);
    }

    // 11. 发送工具执行结果（并告知批注是否已被使用）
    yield {
      conversationId,
      content: lastMessage,
      toolIteration: true as const,
      toolResults: allToolResults,
      checkpoints: allCheckpoints,
      annotationUsed: hasAnnotation ? annotation : undefined
    } satisfies ChatStreamToolIterationData;

    // 12. 继续 AI 对话（让 AI 处理工具结果）
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
   * 继续对话（带批注）
   *
   * 用于文件修改工具执行后，等待用户确认 diff 并填写批注后继续对话。
   */
  async *continueWithAnnotation(
    request: ContinueWithAnnotationRequestData,
  ): AsyncGenerator<ChatStreamOutput> {
    const { conversationId, configId, annotation } = request;

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

    // 3. 写入批注（允许为空字符串，表示用户不想添加任何批注）
    const trimmed = annotation?.trim();
    if (trimmed) {
      await this.conversationManager.addContent(conversationId, {
        role: 'user',
        parts: [{ text: trimmed }],
      });
      await this.tokenEstimationService.preCountUserMessageTokens(conversationId, config.type);
    }

    // 4. 继续工具调用循环
    const maxToolIterations = this.getMaxToolIterations();

    for await (const output of this.toolIterationLoopService.runToolLoop({
      conversationId,
      configId,
      config,
      abortSignal: request.abortSignal,
      // continueWithAnnotation 不视为首条消息
      isFirstMessage: false,
      maxIterations: maxToolIterations,
      // 保持与工具确认后继续对话一致：不创建模型消息前检查点
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

    try {
      // 3. 删除关联的检查点
      await this.checkpointService.deleteCheckpointsFromIndex(conversationId, targetIndex);

      // 4. 删除消息
      const deletedCount = await this.conversationManager.deleteToMessage(conversationId, targetIndex);

      return {
        success: true,
        deletedCount,
      };
    } finally {
      // 5. 重置 diff 中断标记
      this.diffInterruptService.resetUserInterrupt();
    }
  }
}
