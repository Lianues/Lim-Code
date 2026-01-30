/**
 * SubAgents 工具
 *
 * 允许 AI 调用子代理来处理特定任务
 * 支持动态更新工具定义（根据注册的子代理）
 */

import type { Tool, ToolResult, ToolContext, ToolDeclaration } from '../types';
import type { SubAgentRequest, SubAgentResult, SubAgentConfig } from './types';
import { subAgentRegistry } from './registry';
import { getGlobalToolRegistry, getGlobalMcpManager, getGlobalSettingsManager } from '../../core/settingsContext';

/**
 * 获取可用的子代理名称列表
 */
function getAvailableAgentNames(): string[] {
    return subAgentRegistry.getNames();
}

/**
 * 获取子代理可用的工具列表
 */
function getAgentAvailableTools(config: SubAgentConfig): string[] {
    const toolRegistry = getGlobalToolRegistry();
    const mcpManager = getGlobalMcpManager();
    
    let builtinToolNames: string[] = [];
    const mcpToolNames: string[] = [];
    
    // 获取内置工具名称
    // 使用 getToolNames() 而不是 getAllTools() 以避免触发 subagents 工具的 getter 导致无限递归
    if (toolRegistry) {
        builtinToolNames = toolRegistry.getToolNames().filter(name => name !== 'subagents');
    }
    
    // 获取 MCP 工具名称
    if (mcpManager) {
        const mcpTools = mcpManager.getAllTools();
        for (const serverTools of mcpTools) {
            for (const tool of serverTools.tools || []) {
                mcpToolNames.push(`mcp__${serverTools.serverId}__${tool.name}`);
            }
        }
    }
    
    const toolsConfig = config.tools;
    let availableTools: string[] = [];
    
    switch (toolsConfig.mode) {
        case 'all':
            availableTools = [...builtinToolNames, ...mcpToolNames];
            break;
        case 'builtin':
            availableTools = builtinToolNames;
            break;
        case 'mcp':
            availableTools = mcpToolNames;
            break;
        case 'whitelist':
            const whitelist = new Set(toolsConfig.whitelist || toolsConfig.list || []);
            availableTools = [...builtinToolNames, ...mcpToolNames].filter(t => whitelist.has(t));
            break;
        case 'blacklist':
            const blacklist = new Set(toolsConfig.blacklist || toolsConfig.list || []);
            availableTools = [...builtinToolNames, ...mcpToolNames].filter(t => !blacklist.has(t));
            break;
    }
    
    return availableTools;
}

/**
 * 格式化工具列表为简洁的字符串
 */
function formatToolsList(tools: string[], maxDisplay: number = 10): string {
    if (tools.length === 0) {
        return 'None';
    }
    
    if (tools.length <= maxDisplay) {
        return tools.join(', ');
    }
    
    const displayTools = tools.slice(0, maxDisplay);
    return `${displayTools.join(', ')} ... and ${tools.length - maxDisplay} more`;
}

/**
 * 获取子代理配置
 */
function getSubAgentsSettings() {
    const settingsManager = getGlobalSettingsManager();
    if (settingsManager) {
        return settingsManager.getSubAgentsConfig();
    }
    return { agents: [], maxConcurrentAgents: 3 };
}

/**
 * 格式化限制数值（-1 表示无限制）
 */
function formatLimit(value: number | undefined, defaultValue: number): string {
    const v = value ?? defaultValue;
    return v === -1 ? 'unlimited' : String(v);
}

/**
 * 生成 agentName 参数的描述（包含各子代理的描述、可用工具和限制）
 */
function generateAgentNameDescription(): string {
    const configs = subAgentRegistry.getAllConfigs();
    
    if (configs.length === 0) {
        return 'The name of sub-agent to invoke. Currently no sub-agents available.';
    }
    
    const agentDescriptions = configs
        .map(config => {
            const tools = getAgentAvailableTools(config);
            const toolsStr = formatToolsList(tools, 8);
            const maxIterStr = formatLimit(config.maxIterations, 20);
            const maxRuntimeStr = formatLimit(config.maxRuntime, 300);
            return `  - "${config.name}": ${config.description || 'No description'}\n    Tools (${tools.length}): ${toolsStr}\n    Limits: max ${maxIterStr} iterations, max ${maxRuntimeStr}s runtime`;
        })
        .join('\n');
    
    return `The name of sub-agent to invoke. Available options:\n${agentDescriptions}`;
}

/**
 * 生成工具的主描述
 */
function generateToolDescription(): string {
    const configs = subAgentRegistry.getAllConfigs();
    const settings = getSubAgentsSettings();
    const maxConcurrent = settings.maxConcurrentAgents ?? 3;
    const maxConcurrentStr = formatLimit(maxConcurrent, 3);
    
    if (configs.length === 0) {
        return `Invoke a specialized sub-agent to handle a specific task.

**Note:** No sub-agents are currently configured. Please configure sub-agents in settings first.`;
    }
    
    const limitsSection = maxConcurrent === -1
        ? '- Each sub-agent has its own max iterations limit (see agent descriptions)'
        : `- Maximum ${maxConcurrentStr} sub-agent(s) can be invoked in a single response\n- Each sub-agent has its own max iterations limit (see agent descriptions)`;
    
    return `Invoke a specialized sub-agent to handle a specific task. The sub-agent has its own tools and can perform complex operations autonomously.

**Limits:**
${limitsSection}

**Usage Notes:**
- Choose the appropriate agent based on the task
- Provide a clear and detailed prompt for the sub-agent
- The sub-agent will execute the task and return the result
- Sub-agents have their own tool access and can make multiple tool calls
- Use sub-agents for complex, multi-step tasks that require focused attention`;
}

/**
 * 动态获取工具声明
 * 
 * 每次调用时根据当前注册的子代理生成最新的工具定义
 */
export function getSubAgentsToolDeclaration(): ToolDeclaration {
    const agentNames = getAvailableAgentNames();
    
    return {
        name: 'subagents',
        category: 'agents',
        description: generateToolDescription(),
        parameters: {
            type: 'object',
            properties: {
                agentName: {
                    type: 'string',
                    description: generateAgentNameDescription(),
                    ...(agentNames.length > 0 ? { enum: agentNames } : {})
                },
                prompt: {
                    type: 'string',
                    description: 'The task prompt/instruction for the sub-agent. Be specific and detailed about what you want the sub-agent to accomplish.'
                },
                context: {
                    type: 'string',
                    description: 'Optional additional context or background information for the sub-agent. Include relevant file paths, code snippets, or requirements.'
                }
            },
            required: ['agentName', 'prompt']
        }
    };
}

/**
 * 工具处理器
 */
async function subAgentsHandler(args: Record<string, any>, context?: ToolContext): Promise<ToolResult> {
    const agentName = args.agentName as string;
    const prompt = args.prompt as string;
    const additionalContext = args.context as string | undefined;
    
    // 验证参数
    if (!agentName) {
        return {
            success: false,
            error: 'agentName is required'
        };
    }
    
    if (!prompt) {
        return {
            success: false,
            error: 'prompt is required'
        };
    }
    
    // 根据名称查找子代理
    const agentEntry = subAgentRegistry.getByName(agentName);
    if (!agentEntry) {
        const availableNames = getAvailableAgentNames();
        return {
            success: false,
            error: `SubAgent "${agentName}" not found. Available agents: ${availableNames.length > 0 ? availableNames.join(', ') : 'none'}`
        };
    }
    
    // 检查是否有执行器
    if (!agentEntry.executor) {
        return {
            success: false,
            error: `SubAgent "${agentName}" has no executor. Please ensure the executor context is initialized.`
        };
    }
    
    // 检查是否已取消
    const abortSignal = context?.abortSignal;
    if (abortSignal?.aborted) {
        return {
            success: false,
            error: 'User cancelled the sub-agent execution. Please wait for user\'s next instruction.',
            cancelled: true
        };
    }
    
    try {
        // 构建请求
        const request: SubAgentRequest = {
            agentType: agentEntry.config.type,
            prompt,
            context: additionalContext
        };
        
        // 执行子代理
        const result: SubAgentResult = await agentEntry.executor(
            request,
            abortSignal
        );
        
        // 检查执行过程中是否被取消
        if (result.cancelled || abortSignal?.aborted) {
            return {
                success: false,
                error: 'User cancelled the sub-agent execution. Please wait for user\'s next instruction.',
                cancelled: true
            };
        }
        
        if (result.success) {
            return {
                success: true,
                data: {
                    agentName,
                    response: result.response,
                    // 子代理实际运行信息（用于 UI 展示）
                    channelId: agentEntry.config.channel.channelId,
                    modelId: agentEntry.config.channel.modelId,
                    modelVersion: result.modelVersion,
                    steps: result.steps,
                    toolCalls: result.toolCalls || []
                }
            };
        } else {
            return {
                success: false,
                error: result.error || 'SubAgent execution failed',
                data: {
                    agentName,
                    partialResponse: result.response,
                    // 子代理实际运行信息（用于 UI 展示）
                    channelId: agentEntry.config.channel.channelId,
                    modelId: agentEntry.config.channel.modelId,
                    modelVersion: result.modelVersion,
                    steps: result.steps,
                    toolCalls: result.toolCalls || []
                }
            };
        }
    } catch (error) {
        return {
            success: false,
            error: `SubAgent execution error: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * 缓存的工具实例
 * 
 * 使用 getter 实现动态声明，每次访问 declaration 时重新生成
 */
let cachedTool: Tool | null = null;

/**
 * 创建动态 SubAgents 工具
 * 
 * 使用 getter 代理，确保每次获取 declaration 时都是最新的
 */
export function createSubAgentsTool(): Tool {
    // 创建一个代理对象，动态获取 declaration
    const tool: Tool = {
        get declaration() {
            return getSubAgentsToolDeclaration();
        },
        handler: subAgentsHandler
    };
    
    return tool;
}

/**
 * 获取 SubAgents 工具（单例）
 * 
 * 返回的工具对象的 declaration 会动态更新
 */
export function getSubAgentsTool(): Tool {
    if (!cachedTool) {
        cachedTool = createSubAgentsTool();
    }
    return cachedTool;
}

/**
 * 强制刷新工具定义
 * 
 * 当子代理配置发生变化时调用，确保下次获取工具定义时是最新的
 * 注意：由于使用了 getter，实际上不需要手动刷新，但保留此方法以备将来使用
 */
export function refreshSubAgentsTool(): void {
    // 使用 getter 后，每次访问 declaration 都会重新生成
    // 这里不需要做任何事情，但保留接口以保持向后兼容
    console.log('[SubAgents] Tool declaration will be refreshed on next access');
}

/**
 * 注册 SubAgents 工具
 * 
 * @deprecated 使用 getSubAgentsTool() 代替
 */
export function registerSubAgents(): Tool {
    return getSubAgentsTool();
}
