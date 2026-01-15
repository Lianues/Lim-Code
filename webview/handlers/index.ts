/**
 * 消息处理器统一导出
 */

import type { MessageHandler } from '../types';

import { registerConversationHandlers } from './ConversationHandlers';
import { registerConfigHandlers } from './ConfigHandlers';
import { registerSettingsHandlers } from './SettingsHandlers';
import { registerCheckpointHandlers } from './CheckpointHandlers';
import { registerToolHandlers } from './ToolHandlers';
import { registerMcpHandlers } from './McpHandlers';
import { registerDependencyHandlers } from './DependencyHandlers';
import { registerStoragePathHandlers } from './StoragePathHandlers';
import { registerContextHandlers } from './ContextHandlers';
import { registerFileHandlers } from './FileHandlers';
import { registerDiffHandlers } from './DiffHandlers';
import { registerChatHandlers } from './ChatHandlers';
import { registerSkillsHandlers } from './SkillsHandlers';

// 重新导出各个模块
export * from './ConversationHandlers';
export * from './ConfigHandlers';
export * from './SettingsHandlers';
export * from './CheckpointHandlers';
export * from './ToolHandlers';
export * from './McpHandlers';
export * from './DependencyHandlers';
export * from './StoragePathHandlers';
export * from './ContextHandlers';
export * from './FileHandlers';
export * from './DiffHandlers';
export * from './ChatHandlers';
export * from './SkillsHandlers';

/**
 * 创建并注册所有消息处理器
 */
export function createMessageHandlerRegistry(): Map<string, MessageHandler> {
  const registry = new Map<string, MessageHandler>();
  
  // 注册各个模块的处理器
  registerConversationHandlers(registry);
  registerConfigHandlers(registry);
  registerSettingsHandlers(registry);
  registerCheckpointHandlers(registry);
  registerToolHandlers(registry);
  registerMcpHandlers(registry);
  registerDependencyHandlers(registry);
  registerStoragePathHandlers(registry);
  registerContextHandlers(registry);
  registerFileHandlers(registry);
  registerDiffHandlers(registry);
  registerChatHandlers(registry);
  registerSkillsHandlers(registry);
  
  return registry;
}
