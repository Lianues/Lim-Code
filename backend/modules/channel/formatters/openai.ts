/**
 * LimCode - OpenAI 格式转换器
 *
 * 将统一格式转换为 OpenAI API 格式（兼容 DeepSeek 等）
 *
 * ## 工具调用处理流程
 *
 * ### XML/JSON 模式
 * - AI 返回简单的 { role, content } 格式
 * - 从 content 中提取工具调用，拆分为 text + functionCall 交错存储
 * - 发送时：将 functionCall 转回文本，合并 text 为单一 content
 * - functionResponse：作为 user 消息发送
 *
 * ### Function Call 模式
 * - AI 返回 { role, content, tool_calls }
 * - 直接使用原生 tool_calls
 * - 发送时：所有 functionCall 放末尾创建 tool_calls，text 拼接
 * - functionResponse：用 role: tool 发送
 */

import { t } from '../../../i18n';
import { BaseFormatter } from './base';
import type { Content, ContentPart } from '../../conversation/types';
import type { OpenAIConfig } from '../../config/types';
import type { ToolDeclaration } from '../../../tools/types';
import {
    convertToolsToXML,
    convertFunctionCallToXML,
    convertFunctionResponseToXML,
    parseXMLToolCalls
} from '../../../tools/xmlFormatter';
import {
    convertToolsToJSON,
    convertFunctionCallToJSON,
    convertFunctionResponseToJSON,
    parseJSONToolCalls,
    TOOL_CALL_START,
    TOOL_CALL_END
} from '../../../tools/jsonFormatter';
import { applyCustomBody } from '../../config/configs/base';
import type {
    GenerateRequest,
    GenerateResponse,
    StreamChunk,
    HttpRequestOptions,
    ChannelError,
    ErrorType
} from '../types';

/**
 * OpenAI 格式转换器
 *
 * 支持 OpenAI API 的完整功能：
 * - 文本内容
 * - 思考内容（reasoning_content）
 * - Token 统计
 * - 流式和非流式输出
 */
export class OpenAIFormatter extends BaseFormatter {
    /**
     * 构建 OpenAI API 请求
     */
    buildRequest(
        request: GenerateRequest,
        config: OpenAIConfig,
        tools?: ToolDeclaration[]
    ): HttpRequestOptions {
        const { history, dynamicContextMessages } = request;
        const toolMode = config.toolMode || 'function_call';
        
        // 处理工具和系统指令
        let systemInstruction = config.systemInstruction;
        
        // 追加静态系统提示词（操作系统、时区、语言、工作区路径 - 可被 API provider 缓存）
        if (request.dynamicSystemPrompt) {
            systemInstruction = systemInstruction
                ? `${systemInstruction}\n\n${request.dynamicSystemPrompt}`
                : request.dynamicSystemPrompt;
        }
        
        // 处理工具描述 - 替换占位符或追加到系统提示词
        // 准备工具定义内容
        let toolsContent = '';
        let mcpToolsContent = '';
        
        if (tools && tools.length > 0) {
            if (toolMode === 'xml') {
                // XML 模式：工具转换为 XML
                toolsContent = convertToolsToXML(tools);
            } else if (toolMode === 'json') {
                // JSON 模式：工具转换为 JSON
                toolsContent = convertToolsToJSON(tools);
            }
        }
        
        // MCP 工具由外部传入
        if (request.mcpToolsContent) {
            mcpToolsContent = request.mcpToolsContent;
        }
        
        // 替换占位符（如果存在）
        if (systemInstruction && (systemInstruction.includes('{{$TOOLS}}') || systemInstruction.includes('{{$MCP_TOOLS}}'))) {
            // 替换 TOOLS 占位符
            systemInstruction = systemInstruction.replace(/\{\{\$TOOLS\}\}/g, toolsContent);
            // 替换 MCP_TOOLS 占位符
            systemInstruction = systemInstruction.replace(/\{\{\$MCP_TOOLS\}\}/g, mcpToolsContent);
        } else if (toolsContent) {
            // 如果没有占位符但有工具内容，追加到末尾
            systemInstruction = systemInstruction
                ? `${systemInstruction}\n\n${toolsContent}`
                : toolsContent;
        }
        
        // 转换思考签名格式（移除，因为 OpenAI 目前不使用思考签名）
        let processedHistory = this.convertThoughtSignatures(history);
        
        // 插入动态上下文消息（直接追加到历史末尾）
        // 动态上下文包含时间、文件树、标签页等频繁变化的内容
        // 这些内容不存储到后端历史，仅在发送时临时插入
        if (dynamicContextMessages && dynamicContextMessages.length > 0) {
            processedHistory = [...processedHistory, ...dynamicContextMessages];
        }
        
        // 转换历史消息为 OpenAI 格式（直接传入原始历史，转换时处理）
        const messages = this.convertToOpenAIMessages(processedHistory, systemInstruction, toolMode);
        
        // 构建请求体
        const body: any = {
            model: config.model,
            messages: messages
        };
        
        // 添加工具（Function Call 模式）
        if (tools && tools.length > 0) {
            const toolMode = config.toolMode || 'function_call';
            if (toolMode === 'function_call') {
                body.tools = this.convertTools(tools);
            }
        }
        
        // 添加生成配置（完全从 config 读取）
        const genConfig = this.buildGenerationConfig(config);
        Object.assign(body, genConfig);
        
        // 决定是否使用流式（完全由配置决定）
        const useStream = config.options?.stream ?? config.preferStream ?? false;
        
        // 始终将 stream 添加到请求体（明确发送 true 或 false）
        body.stream = useStream;
        
        // 如果开启流式，添加 stream_options 以获取完整的 usage 信息
        if (useStream) {
            body.stream_options = {
                include_usage: true
            };
        }
        
        // 构建 URL
        const baseUrl = config.url.endsWith('/')
            ? config.url.slice(0, -1)
            : config.url;
        
        const url = `${baseUrl}/chat/completions`;
        
        // 构建请求头
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        
        // 只有当 apiKey 存在时才添加认证头
        if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        }
        
        // 应用自定义标头（如果启用）
        if (config.customHeadersEnabled && config.customHeaders) {
            for (const header of config.customHeaders) {
                // 只添加启用的、有键名的标头
                if (header.enabled && header.key && header.key.trim()) {
                    headers[header.key.trim()] = header.value || '';
                }
            }
        }
        
        // 应用自定义 body（如果启用）
        const finalBody = applyCustomBody(body, (config as any).customBody, (config as any).customBodyEnabled);
        
        // 构建请求选项
        return {
            url,
            method: 'POST',
            headers,
            body: finalBody,
            timeout: config.timeout,  // 使用配置的超时时间
            stream: useStream
        };
    }
    
    /**
     * 转换为 OpenAI 消息格式
     *
     * OpenAI 格式限制：
     * 1. content 是单个字符串（不像 Gemini 支持多个 parts）
     * 2. 有 tool_calls 时，content 为 null
     * 3. thought 内容不发送给 API
     *
     * 工具调用处理：
     * - function_call 模式：使用原生 tool_calls 和 role: tool
     * - xml/json 模式：将 functionCall 转回文本，functionResponse 作为 user 消息
     */
    private convertToOpenAIMessages(
        history: Content[],
        systemInstruction?: string,
        toolMode: string = 'function_call'
    ): any[] {
        const messages: any[] = [];
        
        // 添加系统指令
        if (systemInstruction) {
            messages.push({
                role: 'system',
                content: systemInstruction
            });
        }
        
        // 根据模式使用不同的转换策略
        if (toolMode === 'function_call') {
            this.convertHistoryFunctionCallMode(history, messages);
        } else {
            // XML 或 JSON 模式
            this.convertHistoryTextMode(history, messages, toolMode as 'xml' | 'json');
        }
        
        return messages;
    }
    
    /**
     * Function Call 模式转换
     *
     * - 所有 functionCall 放在消息末尾作为 tool_calls
     * - text 和多媒体内容转换为 content（支持数组格式）
     * - 思考内容（thought: true）转换为 reasoning_content
     * - functionResponse 用 role: tool 发送
     */
    private convertHistoryFunctionCallMode(history: Content[], messages: any[]): void {
        for (const content of history) {
            const role = content.role === 'model' ? 'assistant' : content.role;
            
            // 分离各种类型的 parts
            const textParts = content.parts.filter(p => 'text' in p && !p.thought);
            const thoughtParts = content.parts.filter(p => 'text' in p && p.thought === true);
            const functionCallParts = content.parts.filter(p => p.functionCall);
            const functionResponseParts = content.parts.filter(p => p.functionResponse);
            const mediaParts = content.parts.filter(p => p.inlineData || p.fileData);
            
            if (functionCallParts.length > 0) {
                // assistant 消息包含 tool_calls
                // 所有 functionCall 放到末尾作为 tool_calls
                const toolCalls = functionCallParts.map((p, index) => ({
                    id: p.functionCall!.id || `call_${Date.now()}_${index}`,
                    type: 'function',
                    function: {
                        name: p.functionCall!.name,
                        arguments: JSON.stringify(p.functionCall!.args)
                    }
                }));
                
                // 构建消息对象
                const message: any = {
                    role: 'assistant',
                    content: textParts.length > 0 ? textParts.map(p => p.text).join('\n') : null,
                    tool_calls: toolCalls
                };
                
                // 如果有思考内容，添加 reasoning_content（DeepSeek R1 必需）
                if (thoughtParts.length > 0) {
                    const reasoningContent = thoughtParts.map(p => p.text).join('\n');
                    if (reasoningContent) {
                        message.reasoning_content = reasoningContent;
                    }
                }
                
                messages.push(message);
            } else if (functionResponseParts.length > 0) {
                // 工具响应用 role: tool 发送
                for (const part of functionResponseParts) {
                    const resp = part.functionResponse!;
                    messages.push({
                        role: 'tool',
                        tool_call_id: resp.id || `call_${Date.now()}`,
                        name: resp.name,  // 工具名称是 OpenAI API 必需的
                        content: JSON.stringify(resp.response)
                    });
                }
            } else if (textParts.length > 0 || thoughtParts.length > 0 || mediaParts.length > 0) {
                // 普通消息（可能包含文本、思考内容和/或多媒体内容）
                const messageContent = this.buildMessageContent(textParts, mediaParts);
                
                // 构建消息对象
                const message: any = {
                    role,
                    content: messageContent
                };
                
                // 如果有思考内容，添加 reasoning_content（仅 assistant 消息）
                if (role === 'assistant' && thoughtParts.length > 0) {
                    const reasoningContent = thoughtParts.map(p => p.text).join('\n');
                    if (reasoningContent) {
                        message.reasoning_content = reasoningContent;
                    }
                }
                
                messages.push(message);
            }
        }
    }
    
    /**
     * 构建消息内容（支持多模态）
     *
     * OpenAI 格式：
     * - 纯文本：string
     * - 多模态：[{type: "text", text: ...}, {type: "image_url", image_url: {...}}]
     */
    private buildMessageContent(textParts: ContentPart[], mediaParts: ContentPart[]): string | any[] {
        // 如果没有多媒体内容，直接返回拼接的文本
        if (mediaParts.length === 0) {
            return textParts.map(p => p.text).join('\n');
        }
        
        // 有多媒体内容，使用数组格式
        const contentArray: any[] = [];
        
        // 添加文本部分
        for (const part of textParts) {
            if (part.text) {
                contentArray.push({
                    type: 'text',
                    text: part.text
                });
            }
        }
        
        // 添加多媒体部分
        for (const part of mediaParts) {
            if (part.inlineData) {
                // Base64 内联数据 -> data URI
                const dataUri = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                contentArray.push({
                    type: 'image_url',
                    image_url: {
                        url: dataUri
                    }
                });
            } else if (part.fileData) {
                // 文件引用 -> URL
                contentArray.push({
                    type: 'image_url',
                    image_url: {
                        url: part.fileData.fileUri
                    }
                });
            }
        }
        
        return contentArray;
    }
    
    /**
     * XML/JSON 模式转换
     *
     * - functionCall 转回文本，与 text 合并为单一 content
     * - 思考内容（thought: true）转换为 reasoning_content
     * - functionResponse 作为 user 消息发送（包含多媒体附件）
     * - 支持多媒体内容
     */
    private convertHistoryTextMode(history: Content[], messages: any[], mode: 'xml' | 'json'): void {
        for (const content of history) {
            const role = content.role === 'model' ? 'assistant' : content.role;
            
            // 分离各种类型的 parts
            const functionResponseParts = content.parts.filter(p => p.functionResponse);
            const thoughtParts = content.parts.filter(p => 'text' in p && p.thought === true);
            const mediaParts = content.parts.filter(p => p.inlineData || p.fileData);
            
            if (functionResponseParts.length > 0) {
                // functionResponse 作为 user 消息发送
                // 如果同一消息中有多媒体附件，需要一起发送（工具调用返回的图片）
                const responseTextParts: ContentPart[] = [];
                
                for (const part of functionResponseParts) {
                    const resp = part.functionResponse!;
                    const responseText = mode === 'xml'
                        ? convertFunctionResponseToXML(resp.name, resp.response)
                        : convertFunctionResponseToJSON(resp.name, resp.response);
                    responseTextParts.push({ text: responseText });
                }
                
                // 使用 buildMessageContent 构建多模态内容
                const messageContent = this.buildMessageContent(responseTextParts, mediaParts);
                
                messages.push({
                    role: 'user',
                    content: messageContent
                });
            } else {
                // 将 functionCall 转回文本，与 text 合并
                const textContentParts: ContentPart[] = [];
                
                for (const part of content.parts) {
                    if (part.thought) {
                        // 思考内容单独处理
                        continue;
                    }
                    
                    if (part.inlineData || part.fileData) {
                        // 多媒体内容稍后处理
                        continue;
                    }
                    
                    if (part.functionCall) {
                        // 将 functionCall 转回文本
                        const callText = mode === 'xml'
                            ? convertFunctionCallToXML(part.functionCall.name, part.functionCall.args)
                            : convertFunctionCallToJSON(part.functionCall.name, part.functionCall.args);
                        textContentParts.push({ text: callText });
                    } else if ('text' in part && part.text) {
                        textContentParts.push({ text: part.text });
                    }
                }
                
                if (textContentParts.length > 0 || thoughtParts.length > 0 || mediaParts.length > 0) {
                    const messageContent = this.buildMessageContent(textContentParts, mediaParts);
                    
                    // 构建消息对象
                    const message: any = {
                        role,
                        content: messageContent
                    };
                    
                    // 如果有思考内容，添加 reasoning_content（仅 assistant 消息）
                    if (role === 'assistant' && thoughtParts.length > 0) {
                        const reasoningContent = thoughtParts.map(p => p.text).join('\n');
                        if (reasoningContent) {
                            message.reasoning_content = reasoningContent;
                        }
                    }
                    
                    messages.push(message);
                }
            }
        }
    }
    
    /**
     * 构建生成配置
     */
    private buildGenerationConfig(
        config: OpenAIConfig,
        options?: any
    ): any {
        const genConfig: any = {};
        const optionsEnabled = (config as any).optionsEnabled || {};
        
        // 合并配置和选项（选项优先）
        const temperature = options?.temperature ?? config.options?.temperature;
        const maxTokens = options?.maxTokens ?? config.options?.max_tokens;
        const topP = options?.topP ?? config.options?.top_p;
        const frequencyPenalty = options?.frequencyPenalty ?? config.options?.frequency_penalty;
        const presencePenalty = options?.presencePenalty ?? config.options?.presence_penalty;
        const stop = options?.stopSequences ?? config.options?.stop;
        const n = options?.candidateCount ?? config.options?.n;
        
        // 添加配置项（仅当启用时）
        if (optionsEnabled.temperature && temperature !== undefined) {
            genConfig.temperature = temperature;
        }
        
        if (optionsEnabled.max_tokens && maxTokens !== undefined) {
            genConfig.max_tokens = maxTokens;
        }
        
        if (optionsEnabled.top_p && topP !== undefined) {
            genConfig.top_p = topP;
        }
        
        if (optionsEnabled.frequency_penalty && frequencyPenalty !== undefined) {
            genConfig.frequency_penalty = frequencyPenalty;
        }
        
        if (optionsEnabled.presence_penalty && presencePenalty !== undefined) {
            genConfig.presence_penalty = presencePenalty;
        }
        
        if (stop && stop.length > 0) {
            genConfig.stop = stop;
        }
        
        if (n !== undefined) {
            genConfig.n = n;
        }
        
        // 添加 reasoning 配置（如果启用）
        const reasoningEnabled = (config as any).optionsEnabled?.reasoning;
        const reasoning = config.options?.reasoning;
        
        if (reasoningEnabled && reasoning) {
            const reasoningConfig: any = {};
            
            // 思考强度 (effort): none, low, medium, high, xhigh
            if (reasoning.effort && reasoning.effort !== 'none') {
                reasoningConfig.effort = reasoning.effort;
            }
            
            // 输出详细程度 (summary): auto, concise, detailed
            // 只有当 summaryEnabled 为 true 时才发送
            if (reasoning.summaryEnabled && reasoning.summary) {
                reasoningConfig.summary = reasoning.summary;
            }
            
            // 只有当有配置项时才添加 reasoning
            if (Object.keys(reasoningConfig).length > 0) {
                genConfig.reasoning = reasoningConfig;
            }
        }
        
        return genConfig;
    }
    
    /**
     * 解析 OpenAI API 响应
     *
     * 自动检测模式：
     * - 如果有 tool_calls，使用原生 function_call 模式
     * - 否则尝试从 content 中检测 XML/JSON 工具调用
     */
    parseResponse(response: any): GenerateResponse {
        // 验证响应格式
        if (!response || !response.choices || response.choices.length === 0) {
            throw new Error(t('modules.channel.formatters.openai.errors.invalidResponse'));
        }
        
        const choice = response.choices[0];
        const message = choice.message;
        
        // 构建 ContentPart 数组
        let parts: ContentPart[] = [];
        
        // 添加思考内容（如果存在）
        if (message.reasoning_content) {
            parts.push({
                text: message.reasoning_content,
                thought: true  // 标记为思考内容
            });
        }
        
        // 自动检测模式
        if (message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            // 有 tool_calls，使用原生 function_call 模式
            parts = this.parseResponseFunctionCallMode(message, parts);
        } else if (message.content) {
            // 没有 tool_calls，尝试从 content 中检测工具调用
            parts = this.parseResponseAutoDetect(message, parts);
        }
        
        // 构建完整的 Content
        const content: Content = {
            role: 'model',  // 统一使用 'model'
            parts,
            modelVersion: response.model  // 存储模型版本
        };
        
        // 存储完整的 usageMetadata（转换 OpenAI 格式到统一格式）
        if (response.usage) {
            const usage = response.usage;
            const completionTokens = usage.completion_tokens || 0;
            const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
            const candidatesTokenCount = completionTokens - reasoningTokens;
            
            content.usageMetadata = {
                promptTokenCount: usage.prompt_tokens,
                candidatesTokenCount: candidatesTokenCount > 0 ? candidatesTokenCount : undefined,
                totalTokenCount: usage.total_tokens,
                thoughtsTokenCount: reasoningTokens > 0 ? reasoningTokens : undefined
            };
        }
        
        // 提取结束原因
        const finishReason = choice.finish_reason;
        
        // 提取模型名称
        const model = response.model;
        
        return {
            content,
            finishReason,
            model,
            raw: response
        };
    }
    
    /**
     * Function Call 模式解析响应
     */
    private parseResponseFunctionCallMode(message: any, parts: ContentPart[]): ContentPart[] {
        // 添加主要内容
        if (message.content) {
            parts.push({ text: message.content });
        }
        
        // 处理 tool_calls（函数调用）
        if (message.tool_calls && Array.isArray(message.tool_calls)) {
            for (const toolCall of message.tool_calls) {
                if (toolCall.type === 'function') {
                    let args: Record<string, unknown> = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments || '{}');
                    } catch {
                        args = {};
                    }
                    parts.push({
                        functionCall: {
                            name: toolCall.function.name,
                            args,
                            id: toolCall.id  // 保存 tool_call_id
                        }
                    });
                }
            }
        }
        
        return parts;
    }
    
    /**
     * 自动检测模式解析响应
     *
     * 从 content 中尝试检测 JSON 边界标记或 XML 工具调用
     * 如果都没有，作为纯文本处理
     */
    private parseResponseAutoDetect(message: any, parts: ContentPart[]): ContentPart[] {
        if (!message.content) {
            return parts;
        }
        
        const contentText = message.content as string;
        
        // 检测 JSON 边界标记
        if (contentText.includes(TOOL_CALL_START)) {
            return this.extractJSONToolCallsFromContent(contentText, parts);
        }
        
        // 检测 XML 工具调用
        if (contentText.includes('<tool_use>')) {
            return this.extractXMLToolCallsFromContent(contentText, parts);
        }
        
        // 无工具调用，作为纯文本
        if (contentText.trim()) {
            parts.push({ text: contentText });
        }
        return parts;
    }
    
    /**
     * 从内容中提取 JSON 格式的工具调用
     *
     * 根据 <<<TOOL_CALL>>> 边界标记拆分内容
     * 返回 text + functionCall 交错的 parts 数组
     */
    private extractJSONToolCallsFromContent(content: string, existingParts: ContentPart[]): ContentPart[] {
        const parts = [...existingParts];
        
        // 使用边界标记拆分内容
        const segments = content.split(TOOL_CALL_START);
        
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            
            if (i === 0) {
                // 第一个段落是开始标记之前的文本
                const text = segment.trim();
                if (text) {
                    parts.push({ text });
                }
            } else {
                // 后续段落包含工具调用和可能的文本
                const endIndex = segment.indexOf(TOOL_CALL_END);
                
                if (endIndex !== -1) {
                    // 提取工具调用 JSON
                    const jsonStr = segment.substring(0, endIndex).trim();
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.tool && typeof parsed.tool === 'string') {
                            parts.push({
                                functionCall: {
                                    name: parsed.tool,
                                    args: parsed.parameters || {},
                                    id: `call_${Date.now()}_${i}`
                                }
                            });
                        }
                    } catch (error) {
                        // JSON 解析失败，作为普通文本
                        console.warn('Failed to parse JSON tool call:', error);
                        parts.push({ text: `${TOOL_CALL_START}${jsonStr}${TOOL_CALL_END}` });
                    }
                    
                    // 提取工具调用后的文本
                    const afterText = segment.substring(endIndex + TOOL_CALL_END.length).trim();
                    if (afterText) {
                        parts.push({ text: afterText });
                    }
                } else {
                    // 没有找到结束标记，可能是不完整的工具调用
                    parts.push({ text: `${TOOL_CALL_START}${segment}` });
                }
            }
        }
        
        return parts;
    }
    
    /**
     * 从内容中提取 XML 格式的工具调用
     *
     * 根据 <tool_use> 标签拆分内容
     * 返回 text + functionCall 交错的 parts 数组
     */
    private extractXMLToolCallsFromContent(content: string, existingParts: ContentPart[]): ContentPart[] {
        const parts = [...existingParts];
        
        // 使用正则匹配 <tool_use>...</tool_use> 块
        const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g;
        let lastIndex = 0;
        let match;
        
        while ((match = toolUseRegex.exec(content)) !== null) {
            // 添加工具调用之前的文本
            const beforeText = content.substring(lastIndex, match.index).trim();
            if (beforeText) {
                parts.push({ text: beforeText });
            }
            
            // 解析工具调用
            const toolCalls = parseXMLToolCalls(match[0]);
            for (const call of toolCalls) {
                parts.push({
                    functionCall: {
                        name: call.name,
                        args: call.args,
                        id: `call_${Date.now()}_${parts.length}`
                    }
                });
            }
            
            lastIndex = match.index + match[0].length;
        }
        
        // 添加最后一个工具调用之后的文本
        const afterText = content.substring(lastIndex).trim();
        if (afterText) {
            parts.push({ text: afterText });
        }
        
        // 如果没有找到任何工具调用，直接添加整个内容
        if (parts.length === existingParts.length && content.trim()) {
            parts.push({ text: content });
        }
        
        return parts;
    }
    
    /**
     * 解析流式响应块
     *
     * OpenAI 流式响应特点：
     * 1. 内容 chunk: choices[0] 有 delta.content/tool_calls，可能有 finish_reason
     * 2. usage chunk: choices 为空数组，但有 usage 数据（当请求中设置了 stream_options.include_usage）
     * 3. 结束标记: data: [DONE]（在 ChannelManager 中处理）
     */
    parseStreamChunk(chunk: any): StreamChunk {
        // OpenAI 流式响应格式
        const choice = chunk.choices?.[0];
        const parts: ContentPart[] = [];
        
        // 处理内容 chunk（有 choice）
        if (choice) {
            const delta = choice.delta;
            
            // 提取思考内容增量（如果存在）
            if (delta?.reasoning_content) {
                parts.push({
                    text: delta.reasoning_content,
                    thought: true  // 标记为思考内容
                });
            }
            
            // 提取普通内容增量
            if (delta?.content) {
                parts.push({ text: delta.content });
            }
            
            // 处理流式 tool_calls
            if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const toolCall of delta.tool_calls) {
                    if (toolCall.function) {
                        console.log('[OpenAI Stream] tool_call chunk:', JSON.stringify({
                            index: toolCall.index,
                            id: toolCall.id,
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments
                        }));
                        parts.push({
                            functionCall: {
                                name: toolCall.function.name || '',
                                args: {},
                                partialArgs: toolCall.function.arguments,
                                id: toolCall.id,
                                index: toolCall.index
                            } as any
                        });
                    }
                }
            }
        }
        
        // 检查是否完成
        // 1. 有 choice 且有 finish_reason
        // 2. 或者有 usage 数据（usage chunk）
        const hasFinishReason = !!choice?.finish_reason;
        const hasUsage = !!chunk.usage;
        const done = hasFinishReason || hasUsage;
        
        // 构建响应块
        const streamChunk: StreamChunk = {
            delta: parts,
            done
        };
        
        // 添加 token 统计信息（可能在 finish_reason chunk 或 usage chunk 中）
        if (hasUsage) {
            const usage = chunk.usage;
            const completionTokens = usage.completion_tokens || 0;
            const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
            const candidatesTokenCount = completionTokens - reasoningTokens;
            
            streamChunk.usage = {
                promptTokenCount: usage.prompt_tokens,
                candidatesTokenCount: candidatesTokenCount > 0 ? candidatesTokenCount : undefined,
                totalTokenCount: usage.total_tokens,
                thoughtsTokenCount: reasoningTokens > 0 ? reasoningTokens : undefined
            };
        }
        
        // 添加 finish_reason（可能在内容 chunk 中）
        if (hasFinishReason) {
            streamChunk.finishReason = choice.finish_reason;
        }
        
        // 添加模型版本
        if (chunk.model) {
            streamChunk.modelVersion = chunk.model;
        }
        
        return streamChunk;
    }
    
    /**
     * 验证配置（不验证 API Key）
     */
    validateConfig(config: any): boolean {
        if (config.type !== 'openai') {
            return false;
        }
        
        const openaiConfig = config as OpenAIConfig;
        
        // 检查必需字段（不验证 apiKey）
        if (!openaiConfig.url || !openaiConfig.model) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 获取支持的配置类型
     */
    getSupportedType(): string {
        return 'openai';
    }
    
    /**
     * 转换思考签名格式
     *
     * 将内部存储的 thoughtSignatures 移除或转换
     * OpenAI 目前不使用思考签名，所以直接移除
     *
     * 注意：这里做占位处理，未来如果 OpenAI API 支持签名，可以在这里添加
     * 类似于 GeminiFormatter.convertThoughtSignatures 的处理
     */
    private convertThoughtSignatures(history: Content[]): Content[] {
        return history.map(content => ({
            role: content.role,
            parts: content.parts.map(part => {
                // 移除 thoughtSignatures 字段
                // 未来如果 OpenAI 支持签名，可以像 Gemini 一样：
                // if (part.thoughtSignatures?.openai) {
                //     return { ...restPart, signature: thoughtSignatures.openai };
                // }
                if (part.thoughtSignatures) {
                    const { thoughtSignatures, ...restPart } = part;
                    return restPart;
                }
                return part;
            })
        }));
    }
    
    /**
     * 转换工具声明为 OpenAI 格式
     *
     * OpenAI 格式：
     * [{
     *   "type": "function",
     *   "function": {
     *     "name": "...",
     *     "description": "...",
     *     "parameters": {...}
     *   }
     * }]
     */
    convertTools(tools: ToolDeclaration[]): any {
        if (!tools || tools.length === 0) {
            return undefined;
        }
        
        // 转换为 OpenAI 格式
        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                strict: false  // OpenAI 的 strict 模式
            }
        }));
    }
}