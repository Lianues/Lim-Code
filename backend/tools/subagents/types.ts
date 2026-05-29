/**
 * SubAgents 工具类型定义
 *
 * 定义子代理的类型和接口
 */

import type { Tool, ToolDeclaration } from '../types';
import type { ResolvedPromptModeSnapshot } from '../../modules/settings/types';

/**
 * 子代理类型
 * 
 * 可以通过 subAgentRegistry.register() 动态添加更多类型
 */
export type SubAgentType = string;

/**
 * Provider 自动重试耗尽后的 SubAgent 处理策略。
 *
 * 修改原因：SubAgent 复用 ChannelManager 自动重试后，仍需要决定重试耗尽时主工具是否立即失败。
 * 修改方式：在 SubAgent 运行时类型中声明同一组稳定枚举值，与 SettingsManager 的持久化字段保持一致。
 * 修改目的：让 executor、registry 和 Monitor 控制器共享同一语义，避免字符串特判散落。
 */
export type SubAgentFailureModeAfterRetries = 'fail_parent_tool' | 'wait_for_monitor_action';

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

    /**
     * 主对话可接收的 SubAgent 摘要最大字符数。
     *
     * 修改原因：SubAgent 完整输出不能直接进入主对话上下文，否则会绕过主上下文压缩预算。
     * 修改方式：在配置类型中加入 output cap，由 resultSerializer 单点执行。
     * 修改目的：让每个 SubAgent 可以有独立输出预算，完整 transcript 仍留在 Monitor。
     */
    maxOutputChars?: number;

    /** 输入 prompt + context 的最大字符预算，作为 P1 token budget 的本地近似防线。 */
    maxInputChars?: number;

    /** 显式递归深度上限；当前默认 1，并保留 excludeToolNames 作为防御层。 */
    maxDepth?: number;

    /**
     * Provider 自动重试耗尽后的处理策略。
     *
     * 修改原因：单个 SubAgent 需要能覆盖全局默认策略，决定失败后是否等待 Monitor 操作。
     * 修改方式：字段保持可选，运行时由 settings 全局默认值补齐。
     * 修改目的：兼容旧配置，并为后续暂停/等待状态机提供明确策略输入。
     */
    failureModeAfterRetries?: SubAgentFailureModeAfterRetries;
    
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

    /**
     * 外部预分配的 SubAgent 运行实例 ID。
     *
     * 修改原因：主窗口工具卡片在 pending 阶段还没有 ToolResult，但需要立即显示并打开 Open details。
     * 修改方式：subagents handler 根据主工具调用 id 预先生成 runId，再交给默认 executor 使用。
     * 修改目的：pending、完成态和历史态都用同一个 runId 打开同一次 Monitor 运行。
     */
    runId?: string;
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

    /**
     * SubAgent 运行实例 ID。
     *
     * 修改原因：主聊天工具块和 SubAgent Monitor 需要用同一个稳定 ID 定位运行过程。
     * 修改方式：由默认执行器创建 runId，并随最终结果返回。
     * 修改目的：不把内部事件写入主历史，也能从主卡片打开对应的运行详情。
     */
    runId?: string;
    
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

    /**
     * 配置管理器。
     *
     * 修改原因：SubAgent 的 provider 配置独立于主会话，但工具执行仍需要读取该 provider 的多模态和 toolMode 能力。
     * 修改方式：把 ConfigManager 注入执行上下文，由 SubAgent 在每次 run 中解析自己的 channel 配置。
     * 修改目的：避免 SubAgent 工具执行时因拿不到渠道配置而退化为 multimodalEnabled=false。
     */
    configManager?: any; // ConfigManager 类型

    /**
     * 共享工具执行服务。
     *
     * 修改原因：SubAgent 不能再复制 ToolExecutionService 的工具参数校验、MCP、多模态打包和工具配置注入逻辑。
     * 修改方式：通过上下文注入 ChatHandler 持有的 ToolExecutionService 实例；执行时仍传入 SubAgent 自己的 provider 配置。
     * 修改目的：共享工具执行内核，但保持 SubAgent 模型能力、toolMode 和多模态开关独立于主会话。
     */
    toolExecutionService?: any; // ToolExecutionService 类型

    /** 对话 ID，用于把 SubAgent 内部记录保存到 conversation 子记录 */
    conversationId?: string;

    /** 对话元数据存储，用于保存 subAgentRuns 子记录 */
    conversationStore?: {
        getCustomMetadata(conversationId: string, key: string): Promise<unknown>;
        setCustomMetadata(conversationId: string, key: string, value: unknown): Promise<void>;
    };

    /** 父请求继承下来的提示词模式快照（可选） */
    promptModeSnapshot?: ResolvedPromptModeSnapshot;
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
