/**
 * 全局上下文
 *
 * 提供全局管理器的访问点，避免循环依赖
 *
 * 包含：
 * - SettingsManager: 全局设置管理器
 * - ConfigManager: 渠道配置管理器
 * - ChannelManager: 渠道调用管理器
 * - ToolRegistry: 工具注册器
 * - McpManager: MCP 管理器
 */

import type { SettingsManager } from '../modules/settings';
import type { ConfigManager } from '../modules/config';
import type { ChannelManager } from '../modules/channel';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type { DiffStorageManager } from '../modules/conversation/DiffStorageManager';
import type { McpManager } from '../modules/mcp';

/**
 * 全局上下文接口
 */
export interface GlobalContext {
    settingsManager: SettingsManager | null;
    configManager: ConfigManager | null;
    channelManager: ChannelManager | null;
    toolRegistry: ToolRegistry | null;
    diffStorageManager: DiffStorageManager | null;
    mcpManager: McpManager | null;
}

/**
 * 全局上下文存储
 */
const globalContext: GlobalContext = {
    settingsManager: null,
    configManager: null,
    channelManager: null,
    toolRegistry: null,
    diffStorageManager: null,
    mcpManager: null
};

// ========== 设置管理器 ==========

/**
 * 设置全局设置管理器引用
 */
export function setGlobalSettingsManager(manager: SettingsManager): void {
    globalContext.settingsManager = manager;
}

/**
 * 获取全局设置管理器
 */
export function getGlobalSettingsManager(): SettingsManager | null {
    return globalContext.settingsManager;
}

// ========== 配置管理器 ==========

/**
 * 设置全局配置管理器引用
 */
export function setGlobalConfigManager(manager: ConfigManager): void {
    globalContext.configManager = manager;
}

/**
 * 获取全局配置管理器
 */
export function getGlobalConfigManager(): ConfigManager | null {
    return globalContext.configManager;
}

// ========== 渠道管理器 ==========

/**
 * 设置全局渠道管理器引用
 */
export function setGlobalChannelManager(manager: ChannelManager): void {
    globalContext.channelManager = manager;
}

/**
 * 获取全局渠道管理器
 */
export function getGlobalChannelManager(): ChannelManager | null {
    return globalContext.channelManager;
}

// ========== 工具注册器 ==========

/**
 * 设置全局工具注册器引用
 */
export function setGlobalToolRegistry(registry: ToolRegistry): void {
    globalContext.toolRegistry = registry;
}

/**
 * 获取全局工具注册器
 */
export function getGlobalToolRegistry(): ToolRegistry | null {
    return globalContext.toolRegistry;
}

// ========== Diff 存储管理器 ==========

/**
 * 设置全局 Diff 存储管理器引用
 */
export function setGlobalDiffStorageManager(manager: DiffStorageManager): void {
    globalContext.diffStorageManager = manager;
}

/**
 * 获取全局 Diff 存储管理器
 */
export function getGlobalDiffStorageManager(): DiffStorageManager | null {
    return globalContext.diffStorageManager;
}

// ========== MCP 管理器 ==========

/**
 * 设置全局 MCP 管理器引用
 */
export function setGlobalMcpManager(manager: McpManager): void {
    globalContext.mcpManager = manager;
}

/**
 * 获取全局 MCP 管理器
 */
export function getGlobalMcpManager(): McpManager | null {
    return globalContext.mcpManager;
}

// ========== 便捷方法 ==========

/**
 * 获取完整的全局上下文
 */
export function getGlobalContext(): Readonly<GlobalContext> {
    return globalContext;
}

/**
 * 初始化全局上下文
 */
export function initGlobalContext(context: Partial<GlobalContext>): void {
    if (context.settingsManager) {
        globalContext.settingsManager = context.settingsManager;
    }
    if (context.configManager) {
        globalContext.configManager = context.configManager;
    }
    if (context.channelManager) {
        globalContext.channelManager = context.channelManager;
    }
    if (context.toolRegistry) {
        globalContext.toolRegistry = context.toolRegistry;
    }
    if (context.diffStorageManager) {
        globalContext.diffStorageManager = context.diffStorageManager;
    }
    if (context.mcpManager) {
        globalContext.mcpManager = context.mcpManager;
    }
}

/**
 * 清除全局上下文（用于测试）
 */
export function clearGlobalContext(): void {
    globalContext.settingsManager = null;
    globalContext.configManager = null;
    globalContext.channelManager = null;
    globalContext.toolRegistry = null;
    globalContext.diffStorageManager = null;
    globalContext.mcpManager = null;
}