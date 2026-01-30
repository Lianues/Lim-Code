/**
 * SubAgents 工具类型定义
 *
 * 定义子代理的类型和接口
 */

import type { Tool, ToolDeclaration } from '../types';

/**
 * 子代理类型
 * 
 * 可以通过 subAgentRegistry.register() 动态添加更多类型
 */
export type SubAgentType = string;

/**
 * 子代理渠道配置
 * 
 * 指定子代理使用的 AI 渠道和模型
 */
export interface SubAgentChannelConfig {
    /** 渠道 ID（对应 ConfigManager 中的配置 ID） */
    channelId: string;
    
    /** 模型 ID（可选，使用渠道默认模型） */
    modelId?: string;
}

/**
 * 子代理工具配置
 * 
 * 控制子代理可使用的工具
 */
export interface SubAgentToolsConfig {
    /**
     * 工具过滤模式
     * - 'all': 使用所有已注册的工具（内置 + MCP）
     * - 'builtin': 仅使用内置工具
     * - 'mcp': 仅使用 MCP 工具
     * - 'whitelist': 仅使用白名单中的工具
     * - 'blacklist': 排除黑名单中的工具
     */
    mode: 'all' | 'builtin' | 'mcp' | 'whitelist' | 'blacklist';
    
    /** 工具列表（白名单/黑名单模式下使用，兼容旧版配置） */
    list?: string[];
    
    /** 工具白名单（mode 为 'whitelist' 时使用） */
    whitelist?: string[];
    
    /** 工具黑名单（mode 为 'blacklist' 时使用） */
    blacklist?: string[];
    
    /** 是否包含 MCP 工具（mode 为 'builtin' 时忽略） */
    includeMcp?: boolean;
}

/**
 * 子代理配置
 */
export interface SubAgentConfig {
    /** 代理类型（唯一标识符） */
    type: SubAgentType;
    
    /** 代理名称（显示名称） */
    name: string;
    
    /** 代理描述（供主 AI 理解何时使用） */
    description: string;
    
    /** 代理系统提示词 */
    systemPrompt: string;
    
    /** 渠道配置（使用哪个 AI 渠道和模型） */
    channel: SubAgentChannelConfig;
    
    /** 工具配置（使用哪些工具） */
    tools: SubAgentToolsConfig;
    
    /** 最大迭代次数（防止无限循环，默认 20，-1 表示无限制） */
    maxIterations?: number;
    
    /** 最大运行时间（秒，默认 300，-1 表示无限制） */
    maxRuntime?: number;
    
    /** 是否启用（禁用的代理不会出现在工具列表中） */
    enabled?: boolean;
}

/**
 * 子代理执行请求
 */
export interface SubAgentRequest {
    /** 代理类型 */
    agentType: SubAgentType;
    
    /** 用户提示词 */
    prompt: string;
    
    /** 附加上下文（可选） */
    context?: string;
}

/**
 * 工具调用记录
 */
export interface SubAgentToolCall {
    /** 工具名称 */
    tool: string;
    
    /** 工具参数 */
    args: Record<string, unknown>;
    
    /** 执行结果 */
    result: unknown;
    
    /** 是否成功 */
    success: boolean;
    
    /** 执行时间（毫秒） */
    duration?: number;
}

/**
 * 子代理执行结果
 */
export interface SubAgentResult {
    /** 是否成功 */
    success: boolean;
    
    /** 代理响应内容 */
    response?: string;

    /**
     * 实际模型版本（优先使用渠道返回的 modelVersion）
     *
     * 用于在 UI 中展示“子代理实际运行的模型”
     */
    modelVersion?: string;
    
    /** 执行步骤数 */
    steps?: number;
    
    /** 使用的工具调用记录 */
    toolCalls?: SubAgentToolCall[];
    
    /** 错误信息 */
    error?: string;
    
    /** 是否被取消 */
    cancelled?: boolean;
}

/**
 * 子代理执行上下文
 * 
 * 提供执行器所需的依赖
 */
export interface SubAgentExecutorContext {
    /** 渠道管理器（用于调用 AI） */
    channelManager: any; // ChannelManager 类型
    
    /** 工具注册器（用于获取内置工具） */
    toolRegistry: any; // ToolRegistry 类型
    
    /** MCP 管理器（用于获取 MCP 工具） */
    mcpManager?: any; // McpManager 类型
    
    /** 设置管理器 */
    settingsManager?: any; // SettingsManager 类型
}

/**
 * 子代理注册表项
 */
export interface SubAgentRegistryEntry {
    /** 代理配置 */
    config: SubAgentConfig;
    
    /** 代理执行器（可选，使用默认执行器） */
    executor?: SubAgentExecutor;
}

/**
 * 子代理执行器函数类型
 */
export type SubAgentExecutor = (
    request: SubAgentRequest,
    abortSignal?: AbortSignal
) => Promise<SubAgentResult>;

/**
 * 子代理执行器工厂函数类型
 * 
 * 用于创建带上下文的执行器
 */
export type SubAgentExecutorFactory = (
    config: SubAgentConfig,
    context: SubAgentExecutorContext
) => SubAgentExecutor;
