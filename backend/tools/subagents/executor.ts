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
        // 修改原因：主聊天卡片和 Monitor 需要用稳定 ID 关联同一次 SubAgent 运行，但内部事件不写入主对话历史。
        // 修改方式：默认执行器在运行开始时创建 runId，并通过内存事件总线广播生命周期事件。
        // 修改目的：实现“主卡片摘要 + Monitor 详情”的路由基础，同时保持内部过程不持久化。
        const runId = `subagent_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
        const maxIterations = config.maxIterations ?? 20;
        const maxRuntime = config.maxRuntime ?? 300; // 默认 5 分钟
        const startTime = Date.now();
        
        // 创建超时控制器
        let timeoutController: AbortController | null = null;
        let combinedSignal: AbortSignal | undefined = abortSignal;
        
        if (maxRuntime > 0) {
            timeoutController = new AbortController();
            // 设置超时定时器
            const timeoutId = setTimeout(() => {
                timeoutController?.abort();
            }, maxRuntime * 1000);
            
            // 组合信号：用户取消 + 超时
            if (abortSignal) {
                // 监听用户取消
                abortSignal.addEventListener('abort', () => {
                    clearTimeout(timeoutId);
                    timeoutController?.abort();
                });
            }
            combinedSignal = timeoutController.signal;
        }
        
        // 检查是否超时的辅助函数
        const checkTimeout = (): { exceeded: boolean; elapsed: number } => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            if (maxRuntime > 0 && elapsed >= maxRuntime) {
                return { exceeded: true, elapsed };
            }
            return { exceeded: false, elapsed };
        };
        
        // 检查是否超出迭代次数的辅助函数
        const checkIterations = (): boolean => {
            if (maxIterations === -1) return false; // -1 表示无限制
            return steps >= maxIterations;
        };
        
        try {
            // 检查是否取消
            if (combinedSignal?.aborted || abortSignal?.aborted) {
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
            let lastResponse: string = '';
            
            while (true) {
                // 检查是否取消或超时
                if (combinedSignal?.aborted || abortSignal?.aborted) {
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
                const generateRequest: any = {
                    configId: config.channel.channelId,
                    history: history,
                    dynamicSystemPrompt: systemPrompt,
                    abortSignal: combinedSignal,
                    toolOverrides: availableTools.length > 0 ? availableTools : undefined,
                    suppressRetryNotification: true,
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
                        abortSignal: combinedSignal,
                        conversationId: runId
                    });
                    
                    if (isAsyncGenerator(result)) {
                        // 修改原因：SubAgent 不应直接 new StreamAccumulator，否则主窗口流式解析升级时 Monitor 不会同步升级。
                        // 修改方式：复用 StreamResponseProcessor，并把处理后的 chunk 原样通过事件总线转给 Monitor。
                        // 修改目的：SubAgent Monitor 与主窗口共享流式解析、contentSnapshot 和取消语义。
                        for await (const chunkData of streamProcessor.processStream(result as AsyncGenerator<any>)) {
                            if (combinedSignal?.aborted || checkTimeout().exceeded) {
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
                    if (timeoutCheck.exceeded || combinedSignal?.aborted) {
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
                        combinedSignal,
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
        }
    };
}

/**
 * 默认执行器工厂
 */
export const defaultExecutorFactory: SubAgentExecutorFactory = createDefaultExecutor;
