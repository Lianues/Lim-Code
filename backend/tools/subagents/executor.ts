/**
 * SubAgents 执行器
 *
 * 提供子代理的默认执行逻辑
 */

import type {
    SubAgentConfig,
    SubAgentRequest,
    SubAgentResult,
    SubAgentToolCall,
    SubAgentExecutor,
    SubAgentExecutorContext,
    SubAgentExecutorFactory
} from './types';
import type { ToolDeclaration } from '../types';
import { ToolDeclarationResolver } from '../../modules/channel/ToolDeclarationResolver';
import { StreamResponseProcessor, isAsyncGenerator } from '../../modules/api/chat/handlers';
import { ToolCallParserService } from '../../modules/api/chat/services/ToolCallParserService';
import type { Content } from '../../modules/conversation/types';
import { subAgentRunEventBus } from './runEventBus';
import { subAgentRunController } from './runController';

/**
 * 子代理内部工具执行结果。
 *
 * 修改原因：SubAgent 历史需要写入主 ToolExecutionService 生成的 functionResponse parts，不能只保存简化的 success/result/error。
 * 修改方式：在原有 result/success/error 外，携带 responseParts、toolResults 和 prompt 模式多模态附件。
 * 修改目的：让 read_file 图片、MCP 多模态和后续工具结果格式升级能被 SubAgent 自动继承。
 */
interface SubAgentExecutedToolCall {
    result: unknown;
    success: boolean;
    error?: string;
    responseParts?: any[];
    toolResults?: any[];
    multimodalAttachments?: any[];
}

/**
 * 子代理执行器上下文存储
 */
let executorContext: SubAgentExecutorContext | null = null;

/**
 * 设置执行器上下文
 * 
 * 应在应用启动时调用，注入所需的依赖
 */
export function setSubAgentExecutorContext(context: SubAgentExecutorContext): void {
    executorContext = context;
}

/**
 * 获取执行器上下文
 */
export function getSubAgentExecutorContext(): SubAgentExecutorContext | null {
    return executorContext;
}

/**
 * 根据配置获取可用工具列表
 */
async function getAvailableTools(
    config: SubAgentConfig,
    context: SubAgentExecutorContext
): Promise<ToolDeclaration[]> {
    if (!context.configManager) {
        throw new Error('SubAgent shared ToolDeclarationResolver requires configManager in executor context.');
    }

    const channelConfig = await context.configManager.getConfig(config.channel.channelId);
    if (!channelConfig) {
        throw new Error(`SubAgent channel config not found: ${config.channel.channelId}`);
    }

    const toolsConfig = config.tools;
    const mode = toolsConfig.mode;
    const includeBuiltins = mode !== 'mcp';
    const includeMcp = mode === 'all' || mode === 'mcp' || toolsConfig.includeMcp === true;
    const allowlist = mode === 'whitelist' ? (toolsConfig.whitelist || toolsConfig.list || []) : undefined;
    const denylist = mode === 'blacklist' ? (toolsConfig.blacklist || toolsConfig.list || []) : undefined;

    // 修改原因：SubAgent 过去直接读取 toolRegistry/MCP 并自己清理 schema，导致工具声明与主会话动态声明分叉。
    // 修改方式：统一委托 ToolDeclarationResolver，并把 SubAgent 自己的 provider config、工具白名单和黑名单作为输入。
    // 修改目的：read_file 多模态说明、图片工具过滤、MCP schema 清理等以后只需要升级一个入口。
    const resolver = new ToolDeclarationResolver(
        context.toolRegistry,
        context.settingsManager,
        context.mcpManager
    );

    return resolver.resolve({
        multimodalEnabled: channelConfig.multimodalToolsEnabled,
        channelType: channelConfig.type,
        toolMode: channelConfig.toolMode,
        promptModeSnapshot: context.promptModeSnapshot,
        includeBuiltins,
        includeMcp,
        allowlist,
        denylist,
        excludeToolNames: ['subagents']
    }) || [];
}

/**
 * 执行单个工具调用
 */
async function executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: SubAgentExecutorContext,
    abortSignal?: AbortSignal,
    allowedToolNames?: Set<string>,
    agentConfig?: SubAgentConfig,
    callId?: string,
    runId?: string,
    agentName?: string
): Promise<SubAgentExecutedToolCall> {
    try {
        // 检查是否取消
        if (abortSignal?.aborted) {
            return {
                result: null,
                success: false,
                error: 'Cancelled'
            };
        }

        // 校验子代理自身的工具白名单
        // 即使 AI 不应该调用不在列表里的工具，这里做防御性校验
        if (allowedToolNames && allowedToolNames.size > 0) {
            if (!allowedToolNames.has(toolName)) {
                return {
                    result: null,
                    success: false,
                    error: `Tool not allowed for this sub-agent: ${toolName}`
                };
            }
        }

        if (!context.toolExecutionService || !context.configManager || !agentConfig) {
            return {
                result: null,
                success: false,
                error: 'SubAgent shared ToolExecutionService/configManager is missing. Refusing to use legacy fallback execution.'
            };
        }

        const executionCall = {
            id: callId || `subagent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: toolName,
            args
        };
        const channelConfig = await context.configManager.getConfig(agentConfig.channel.channelId);
        if (!channelConfig) {
            return {
                result: null,
                success: false,
                error: `SubAgent channel config not found: ${agentConfig.channel.channelId}`
            };
        }

            subAgentRunEventBus.emit({
                runId: runId || executionCall.id,
                agentName,
                type: 'tool_started',
                toolId: executionCall.id,
                toolName,
                payload: { args }
            });

            // 修改原因：SubAgent 不能再复制主工具执行逻辑，否则多模态、MCP、工具配置和参数校验会继续分叉。
            // 修改方式：优先调用 ChatHandler 注入的 ToolExecutionService，并传入 SubAgent 自己的 provider config。
            // 修改目的：让 SubAgent 内部工具调用和主会话工具调用共享同一套执行、校验和 functionResponse 打包逻辑。
            const fullResult = await context.toolExecutionService.executeFunctionCallsWithResults(
                [executionCall],
                undefined,
                undefined,
                channelConfig || undefined,
                abortSignal,
                context.promptModeSnapshot,
                (event: any) => subAgentRunEventBus.emit({
                    ...event,
                    runId: runId || executionCall.id,
                    agentName
                })
            );

            const toolResult = fullResult.toolResults?.[0];
            const resultPayload = toolResult?.result ?? { success: false, error: `Tool produced no result: ${toolName}` };
            const success = !(
                (resultPayload as any)?.success === false ||
                (resultPayload as any)?.error ||
                (resultPayload as any)?.cancelled ||
                (resultPayload as any)?.rejected
            );
            const error = typeof (resultPayload as any)?.error === 'string'
                ? (resultPayload as any).error
                : undefined;

            subAgentRunEventBus.emit({
                runId: runId || executionCall.id,
                agentName,
                type: success ? 'tool_completed' : 'tool_failed',
                toolId: executionCall.id,
                toolName,
                payload: toolResult
            });

            return {
                result: resultPayload,
                success,
                error,
                responseParts: fullResult.responseParts,
                toolResults: fullResult.toolResults,
                multimodalAttachments: fullResult.multimodalAttachments
            };
    } catch (e) {
        return {
            result: null,
            success: false,
            error: e instanceof Error ? e.message : String(e)
        };
    }
}

/**
 * 提取 AI 响应的文本内容（排除思考内容）
 * 
 * 支持标准化的 GenerateResponse 格式
 */
function extractTextContent(response: any): string {
    // 标准化格式: response.content.parts
    if (response?.content?.parts) {
        const textParts = response.content.parts
            // 过滤掉思考内容（thought: true）和非文本内容
            .filter((part: any) => part.text && !part.thought)
            .map((part: any) => part.text);
        if (textParts.length > 0) {
            return textParts.join('\n');
        }
    }
    
    // Gemini 原始格式
    if (response?.candidates?.[0]?.content?.parts) {
        const textParts = response.candidates[0].content.parts
            .filter((part: any) => part.text && !part.thought)
            .map((part: any) => part.text);
        return textParts.join('\n');
    }
    
    // OpenAI 格式
    if (response?.choices?.[0]?.message?.content) {
        return response.choices[0].message.content;
    }
    
    // Anthropic 格式
    if (response?.content && Array.isArray(response.content)) {
        const textBlocks = response.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text);
        return textBlocks.join('\n');
    }
    
    return '';
}

/**
 * 创建默认子代理执行器
 */
export function createDefaultExecutor(
    config: SubAgentConfig,
    context: SubAgentExecutorContext
): SubAgentExecutor {
    return async (request: SubAgentRequest, abortSignal?: AbortSignal): Promise<SubAgentResult> => {
        const toolCalls: SubAgentToolCall[] = [];
        let steps = 0;
        let modelVersion: string | undefined;
        // 修改原因：主聊天卡片和 Monitor 需要用稳定 ID 关联同一次 SubAgent 运行，但 pending 阶段前端还拿不到最终 ToolResult。
        // 修改方式：优先使用 handler 根据主工具调用 id 预分配的 runId；没有外部 runId 时才回退为本地随机 runId。
        // 修改目的：让 pending、完成态和历史态的 Open details 都能定位同一次运行，同时兼容非主聊天入口。
        const requestedRunId = typeof request.runId === 'string' && request.runId.trim() ? request.runId.trim() : undefined;
        const runId = requestedRunId || `subagent_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const initialPromptContent: Content = {
            role: 'user',
            parts: [{
                text: [
                    '# SubAgent Invocation',
                    '',
                    '## Agent System Prompt',
                    config.systemPrompt || '(empty)',
                    '',
                    request.context ? '## Context' : '',
                    request.context || '',
                    request.context ? '' : '',
                    '## User Prompt',
                    request.prompt
                ].filter(Boolean).join('\n')
            }],
            isUserInput: true,
            timestamp: Date.now()
        } as Content;
        subAgentRunEventBus.createRun(runId, config.name, {
            agentType: request.agentType,
            prompt: request.prompt,
            context: request.context
        }, {
            conversationId: context.conversationId,
            conversationStore: context.conversationStore,
            initialContents: [initialPromptContent]
        });
        // 修改原因：Monitor 顶部控制按钮只能控制仍在等待主窗口工具结果的活跃 run。
        // 修改方式：默认 executor 创建 run 后立即注册到 SubAgentRunController，完成/失败时在 finally 中注销。
        // 修改目的：让 Monitor 可以区分“可中止/退出”的活跃 run 和只能查看的历史 run。
        subAgentRunController.register(runId, config.name);
        const maxIterations = config.maxIterations ?? 20;
        const maxRuntime = config.maxRuntime ?? 300; // 默认 5 分钟
        const startTime = Date.now();
        const getActiveElapsedMs = (): number => Math.max(0, Date.now() - startTime - subAgentRunController.getInactiveDurationMs(runId));
        
        // 创建超时控制器
        let timeoutController: AbortController | null = null;
        let timeoutId: ReturnType<typeof setInterval> | undefined;
        
        // 检查是否超时的辅助函数
        const checkTimeout = (): { exceeded: boolean; elapsed: number } => {
            const elapsed = Math.floor(getActiveElapsedMs() / 1000);
            if (maxRuntime > 0 && elapsed >= maxRuntime) {
                return { exceeded: true, elapsed };
            }
            return { exceeded: false, elapsed };
        };

        if (maxRuntime > 0) {
            timeoutController = new AbortController();
            // 修改原因：Monitor 暂停和等待用户操作的时间不应计入 maxRuntime，固定 setTimeout 会误把暂停时间算入运行时间。
            // 修改方式：用短间隔轮询 checkTimeout，checkTimeout 会扣除 runController 记录的 inactiveDurationMs。
            // 修改目的：用户暂停查看 Monitor 或等待手动决策时，SubAgent 不会因为真实墙钟时间流逝而超时失败。
            timeoutId = setInterval(() => {
                if (checkTimeout().exceeded) {
                    timeoutController?.abort();
                }
            }, 500);
            if (abortSignal) {
                abortSignal.addEventListener('abort', () => {
                    if (timeoutId) clearInterval(timeoutId);
                    timeoutController?.abort();
                });
            }
        }

        const createOperationSignal = (): AbortSignal | undefined => {
            const signals = [abortSignal, timeoutController?.signal, subAgentRunController.getAbortSignal(runId)]
                .filter((signal): signal is AbortSignal => !!signal);
            if (signals.length === 0) return undefined;
            const controller = new AbortController();
            const abort = () => controller.abort();
            for (const signal of signals) {
                if (signal.aborted) {
                    controller.abort();
                    break;
                }
                signal.addEventListener('abort', abort, { once: true });
            }
            return controller.signal;
        };

        let lastResponse: string = '';

        const buildCancelledResult = (error: string): SubAgentResult => ({
            success: false,
            response: lastResponse,
            modelVersion,
            steps,
            runId,
            toolCalls,
            error,
            cancelled: true
        });

        const waitForControlIfNeeded = async (): Promise<SubAgentResult | null> => {
            const state = subAgentRunController.getState(runId);
            if (!state) return null;
            if (state.status === 'cancelled') {
                return buildCancelledResult(subAgentRunController.getExitReason(runId) || '用户主动终止 SubAgent 执行');
            }
            if (state.status === 'paused' || state.status === 'awaiting_monitor_action') {
                const status = await subAgentRunController.waitUntilRunnable(runId);
                if (status === 'cancelled') {
                    return buildCancelledResult(subAgentRunController.getExitReason(runId) || '用户主动终止 SubAgent 执行');
                }
            }
            return null;
        };

        const isControlInterruption = (): boolean => {
            const state = subAgentRunController.getState(runId);
            return !!state && (state.status === 'paused' || state.status === 'awaiting_monitor_action' || state.status === 'cancelled');
        };
        
        // 检查是否超出迭代次数的辅助函数
        const checkIterations = (): boolean => {
            if (maxIterations === -1) return false; // -1 表示无限制
            return steps >= maxIterations;
        };

        const resolveFailureModeAfterRetries = (): 'fail_parent_tool' | 'wait_for_monitor_action' => {
            // 修改原因：旧 SubAgent 配置可能没有 failureModeAfterRetries，但运行时必须有明确策略。
            // 修改方式：优先使用单个 SubAgent 覆盖值，其次使用全局 SubAgents 默认值，最后回退到 fail_parent_tool。
            // 修改目的：满足“运行时补齐，不主动写回”的兼容策略。
            const own = config.failureModeAfterRetries;
            if (own === 'wait_for_monitor_action' || own === 'fail_parent_tool') return own;
            const global = context.settingsManager?.getSubAgentsConfig?.()?.failureModeAfterRetries;
            return global === 'wait_for_monitor_action' ? 'wait_for_monitor_action' : 'fail_parent_tool';
        };
        
        try {
            // 检查是否取消
            if (abortSignal?.aborted || timeoutController?.signal.aborted) {
                return {
                    success: false,
                    error: 'Cancelled before execution',
                    cancelled: true
                };
            }
            
            if (!context.configManager) {
                throw new Error('SubAgent shared parser/stream path requires configManager in executor context.');
            }
            const channelConfig = await context.configManager.getConfig(config.channel.channelId);
            if (!channelConfig) {
                throw new Error(`SubAgent channel config not found: ${config.channel.channelId}`);
            }
            const toolMode = channelConfig.toolMode || 'function_call';
            const providerType = channelConfig.type || 'custom';
            const toolCallParser = new ToolCallParserService();

            // 获取可用工具
            const availableTools = await getAvailableTools(config, context);
            
            // 构建允许的工具名称集合，用于执行时的防御性校验
            const allowedToolNames = new Set(availableTools.map(t => t.name));
            
            // 构建系统提示词
            const systemPrompt = config.systemPrompt;
            
            // 构建用户提示词
            let userPrompt = request.prompt;
            if (request.context) {
                userPrompt = `Context:\n${request.context}\n\nTask:\n${request.prompt}`;
            }
            
            // 构建对话历史（Content 格式）
            const history: Array<{ role: 'user' | 'model'; parts: any[] }> = [
                { role: 'user', parts: [{ text: userPrompt }] }
            ];
            
            // 工具迭代循环
            
            while (true) {
                const controlWaitResult = await waitForControlIfNeeded();
                if (controlWaitResult) {
                    return controlWaitResult;
                }

                // 检查是否取消或超时
                if (abortSignal?.aborted || timeoutController?.signal.aborted) {
                    const timeoutCheck = checkTimeout();
                    const isTimeout = timeoutCheck.exceeded;
                    return {
                        success: false,
                        response: lastResponse,
                        modelVersion,
                        steps,
                        toolCalls,
                        error: isTimeout 
                            ? `Exceeded maximum runtime (${maxRuntime}s). Elapsed: ${timeoutCheck.elapsed}s`
                            : 'Cancelled during execution',
                        cancelled: !isTimeout
                    };
                }
                
                // 检查超时
                const timeoutCheck = checkTimeout();
                if (timeoutCheck.exceeded) {
                    return {
                        success: false,
                        response: lastResponse,
                        modelVersion,
                        steps,
                        toolCalls,
                        error: `Exceeded maximum runtime (${maxRuntime}s). Elapsed: ${timeoutCheck.elapsed}s`
                    };
                }
                
                // 检查迭代次数
                if (checkIterations()) {
                    return {
                        success: false,
                        response: lastResponse,
                        modelVersion,
                        steps,
                        toolCalls,
                        error: `Exceeded maximum iterations (${maxIterations})`
                    };
                }
                
                steps++;
                
                // 调用 AI
                const operationSignal = createOperationSignal();
                let retryFailedInThisCall = false;
                const generateRequest: any = {
                    configId: config.channel.channelId,
                    history: history,
                    dynamicSystemPrompt: systemPrompt,
                    abortSignal: operationSignal,
                    toolOverrides: availableTools.length > 0 ? availableTools : undefined,
                    suppressRetryNotification: true,
                    retryStatusCallback: (status: any) => {
                        if (status?.type === 'retryFailed') {
                            retryFailedInThisCall = true;
                        }
                        // 修改原因：SubAgent 内部自动重试状态不能进入主窗口 retryStatus，但用户需要在 Monitor 里看到。
                        // 修改方式：通过 GenerateRequest.retryStatusCallback 把 ChannelManager 的 retrying/retrySuccess/retryFailed 事件路由到 SubAgent runEventBus。
                        // 修改目的：继续复用 Provider 自动重试配置，同时让 Monitor 成为内部重试状态的唯一展示位置。
                        subAgentRunEventBus.emit({
                            runId,
                            agentName: config.name,
                            type: status?.type || 'run_updated',
                            payload: status
                        });
                    },
                    // 修改原因：SubAgent 解析 XML/JSON prompt tool mode 时必须和主请求使用同一份模式快照。
                    // 修改方式：把父请求解析好的 promptModeSnapshot 继续传给 ChannelManager。
                    // 修改目的：避免 SubAgent 工具声明和工具调用解析在不同 prompt mode 下再次分叉。
                    promptModeSnapshot: context.promptModeSnapshot
                };
                
                // 如果指定了模型，设置模型覆盖
                if (config.channel.modelId) {
                    generateRequest.modelOverride = config.channel.modelId;
                }
                
                let response: any;
                try {
                    const result = await context.channelManager.generate(generateRequest);
                    const requestStartTime = Date.now();
                    const streamProcessor = new StreamResponseProcessor({
                        requestStartTime,
                        providerType,
                        toolMode,
                        abortSignal: operationSignal,
                        conversationId: runId
                    });
                    
                    if (isAsyncGenerator(result)) {
                        // 修改原因：SubAgent 不应直接 new StreamAccumulator，否则主窗口流式解析升级时 Monitor 不会同步升级。
                        // 修改方式：复用 StreamResponseProcessor，并把处理后的 chunk 原样通过事件总线转给 Monitor。
                        // 修改目的：SubAgent Monitor 与主窗口共享流式解析、contentSnapshot 和取消语义。
                        for await (const chunkData of streamProcessor.processStream(result as AsyncGenerator<any>)) {
                            if (operationSignal?.aborted || checkTimeout().exceeded) {
                                break;
                            }
                            subAgentRunEventBus.emit({
                                runId,
                                agentName: config.name,
                                type: 'llm_delta',
                                payload: chunkData.chunk
                            });
                        }
                        response = {
                            content: streamProcessor.getContent()
                        };
                        subAgentRunEventBus.updateLastModelContent(runId, response.content);
                    } else {
                        const processed = streamProcessor.processNonStream(result as any);
                        response = {
                            ...(result as any),
                            content: processed.content
                        };
                        subAgentRunEventBus.updateLastModelContent(runId, response.content);
                        subAgentRunEventBus.emit({
                            runId,
                            agentName: config.name,
                            type: 'llm_delta',
                            payload: processed.chunkData.chunk
                        });
                    }

                    subAgentRunEventBus.emit({
                        runId,
                        agentName: config.name,
                        type: 'content_snapshot',
                        payload: response?.content
                    });
                } catch (e) {
                    // 检查是否是超时导致的错误
                    const timeoutCheck = checkTimeout();
                    if (timeoutCheck.exceeded) {
                        return {
                            success: false,
                            response: lastResponse,
                            modelVersion,
                            steps,
                            toolCalls,
                            error: `Exceeded maximum runtime (${maxRuntime}s). Elapsed: ${timeoutCheck.elapsed}s`
                        };
                    }
                    if (operationSignal?.aborted && isControlInterruption()) {
                        const controlResult = await waitForControlIfNeeded();
                        if (controlResult) return controlResult;
                        continue;
                    }

                    if (retryFailedInThisCall && resolveFailureModeAfterRetries() === 'wait_for_monitor_action') {
                        const reason = e instanceof Error ? e.message : String(e);
                        subAgentRunController.markAwaitingMonitorAction(runId, reason);
                        const controlResult = await waitForControlIfNeeded();
                        if (controlResult) return controlResult;
                        continue;
                    }

                    return {
                        success: false,
                        response: lastResponse,
                        modelVersion,
                        steps,
                        toolCalls,
                        error: `AI call failed: ${e instanceof Error ? e.message : String(e)}`
                    };
                }
                
                // 修改原因：SubAgent 过去自己解析各 provider 的工具调用，主流程支持 XML/JSON prompt tool mode 后容易漏同步。
                // 修改方式：统一把标准 Content 交给 ToolCallParserService 转换和提取 functionCall。
                // 修改目的：所有工具调用解析能力只维护一个入口。
                if (response?.content) {
                    toolCallParser.convertPromptModeToolCallsToFunctionCalls(response.content, toolMode);
                    toolCallParser.ensureFunctionCallIds(response.content);
                }
                const currentToolCalls = response?.content
                    ? toolCallParser.extractFunctionCalls(response.content, toolMode)
                    : [];
                const textContent = extractTextContent(response);

                // 记录子代理实际运行的模型版本（优先 content.modelVersion，其次 response.model）
                const mvCandidate =
                    (response as any)?.content?.modelVersion
                    || (response as any)?.modelVersion
                    || (response as any)?.model;
                if (typeof mvCandidate === 'string' && mvCandidate.trim()) {
                    modelVersion = mvCandidate.trim();
                }
                
                if (textContent) {
                    lastResponse = textContent;
                }
                
                // 将 AI 响应添加到历史（过滤掉思考内容）
                if (response?.content) {
                    // 修改原因：Monitor 需要显示完整模型消息，包括主窗口允许展示的 thought、工具调用、计时和 usage 信息。
                    // 修改方式：Monitor 子记录保存完整 response.content；发回子模型的历史仍过滤 thought，保持现有请求安全语义。
                    // 修改目的：UI 展示和模型续传各走正确数据，不再为了续传牺牲 Monitor 的完整聊天体验。
                    subAgentRunEventBus.updateLastModelContent(runId, response.content);
                    const filteredParts = (response.content.parts || []).filter(
                        (part: any) => !part.thought
                    );
                    if (filteredParts.length > 0) {
                        history.push({
                            role: 'model',
                            parts: filteredParts
                        });
                    }
                }
                
                // 如果没有工具调用，说明代理已完成任务
                if (currentToolCalls.length === 0) {
                    subAgentRunEventBus.emit({
                        runId,
                        agentName: config.name,
                        type: 'run_completed',
                        payload: { response: lastResponse, steps, modelVersion }
                    });
                    return {
                        success: true,
                        response: lastResponse,
                        modelVersion,
                        steps,
                        runId,
                        toolCalls
                    };
                }
                
                // 执行工具调用
                const toolResultParts: any[] = [];
                
                for (const call of currentToolCalls) {
                    // 执行工具前检查超时
                    const timeoutCheck = checkTimeout();
                    const toolOperationSignal = createOperationSignal();
                    if (timeoutCheck.exceeded || abortSignal?.aborted || timeoutController?.signal.aborted) {
                        return {
                            success: false,
                            response: lastResponse,
                            modelVersion,
                            steps,
                            toolCalls,
                            error: `Exceeded maximum runtime (${maxRuntime}s). Elapsed: ${timeoutCheck.elapsed}s`
                        };
                    }
                    
                    const toolStartTime = Date.now();
                    const result = await executeToolCall(
                        call.name,
                        call.args,
                        context,
                        toolOperationSignal,
                        allowedToolNames,
                        config,
                        call.id,
                        runId,
                        config.name
                    );
                    const duration = Date.now() - toolStartTime;
                    
                    toolCalls.push({
                        tool: call.name,
                        args: call.args,
                        result: result.result,
                        success: result.success,
                        duration
                    });
                    
                    if (result.responseParts && result.responseParts.length > 0) {
                        // 修改原因：主 ToolExecutionService 已经负责构造包含多模态 parts 的 functionResponse，SubAgent 不应再手写简化结果。
                        // 修改方式：优先写入 ToolExecutionService 返回的 responseParts，并在 prompt 模式下带上 multimodalAttachments。
                        // 修改目的：确保图片/PDF/MCP 多模态结果在 SubAgent 内部能按主流程同样的格式回传给子模型。
                        if (result.multimodalAttachments && result.multimodalAttachments.length > 0) {
                            toolResultParts.push(...result.multimodalAttachments);
                        }
                        toolResultParts.push(...result.responseParts);
                    } else {
                        // 回退路径只用于旧上下文缺少 ToolExecutionService 的情况，保留原始 id 以满足 Anthropic/Responses 配对要求。
                        toolResultParts.push({
                            functionResponse: {
                                name: call.name,
                                response: {
                                    success: result.success,
                                    result: result.result,
                                    error: result.error
                                },
                                id: call.id
                            }
                        });
                    }
                }
                
                // 将工具结果添加到历史（作为 user 消息）
                const functionResponseContent = {
                    role: 'user' as const,
                    parts: toolResultParts,
                    isFunctionResponse: true,
                    timestamp: Date.now()
                } as Content;
                history.push({
                    role: 'user',
                    parts: toolResultParts
                });
                subAgentRunEventBus.appendContent(runId, functionResponseContent);
            }
            
        } catch (e) {
            // 检查是否是超时导致的错误
            const timeoutCheck = checkTimeout();
            if (timeoutCheck.exceeded) {
                const error = `Exceeded maximum runtime (${maxRuntime}s). Elapsed: ${timeoutCheck.elapsed}s`;
                subAgentRunEventBus.emit({ runId, agentName: config.name, type: 'run_failed', payload: { error } });
                return {
                    success: false,
                    modelVersion,
                    steps,
                    runId,
                    toolCalls,
                    error
                };
            }
            const error = e instanceof Error ? e.message : String(e);
            subAgentRunEventBus.emit({ runId, agentName: config.name, type: 'run_failed', payload: { error } });
            return {
                success: false,
                modelVersion,
                steps,
                runId,
                toolCalls,
                error
            };
        } finally {
            // 修改原因：run 完成、失败或取消后不能继续显示为可控制的活跃执行。
            // 修改方式：executor 最外层 finally 注销 runController 中的活跃记录，事件总线快照仍保留历史。
            // 修改目的：避免 Monitor 对历史 run 展示“中止/退出”等会影响主工具的按钮。
            subAgentRunController.unregister(runId);
        }
    };
}

/**
 * 默认执行器工厂
 */
export const defaultExecutorFactory: SubAgentExecutorFactory = createDefaultExecutor;
