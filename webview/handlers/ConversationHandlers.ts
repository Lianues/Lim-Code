/**
 * 对话管理消息处理器
 */

import { t } from '../../backend/i18n';
import type { HandlerContext, MessageHandler } from '../types';

/**
 * 创建对话
 */
export const createConversation: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, title, workspaceUri } = data;
  const wsUri = workspaceUri || ctx.getCurrentWorkspaceUri();
  await ctx.conversationManager.createConversation(conversationId, title, wsUri);
  ctx.sendResponse(requestId, { success: true });
};

/**
 * 列出所有对话
 */
export const listConversations: MessageHandler = async (data, requestId, ctx) => {
  const ids = await ctx.conversationManager.listConversations();
  ctx.sendResponse(requestId, ids);
};

/**
 * 获取对话元数据
 */
export const getConversationMetadata: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId } = data;
  const metadata = await ctx.conversationManager.getMetadata(conversationId);
  ctx.sendResponse(requestId, metadata);
};

/**
 * 设置对话标题
 */
export const setTitle: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, title } = data;
  await ctx.conversationManager.setTitle(conversationId, title);
  ctx.sendResponse(requestId, { success: true });
};

export const setWorkspaceUri: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, workspaceUri } = data;
  await ctx.conversationManager.setWorkspaceUri(conversationId, workspaceUri);
  ctx.sendResponse(requestId, { success: true });
};

/**
 * 设置自定义元数据
 */
export const setCustomMetadata: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, key, value } = data;
  await ctx.conversationManager.setCustomMetadata(conversationId, key, value);
  ctx.sendResponse(requestId, { success: true });
};

/**
 * 删除对话
 */
export const deleteConversation: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId } = data;
  // 先删除该对话的所有检查点（包括备份目录）
  await ctx.checkpointManager.deleteAllCheckpoints(conversationId);
  // 再删除对话本身
  await ctx.conversationManager.deleteConversation(conversationId);
  ctx.sendResponse(requestId, { success: true });
};

/**
 * 获取对话消息
 */
export const getMessages: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId } = data;
  const messages = await ctx.conversationManager.getMessages(conversationId);
  ctx.sendResponse(requestId, messages);
};

/**
 * 分页获取对话消息
 */
export const getMessagesPaged: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, beforeIndex, offset, limit } = data || {};
  const result = await ctx.conversationManager.getMessagesPaged(conversationId, { beforeIndex, offset, limit });
  ctx.sendResponse(requestId, result);
};

/**
 * 获取对话视图所需数据
 *
 * 用于切换对话时一次性加载 metadata、最后一页消息和 checkpoints，减少重复 IPC。
 */
export const loadConversationForView: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, beforeIndex, offset, limit } = data || {};
  const [metadata, result] = await Promise.all([
    ctx.conversationManager.getMetadata(conversationId),
    ctx.conversationManager.getMessagesPaged(conversationId, { beforeIndex, offset, limit })
  ]);

  const custom = (metadata?.custom || {}) as Record<string, unknown>;
  ctx.sendResponse(requestId, {
    metadata,
    totalMessages: result.total,
    messages: result.messages,
    checkpoints: Array.isArray(custom.checkpoints) ? custom.checkpoints : [],
    modelConfig: custom.inputModelConfig,
    promptMode: custom.promptModeConfig,
    activeBuild: custom.activeBuild ?? null
  });
};

/**
 * 拒绝工具调用
 */
export const rejectToolCalls: MessageHandler = async (data, requestId, ctx) => {
  const { conversationId, messageIndex, toolCallIds } = data;
  try {
    await ctx.conversationManager.rejectToolCalls(conversationId, messageIndex, toolCallIds);
    ctx.sendResponse(requestId, { success: true });
  } catch (error: any) {
    ctx.sendError(requestId, 'REJECT_TOOL_CALLS_ERROR', error.message || t('webview.errors.rejectToolCallsFailed'));
  }
};

/**
 * 注册对话管理处理器
 */
export function registerConversationHandlers(registry: Map<string, MessageHandler>): void {
  registry.set('conversation.createConversation', createConversation);
  registry.set('conversation.listConversations', listConversations);
  registry.set('conversation.getConversationMetadata', getConversationMetadata);
  registry.set('conversation.setTitle', setTitle);
  registry.set('conversation.setWorkspaceUri', setWorkspaceUri);
  registry.set('conversation.setCustomMetadata', setCustomMetadata);
  registry.set('conversation.deleteConversation', deleteConversation);
  registry.set('conversation.getMessages', getMessages);
  registry.set('conversation.getMessagesPaged', getMessagesPaged);
  registry.set('conversation.loadConversationForView', loadConversationForView);
  registry.set('conversation.rejectToolCalls', rejectToolCalls);
}
