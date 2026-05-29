/**
 * SubAgents 工具
 *
 * 允许 AI 调用子代理来处理特定任务
 * 支持动态更新工具定义（根据注册的子代理）
 */

import type { Tool, ToolResult, ToolContext, ToolDeclaration } from '../types';
import type { SubAgentRequest, SubAgentResult, SubAgentConfig } from './types';
import { subAgentRegistry } from './registry';
import { createDefaultExecutor, getSubAgentExecutorContext } from './executor';
import { serializeSubAgentResult } from './resultSerializer';
import { SubAgentBudgetGovernor, SubAgentDepthGuard, resolveSubAgentGovernancePolicy, subAgentConcurrencyGuard } from './governance';
import { getGlobalToolRegistry, getGlobalMcpManager, getGlobalSettingsManager, getGlobalConfigManager } from '../../core/settingsContext';
// WP12：统一使用 codec 编码 MCP 工具名，禁止手拼 mcp__ 字符串
import { encodeMcpToolName } from '../../modules/mcp/mcpToolNameCodec';

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
                mcpToolNames.push(encodeMcpToolName(serverTools.serverId, tool.name));
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
        return '要调用的 SubAgent 名称。当前没有可用的 SubAgent，请先在设置中配置。';
    }
    
    // 修改原因：用户要求提示词使用中文，且主 Agent 需要在选择 SubAgent 时直接看到工具、限制和上下文隔离信息。
    // 修改方式：保留 agentName 枚举值不变，只把面向模型的说明文案改为中文，并把工具/限制标签本地化。
    // 修改目的：减少主 Agent 因英文简略提示而忽略 SubAgent 无状态和工具能力边界的概率，同时不改变工具 schema。
    const agentDescriptions = configs
        .map(config => {
            const tools = getAgentAvailableTools(config);
            const toolsStr = formatToolsList(tools, 8);
            const maxIterStr = formatLimit(config.maxIterations, 20);
            const maxRuntimeStr = formatLimit(config.maxRuntime, 300);
            const maxIterText = maxIterStr === 'unlimited' ? '迭代次数不限制' : `最多 ${maxIterStr} 次迭代`;
            const maxRuntimeText = maxRuntimeStr === 'unlimited' ? '运行时间不限制' : `最长 ${maxRuntimeStr} 秒`;
            return `  - "${config.name}": ${config.description || '无描述'}\n    可用工具（${tools.length}）：${toolsStr}\n    限制：${maxIterText}，${maxRuntimeText}`;
        })
        .join('\n');
    
    return `要调用的 SubAgent 名称。可用选项：\n${agentDescriptions}`;
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
        return `调用一个专门的 SubAgent 处理特定任务。

**注意：** 当前没有配置任何 SubAgent。请先在设置中配置 SubAgent。`;
    }
    
    const limitsSection = maxConcurrent === -1
        ? '- 每个 SubAgent 仍受自身迭代次数和运行时间限制约束，具体见 agentName 描述。'
        : `- 单次回复最多可并行调用 ${maxConcurrentStr} 个 SubAgent。\n- 每个 SubAgent 仍受自身迭代次数和运行时间限制约束，具体见 agentName 描述。`;
    
    // 修改原因：旧工具描述只说“给出清晰详细 prompt”，没有把 Skill resources、中央数据库和 SubAgent 无状态这些高风险约束放到模型必看的工具说明中。
    // 修改方式：在工具 description 顶层直接写中文派单门禁；保留字段名和执行逻辑不变，只增强模型可见的使用规则。
    // 修改目的：让主 Agent 在调用 subagents 前先外化共享上下文，避免二轮复核、审批和 Skill 驱动任务退化成压缩摘要。
    return `调用一个专门的 SubAgent 处理特定任务。SubAgent 有自己的工具访问权限，可以自主执行多步操作。

**限制：**
${limitsSection}

**必须理解的上下文规则：**
- SubAgent 是无状态、独立上下文的执行单元；它不会继承主 Agent 的聊天记录、已读 Skill、其他 SubAgent 输出或主 Agent 的隐含计划。
- 简单一次性任务可以直接在 prompt/context 中写完整目标、背景、约束、范围、输出格式和成功标准。
- 多轮复核、审批、阻断项收敛、对抗审查、多个 SubAgent 协作或任何需要共享状态的任务，必须先建立或引用中央数据库/共享信息库，例如 docs/pm/<task>/，并在 prompt 中列出 SubAgent 必须读取的具体文件。
- 如果任务依赖 Skill，主 Agent 必须把已读取的必要 Skill 规则和资源摘要写进 prompt/context，或明确要求 SubAgent 自己调用 read_skill，并在 read_skill 返回 resources manifest 后按需调用 read_skill_resource 读取 textReadable=true 的相关资源；不要无条件读取所有资源，也不要假设 SubAgent 会知道主 Agent 已读过的 Skill。
- 复核类派单必须包含被复核对象、上一轮完整问题清单、每个问题的修订摘要、证据路径、通过/阻断标准和输出格式；缺少这些内容时不要调用 SubAgent。

**使用建议：**
- 根据任务选择合适的 SubAgent，并说明切分维度。
- 明确 SubAgent 应读取哪些文件、允许修改哪些文件、需要运行哪些验证。
- 对互相独立的多个 SubAgent 调用，应在同一轮回复中并行发出。`;
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
                    // 修改原因：prompt 参数是主 Agent 真正传给 SubAgent 的任务文本，旧描述没有强制自包含上下文和复核门禁。
                    // 修改方式：参数描述改为中文，并明确多轮/复核/Skill 任务必须写入中央数据库路径、报告路径和资源读取要求。
                    // 修改目的：在工具 schema 层提醒模型不要使用“如上”“继续上一轮”等相对指代派单。
                    description: '给 SubAgent 的任务指令。必须自包含：写清目标、背景、输入范围、输出产物、证据要求和完成标准。多轮复核/审批/阻断项收敛任务必须包含中央数据库或共享信息库路径、上一轮报告、修订摘要、验收标准和输出格式；依赖 Skill 时必须说明已读取的 Skill 要点，或要求 SubAgent 自行调用 read_skill 并按需调用 read_skill_resource。'
                },
                context: {
                    type: 'string',
                    // 修改原因：context 参数常被主 Agent 当作“补充摘要”，但 SubAgent 无法读取主会话隐含上下文。
                    // 修改方式：把参数描述改为中文，要求这里承载可复用背景、文件路径、代码片段、中央数据库路径和读取顺序。
                    // 修改目的：让 context 成为显式外部输入清单，而不是模糊的上一轮记忆引用。
                    description: '可选的补充上下文。用于放置背景信息、相关文件路径、代码片段、约束、中央数据库/共享信息库路径，以及 SubAgent 开始前必须读取的文件列表。不要写“如上”或依赖主 Agent 聊天记录。'
                }
            },
            required: ['agentName', 'prompt']
        }
    };
}

/**
 * 工具处理器
 */
function normalizeToolIdForRunId(toolId: string): string {
    // 修改原因：pending 阶段前端需要根据同一个 toolId 推导出后端即将创建的 SubAgent runId。
    // 修改方式：与前端 subagents action 使用相同规则，只保留字母、数字、下划线和连字符。
    // 修改目的：让 Open details 在工具执行中也能直接聚焦当前 SubAgent 运行，而不是只能打开最新运行。
    return toolId.trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

function getPreallocatedRunId(context?: ToolContext): string | undefined {
    const toolId = typeof context?.toolId === 'string' ? normalizeToolIdForRunId(context.toolId) : '';
    return toolId ? `subagent_run_${toolId}` : undefined;
}

async function subAgentsHandler(args: Record<string, any>, context?: ToolContext): Promise<ToolResult> {
    const agentName = args.agentName as string;
    const prompt = args.prompt as string;
    const additionalContext = args.context as string | undefined;
    const runId = getPreallocatedRunId(context);
    
    if (!agentName || !prompt) {
        return { success: false, error: `${!agentName ? 'agentName' : 'prompt'} is required` };
    }
    
    const agentEntry = subAgentRegistry.getByName(agentName);
    if (!agentEntry) {
        const availableNames = getAvailableAgentNames();
        return { success: false, error: `SubAgent "${agentName}" not found. Available agents: ${availableNames.length > 0 ? availableNames.join(', ') : 'none'}` };
    }
    
    if (!agentEntry.executor) {
        return { success: false, error: `SubAgent "${agentName}" has no executor. Please ensure the executor context is initialized.` };
    }

    const promptModeSnapshot = context?.promptModeSnapshot as any;
    const baseExecutorContext = getSubAgentExecutorContext();
    const runtimeExecutor = baseExecutorContext
        ? createDefaultExecutor(agentEntry.config, {
            ...baseExecutorContext,
            // 修改原因：SubAgent 内部记录要保存为 conversation 子记录，但不能进入主消息时间线。
            // 修改方式：把 ToolExecutionService 注入的 conversationId/conversationStore 继续传入 SubAgent 默认执行器。
            // 修改目的：Monitor 可恢复完整内部子对话，同时主模型上下文仍只看到 subagents 最终摘要。
            conversationId: context?.conversationId as string | undefined,
            conversationStore: context?.conversationStore as any,
            promptModeSnapshot: promptModeSnapshot || baseExecutorContext.promptModeSnapshot
        })
        : agentEntry.executor;

    if (!runtimeExecutor) {
        return { success: false, error: `SubAgent "${agentName}" has no runtime executor context.` };
    }
    
    const abortSignal = context?.abortSignal;
    if (abortSignal?.aborted) {
        return { success: false, error: 'User cancelled the sub-agent execution. Please wait for user\'s next instruction.', cancelled: true };
    }
    
    try {
        const settings = getSubAgentsSettings();
        const policy = resolveSubAgentGovernancePolicy(agentEntry.config, settings.maxConcurrentAgents);
        const budgetGovernor = new SubAgentBudgetGovernor(policy);
        const depthGuard = new SubAgentDepthGuard(policy);
        const inputDecision = budgetGovernor.checkInput(prompt, additionalContext);
        const depthDecision = depthGuard.checkDepth(typeof (context as any)?.subAgentDepth === 'number' ? (context as any).subAgentDepth : 0);
        const concurrencyDecision = subAgentConcurrencyGuard.acquire(runId, policy);
        const rejection = [inputDecision, depthDecision, concurrencyDecision].find(decision => !decision.allowed);
        if (rejection) {
            if (concurrencyDecision.allowed) {
                subAgentConcurrencyGuard.release(runId);
            }
            return {
                success: false,
                error: rejection.message || 'SubAgent governance rejected this run.',
                data: {
                    agentName,
                    runId,
                    outcome: 'failed',
                    summary: rejection.message || '',
                    keyFindings: [],
                    artifacts: [],
                    errors: [{ code: rejection.code || 'SUBAGENT_GOVERNANCE_REJECTED', message: rejection.message || 'SubAgent governance rejected this run.' }],
                    provenance: { runId, agentName },
                    truncated: false,
                    fullResponseChars: 0,
                    policySnapshot: policy
                }
            };
        }

        let result: SubAgentResult;
        try {
            result = await runtimeExecutor({
                agentType: agentEntry.config.type,
                prompt,
                context: additionalContext,
                // 修改原因：前端 pending 卡片需要在 ToolResult 返回前就能打开同一次 Monitor 运行。
                // 修改方式：把由主工具调用 id 派生的 runId 传给默认 executor，executor 会用它创建事件总线 run。
                // 修改目的：顶部 Open details 在 pending 和完成后都指向同一个 SubAgent run。
                runId
            }, abortSignal);
        } finally {
            subAgentConcurrencyGuard.release(runId);
        }
        
        // 构建公共 data：子代理运行信息
        // channelName / modelId / steps 仅供前端 UI 展示，cleanFunctionResponseForAPI 会将其过滤掉不发给 AI
        
        // 通过 ConfigManager 获取渠道显示名称（channelId 是随机分配的，对前端无意义）
        let channelName = '';
        const configManager = getGlobalConfigManager();
        if (configManager) {
            const channelConfig = await configManager.getConfig(agentEntry.config.channel.channelId);
            channelName = channelConfig?.name || agentEntry.config.channel.channelId;
        }

        const data: Record<string, unknown> = {
            // 修改原因：serializer 返回具名接口以便测试字段完整性，但 ToolResult.data 是宽 Record。
            // 修改方式：在 handler 边界展开为普通对象，不改变 serializer 的强类型契约。
            // 修改目的：兼容现有工具结果类型，同时保持 P1 结构化摘要字段可测试。
            ...serializeSubAgentResult(result, {
                agentName,
                channelName,
                modelId: agentEntry.config.channel.modelId,
                maxSummaryChars: budgetGovernor.getMaxOutputChars()
            }),
            policySnapshot: policy
        };

        if (result.cancelled || abortSignal?.aborted) {
            // 修改原因：取消路径过去直接返回 error，丢失 runId，用户无法打开 Monitor 查看已执行的部分过程。
            // 修改方式：取消也走统一 serializer，主结果包含 bounded partialResponse、outcome 和 runId。
            // 修改目的：保持主对话隔离，同时让失败/取消态也能定位完整 SubAgent run。
            return {
                success: false,
                error: result.error || 'User cancelled the sub-agent execution. Please wait for user\'s next instruction.',
                cancelled: true,
                data
            };
        }
        
        return result.success
            ? { success: true, data }
            : { success: false, error: result.error || 'SubAgent execution failed', data };
    } catch (error) {
        return { success: false, error: `SubAgent execution error: ${error instanceof Error ? error.message : String(error)}` };
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
