/**
 * LimCode - Anthropic 格式转换器
 *
 * 将统一格式转换为 Anthropic Claude API 格式
 *
 * ## Anthropic API 特点
 *
 * 1. 认证：使用 x-api-key 头部
 * 2. 版本：需要 anthropic-version 头部
 * 3. 消息格式：content 是数组，每项有 type 字段
 * 4. 多模态：{"type": "image", "source": {"type": "base64", "media_type": "...", "data": "..."}}
 * 5. 工具调用：使用 tool_use 和 tool_result
 *
 * ## 工具调用处理流程
 *
 * ### Function Call 模式
 * - AI 返回 content 中包含 type: "tool_use"
 * - functionResponse 使用 type: "tool_result"
 *
 * ### XML/JSON 模式
 * - 与 OpenAI 类似，工具转换为提示词
 */

import { t } from '../../../i18n';
import { BaseFormatter } from './base';
import type { Content, ContentPart } from '../../conversation/types';
import type { AnthropicConfig } from '../../config/types';
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
    TOOL_CALL_START,
    TOOL_CALL_END
} from '../../../tools/jsonFormatter';
import { applyCustomBody } from '../../config/configs/base';
import type {
    GenerateRequest,
    GenerateResponse,
    StreamChunk,
    HttpRequestOptions
} from '../types';

/**
 * Anthropic 格式转换器
 *
 * 支持 Anthropic Claude API 的完整功能：
 * - 文本内容
 * - 多模态（图片）
 * - 工具调用（tool_use/tool_result）
 * - Token 统计
 * - 流式和非流式输出
 */
export class AnthropicFormatter extends BaseFormatter {
    /**
     * 构建 Anthropic API 请求
     */
    buildRequest(
        request: GenerateRequest,
        config: AnthropicConfig,
        tools?: ToolDeclaration[]
    ): HttpRequestOptions {
        const { history, dynamicContextMessages } = request;
        const toolMode = (config as any).toolMode || 'function_call';
        
        // 处理系统指令
        let systemInstruction = (config as any).systemInstruction || '';
        
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
        if (systemInstruction.includes('{{$TOOLS}}') || systemInstruction.includes('{{$MCP_TOOLS}}')) {
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
        
        // 转换思考签名格式
        let processedHistory = this.convertThoughtSignatures(history);
        
        // 插入动态上下文消息
        // 动态上下文包含时间、文件树、标签页等频繁变化的内容
        // 这些内容不存储到后端历史，仅在发送时临时插入到连续的最后一组用户主动发送消息之前
        if (dynamicContextMessages && dynamicContextMessages.length > 0) {
            // 在 processedHistory 中计算最后一组用户主动消息的第一条索引
            const insertIndex = this.findLastUserMessageGroupIndex(processedHistory);
            
            if (insertIndex >= 0) {
                processedHistory = [
                    ...processedHistory.slice(0, insertIndex),
                    ...dynamicContextMessages,
                    ...processedHistory.slice(insertIndex)
                ];
            } else {
                // 回退到追加到末尾的行为
                processedHistory = [...processedHistory, ...dynamicContextMessages];
            }
        }
        
        // 清理内部字段（如 isUserInput），这些字段不应该发送给 API
        processedHistory = this.cleanInternalFields(processedHistory);
        
        // 转换历史消息为 Anthropic 格式
        const messages = this.convertToAnthropicMessages(processedHistory, toolMode);
        
        // 构建请求体
        const body: any = {
            model: config.model,
            messages: messages
        };
        
        // 添加系统指令（Anthropic 使用独立的 system 字段）
        if (systemInstruction) {
            body.system = systemInstruction;
        }
        
        // 添加工具（Function Call 模式）
        if (tools && tools.length > 0 && toolMode === 'function_call') {
            body.tools = this.convertTools(tools);
        }
        
        // 添加生成配置
        const genConfig = this.buildGenerationConfig(config);
        Object.assign(body, genConfig);
        
        // 决定是否使用流式（始终发送 stream 字段）
        const useStream = (config.options as any)?.stream ?? (config as any).preferStream ?? false;
        body.stream = useStream;
        
        // 构建 URL
        const baseUrl = config.url.endsWith('/')
            ? config.url.slice(0, -1)
            : config.url;
        
        const url = `${baseUrl}/messages`;
        
        // 构建请求头
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
        };
        
        // 只有当 apiKey 存在时才添加认证头
        if (config.apiKey) {
            if ((config as any).useAuthorizationHeader) {
                // 使用 Authorization Bearer 格式
                headers['Authorization'] = `Bearer ${config.apiKey}`;
            } else {
                // 使用原生 x-api-key 格式
                headers['x-api-key'] = config.apiKey;
            }
        }
        
        // 应用自定义标头（如果启用）
        if ((config as any).customHeadersEnabled && (config as any).customHeaders) {
            for (const header of (config as any).customHeaders) {
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
            timeout: config.timeout,
            stream: useStream
        };
    }
    
    /**
     * 转换为 Anthropic 消息格式
     *
     * Anthropic 格式：
     * - role: "user" | "assistant"
     * - content: array of content blocks
     */
    private convertToAnthropicMessages(
        history: Content[],
        toolMode: string = 'function_call'
    ): any[] {
        const messages: any[] = [];
        
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
     * - functionCall 使用 type: "tool_use"
     * - functionResponse 使用 type: "tool_result"
     * - 思考内容使用 type: "thinking"，包含 thinking 和 signature 字段
     * - 加密思考使用 type: "redacted_thinking"，包含 data 字段
     */
    private convertHistoryFunctionCallMode(history: Content[], messages: any[]): void {
        for (const content of history) {
            const role = content.role === 'model' ? 'assistant' : content.role;
            
            // 分离各种类型的 parts
            const textParts = content.parts.filter(p => 'text' in p && !p.thought);
            const thoughtParts = content.parts.filter(p => 'text' in p && p.thought);
            const redactedThinkingParts = content.parts.filter(p => p.redactedThinking);
            const signatureParts = content.parts.filter(p => (p as any).signature);
            const functionCallParts = content.parts.filter(p => p.functionCall);
            const functionResponseParts = content.parts.filter(p => p.functionResponse);
            const mediaParts = content.parts.filter(p => p.inlineData || p.fileData);
            
            if (functionCallParts.length > 0) {
                // assistant 消息包含 tool_use
                const contentArray: any[] = [];
                
                // 添加思考内容（如果有）- 包括普通思考和加密思考
                this.addThinkingBlocks(contentArray, thoughtParts, redactedThinkingParts, signatureParts);
                
                // 添加文本内容
                for (const part of textParts) {
                    if (part.text) {
                        contentArray.push({
                            type: 'text',
                            text: part.text
                        });
                    }
                }
                
                // 添加 tool_use
                for (const part of functionCallParts) {
                    const fc = part.functionCall!;
                    contentArray.push({
                        type: 'tool_use',
                        id: fc.id || `toolu_${Date.now()}`,
                        name: fc.name,
                        input: fc.args
                    });
                }
                
                messages.push({
                    role: 'assistant',
                    content: contentArray
                });
            } else if (functionResponseParts.length > 0) {
                // user 消息包含 tool_result
                const contentArray: any[] = [];
                
                for (const part of functionResponseParts) {
                    const resp = part.functionResponse!;
                    contentArray.push({
                        type: 'tool_result',
                        tool_use_id: resp.id || `toolu_${Date.now()}`,
                        content: JSON.stringify(resp.response)
                    });
                }
                
                messages.push({
                    role: 'user',
                    content: contentArray
                });
            } else if (textParts.length > 0 || mediaParts.length > 0 || thoughtParts.length > 0 || redactedThinkingParts.length > 0) {
                // 普通消息（可能包含文本、多媒体和/或思考内容）
                const contentArray: any[] = [];
                
                // 添加思考内容（如果有）- 包括普通思考和加密思考
                this.addThinkingBlocks(contentArray, thoughtParts, redactedThinkingParts, signatureParts);
                
                // 添加普通内容
                contentArray.push(...this.buildMessageContent(textParts, mediaParts));
                
                messages.push({
                    role,
                    content: contentArray
                });
            }
        }
    }
    
    /**
     * 添加思考块到内容数组
     *
     * 处理三种类型的思考内容：
     * 1. 普通思考（thinking）
     * 2. 加密思考（redacted_thinking）
     * 3. 思考签名（signature）
     */
    private addThinkingBlocks(
        contentArray: any[],
        thoughtParts: ContentPart[],
        redactedThinkingParts: ContentPart[],
        signatureParts: ContentPart[]
    ): void {
        // 添加普通思考内容
        if (thoughtParts.length > 0) {
            const thinkingText = thoughtParts.map(p => p.text).join('\n');
            const thinkingBlock: any = {
                type: 'thinking',
                thinking: thinkingText
            };
            // 如果有签名，添加到思考块
            if (signatureParts.length > 0) {
                thinkingBlock.signature = (signatureParts[0] as any).signature;
            }
            contentArray.push(thinkingBlock);
        }
        
        // 添加加密思考内容
        for (const part of redactedThinkingParts) {
            if (part.redactedThinking) {
                contentArray.push({
                    type: 'redacted_thinking',
                    data: part.redactedThinking
                });
            }
        }
    }
    
    /**
     * 构建消息内容（支持多模态）
     *
     * Anthropic 格式：
     * - 文本：{type: "text", text: "..."}
     * - 图片：{type: "image", source: {type: "base64", media_type: "...", data: "..."}}
     */
    private buildMessageContent(textParts: ContentPart[], mediaParts: ContentPart[]): any[] {
        const contentArray: any[] = [];
        
        // 添加多媒体部分（图片通常放在文本前面）
        for (const part of mediaParts) {
            if (part.inlineData) {
                // Base64 内联数据
                contentArray.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: part.inlineData.mimeType,
                        data: part.inlineData.data
                    }
                });
            } else if (part.fileData) {
                // 文件引用 -> URL 格式
                contentArray.push({
                    type: 'image',
                    source: {
                        type: 'url',
                        url: part.fileData.fileUri
                    }
                });
            }
        }
        
        // 添加文本部分
        for (const part of textParts) {
            if (part.text) {
                contentArray.push({
                    type: 'text',
                    text: part.text
                });
            }
        }
        
        return contentArray;
    }
    
    /**
     * XML/JSON 模式转换
     *
     * - functionCall 转回文本
     * - functionResponse 作为 user 消息发送
     */
    private convertHistoryTextMode(history: Content[], messages: any[], mode: 'xml' | 'json'): void {
        for (const content of history) {
            const role = content.role === 'model' ? 'assistant' : content.role;
            
            // 分离各种类型的 parts
            const functionResponseParts = content.parts.filter(p => p.functionResponse);
            const mediaParts = content.parts.filter(p => p.inlineData || p.fileData);
            
            if (functionResponseParts.length > 0) {
                // functionResponse 作为 user 消息发送
                const contentArray: any[] = [];
                
                for (const part of functionResponseParts) {
                    const resp = part.functionResponse!;
                    const responseText = mode === 'xml'
                        ? convertFunctionResponseToXML(resp.name, resp.response)
                        : convertFunctionResponseToJSON(resp.name, resp.response);
                    
                    contentArray.push({
                        type: 'text',
                        text: responseText
                    });
                }
                
                messages.push({
                    role: 'user',
                    content: contentArray
                });
            } else {
                // 将 functionCall 转回文本，与 text 合并
                const textParts: ContentPart[] = [];
                
                for (const part of content.parts) {
                    if (part.thought) {
                        continue;
                    }
                    
                    if (part.inlineData || part.fileData) {
                        continue;
                    }
                    
                    if (part.functionCall) {
                        const callText = mode === 'xml'
                            ? convertFunctionCallToXML(part.functionCall.name, part.functionCall.args)
                            : convertFunctionCallToJSON(part.functionCall.name, part.functionCall.args);
                        textParts.push({ text: callText });
                    } else if ('text' in part && part.text) {
                        textParts.push({ text: part.text });
                    }
                }
                
                if (textParts.length > 0 || mediaParts.length > 0) {
                    const contentArray = this.buildMessageContent(textParts, mediaParts);
                    messages.push({
                        role,
                        content: contentArray
                    });
                }
            }
        }
    }
    
    /**
     * 构建生成配置
     */
    private buildGenerationConfig(config: AnthropicConfig): any {
        const genConfig: any = {};
        const optionsEnabled = (config as any).optionsEnabled || {};
        
        // max_tokens: 仅在启用时发送
        if (optionsEnabled.max_tokens && config.options?.max_tokens !== undefined) {
            genConfig.max_tokens = config.options.max_tokens;
        }
        
        if (optionsEnabled.temperature && config.options?.temperature !== undefined) {
            genConfig.temperature = config.options.temperature;
        }
        
        if (optionsEnabled.top_p && config.options?.top_p !== undefined) {
            genConfig.top_p = config.options.top_p;
        }
        
        if (optionsEnabled.top_k && config.options?.top_k !== undefined) {
            genConfig.top_k = config.options.top_k;
        }
        
        if (config.options?.stop_sequences && config.options.stop_sequences.length > 0) {
            genConfig.stop_sequences = config.options.stop_sequences;
        }
        
        // 添加 thinking 配置（如果启用）
        const thinkingEnabled = optionsEnabled.thinking;
        const thinking = config.options?.thinking;
        
        if (thinkingEnabled && thinking) {
            const thinkingType = thinking.type || 'enabled';
            
            if (thinkingType === 'adaptive') {
                // 自适应思考模式（Opus 4.6+）
                genConfig.thinking = {
                    type: 'adaptive'
                };
                
                // effort 通过 output_config 发送
                if (thinking.effort) {
                    genConfig.output_config = {
                        effort: thinking.effort
                    };
                }
            } else if (thinkingType === 'enabled') {
                // 传统手动思考模式
                const thinkingConfig: any = {
                    type: 'enabled'
                };
                
                // 思考预算（budget_tokens）
                if (thinking.budget_tokens && thinking.budget_tokens > 0) {
                    thinkingConfig.budget_tokens = thinking.budget_tokens;
                } else {
                    // 默认预算
                    thinkingConfig.budget_tokens = 10000;
                }
                
                genConfig.thinking = thinkingConfig;
            }
        }
        
        return genConfig;
    }
    
    /**
     * 解析 Anthropic API 响应
     *
     * Anthropic 思考内容格式：
     * {
     *   "content": [
     *     {
     *       "type": "thinking",
     *       "thinking": "思考过程...",
     *       "signature": "Base64签名..."
     *     },
     *     {
     *       "type": "text",
     *       "text": "最终回答..."
     *     }
     *   ]
     * }
     */
    parseResponse(response: any): GenerateResponse {
        // 验证响应格式
        if (!response || !response.content) {
            throw new Error(t('modules.channel.formatters.anthropic.errors.invalidResponse'));
        }
        
        // 构建 ContentPart 数组
        let parts: ContentPart[] = [];
        
        // 解析 content 数组
        for (const block of response.content) {
            if (block.type === 'thinking') {
                // 思考内容块
                // 1. 存储思考文本（带 thought: true 标记）
                if (block.thinking) {
                    parts.push({
                        text: block.thinking,
                        thought: true
                    });
                }
                // 2. 存储思考签名（使用多格式存储）
                if (block.signature) {
                    parts.push({
                        thoughtSignatures: {
                            anthropic: block.signature
                        }
                    });
                }
            } else if (block.type === 'redacted_thinking') {
                // 加密思考内容块
                // 存储加密的思考数据，需要在后续对话中原样返回
                if (block.data) {
                    parts.push({
                        redactedThinking: block.data
                    });
                }
            } else if (block.type === 'text') {
                parts.push({ text: block.text });
            } else if (block.type === 'tool_use') {
                parts.push({
                    functionCall: {
                        name: block.name,
                        args: block.input || {},
                        id: block.id
                    }
                });
            }
        }
        
        // 如果没有原生工具调用，尝试从文本中检测
        const hasToolUse = response.content.some((b: any) => b.type === 'tool_use');
        if (!hasToolUse) {
            const textContent = parts
                .filter(p => 'text' in p && !p.thought)
                .map(p => p.text)
                .join('\n');
            
            if (textContent) {
                // 保留思考内容和签名，只对普通文本进行工具调用检测
                        const thoughtParts = parts.filter(p => p.thought || p.thoughtSignatures);
                const detectedParts = this.parseResponseAutoDetect(textContent);
                parts = [...thoughtParts, ...detectedParts];
            }
        }
        
        // 构建完整的 Content
        const content: Content = {
            role: 'model',
            parts,
            modelVersion: response.model
        };
        
        // 存储 usageMetadata
        if (response.usage) {
            content.usageMetadata = {
                promptTokenCount: response.usage.input_tokens,
                candidatesTokenCount: response.usage.output_tokens,
                totalTokenCount: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
            };
        }
        
        // 提取结束原因
        const finishReason = response.stop_reason;
        
        return {
            content,
            finishReason,
            model: response.model,
            raw: response
        };
    }
    
    /**
     * 自动检测模式解析响应
     */
    private parseResponseAutoDetect(contentText: string): ContentPart[] {
        const parts: ContentPart[] = [];
        
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
     */
    private extractJSONToolCallsFromContent(content: string, existingParts: ContentPart[]): ContentPart[] {
        const parts = [...existingParts];
        const segments = content.split(TOOL_CALL_START);
        
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            
            if (i === 0) {
                const text = segment.trim();
                if (text) {
                    parts.push({ text });
                }
            } else {
                const endIndex = segment.indexOf(TOOL_CALL_END);
                
                if (endIndex !== -1) {
                    const jsonStr = segment.substring(0, endIndex).trim();
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.tool && typeof parsed.tool === 'string') {
                            parts.push({
                                functionCall: {
                                    name: parsed.tool,
                                    args: parsed.parameters || {},
                                    id: `toolu_${Date.now()}_${i}`
                                }
                            });
                        }
                    } catch (error) {
                        console.warn('Failed to parse JSON tool call:', error);
                        parts.push({ text: `${TOOL_CALL_START}${jsonStr}${TOOL_CALL_END}` });
                    }
                    
                    const afterText = segment.substring(endIndex + TOOL_CALL_END.length).trim();
                    if (afterText) {
                        parts.push({ text: afterText });
                    }
                } else {
                    parts.push({ text: `${TOOL_CALL_START}${segment}` });
                }
            }
        }
        
        return parts;
    }
    
    /**
     * 从内容中提取 XML 格式的工具调用
     */
    private extractXMLToolCallsFromContent(content: string, existingParts: ContentPart[]): ContentPart[] {
        const parts = [...existingParts];
        const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g;
        let lastIndex = 0;
        let match;
        
        while ((match = toolUseRegex.exec(content)) !== null) {
            const beforeText = content.substring(lastIndex, match.index).trim();
            if (beforeText) {
                parts.push({ text: beforeText });
            }
            
            const toolCalls = parseXMLToolCalls(match[0]);
            for (const call of toolCalls) {
                parts.push({
                    functionCall: {
                        name: call.name,
                        args: call.args,
                        id: `toolu_${Date.now()}_${parts.length}`
                    }
                });
            }
            
            lastIndex = match.index + match[0].length;
        }
        
        const afterText = content.substring(lastIndex).trim();
        if (afterText) {
            parts.push({ text: afterText });
        }
        
        if (parts.length === existingParts.length && content.trim()) {
            parts.push({ text: content });
        }
        
        return parts;
    }
    
    /**
     * 解析流式响应块
     *
     * Anthropic 流式格式使用 SSE，事件类型：
     * - message_start: 消息开始
     * - content_block_start: 内容块开始
     * - content_block_delta: 内容增量
     * - content_block_stop: 内容块结束
     * - message_delta: 消息增量（包含 stop_reason）
     * - message_stop: 消息结束
     *
     * 思考内容流式格式：
     * - content_block_start: { type: "thinking" }
     * - content_block_delta: { type: "thinking_delta", thinking: "..." }
     * - content_block_delta: { type: "signature_delta", signature: "..." }
     */
    parseStreamChunk(chunk: any): StreamChunk {
        const parts: ContentPart[] = [];
        let done = false;
        let usage: any;
        let finishReason: string | undefined;
        
        // 处理不同的事件类型
        if (chunk.type === 'content_block_delta') {
            const delta = chunk.delta;
            
            if (delta?.type === 'text_delta') {
                parts.push({ text: delta.text });
            } else if (delta?.type === 'thinking_delta') {
                // 思考内容增量
                parts.push({
                    text: delta.thinking,
                    thought: true
                });
            } else if (delta?.type === 'signature_delta') {
                // 思考签名增量（使用多格式存储）
                parts.push({
                    thoughtSignatures: {
                        anthropic: delta.signature
                    }
                });
            } else if (delta?.type === 'redacted_thinking_delta') {
                // 加密思考内容增量
                parts.push({
                    redactedThinking: delta.data
                });
            } else if (delta?.type === 'input_json_delta') {
                // 工具调用参数增量
                if (delta.partial_json !== undefined) {
                    parts.push({
                        functionCall: {
                            name: '', // 名称在 block_start 中提供，这里留空供累加器合并
                            args: {},
                            partialArgs: delta.partial_json
                        }
                    });
                }
            }
        } else if (chunk.type === 'content_block_start') {
            const block = chunk.content_block;
            
            if (block?.type === 'text') {
                // 文本块开始
                if (block.text) {
                    parts.push({ text: block.text });
                }
            } else if (block?.type === 'thinking') {
                // 思考块开始，可能包含初始内容
                if (block.thinking) {
                    parts.push({
                        text: block.thinking,
                        thought: true
                    });
                }
            } else if (block?.type === 'redacted_thinking') {
                // 加密思考块开始，可能包含初始数据
                if (block.data) {
                    parts.push({
                        redactedThinking: block.data
                    });
                }
            } else if (block?.type === 'tool_use') {
                const args = block.input || {};
                parts.push({
                    functionCall: {
                        name: block.name,
                        args: args,
                        partialArgs: Object.keys(args).length > 0 ? JSON.stringify(args) : '',
                        id: block.id
                    }
                });
            }
        } else if (chunk.type === 'message_delta') {
            finishReason = chunk.delta?.stop_reason;
            
            if (chunk.usage) {
                usage = {
                    candidatesTokenCount: chunk.usage.output_tokens
                };
            }
        } else if (chunk.type === 'message_stop') {
            done = true;
        } else if (chunk.type === 'message_start') {
            // 消息开始，可能包含 usage 信息
            if (chunk.message?.usage) {
                usage = {
                    promptTokenCount: chunk.message.usage.input_tokens
                };
            }
        }
        
        const streamChunk: StreamChunk = {
            delta: parts,
            done
        };
        
        if (finishReason) {
            streamChunk.finishReason = finishReason;
        }
        
        if (usage) {
            streamChunk.usage = usage;
        }
        
        return streamChunk;
    }
    
    /**
     * 验证配置（不验证 API Key）
     */
    validateConfig(config: any): boolean {
        if (config.type !== 'anthropic') {
            return false;
        }
        
        const anthropicConfig = config as AnthropicConfig;
        
        // 检查必需字段（不验证 apiKey）
        if (!anthropicConfig.url || !anthropicConfig.model) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 获取支持的配置类型
     */
    getSupportedType(): string {
        return 'anthropic';
    }
    
    /**
     * 转换思考签名格式
     *
     * 将内部存储的 thoughtSignatures: { anthropic: "..." } 格式
     * 转换为 Anthropic API 需要的 signature 字段格式
     *
     * Anthropic 思考签名格式（发送时）：
     * content: [
     *   { type: "thinking", thinking: "...", signature: "..." }
     * ]
     *
     * 由于我们在 convertToAnthropicMessages 中处理内容，
     * 这里需要处理 parts 中的 thoughtSignatures
     */
    private convertThoughtSignatures(history: Content[]): Content[] {
        return history.map(content => {
            const result: Content = {
                role: content.role,
                parts: content.parts.map(part => {
                    // 如果有 thoughtSignatures，提取 anthropic 格式的签名
                    if (part.thoughtSignatures?.anthropic) {
                        const { thoughtSignatures, ...restPart } = part;
                        return {
                            ...restPart,
                            // 使用 signature 字段存储，在后续处理中会转换为正确格式
                            signature: thoughtSignatures.anthropic
                        } as ContentPart;
                    }
                    // 如果有 thoughtSignatures 但没有 anthropic 格式，移除
                    if (part.thoughtSignatures) {
                        const { thoughtSignatures, ...restPart } = part;
                        return restPart;
                    }
                    return part;
                })
            };
            // 保留 isUserInput 标记
            if (content.isUserInput) {
                result.isUserInput = true;
            }
            return result;
        });
    }
    
    /**
     * 转换工具声明为 Anthropic 格式
     *
     * Anthropic 格式：
     * [{
     *   "name": "...",
     *   "description": "...",
     *   "input_schema": {...}  // JSON Schema
     * }]
     */
    convertTools(tools: ToolDeclaration[]): any {
        if (!tools || tools.length === 0) {
            return undefined;
        }
        
        return tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
        }));
    }
}