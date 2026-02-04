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
import type { ToolDeclaration, ToolResult, ToolContext } from '../types';
import { StreamAccumulator } from '../../modules/channel/StreamAccumulator';
import { isPlanPathAllowed } from '../../modules/settings/modeToolsPolicy';

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
    const tools: ToolDeclaration[] = [];
    const toolsConfig = config.tools;
    const mode = toolsConfig.mode;
    // 支持 whitelist/blacklist 或 list 字段
    const whitelist = toolsConfig.whitelist || toolsConfig.list;
    const blacklist = toolsConfig.blacklist || toolsConfig.list;
    const includeMcp = toolsConfig.includeMcp;
    
    // 获取内置工具
    if (mode !== 'mcp' && context.toolRegistry) {
        const builtinTools = context.toolRegistry.getAvailableDeclarations();
        // 排除 subagents 工具
        tools.push(...builtinTools.filter(t => t.name !== 'subagents'));
    }
    
    // 获取 MCP 工具
    if ((mode === 'all' || mode === 'mcp' || includeMcp) && context.mcpManager) {
        try {
            const mcpToolsResult = context.mcpManager.getAllTools();
            if (mcpToolsResult && Array.isArray(mcpToolsResult)) {
                for (const serverTools of mcpToolsResult) {
                    if (serverTools.tools && Array.isArray(serverTools.tools)) {
                        for (const tool of serverTools.tools) {
                            tools.push({
                                name: `mcp__${serverTools.serverId}__${tool.name}`,
                                description: tool.description || '',
                                parameters: tool.inputSchema || { type: 'object', properties: {} }
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[SubAgent] Failed to get MCP tools:', e);
        }
    }
    
    // 应用白名单/黑名单过滤
    let filteredTools = tools;
    
    if (mode === 'whitelist' && whitelist && whitelist.length > 0) {
        const whitelistSet = new Set(whitelist);
        filteredTools = tools.filter(t => whitelistSet.has(t.name));
    } else if (mode === 'blacklist' && blacklist && blacklist.length > 0) {
        const blacklistSet = new Set(blacklist);
        filteredTools = tools.filter(t => !blacklistSet.has(t.name));
    }
    
    return filteredTools;
}

/**
 * 执行单个工具调用
 */
async function executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: SubAgentExecutorContext,
    abortSignal?: AbortSignal
): Promise<{ result: unknown; success: boolean; error?: string }> {
    const startTime = Date.now();
    
    try {
        // 检查是否取消
        if (abortSignal?.aborted) {
            return {
                result: null,
                success: false,
                error: 'Cancelled'
            };
        }

        // 安全策略：防止子代理绕过“模式工具限制”
        // - mode.toolPolicy 为非空数组时：硬 allowlist
        // - settingsManager.isToolEnabled(toolName) 为 false 时：拒绝
        // - Plan 模式下 write_file：仅允许写入 .limcode/plans 下的 .md/.plan.md（同 ToolExecutionService 规则）
        function isPlanModeWriteFilePathAllowed(path: string): boolean {
            // 单工作区格式：.limcode/plans/...
            if (isPlanPathAllowed(path)) {
                return true;
            }

            // 多工作区：允许 workspaceName/.limcode/plans/...
            const normalized = path.replace(/\\/g, '/');
            const slashIndex = normalized.indexOf('/');
            if (slashIndex <= 0) {
                return false;
            }
            const withoutWorkspacePrefix = normalized.substring(slashIndex + 1);
            return isPlanPathAllowed(withoutWorkspacePrefix);
        }

        function parseMcpToolNameAny(name: string): { serverId: string; toolName: string } | null {
            // Preferred: mcp__{serverId}__{toolName}
            if (name.startsWith('mcp__')) {
                const parts = name.split('__');
                if (parts.length >= 3) {
                    const serverId = parts[1];
                    const tool = parts.slice(2).join('__');
                    if (serverId && tool) {
                        return { serverId, toolName: tool };
                    }
                }
                return null;
            }

            // Backward compatible: mcp_{serverId}_{toolName}
            if (name.startsWith('mcp_')) {
                const rest = name.substring(4);
                const idx = rest.indexOf('_');
                if (idx <= 0) return null;
                const serverId = rest.substring(0, idx);
                const tool = rest.substring(idx + 1);
                if (!serverId || !tool) return null;
                return { serverId, toolName: tool };
            }

            return null;
        }

        if (context.settingsManager) {
            const currentMode = context.settingsManager.getCurrentPromptMode?.();
            const allowlist = currentMode?.toolPolicy;

            if (Array.isArray(allowlist) && allowlist.length > 0) {
                const allowlistSet = new Set(allowlist);
                if (!allowlistSet.has(toolName)) {
                    return {
                        result: null,
                        success: false,
                        error: `Tool not allowed in current mode: ${toolName}`
                    };
                }
            }

            if (context.settingsManager.isToolEnabled?.(toolName) === false) {
                return {
                    result: null,
                    success: false,
                    error: `Tool is disabled: ${toolName}`
                };
            }

            if (currentMode?.id === 'plan' && toolName === 'write_file') {
                const files = (args as any)?.files;
                if (!Array.isArray(files) || files.length === 0) {
                    return {
                        result: null,
                        success: false,
                        error: 'Invalid write_file args in plan mode: files must be a non-empty array'
                    };
                }

                for (const file of files) {
                    const filePath = (file as any)?.path;
                    if (typeof filePath !== 'string') {
                        return {
                            result: null,
                            success: false,
                            error: 'Invalid write_file args in plan mode: files[].path must be a string'
                        };
                    }
                    if (!isPlanModeWriteFilePathAllowed(filePath)) {
                        return {
                            result: null,
                            success: false,
                            error: `write_file path not allowed in plan mode: ${filePath}`
                        };
                    }
                }
            }
        }
        
        // 检查是否是 MCP 工具
        const mcpParsed = context.mcpManager ? parseMcpToolNameAny(toolName) : null;
        if (mcpParsed && context.mcpManager) {
            const result = await context.mcpManager.callTool({
                serverId: mcpParsed.serverId,
                toolName: mcpParsed.toolName,
                arguments: args
            });

            if (result.success) {
                const textContent = result.content
                    ?.filter((c: any) => c?.type === 'text')
                    .map((c: any) => c?.text)
                    .filter((t: any) => typeof t === 'string' && t.trim().length > 0)
                    .join('\n') || '';

                return {
                    result: textContent,
                    success: true
                };
            }

            return {
                result: null,
                success: false,
                error: result.error || `MCP tool call failed: ${mcpParsed.toolName}`
            };
        }
        
        // 内置工具
        if (context.toolRegistry) {
            const tool = context.toolRegistry.getTool(toolName);
            if (tool) {
                const toolContext: ToolContext = {
                    abortSignal,
                    toolId: `subagent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                };
                
                const result: ToolResult = await tool.handler(args, toolContext);
                
                return {
                    result: result.success ? result.data : result.error,
                    success: result.success,
                    error: result.error
                };
            }
        }
        
        return {
            result: null,
            success: false,
            error: `Tool not found: ${toolName}`
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
 * 解析 AI 响应中的工具调用
 * 
 * 支持标准化的 GenerateResponse 格式
 */
function parseToolCalls(response: any): Array<{ name: string; args: Record<string, unknown> }> {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    
    // 标准化格式: response.content.parts
    if (response?.content?.parts) {
        for (const part of response.content.parts) {
            if (part.functionCall) {
                calls.push({
                    name: part.functionCall.name,
                    args: part.functionCall.args || {}
                });
            }
        }
        return calls;
    }
    
    // Gemini 原始格式: response.candidates[0].content.parts
    if (response?.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.functionCall) {
                calls.push({
                    name: part.functionCall.name,
                    args: part.functionCall.args || {}
                });
            }
        }
        return calls;
    }
    
    // OpenAI 格式: response.choices[0].message.tool_calls
    if (response?.choices?.[0]?.message?.tool_calls) {
        for (const toolCall of response.choices[0].message.tool_calls) {
            if (toolCall.function) {
                try {
                    calls.push({
                        name: toolCall.function.name,
                        args: JSON.parse(toolCall.function.arguments || '{}')
                    });
                } catch {
                    calls.push({
                        name: toolCall.function.name,
                        args: {}
                    });
                }
            }
        }
        return calls;
    }
    
    // Anthropic 格式: response.content 数组中查找 type: 'tool_use'
    if (response?.content && Array.isArray(response.content)) {
        for (const block of response.content) {
            if (block.type === 'tool_use') {
                calls.push({
                    name: block.name,
                    args: block.input || {}
                });
            }
        }
        return calls;
    }
    
    return calls;
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
            
            // 获取可用工具
            const availableTools = await getAvailableTools(config, context);
            
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
                    skipRetry: true  // 子代理内部不重试
                };
                
                // 如果指定了模型，设置模型覆盖
                if (config.channel.modelId) {
                    generateRequest.modelOverride = config.channel.modelId;
                }
                
                let response: any;
                try {
                    const result = await context.channelManager.generate(generateRequest);
                    
                    // 检查是否是流式响应（AsyncGenerator）
                    if (result && typeof result[Symbol.asyncIterator] === 'function') {
                        // 流式响应，使用 StreamAccumulator 来累加
                        const accumulator = new StreamAccumulator();
                        
                        for await (const chunk of result as AsyncGenerator<any>) {
                            // 在流式过程中也检查超时
                            if (combinedSignal?.aborted || checkTimeout().exceeded) {
                                break;
                            }
                            accumulator.add(chunk);
                        }
                        
                        // 获取累加后的完整响应
                        response = {
                            content: accumulator.getContent(),
                            finishReason: accumulator.getFinishReason()
                        };
                    } else {
                        // 非流式响应
                        response = result;
                    }
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
                
                // 解析响应
                const currentToolCalls = parseToolCalls(response);
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
                    // 过滤掉思考 parts，只保留正文和工具调用
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
                    return {
                        success: true,
                        response: lastResponse,
                        modelVersion,
                        steps,
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
                        combinedSignal
                    );
                    const duration = Date.now() - toolStartTime;
                    
                    toolCalls.push({
                        tool: call.name,
                        args: call.args,
                        result: result.result,
                        success: result.success,
                        duration
                    });
                    
                    // 构建工具结果 part（Gemini 格式）
                    toolResultParts.push({
                        functionResponse: {
                            name: call.name,
                            response: {
                                success: result.success,
                                result: result.result,
                                error: result.error
                            }
                        }
                    });
                }
                
                // 将工具结果添加到历史（作为 user 消息）
                history.push({
                    role: 'user',
                    parts: toolResultParts
                });
            }
            
        } catch (e) {
            // 检查是否是超时导致的错误
            const timeoutCheck = checkTimeout();
            if (timeoutCheck.exceeded) {
                return {
                    success: false,
                    modelVersion,
                    steps,
                    toolCalls,
                    error: `Exceeded maximum runtime (${maxRuntime}s). Elapsed: ${timeoutCheck.elapsed}s`
                };
            }
            return {
                success: false,
                modelVersion,
                steps,
                toolCalls,
                error: e instanceof Error ? e.message : String(e)
            };
        }
    };
}

/**
 * 默认执行器工厂
 */
export const defaultExecutorFactory: SubAgentExecutorFactory = createDefaultExecutor;
