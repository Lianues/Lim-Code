/**
 * LimCode - 孤立函数调用处理服务
 *
 * 负责检查并执行对话历史中“悬挂”的函数调用：
 * - 历史最后一条消息是 model
 * - 包含 functionCall
 * - 且没有对应的函数响应内容（没有 user 文本）
 */

import type { ConversationManager } from '../../../conversation/ConversationManager';
import type { Content } from '../../../conversation/types';
import type { FunctionCallInfo } from '../utils';
import type { ToolExecutionService } from './ToolExecutionService';
import type { ToolCallParserService } from './ToolCallParserService';

export interface OrphanedToolCallResult {
  /** 原始的函数调用所在的 model 消息 */
  functionCallContent: Content;
  /** 工具执行结果列表 */
  toolResults: Array<{ id?: string; name: string; result: Record<string, unknown> }>;
}

export class OrphanedToolCallService {
  constructor(
    private conversationManager: ConversationManager,
    private toolCallParserService: ToolCallParserService,
    private toolExecutionService: ToolExecutionService
  ) {}

  /**
   * 检查并执行孤立的函数调用
   *
   * 如果历史最后一条 model 消息包含 functionCall 且没有对应的函数响应，
   * 则执行这些函数调用并将结果添加到历史。
   *
   * @param conversationId 对话 ID
   * @returns 如果有孤立调用，返回执行结果；否则返回 null
   */
  async checkAndExecuteOrphanedFunctionCalls(
    conversationId: string
  ): Promise<OrphanedToolCallResult | null> {
    const history = await this.conversationManager.getHistoryRef(conversationId);

    if (history.length === 0) {
      return null;
    }

    const lastMessage = history[history.length - 1];

    // 检查最后一条消息是否是 model 且包含 functionCall
    if (lastMessage.role !== 'model') {
      return null;
    }

    const functionCalls = this.toolCallParserService.extractFunctionCalls(lastMessage) as FunctionCallInfo[];
    if (functionCalls.length === 0) {
      return null;
    }

    // 检查是否有文本内容（如果有文本，说明函数调用已经完成）
    const hasTextContent = lastMessage.parts.some(p => p.text && !p.thought);
    if (hasTextContent) {
      return null;
    }

    // 执行这些函数调用
    // 获取当前消息索引
    const orphanedHistory = await this.conversationManager.getHistoryRef(conversationId);
    const orphanedMessageIndex = orphanedHistory.length - 1;

    const { responseParts, toolResults } = await this.toolExecutionService.executeFunctionCallsWithResults(
      functionCalls,
      conversationId,
      orphanedMessageIndex
    );

    // 将函数响应添加到历史（作为 user 消息，标记为函数响应）
    await this.conversationManager.addContent(conversationId, {
      role: 'user',
      parts: responseParts,
      isFunctionResponse: true
    });

    return {
      functionCallContent: lastMessage,
      toolResults
    };
  }
}
