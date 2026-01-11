/**
 * LimCode - Gemini 格式转换器
 *
 * 将统一格式转换为 Gemini API 格式
 */

import { t } from '../../../i18n';
import { BaseFormatter } from './base';
import type { Content, ContentPart } from '../../conversation/types';
import type { GeminiConfig } from '../../config/types';
import type { ToolDeclaration } from '../../../tools/types';
import { convertToolsToXML, convertFunctionCallToXML, convertFunctionResponseToXML } from '../../../tools/xmlFormatter';
import { convertToolsToJSON, convertFunctionCallToJSON, convertFunctionResponseToJSON } from '../../../tools/jsonFormatter';
import { applyCustomBody } from '../../config/configs/base';
import type {
    GenerateRequest,
    GenerateResponse,
    StreamChunk,
    HttpRequestOptions
} from '../types';
import { ChannelError, ErrorType } from '../types';

/**
 * Gemini 格式转换器
 * 
 * 支持 Google Gemini API 的完整功能：
 * - 文本、图片、音频、视频、文档
 * - 函数调用和函数响应
 * - 思考签名和思考内容
 * - 流式和非流式输出
 */
export class GeminiFormatter extends BaseFormatter {
    /**
     * 构建 Gemini API 请求
     */
    buildRequest(
        request: GenerateRequest,
        config: GeminiConfig,
        tools?: ToolDeclaration[]
    ): HttpRequestOptions {
        const { history, dynamicContextMessages } = request;
        const toolMode = config.toolMode || 'function_call';
        
        // 根据模式处理历史记录
        let processedHistory: Content[];
        if (toolMode === 'xml') {
            // XML 模式：将 functionCall 和 functionResponse 转换为 XML 文本
            processedHistory = this.convertHistoryToXMLMode(history);
        } else if (toolMode === 'json') {
            // JSON 模式：将 functionCall 和 functionResponse 转换为 JSON 代码块
            processedHistory = this.convertHistoryToJSONMode(history);
        } else {
            // Function Call 模式：清理 Gemini API 不支持的字段（如 functionResponse.id）
            processedHistory = this.cleanHistoryForGeminiAPI(history);
        }
        
        // 转换思考签名格式：将 thoughtSignatures.gemini 转换为 thoughtSignature
        processedHistory = this.convertThoughtSignatures(processedHistory);
        
        // 插入动态上下文消息（直接追加到历史末尾）
        // 动态上下文包含时间、文件树、标签页等频繁变化的内容
        // 这些内容不存储到后端历史，仅在发送时临时插入
        if (dynamicContextMessages && dynamicContextMessages.length > 0) {
            processedHistory = [...processedHistory, ...dynamicContextMessages];
        }
        
        // 构建请求体
        const body: any = {
            contents: processedHistory,
            generationConfig: this.buildGenerationConfig(config)
        };
        
        // 处理工具
        let systemInstruction = config.systemInstruction || '';
        
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
            if (toolMode === 'function_call') {
                // Function Call 模式：工具作为独立字段，不添加到系统提示词
                body.tools = this.convertTools(tools);
            } else if (toolMode === 'xml') {
                // XML 模式：工具转换为 XML
                toolsContent = convertToolsToXML(tools);
            } else if (toolMode === 'json') {
                // JSON 模式：工具转换为 JSON
                toolsContent = convertToolsToJSON(tools);
            }
        }
        
        // MCP 工具由外部传入，这里只处理占位符
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
        
        // 添加系统指令
        if (systemInstruction) {
            body.systemInstruction = {
                parts: [{ text: systemInstruction }]
            };
        }
        
        // 决定是否使用流式（完全由配置决定）
        const useStream = config.options?.stream ?? config.preferStream ?? false;
        
        // 构建 URL
        const baseUrl = config.url.endsWith('/')
            ? config.url.slice(0, -1)
            : config.url;
        
        const method = useStream
            ? 'streamGenerateContent'
            : 'generateContent';
        
        // 流式请求需要添加 ?alt=sse 参数以获取 SSE 格式响应
        const queryParams = useStream ? '?alt=sse' : '';
        const url = `${baseUrl}/models/${config.model}:${method}${queryParams}`;
        
        // 构建请求头
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        
        // 只有当 apiKey 存在时才添加认证头
        if (config.apiKey) {
            if (config.useAuthorizationHeader) {
                // 使用 Authorization Bearer 格式
                headers['Authorization'] = `Bearer ${config.apiKey}`;
            } else {
                // 使用原生 x-goog-api-key 格式
                headers['x-goog-api-key'] = config.apiKey;
            }
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
        const finalBody = applyCustomBody(body, config.customBody, config.customBodyEnabled);
        
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
     * 构建生成配置（根据 optionsEnabled 决定发送哪些参数）
     *
     * 只有在 optionsEnabled 中对应字段为 true 时，才会发送该参数
     */
    private buildGenerationConfig(config: GeminiConfig): any {
        const genConfig: any = {};
        
        // 从配置中读取所有参数
        const { options, optionsEnabled } = config;
        
        if (!options) {
            return genConfig;
        }
        
        // 如果没有 optionsEnabled，默认不发送任何参数
        if (!optionsEnabled) {
            return genConfig;
        }
        
        // 根据 optionsEnabled 决定发送哪些参数
        if (optionsEnabled.temperature && options.temperature !== undefined) {
            genConfig.temperature = options.temperature;
        }
        
        if (optionsEnabled.maxOutputTokens && options.maxOutputTokens !== undefined) {
            genConfig.maxOutputTokens = options.maxOutputTokens;
        }
        
        // 处理思考配置（Gemini 默认开启思考）
        // 如果 optionsEnabled.thinkingConfig 未定义，则默认为 true
        const thinkingEnabled = optionsEnabled.thinkingConfig !== false;
        if (thinkingEnabled) {
            const thinkingConfig = options.thinkingConfig || {};
            const apiThinkingConfig: any = {};
            
            // 是否包含思考内容（默认开启）
            const includeThoughts = thinkingConfig.includeThoughts !== false;
            if (includeThoughts) {
                apiThinkingConfig.includeThoughts = true;
            }
            
            // 根据模式设置思考等级或预算
            const mode = thinkingConfig.mode || 'default';
            if (mode === 'level' && thinkingConfig.thinkingLevel) {
                // 等级模式：发送思考等级
                apiThinkingConfig.thinkingLevel = thinkingConfig.thinkingLevel;
            } else if (mode === 'budget' && thinkingConfig.thinkingBudget !== undefined) {
                // 预算模式：发送思考预算
                apiThinkingConfig.thinkingBudget = thinkingConfig.thinkingBudget;
            }
            // default 模式：不发送等级或预算，使用 API 默认值
            
            // 只有当有配置项时才添加 thinkingConfig
            if (Object.keys(apiThinkingConfig).length > 0) {
                genConfig.thinkingConfig = apiThinkingConfig;
            }
        }
        
        return genConfig;
    }
    
    /**
     * 解析 Gemini API 响应
     */
    parseResponse(response: any): GenerateResponse {
        // 验证响应格式
        if (!response || !response.candidates || response.candidates.length === 0) {
            throw new Error(t('modules.channel.formatters.gemini.errors.invalidResponse'));
        }
        
        const candidate = response.candidates[0];
        
        // 提取完整的 Content（Gemini 已经是标准格式）
        const content = candidate.content;
        
        // 提取思考签名并转换为内部格式，同时删除原始单数格式
        if (content.parts) {
            content.parts = content.parts.map(part => {
                const { thoughtSignature, ...rest } = part as any;
                if (thoughtSignature) {
                    return {
                        ...rest,
                        thoughtSignatures: { gemini: thoughtSignature }
                    };
                }
                return part;
            });
        }
        
        // 存储完整的 usageMetadata（包括多模态 token 详情）
        if (response.usageMetadata) {
            content.usageMetadata = {
                promptTokenCount: response.usageMetadata.promptTokenCount,
                candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
                totalTokenCount: response.usageMetadata.totalTokenCount,
                thoughtsTokenCount: response.usageMetadata.thoughtsTokenCount,
                promptTokensDetails: response.usageMetadata.promptTokensDetails,
                candidatesTokensDetails: response.usageMetadata.candidatesTokensDetails
            };
        }
        
        // 存储模型版本
        if (response.modelVersion) {
            content.modelVersion = response.modelVersion;
        }
        
        // 提取结束原因
        const finishReason = candidate.finishReason;
        
        // 提取模型名称
        const model = response.modelVersion;
        
        return {
            content,
            finishReason,
            model,
            raw: response
        };
    }
    
    /**
     * 解析流式响应块
     */
    parseStreamChunk(chunk: any): StreamChunk {
        // 检查是否是错误响应（与非流式保持一致的错误格式）
        if (chunk.error) {
            throw new ChannelError(
                ErrorType.API_ERROR,
                t('modules.channel.formatters.gemini.errors.apiError', { code: chunk.error.code || 'UNKNOWN' }),
                chunk  // 保留完整的错误响应体
            );
        }
        
        // Gemini 流式响应格式：每个块都是一个完整的响应对象
        const candidate = chunk.candidates?.[0];
        
        if (!candidate) {
            return {
                delta: [],
                done: false
            };
        }
        
        const content = candidate.content;
        const parts = content?.parts || [];
        
        // 提取并转换思考签名（转换为内部复数格式，并删除原始单数格式）
        const processedParts = parts.map(part => {
            const { thoughtSignature, ...rest } = part as any;
            if (thoughtSignature) {
                return {
                    ...rest,
                    thoughtSignatures: { gemini: thoughtSignature }
                };
            }
            return part;
        });
        
        // 检查是否完成
        const done = !!candidate.finishReason;
        
        // 构建响应块
        const streamChunk: StreamChunk = {
            delta: processedParts,
            done
        };
        
        // 如果完成，添加完整的 token 信息（包括多模态详情）和模型版本
        if (done) {
            if (chunk.usageMetadata) {
                streamChunk.usage = {
                    promptTokenCount: chunk.usageMetadata.promptTokenCount,
                    candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount,
                    totalTokenCount: chunk.usageMetadata.totalTokenCount,
                    thoughtsTokenCount: chunk.usageMetadata.thoughtsTokenCount,
                    promptTokensDetails: chunk.usageMetadata.promptTokensDetails,
                    candidatesTokensDetails: chunk.usageMetadata.candidatesTokensDetails
                };
            }
            streamChunk.finishReason = candidate.finishReason;
            
            // 添加模型版本
            if (chunk.modelVersion) {
                streamChunk.modelVersion = chunk.modelVersion;
            }
        }
        
        return streamChunk;
    }
    
    /**
     * 验证配置（不验证 API Key）
     */
    validateConfig(config: any): boolean {
        if (config.type !== 'gemini') {
            return false;
        }
        
        const geminiConfig = config as GeminiConfig;
        
        // 检查必需字段（不验证 apiKey）
        if (!geminiConfig.url || !geminiConfig.model) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 获取支持的配置类型
     */
    getSupportedType(): string {
        return 'gemini';
    }
    
    /**
     * 清理历史记录中 Gemini API 不支持的字段
     *
     * Gemini API 的 functionResponse 不支持以下字段：
     * - id: Anthropic API 使用，用于关联 tool_use 和 tool_result
     * - functionCall.id: 同样不被 Gemini API 接受
     *
     * 同时清理其他内部字段（isFunctionResponse, tokenCountByChannel 等）
     */
    private cleanHistoryForGeminiAPI(history: Content[]): Content[] {
        return history.map(content => {
            const cleanedParts: ContentPart[] = content.parts.map(part => {
                // 创建清理后的 part
                const cleanedPart: ContentPart = {};
                
                // text
                if (part.text !== undefined) {
                    cleanedPart.text = part.text;
                }
                
                // thought
                if (part.thought !== undefined) {
                    cleanedPart.thought = part.thought;
                }
                
                // inlineData - 只保留 API 需要的字段
                if (part.inlineData) {
                    cleanedPart.inlineData = {
                        mimeType: part.inlineData.mimeType,
                        data: part.inlineData.data
                    };
                    if (part.inlineData.displayName) {
                        cleanedPart.inlineData.displayName = part.inlineData.displayName;
                    }
                }
                
                // fileData
                if (part.fileData) {
                    cleanedPart.fileData = { ...part.fileData };
                }
                
                // functionCall - 不包含 id（Gemini API 不支持）
                if (part.functionCall) {
                    cleanedPart.functionCall = {
                        name: part.functionCall.name,
                        args: part.functionCall.args
                    };
                    // 注意：不包含 id，因为 Gemini API 不支持
                }
                
                // functionResponse - 不包含 id（Gemini API 不支持）
                if (part.functionResponse) {
                    cleanedPart.functionResponse = {
                        name: part.functionResponse.name,
                        response: part.functionResponse.response
                    };
                    // Gemini 3+ 支持多模态函数响应的 parts
                    if (part.functionResponse.parts && part.functionResponse.parts.length > 0) {
                        cleanedPart.functionResponse.parts = part.functionResponse.parts;
                    }
                    // 注意：不包含 id，因为 Gemini API 不支持
                }
                
                // thoughtSignatures 会在 convertThoughtSignatures 中处理
                if (part.thoughtSignatures) {
                    cleanedPart.thoughtSignatures = part.thoughtSignatures;
                }
                
                return cleanedPart;
            });
            
            // 只返回 role 和 parts，不包含其他元数据
            return {
                role: content.role,
                parts: cleanedParts
            };
        });
    }
    
    /**
     * 将历史记录转换为 XML 模式
     *
     * 将 functionCall 和 functionResponse 转换为 XML 格式的文本
     * 这样模型看到的历史记录和它需要产出的格式是一致的
     *
     * 注意：functionResponse.parts 中的多模态内容会被提取并添加到消息中
     */
    private convertHistoryToXMLMode(history: Content[]): Content[] {
        return history.map(content => {
            const newParts: ContentPart[] = [];
            
            for (const part of content.parts) {
                if (part.functionCall) {
                    // 将 functionCall 转换为 XML 文本
                    const xmlText = convertFunctionCallToXML(
                        part.functionCall.name,
                        part.functionCall.args
                    );
                    newParts.push({ text: xmlText });
                } else if (part.functionResponse) {
                    // 将 functionResponse 转换为 XML 文本
                    const xmlText = convertFunctionResponseToXML(
                        part.functionResponse.name,
                        part.functionResponse.response
                    );
                    newParts.push({ text: xmlText });
                    
                    // 提取 functionResponse.parts 中的多模态内容
                    // 这些内容（如工具返回的图片）需要作为独立的 parts 发送给 AI
                    if (part.functionResponse.parts && part.functionResponse.parts.length > 0) {
                        for (const responsePart of part.functionResponse.parts) {
                            // 只提取多模态内容（inlineData 或 fileData）
                            if (responsePart.inlineData || responsePart.fileData) {
                                newParts.push(responsePart);
                            }
                        }
                    }
                } else {
                    // 其他类型的 part 保持不变
                    newParts.push(part);
                }
            }
            
            return {
                ...content,
                parts: newParts
            };
        });
    }
    
    /**
     * 将历史记录转换为 JSON 模式
     *
     * 将 functionCall 和 functionResponse 转换为 JSON 代码块格式的文本
     * 这样模型看到的历史记录和它需要产出的格式是一致的
     *
     * 注意：functionResponse.parts 中的多模态内容会被提取并添加到消息中
     */
    private convertHistoryToJSONMode(history: Content[]): Content[] {
        return history.map(content => {
            const newParts: ContentPart[] = [];
            
            for (const part of content.parts) {
                if (part.functionCall) {
                    // 将 functionCall 转换为 JSON 代码块
                    const jsonText = convertFunctionCallToJSON(
                        part.functionCall.name,
                        part.functionCall.args
                    );
                    newParts.push({ text: jsonText });
                } else if (part.functionResponse) {
                    // 将 functionResponse 转换为 JSON 代码块
                    const jsonText = convertFunctionResponseToJSON(
                        part.functionResponse.name,
                        part.functionResponse.response
                    );
                    newParts.push({ text: jsonText });
                    
                    // 提取 functionResponse.parts 中的多模态内容
                    // 这些内容（如工具返回的图片）需要作为独立的 parts 发送给 AI
                    if (part.functionResponse.parts && part.functionResponse.parts.length > 0) {
                        for (const responsePart of part.functionResponse.parts) {
                            // 只提取多模态内容（inlineData 或 fileData）
                            if (responsePart.inlineData || responsePart.fileData) {
                                newParts.push(responsePart);
                            }
                        }
                    }
                } else {
                    // 其他类型的 part 保持不变
                    newParts.push(part);
                }
            }
            
            return {
                ...content,
                parts: newParts
            };
        });
    }
    
    /**
     * 转换思考签名格式
     *
     * 将内部存储的 thoughtSignatures: { gemini: "..." } 格式
     * 转换为 Gemini API 需要的 thoughtSignature: "..." 格式
     */
    private convertThoughtSignatures(history: Content[]): Content[] {
        return history.map(content => ({
            role: content.role,
            parts: content.parts.map(part => {
                // 如果有 thoughtSignatures，提取 gemini 格式的签名
                if (part.thoughtSignatures?.gemini) {
                    const { thoughtSignatures, ...restPart } = part;
                    return {
                        ...restPart,
                        thoughtSignature: thoughtSignatures.gemini
                    };
                }
                // 如果没有 thoughtSignatures，直接返回原 part
                // 但需要确保不发送 thoughtSignatures 字段
                if (part.thoughtSignatures) {
                    const { thoughtSignatures, ...restPart } = part;
                    return restPart;
                }
                return part;
            })
        }));
    }
    
    /**
     * 转换工具声明为 Gemini 格式
     *
     * Gemini 格式：
     * {
     *   "tools": [{
     *     "function_declarations": [
     *       {
     *         "name": "tool_name",
     *         "description": "...",
     *         "parameters": { ... }
     *       }
     *     ]
     *   }]
     * }
     *
     * 注意：category 是内部字段，不发送给 API
     */
    convertTools(tools: ToolDeclaration[]): any {
        if (!tools || tools.length === 0) {
            return undefined;
        }
        
        // 转换工具声明，只保留 Gemini API 需要的字段
        const functionDeclarations = tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }));
        
        // Gemini 格式需要包装在 function_declarations 数组中
        return [{
            function_declarations: functionDeclarations
        }];
    }
}