/**
 * LimCode - OpenAI Responses 格式转换器
 *
 * 将统一格式转换为 OpenAI Responses API 格式
 * 详情参考: https://api.openai.com/v1/responses
 */

import { t } from '../../../i18n';
import { BaseFormatter } from './base';
import type { Content, ContentPart } from '../../conversation/types';
import type { OpenAIResponsesConfig } from '../../config/types';
import type { ToolDeclaration } from '../../../tools/types';
import { applyCustomBody } from '../../config/configs/base';
import type {
    GenerateRequest,
    GenerateResponse,
    StreamChunk,
    HttpRequestOptions
} from '../types';

/**
 * OpenAI Responses 格式转换器
 * 
 * 使用全新的 Responses API，支持更丰富的内容类型和流式处理方式。
 */
export class OpenAIResponsesFormatter extends BaseFormatter {
    /**
     * 构建 OpenAI Responses API 请求
     */
    buildRequest(
        request: GenerateRequest,
        config: OpenAIResponsesConfig,
        tools?: ToolDeclaration[]
    ): HttpRequestOptions {
        const { history } = request;
        
        // 准备系统指令 (instructions)
        let instructions = config.systemInstruction;
        
        // 追加动态系统提示词
        if (request.dynamicSystemPrompt) {
            instructions = instructions
                ? `${instructions}\n\n${request.dynamicSystemPrompt}`
                : request.dynamicSystemPrompt;
        }

        // 转换历史消息为 OpenAI Responses input 格式
        const input = this.convertToResponsesInput(history);

        // 构建请求体
        const body: any = {
            model: config.model,
            instructions: instructions || undefined,
            input: input,
            include: ["reasoning.encrypted_content"] // 始终包含加密思考内容
        };

        // 添加工具
        if (tools && tools.length > 0) {
            body.tools = this.convertTools(tools);
        }

        // 添加生成配置
        const genConfig = this.buildGenerationConfig(config);
        Object.assign(body, genConfig);

        // 决定是否使用流式
        const useStream = config.options?.stream ?? config.preferStream ?? false;
        
        // 始终将 stream 添加到请求体
        body.stream = useStream;

        // 构建 URL
        const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
        const url = baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`;

        // 构建请求头
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        
        if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        // 应用自定义标头
        if (config.customHeadersEnabled && config.customHeaders) {
            for (const header of config.customHeaders) {
                if (header.enabled && header.key && header.key.trim()) {
                    headers[header.key.trim()] = header.value || '';
                }
            }
        }
        
        // 应用自定义 body
        const finalBody = applyCustomBody(body, config.customBody, config.customBodyEnabled);

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
     * 将历史记录转换为 Responses API 的 input 格式
     * 
     * 支持：
     * - role: user/assistant
     * - content: input_text, input_image, input_file
     * - function_call_output 类型项
     */
    private convertToResponsesInput(history: Content[]): any[] {
        const input: any[] = [];
        
        for (const content of history) {
            const role = content.role === 'model' ? 'assistant' : content.role;
            
            // 缓存当前正在构建的 message 类型项的内容
            let messageParts: any[] = [];
            
            // 辅助函数：将积攒的文本/图片内容作为一个 message 项提交
            const flushMessage = () => {
                if (messageParts.length > 0) {
                    input.push({
                        role,
                        content: messageParts
                    });
                    messageParts = [];
                }
            };
            
            for (const part of content.parts) {
                // 1. 处理推理项 (OpenAI Reasoning Item - 包含签名和可能的摘要)
                if (part.thoughtSignatures?.['openai-responses']) {
                    flushMessage();
                    const reasoningItem: any = {
                        type: 'reasoning',
                        encrypted_content: part.thoughtSignatures['openai-responses'],
                        summary: [] // 必须提供 summary 字段，即使为空，否则 API 会报错
                    };

                    // 如果该 Part 包含摘要文本，则添加到 summary 字段
                    if ('text' in part && part.text) {
                        reasoningItem.summary = [
                            {
                                type: 'summary_text',
                                text: part.text
                            }
                        ];
                    }

                    input.push(reasoningItem);
                    continue;
                }

                // 2. 处理加密思考内容 (Anthropic/Redacted)
                if (part.redactedThinking) {
                    flushMessage();
                    input.push({
                        type: 'redacted_thinking',
                        data: part.redactedThinking
                    });
                    continue;
                }

                // 3. 过滤掉不含签名的思考分段
                // OpenAI Responses 必须有签名才能回传推理项
                if (part.thought) {
                    continue;
                }

                // 4. 处理函数调用 (Function Call Item)
                if (part.functionCall) {
                    flushMessage();
                    input.push({
                        type: 'function_call',
                        name: part.functionCall.name,
                        call_id: part.functionCall.id,
                        arguments: typeof part.functionCall.args === 'string'
                            ? part.functionCall.args
                            : JSON.stringify(part.functionCall.args)
                    });
                    continue;
                }

                // 5. 处理函数响应 (Function Call Output Item)
                if (part.functionResponse) {
                    flushMessage();
                    input.push({
                        type: 'function_call_output',
                        call_id: part.functionResponse.id,
                        output: typeof part.functionResponse.response === 'string'
                            ? part.functionResponse.response
                            : JSON.stringify(part.functionResponse.response)
                    });
                    
                    // 如果工具返回了多模态内容（如图片），这些需要作为紧随其后的新 message 项
                    if (part.functionResponse.parts && part.functionResponse.parts.length > 0) {
                        const toolContentParts = part.functionResponse.parts
                            .map(p => {
                                if (p.inlineData) {
                                    return {
                                        type: 'input_image',
                                        image_url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
                                    };
                                }
                                return null;
                            })
                            .filter(p => p !== null);
                        
                        if (toolContentParts.length > 0) {
                            input.push({
                                role: 'user', // 工具返回的内容被视为用户输入
                                content: toolContentParts
                            });
                        }
                    }
                    continue;
                }

                // 6. 处理普通消息内容 (积攒到 messageParts)
                if ('text' in part && part.text) {
                    messageParts.push({
                        type: role === 'assistant' ? 'output_text' : 'input_text',
                        text: part.text
                    });
                } else if (part.inlineData) {
                    messageParts.push({
                        type: 'input_image',
                        image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                    });
                } else if (part.fileData) {
                    messageParts.push({
                        type: 'input_file',
                        file_url: part.fileData.fileUri
                    });
                }
            }

            // 提交剩余积攒的消息内容
            flushMessage();
        }
        
        return input;
    }

    /**
     * 解析 OpenAI Responses API 响应 (非流式)
     */
    parseResponse(response: any): GenerateResponse {
        if (!response || !response.output || !Array.isArray(response.output)) {
            throw new Error(t('modules.channel.formatters.openai.errors.invalidResponse'));
        }

        const parts: ContentPart[] = [];
        
        // 遍历 output 数组
        for (const item of response.output) {
            if (item.type === 'message') {
                // 处理消息内容
                if (item.content && Array.isArray(item.content)) {
                    for (const contentPart of item.content) {
                        if (contentPart.type === 'output_text') {
                            parts.push({
                                text: contentPart.text
                            });
                        }
                    }
                }
            } else if (item.type === 'reasoning') {
                // 处理思考内容
                const reasoningPart: ContentPart = {
                    thought: true
                };

                // 提取摘要文本
                if (item.summary && Array.isArray(item.summary)) {
                    const summaryText = item.summary
                        .filter((s: any) => s.type === 'summary_text')
                        .map((s: any) => s.text)
                        .join('\n');
                    if (summaryText) {
                        reasoningPart.text = summaryText;
                    }
                } else if (item.content || item.text) {
                    reasoningPart.text = item.content || item.text;
                }

                // 提取思考签名 (Encrypted Content)
                if (item.encrypted_content) {
                    reasoningPart.thoughtSignatures = {
                        'openai-responses': item.encrypted_content
                    };
                }

                if (reasoningPart.text || reasoningPart.thoughtSignatures) {
                    parts.push(reasoningPart);
                }
            } else if (item.type === 'redacted_thinking') {
                // 处理加密思考内容
                if (item.data) {
                    parts.push({
                        redactedThinking: item.data
                    });
                }
            } else if (item.type === 'function_call') {
                // 处理函数调用
                let args: Record<string, unknown> = {};
                try {
                    args = JSON.parse(item.arguments || '{}');
                } catch {
                    args = {};
                }
                parts.push({
                    functionCall: {
                        name: item.name,
                        args,
                        id: item.call_id
                    }
                });
            }
        }

        const content: Content = {
            role: 'model',
            parts,
            modelVersion: response.model
        };

        // 处理 Usage 统计
        if (response.usage) {
            const usage = response.usage;
            content.usageMetadata = {
                promptTokenCount: usage.input_tokens,
                candidatesTokenCount: usage.output_tokens,
                totalTokenCount: usage.total_tokens,
                thoughtsTokenCount: usage.output_tokens_details?.reasoning_tokens
            };
        }

        return {
            content,
            finishReason: response.status,
            model: response.model,
            raw: response
        };
    }

    /**
     * 解析流式响应块
     * 
     * Responses API 使用 SSE 发送事件，每个 chunk 是一个完整的 JSON 事件
     */
    parseStreamChunk(chunk: any): StreamChunk {
        const parts: ContentPart[] = [];
        let done = false;
        let usage: any;
        let finishReason: string | undefined;

        // 根据事件类型处理
        switch (chunk.type) {
            case 'response.output_item.added':
                // 当函数调用或思考项被添加时
                if (chunk.item?.type === 'function_call') {
                    parts.push({
                        functionCall: {
                            name: chunk.item.name,
                            args: {},
                            partialArgs: '',
                            id: chunk.item.call_id,
                            index: chunk.output_index
                        } as any
                    });
                } else if (chunk.item?.type === 'reasoning') {
                    // 推理项被添加时，提取签名 (Encrypted Content)
                    if (chunk.item.encrypted_content) {
                        parts.push({
                            thought: true,
                            thoughtSignatures: {
                                'openai-responses': chunk.item.encrypted_content
                            }
                        });
                    }
                }
                break;
            
            case 'response.output_item.done':
                // 当项完成时，再次尝试提取签名（可能在 added 时没有而在 done 时有）
                if (chunk.item?.type === 'reasoning' && chunk.item.encrypted_content) {
                    parts.push({
                        thought: true,
                        thoughtSignatures: {
                            'openai-responses': chunk.item.encrypted_content
                        }
                    });
                }
                break;
            
            case 'response.output_text.delta':
            case 'response.text.delta': // 兼容旧版本
                // 文本增量
                parts.push({
                    text: chunk.delta
                });
                break;
            
            case 'response.reasoning_text.delta':
            case 'response.reasoning_summary_text.delta':
            case 'response.reasoning.delta': // 兼容旧版本
                // 思考内容增量
                parts.push({
                    text: chunk.delta,
                    thought: true
                });
                break;
            
            case 'response.function_call_arguments.delta':
                // 函数参数增量
                parts.push({
                    functionCall: {
                        partialArgs: chunk.delta,
                        index: chunk.output_index
                    } as any
                });
                break;

            case 'response.function_call_arguments.done':
                // 函数调用完成
                parts.push({
                    functionCall: {
                        name: chunk.name,
                        args: {}, // arguments 将在 done 之后由 StreamAccumulator 解析
                        partialArgs: chunk.arguments,
                        id: chunk.item_id,
                        index: chunk.output_index
                    } as any
                });
                break;
            
            case 'response.completed':
            case 'response.done': // 兼容旧版本
                // 响应完成
                done = true;
                if (chunk.response?.usage) {
                    const u = chunk.response.usage;
                    usage = {
                        promptTokenCount: u.input_tokens,
                        candidatesTokenCount: u.output_tokens,
                        totalTokenCount: u.total_tokens,
                        thoughtsTokenCount: u.output_tokens_details?.reasoning_tokens
                    };
                }
                
                finishReason = chunk.response?.status;
                break;
            
            case 'response.failed':
                // 响应失败
                throw new Error(chunk.response?.error?.message || 'Response failed');
            
            case 'response.incomplete':
                // 响应不完整
                done = true;
                finishReason = chunk.response?.incomplete_details?.reason || 'incomplete';
                break;
                
            case 'error':
                // 处理流中的错误
                throw new Error(chunk.error?.message || 'Unknown stream error');
        }

        return {
            delta: parts,
            done,
            usage,
            finishReason,
            modelVersion: chunk.response?.model
        };
    }

    /**
     * 构建生成配置
     */
    private buildGenerationConfig(config: OpenAIResponsesConfig): any {
        const genConfig: any = {};
        const optionsEnabled = config.optionsEnabled || {};
        const options = config.options || {};

        if (optionsEnabled.temperature && options.temperature !== undefined) {
            genConfig.temperature = options.temperature;
        }
        
        if (optionsEnabled.max_output_tokens && options.max_output_tokens !== undefined) {
            genConfig.max_output_tokens = options.max_output_tokens;
        }
        
        if (optionsEnabled.top_p && options.top_p !== undefined) {
            genConfig.top_p = options.top_p;
        }

        if (options.truncation) {
            genConfig.truncation = options.truncation;
        }

        // 处理推理配置
        if (optionsEnabled.reasoning && options.reasoning) {
            const reasoning: any = {};
            if (options.reasoning.effort && options.reasoning.effort !== 'none') {
                reasoning.effort = options.reasoning.effort;
            }
            
            // 处理输出详细程度 (Summary)
            if (options.reasoning.summaryEnabled && options.reasoning.summary) {
                reasoning.summary = options.reasoning.summary;
            }

            if (Object.keys(reasoning).length > 0) {
                genConfig.reasoning = reasoning;
            }
        }

        return genConfig;
    }

    /**
     * 转换工具声明
     */
    convertTools(tools: ToolDeclaration[]): any {
        if (!tools || tools.length === 0) {
            return undefined;
        }
        
        return tools.map(tool => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }));
    }

    /**
     * 验证配置
     */
    validateConfig(config: any): boolean {
        if (config.type !== 'openai-responses') {
            return false;
        }
        
        const c = config as OpenAIResponsesConfig;
        return !!c.url && !!c.model;
    }

    /**
     * 获取支持的类型
     */
    getSupportedType(): string {
        return 'openai-responses';
    }
}
