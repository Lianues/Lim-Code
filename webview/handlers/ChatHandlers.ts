/**
 * 聊天功能消息处理器
 * 
 * 处理删除消息等非流式操作
 */

import { t } from '../../backend/i18n';
import type { HandlerContext, MessageHandler } from '../types';

/**
 * 删除消息（删除到指定位置）
 */
export const deleteMessage: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, targetIndex } = data;
  
  // 先取消该对话的流式请求（如果有）
  // streamAbortControllers 实际上是 StreamAbortManager，但类型定义为 Map
  const abortManager = ctx.streamAbortControllers as any;
  if (abortManager.cancel) {
    abortManager.cancel(conversationId);
  } else if (abortManager.get) {
    // 如果是纯 Map，手动取消
    const controller = abortManager.get(conversationId);
    if (controller) {
      controller.abort();
      abortManager.delete(conversationId);
    }
  }
  
  const result = await ctx.chatHandler.handleDeleteToMessage({
    conversationId,
    targetIndex
  });
  ctx.sendResponse(requestId, result);
};

/**
 * 删除单条消息
 */
export const deleteSingleMessage: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, targetIndex } = data;
  try {
    await ctx.conversationManager.deleteMessage(conversationId, targetIndex);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'DELETE_SINGLE_MESSAGE_ERROR', error.message || t('webview.errors.deleteMessageFailed'));
  }
};

/**
 * 注册聊天处理器
 */
export function registerChatHandlers(registry: Map<string, MessageHandler>): void {
  registry.set('deleteMessage', deleteMessage);
  registry.set('deleteSingleMessage', deleteSingleMessage);
}
