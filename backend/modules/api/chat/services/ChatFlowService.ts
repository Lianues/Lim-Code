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
import type { Content, ContentPart } from '../../../conversation/types';
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
  ChatStreamToolStatusData,
  ChatStreamAutoSummaryData,
  ChatStreamAutoSummaryStatusData,
} from '../types';

import type { MessageBuilderService } from './MessageBuilderService';
import type { TokenEstimationService } from './TokenEstimationService';
import type { ToolIterationLoopService } from './ToolIterationLoopService';
import type { CheckpointService } from './CheckpointService';
import type { DiffInterruptService } from './DiffInterruptService';
import type { OrphanedToolCallService } from './OrphanedToolCallService';
import type { ToolExecutionService, ToolExecutionFullResult, ToolExecutionProgressEvent } from './ToolExecutionService';
import type { ToolCallParserService } from './ToolCallParserService';

export type ChatStreamOutput =
  | ChatStreamChunkData
  | ChatStreamCompleteData
  | ChatStreamErrorData
  | ChatStreamToolIterationData
  | ChatStreamCheckpointsData
  | ChatStreamToolConfirmationData
  | ChatStreamToolsExecutingData
  | ChatStreamToolStatusData
  | ChatStreamAutoSummaryData
  | ChatStreamAutoSummaryStatusData;

type TodoStatusValue = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TodoItemValue = { id: string; content: string; status: TodoStatusValue };

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

  private mergeResponseWithCleanup(
    existing: Record<string, unknown> | undefined,
    patch: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      ...(existing && typeof existing === 'object' ? existing : {}),
      ...(patch || {})
    };
  }

  private normalizeTodoStatus(value: unknown): TodoStatusValue {
    if (value === 'in_progress' || value === 'completed' || value === 'cancelled') return value;
    return 'pending';
  }

  private normalizeTodoList(raw: unknown): TodoItemValue[] {
    if (!Array.isArray(raw)) return [];
    const out: TodoItemValue[] = [];

    for (const item of raw) {
      const id = (item as any)?.id;
      const content = (item as any)?.content;
      const status = (item as any)?.status;
      if (typeof id !== 'string' || !id.trim()) continue;
      if (typeof content !== 'string') continue;

      out.push({
        id: id.trim(),
        content,
        status: this.normalizeTodoStatus(status),
      });
    }

    return out;
  }

  private applyTodoUpdateOps(existing: TodoItemValue[], rawOps: unknown): TodoItemValue[] {
    const result: Array<TodoItemValue | null> = existing.map((t) => ({ ...t }));
    const indexById = new Map<string, number>();

    for (let i = 0; i < result.length; i++) {
      const t = result[i];
      if (t) indexById.set(t.id, i);
    }

    const ops = Array.isArray(rawOps) ? rawOps : [];
    for (const opAny of ops) {
      const op = (opAny as any)?.op;
      const idRaw = (opAny as any)?.id;
      const id = typeof idRaw === 'string' ? idRaw.trim() : '';

      if (op === 'add') {
        const content = (opAny as any)?.content;
        if (!id || typeof content !== 'string') continue;
        const status = this.normalizeTodoStatus((opAny as any)?.status);
        const idx = indexById.get(id);

        if (idx === undefined) {
          indexById.set(id, result.length);
          result.push({ id, content, status });
        } else {
          const current = result[idx];
          if (!current) continue;
          current.content = content;
          current.status = status;
        }
        continue;
      }

      if (!id) continue;
      const idx = indexById.get(id);
      if (idx === undefined) continue;
      const current = result[idx];
      if (!current) continue;

      if (op === 'set_status') {
        current.status = this.normalizeTodoStatus((opAny as any)?.status);
        continue;
      }

      if (op === 'set_content') {
        const content = (opAny as any)?.content;
        if (typeof content === 'string') current.content = content;
        continue;
      }

      if (op === 'cancel') {
        current.status = 'cancelled';
        continue;
      }

      if (op === 'remove') {
        result[idx] = null;
        indexById.delete(id);
      }
    }

    return result.filter((t): t is TodoItemValue => !!t);
  }

  private collectRespondedToolCallIds(history: Content[]): Set<string> {
    const responded = new Set<string>();
    for (const msg of history) {
      if (msg.role !== 'user' || !Array.isArray(msg.parts)) continue;
      for (const part of msg.parts) {
        const id = part.functionResponse?.id;
        if (typeof id === 'string' && id.trim()) {
          responded.add(id.trim());
        }
      }
    }
    return responded;
  }

  private isToolCallResponded(callId: string | undefined, responded: Set<string>): boolean {
    if (!callId) return true;
    const normalized = callId.trim();
    if (!normalized) return true;
    return responded.has(normalized);
  }

  private collectFunctionResponseById(history: Content[]): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();

    for (const msg of history) {
      if (msg.role !== 'user' || !Array.isArray(msg.parts)) continue;
      for (const part of msg.parts) {
        const response = part.functionResponse?.response;
        const idRaw = part.functionResponse?.id;
        if (typeof idRaw !== 'string' || !idRaw.trim()) continue;
        if (!response || typeof response !== 'object') continue;

        const id = idRaw.trim();
        const current = response as Record<string, unknown>;
        const prev = out.get(id);
        out.set(id, this.mergeResponseWithCleanup(prev, current));
      }
    }

    return out;
  }

  private replayTodoListFromHistory(history: Content[], respondedToolCallIds?: Set<string>): TodoItemValue[] | null {
    const responded = respondedToolCallIds || this.collectRespondedToolCallIds(history);
    const responseById = this.collectFunctionResponseById(history);

    let touched = false;
    let list: TodoItemValue[] = [];

    for (const msg of history) {
      if (msg.role !== 'model' || !Array.isArray(msg.parts)) continue;

      for (const part of msg.parts) {
        const call = part.functionCall;
        if (!call || call.rejected) continue;

        if (!this.isToolCallResponded(call.id, responded)) continue;

        const mergedResponse = (() => {
          if (typeof call.id !== 'string' || !call.id.trim()) return undefined;
          return responseById.get(call.id.trim());
        })();

        const args = call.args && typeof call.args === 'object' ? call.args as Record<string, unknown> : {};

        if (call.name === 'create_plan' || call.name === 'todo_write') {
          if (call.name === 'create_plan') {
            const prompt = (mergedResponse as any)?.planExecutionPrompt;
            if (typeof prompt !== 'string' || !prompt.trim()) continue;
          }

          const todosInput = Array.isArray((mergedResponse as any)?.todos)
            ? (mergedResponse as any)?.todos
            : Array.isArray((mergedResponse as any)?.data?.todos)
              ? (mergedResponse as any)?.data?.todos
              : (args as any).todos;
          if (!Array.isArray(todosInput)) continue;
          list = this.normalizeTodoList(todosInput);
          touched = true;
          continue;
        }

        if (call.name === 'todo_update') {
          if (!Array.isArray((args as any).ops)) continue;
          list = this.applyTodoUpdateOps(list, (args as any).ops);
          touched = true;
        }
      }
    }

    return touched ? list : null;
  }

  private async rebuildTodoListMetadataFromHistory(conversationId: string): Promise<void> {
    const history = await this.conversationManager.getHistoryRef(conversationId);
    const replayed = this.replayTodoListFromHistory(history);

    await this.conversationManager.setCustomMetadata(conversationId, 'todoList', replayed || []);

    // 回退/删除后不再从历史“恢复 Build 壳”，避免出现 Recovered Build。
    // activeBuild 仅由真实的计划执行流程维护。
    await this.conversationManager.setCustomMetadata(conversationId, 'activeBuild', null);
  }

  async refreshDerivedMetadataAfterHistoryMutation(conversationId: string): Promise<void> {
    await this.rebuildTodoListMetadataFromHistory(conversationId);
  }

  /**
   * 写入（或替换）一条隐藏 functionResponse。
   *
   * 用途：前端需要“继续对话”但不创建可见 user 文本消息（例如 Plan 执行确认）。
   *
   * 规则：
   * 1) 若提供 id，优先在历史中按 functionResponse.id 精确匹配并替换；
   * 2) 否则（或未匹配到）追加一条 isFunctionResponse 的 user 消息。
   */
  private async upsertHiddenFunctionResponse(
    conversationId: string,
    hidden: NonNullable<ChatRequestData['hiddenFunctionResponse']>,
  ): Promise<void> {
    const targetId = typeof hidden.id === 'string' && hidden.id.trim() ? hidden.id.trim() : undefined;

    if (targetId) {
      const history = await this.conversationManager.getHistoryRef(conversationId);

      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.role !== 'user' || !Array.isArray(msg.parts) || msg.parts.length === 0) continue;

        let matched = false;
        const nextParts: ContentPart[] = msg.parts.map((part) => {
          if (!part.functionResponse) return part;
          if (part.functionResponse.id !== targetId) return part;

          matched = true;
          return {
            ...part,
            functionResponse: {
              ...part.functionResponse,
              id: targetId,
              name: hidden.name,
              response: this.mergeResponseWithCleanup(part.functionResponse.response, hidden.response),
            },
          };
        });

        if (matched) {
          await this.conversationManager.updateMessage(conversationId, i, {
            parts: nextParts,
            isFunctionResponse: true,
          });
          return;
        }
      }
    }

    await this.conversationManager.addContent(conversationId, {
      role: 'user',
      parts: [{
        functionResponse: {
          id: targetId,
          name: hidden.name,
          response: hidden.response,
        },
      }],
      isFunctionResponse: true,
    });
  }

  /**
   * 非流式 Chat 流程
   */
  async handleChat(request: ChatRequestData): Promise<ChatSuccessData | ChatErrorData> {
    const { conversationId, configId, message, modelOverride, hiddenFunctionResponse } = request;

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

    // 3. 添加输入到历史
    if (hiddenFunctionResponse) {
      await this.upsertHiddenFunctionResponse(conversationId, hiddenFunctionResponse);
    } else {
      const userParts = this.messageBuilderService.buildUserMessageParts(message, request.attachments);
      await this.conversationManager.addMessage(conversationId, 'user', userParts, {
        isUserInput: true
      });
    }

    // 4. 工具调用循环（委托给 ToolIterationLoopService，非流式）
    const maxToolIterations = this.getMaxToolIterations();
    const loopResult = await this.toolIterationLoopService.runNonStreamLoop(
      conversationId,
      configId,
      config,
      maxToolIterations,
      modelOverride,
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
    const { conversationId, configId, modelOverride } = request;

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
      modelOverride,
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
    const { conversationId, messageIndex, newMessage, configId, modelOverride } = request;

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
      await this.rebuildTodoListMetadataFromHistory(conversationId);
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
      modelOverride,
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
    const { conversationId, configId, message, modelOverride, hiddenFunctionResponse } = request;

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

    // 4/5/6. 写入输入到历史：
    // - 普通模式：用户文本消息 + before/after checkpoint
    // - 隐藏模式：写入（或替换）functionResponse，不创建可见 user 文本消息，也不创建用户消息 checkpoint
    if (!hiddenFunctionResponse) {
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
    } else {
      await this.upsertHiddenFunctionResponse(conversationId, hiddenFunctionResponse);
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
      modelOverride,
      abortSignal: request.abortSignal,
      summarizeAbortSignal: request.summarizeAbortSignal,
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
    const { conversationId, configId, modelOverride } = request;

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
      modelOverride,
      abortSignal: request.abortSignal,
      summarizeAbortSignal: request.summarizeAbortSignal,
      isFirstMessage: isRetryFirstMessage,
      maxIterations: maxToolIterations,
      // 重试场景原本没有模型消息前检查点，这里显式关闭以保持行为一致
      createBeforeModelCheckpoint: false,
      // 重试的是 AI 回复，回合起始用户消息不变，复用其上缓存的动态上下文
      isNewTurn: false,
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
    const { conversationId, messageIndex, newMessage, configId, modelOverride } = request;

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
      await this.rebuildTodoListMetadataFromHistory(conversationId);
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
      modelOverride,
      abortSignal: request.abortSignal,
      summarizeAbortSignal: request.summarizeAbortSignal,
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
    const { conversationId, configId, toolResponses, modelOverride } = request;

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

    // 3. 寻找最后一条包含工具调用的 model 消息及其索引
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

    // 从后往前找最近的一个 model 消息，它必须包含函数调用
    let modelMessageIndex = -1;
    let lastMessage: Content | undefined;

    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'model') {
        const calls = this.toolCallParserService.extractFunctionCalls(history[i]);
        if (calls.length > 0) {
          modelMessageIndex = i;
          lastMessage = history[i];
          break;
        }
      }
    }

    if (!lastMessage || modelMessageIndex === -1) {
      yield {
        conversationId,
        error: {
          code: 'INVALID_STATE',
          message: t('modules.api.chat.errors.lastMessageNotModel'),
        },
      };
      return;
    }

    const allFunctionCalls = this.toolCallParserService.extractFunctionCalls(lastMessage);
    
    // 收集所有已经存在的函数响应 ID
    const respondedToolIds = new Set<string>();
    for (let i = modelMessageIndex + 1; i < history.length; i++) {
      const msg = history[i];
      if (msg.parts) {
        for (const part of msg.parts) {
          if (part.functionResponse?.id) {
            respondedToolIds.add(part.functionResponse.id);
          }
        }
      }
    }

    // 过滤掉已经有响应的工具调用（比如已经自动执行过的）
    const pendingCalls = allFunctionCalls.filter(call => !respondedToolIds.has(call.id));

    if (pendingCalls.length === 0) {
      // 如果没有待确认的工具，可能是已经被其他操作处理了，直接继续循环
      for await (const output of this.toolIterationLoopService.runToolLoop({
        conversationId,
        configId,
        config,
        modelOverride,
        abortSignal: request.abortSignal,
        summarizeAbortSignal: request.summarizeAbortSignal,
        isFirstMessage: false,
        maxIterations: this.getMaxToolIterations(),
        createBeforeModelCheckpoint: false,
        isNewTurn: false,
      })) {
        yield output as ChatStreamOutput;
      }
      return;
    }

    // 4. 按“队列顺序”处理工具：一次只允许推进到下一个需要批准的工具。
    // 目标：工具之间解耦，但严格保证顺序（后一个必须等前一个成功/失败后才开始）。

    const messageIndex = modelMessageIndex;

    // 队首待处理工具（按 AI 输出顺序）
    const nextCall = allFunctionCalls.find(call => !respondedToolIds.has(call.id));
    if (!nextCall) {
      // 理论上不会发生，但为了健壮性，直接继续循环
      for await (const output of this.toolIterationLoopService.runToolLoop({
        conversationId,
        configId,
        config,
        modelOverride,
        abortSignal: request.abortSignal,
        summarizeAbortSignal: request.summarizeAbortSignal,
        isFirstMessage: false,
        maxIterations: this.getMaxToolIterations(),
        createBeforeModelCheckpoint: false,
        isNewTurn: false,
      })) {
        yield output as ChatStreamOutput;
      }
      return;
    }

    const nextDecision = toolResponses.find(r => r.id === nextCall.id);
    if (!nextDecision) {
      yield {
        conversationId,
        error: {
          code: 'INVALID_TOOL_CONFIRMATION',
          message: `Invalid tool confirmation. Expected toolId=${nextCall.id}, got=${toolResponses.map(r => r.id).join(',')}`,
        },
      };
      return;
    }

    const toolResultsThisTurn: Array<{ id: string; name: string; result: Record<string, unknown> }> = [];
    const checkpointsThisTurn: CheckpointRecord[] = [];

    let responseParts: ContentPart[] = [];
    let multimodalAttachments: ContentPart[] = [];

    const mergeExecutionResult = (res: ToolExecutionFullResult) => {
      toolResultsThisTurn.push(...res.toolResults);
      checkpointsThisTurn.push(...res.checkpoints);
      responseParts.push(...res.responseParts);
      if (res.multimodalAttachments && res.multimodalAttachments.length > 0) {
        multimodalAttachments.push(...res.multimodalAttachments);
      }
    };

    const resolvedIdsThisTurn = new Set<string>();

    // 4.1 先处理队首工具（该工具一定是“当前等待批准”的那个）
    if (nextDecision.confirmed) {
      const gen = this.toolExecutionService.executeFunctionCallsWithProgress(
        [nextCall],
        conversationId,
        messageIndex,
        config,
        request.abortSignal,
      );

      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          mergeExecutionResult(value as ToolExecutionFullResult);
          break;
        }

        const event = value as ToolExecutionProgressEvent;

        if (event.type === 'start') {
          yield {
            conversationId,
            content: lastMessage,
            toolsExecuting: true as const,
            pendingToolCalls: [{
              id: event.call.id,
              name: event.call.name,
              args: event.call.args,
            }],
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
              result: event.toolResult.result,
            },
          } satisfies ChatStreamToolStatusData;
        }
      }

      resolvedIdsThisTurn.add(nextCall.id);
    } else {
      await this.conversationManager.rejectToolCalls(conversationId, messageIndex, [nextCall.id]);

      const rejectedResult = {
        success: false,
        error: t('modules.api.chat.errors.userRejectedTool'),
        rejected: true,
      };

      toolResultsThisTurn.push({
        id: nextCall.id,
        name: nextCall.name,
        result: rejectedResult,
      });

      yield {
        conversationId,
        toolStatus: true as const,
        tool: {
          id: nextCall.id,
          name: nextCall.name,
          status: 'error',
          result: rejectedResult,
        },
      } satisfies ChatStreamToolStatusData;

      resolvedIdsThisTurn.add(nextCall.id);
    }

    // 4.2 继续自动执行“紧随其后、且无需批准”的工具，直到遇到下一个需要批准的工具
    const nextIndex = allFunctionCalls.findIndex(c => c.id === nextCall.id);
    const autoSuffix: typeof allFunctionCalls = [];
    let nextConfirmTool: (typeof allFunctionCalls)[number] | null = null;

    for (let i = nextIndex + 1; i < allFunctionCalls.length; i++) {
      const c = allFunctionCalls[i];
      if (respondedToolIds.has(c.id) || resolvedIdsThisTurn.has(c.id)) {
        continue;
      }
      if (this.toolExecutionService.toolNeedsConfirmation(c.name)) {
        nextConfirmTool = c;
        break;
      }
      autoSuffix.push(c);
    }

    if (autoSuffix.length > 0) {
      const gen = this.toolExecutionService.executeFunctionCallsWithProgress(
        autoSuffix,
        conversationId,
        messageIndex,
        config,
        request.abortSignal,
      );

      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          mergeExecutionResult(value as ToolExecutionFullResult);
          break;
        }

        const event = value as ToolExecutionProgressEvent;

        if (event.type === 'start') {
          yield {
            conversationId,
            content: lastMessage,
            toolsExecuting: true as const,
            pendingToolCalls: [{
              id: event.call.id,
              name: event.call.name,
              args: event.call.args,
            }],
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
              result: event.toolResult.result,
            },
          } satisfies ChatStreamToolStatusData;
        }
      }

      for (const c of autoSuffix) {
        resolvedIdsThisTurn.add(c.id);
      }
    }

    // 5. 持久化本轮执行产生的 functionResponse（rejectToolCalls 已经持久化了拒绝结果）
    if (responseParts.length > 0 || multimodalAttachments.length > 0) {
      const confirmFunctionResponseParts = multimodalAttachments.length > 0
        ? [...multimodalAttachments, ...responseParts]
        : responseParts;

      await this.conversationManager.addContent(conversationId, {
        role: 'user',
        parts: confirmFunctionResponseParts,
        isFunctionResponse: true,
      });
    }

    // 5.5 如果有用户批注，添加为新的用户消息
    if (request.annotation && request.annotation.trim()) {
      await this.conversationManager.addContent(conversationId, {
        role: 'user',
        parts: [{ text: request.annotation.trim() }],
      });
    }

    // 如果本轮存在 cancelled，则不再继续推进，也不再等待下一次确认
    const hasCancelledTools = toolResultsThisTurn.some(r => (r.result as any).cancelled);
    if (hasCancelledTools) {
      yield {
        conversationId,
        content: lastMessage,
        toolIteration: true as const,
        toolResults: toolResultsThisTurn,
        checkpoints: checkpointsThisTurn,
      } satisfies ChatStreamToolIterationData;
      return;
    }

    // 6. 如果还有需要批准的工具，进入等待确认阶段（不触发 toolIteration，也不继续 AI）
    if (nextConfirmTool) {
      yield {
        conversationId,
        pendingToolCalls: [{
          id: nextConfirmTool.id,
          name: nextConfirmTool.name,
          args: nextConfirmTool.args,
        }],
        content: lastMessage,
        awaitingConfirmation: true as const,
        toolResults: toolResultsThisTurn,
        checkpoints: checkpointsThisTurn,
      } satisfies ChatStreamToolConfirmationData;
      return;
    }

    // 7. 工具队列已全部完成，发送 toolIteration，并继续 AI 对话
    yield {
      conversationId,
      content: lastMessage,
      toolIteration: true as const,
      toolResults: toolResultsThisTurn,
      checkpoints: checkpointsThisTurn,
    } satisfies ChatStreamToolIterationData;

    // 注：工具响应和批注消息的 token 计数将在 getHistoryWithContextTrimInfo 中
    // 与系统提示词、动态上下文一起并行计算

    // 8. 继续 AI 对话（让 AI 处理工具结果）
    const maxToolIterations = this.getMaxToolIterations();

    for await (const output of this.toolIterationLoopService.runToolLoop({
      conversationId,
      configId,
      config,
      modelOverride,
      abortSignal: request.abortSignal,
      summarizeAbortSignal: request.summarizeAbortSignal,
      // 工具确认后的继续对话不视为首条消息
      isFirstMessage: false,
      maxIterations: maxToolIterations,
      // 原逻辑未在确认后的循环中创建模型消息前检查点，这里保持一致
      createBeforeModelCheckpoint: false,
      isNewTurn: false,
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

      // 6.5 根据剩余历史重放 todo 工具，修正 ConversationMetadata.custom.todoList
      await this.rebuildTodoListMetadataFromHistory(conversationId);
      
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
