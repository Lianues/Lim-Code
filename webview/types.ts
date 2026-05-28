/**
 * ChatViewProvider 类型定义
 */

import type * as vscode from 'vscode';
import type { ConversationManager } from '../backend/modules/conversation';
import type { ConfigManager } from '../backend/modules/config';
import type { ChannelManager } from '../backend/modules/channel';
import type { ChatHandler } from '../backend/modules/api/chat';
import type { ModelsHandler } from '../backend/modules/api/models';
import type { SettingsManager, StoragePathManager } from '../backend/modules/settings';
import type { SettingsHandler } from '../backend/modules/api/settings';
import type { CheckpointManager } from '../backend/modules/checkpoint';
import type { McpManager } from '../backend/modules/mcp';
import type { DependencyManager } from '../backend/modules/dependencies';
import type { DiffStorageManager } from '../backend/modules/conversation';
import type { ToolRegistry } from '../backend/tools';
import type { WindowsAgentStopNotificationService } from '../backend/modules/notifications/WindowsAgentStopNotificationService';
import type { WebviewClientId } from './runtime/WebviewClientRegistry';

/**
 * 消息处理器上下文
 * 提供处理器所需的所有依赖
 */
export interface HandlerContext {
  // VSCode 上下文
  context?: vscode.ExtensionContext;
  view?: vscode.WebviewView | undefined;
  /**
   * 当前请求来源 webview client。
   *
   * 修改原因：MessageRouter 现在按 clientId + requestId 将响应送回发起方，handler 不应自己判断目标 webview。
   * 修改方式：路由层在 HandlerContext 上附加 clientId，只作为上下文元数据向后兼容。
   * 修改目的：保留旧 handler 签名和消息 shape，同时让必要的底层发送函数可以数据驱动路由。
   */
  clientId?: WebviewClientId;
  
  // 后端模块
  configManager: ConfigManager;
  channelManager: ChannelManager;
  conversationManager: ConversationManager;
  chatHandler?: ChatHandler;
  modelsHandler?: ModelsHandler;
  settingsManager: SettingsManager;
  settingsHandler: SettingsHandler;
  checkpointManager?: CheckpointManager;
  mcpManager: McpManager;
  dependencyManager: DependencyManager;
  storagePathManager: StoragePathManager;
  diffStorageManager: DiffStorageManager;
  toolRegistry?: ToolRegistry;
  windowsAgentStopNotificationService?: WindowsAgentStopNotificationService;
  
  // 流式请求控制
  streamAbortControllers: Map<string, AbortController>;
  
  // Diff 预览提供者
  diffPreviewProvider: DiffPreviewContentProvider;
  
  // 响应函数
  sendResponse: (requestId: string, data: any) => void;
  sendError: (requestId: string, code: string, message: string) => void;
  postMessage?: (message: any) => void;
  /**
   * 打开 SubAgent Monitor 编辑器页。
   *
   * 修改原因：主聊天工具卡片只显示摘要，完整内部过程需要在编辑器区域展示。
   * 修改方式：通过 HandlerContext 暴露打开 Monitor 的能力，消息处理器不直接依赖 ChatViewProvider 实现。
   * 修改目的：保持 handler 解耦，同时让前端按钮能定位到指定 runId。
   */
  openSubAgentMonitor?: (runId?: string, conversationId?: string) => Promise<void> | void;
  
  // 工具函数
  getCurrentWorkspaceUri?: () => string | null;
  syncLanguageToBackend?: () => void;
}

/**
 * Diff 预览内容提供者接口
 */
export interface DiffPreviewContentProvider {
  setContent(uri: string, content: string): void;
  provideTextDocumentContent(uri: vscode.Uri): string;
  dispose(): void;
}

/**
 * 消息处理器类型
 */
export type MessageHandler = (
  data: any,
  requestId: string,
  ctx: HandlerContext
) => Promise<void>;

/**
 * 消息处理器注册表
 */
export type MessageHandlerRegistry = Map<string, MessageHandler>;

/**
 * 终端输出事件
 */
export interface TerminalOutputEvent {
  terminalId: string;
  type: 'stdout' | 'stderr' | 'exit';
  data?: string;
  exitCode?: number;
}

/**
 * 图像生成输出事件
 */
export interface ImageGenOutputEvent {
  toolId: string;
  type: 'progress' | 'complete' | 'error';
  progress?: number;
  data?: string;
  error?: string;
}

/**
 * 任务事件
 */
export interface TaskEvent {
  taskId: string;
  type: string;
  [key: string]: any;
}

/**
 * 重试状态
 */
export interface RetryStatus {
  type: 'retrying' | 'retrySuccess' | 'retryFailed';
  attempt: number;
  maxAttempts: number;
  error?: string;
  nextRetryIn?: number;
}
