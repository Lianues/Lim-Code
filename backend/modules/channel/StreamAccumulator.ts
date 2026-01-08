/**
 * LimCode - 流式响应累加器
 *
 * 用于累加流式响应块，生成完整的 Content
 * 参考 Gemini 流式响应格式设计
 */

import type { Content, ContentPart, UsageMetadata, ThoughtSignatures } from '../conversation/types';
import type { StreamChunk, StreamUsageMetadata } from './types';
import type { ToolMode } from '../config/configs/base';
import { parseXMLToolCalls } from '../../tools/xmlFormatter';
import { getGlobalSettingsManager, getGlobalConfigManager } from '../../core/settingsContext';

// JSON 工具调用边界标记
const TOOL_CALL_START = '<<<TOOL_CALL>>>';
const TOOL_CALL_END = '<<<END_TOOL_CALL>>>';

// XML 工具调用标记
const XML_TOOL_START = '<tool_use>';
const XML_TOOL_END = '</tool_use>';

/**
 * 流式累加器
 *
 * 负责接收和累加流式响应块，最终生成完整的 Content
 *
 * 设计原则：
 * - 参考 Gemini 流式响应格式
 * - 支持思考内容（thought: true）和普通内容的分离
 * - 自动合并相同类型的连续 parts
 * - 正确处理 token 统计信息
 * - 支持多格式思考签名存储
 */
export class StreamAccumulator {
    /** 累加的 parts */
    private parts: ContentPart[] = [];
    
    /** 是否完成 */
    private isDone: boolean = false;
    
    /** 完整的 Token 使用统计 */
    private usageMetadata?: UsageMetadata;
    
    /** 结束原因 */
    private finishReason?: string;
    
    /** 模型版本 */
    private modelVersion?: string;
    
    /** 多格式思考签名 */
    private thoughtSignatures: ThoughtSignatures = {};
    
    /** API 提供商类型（用于确定签名格式） */
    private providerType: 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom' = 'gemini';
    
    /** 思考开始时间戳（毫秒） */
    private thinkingStartTime?: number;
    
    /** 思考持续时间（毫秒） */
    private thinkingDuration?: number;
    
    /** 是否已经收到非思考的普通文本 */
    private hasReceivedNormalText: boolean = false;
    
    /** 流式块计数 */
    private chunkCount: number = 0;
    
    /** 第一个流式块时间戳（毫秒） */
    private firstChunkTime?: number;
    
    /** 最后一个流式块时间戳（毫秒） */
    private lastChunkTime?: number;
    
    /** 请求开始时间戳（毫秒） - 由外部设置 */
    private requestStartTime?: number;
    
    /**
     * 获取工具模式
     * 优先使用当前激活渠道的 toolMode，否则使用全局默认
     */
    private getToolMode(): ToolMode {
        const settingsManager = getGlobalSettingsManager();
        const configManager = getGlobalConfigManager();
        
        if (settingsManager && configManager) {
            const activeChannelId = settingsManager.getActiveChannelId();
            if (activeChannelId) {
                // 同步获取配置（配置已在缓存中）
                // 注意：getConfig 是异步的，但这里我们需要同步获取
                // 使用内部缓存直接访问
                const configCache = (configManager as any).configCache as Map<string, any>;
                const config = configCache?.get(activeChannelId);
                if (config?.toolMode) {
                    return config.toolMode;
                }
            }
            // 使用全局默认工具模式
            return settingsManager.getDefaultToolMode();
        }
        
        return 'function_call';
    }
    
    /**
     * 添加流式响应块
     *
     * 处理流程：
     * 1. 累加增量内容（delta）
     * 2. 更新 usage、finishReason、modelVersion 等元数据
     * 3. 标记完成状态
     *
     * 注意：OpenAI 格式的流式响应中，usage 可能在单独的 chunk 中发送
     * （choices 为空数组但有 usage 数据），所以即使已经 done，
     * 仍然需要接收 usage 更新。
     *
     * @param chunk 流式响应块
     */
    add(chunk: StreamChunk): void {
        const now = Date.now();
        
        // 增加块计数
        this.chunkCount++;
        
        // 记录第一个块的时间
        if (this.chunkCount === 1) {
            this.firstChunkTime = now;
        }
        
        // 更新最后一个块的时间
        this.lastChunkTime = now;
        
        // 累加增量内容（如果有）
        // 即使已经 done，也要处理 delta（虽然通常 done 后 delta 为空）
        if (chunk.delta && chunk.delta.length > 0) {
            for (const part of chunk.delta) {
                this.addPart(part);
            }
        }
        
        // 保存完整的 token 使用统计（包括多模态详情）
        // 这个可能在第一个 done chunk 中，也可能在后续的 usage chunk 中
        if (chunk.usage) {
            this.usageMetadata = {
                promptTokenCount: chunk.usage.promptTokenCount,
                candidatesTokenCount: chunk.usage.candidatesTokenCount,
                totalTokenCount: chunk.usage.totalTokenCount,
                thoughtsTokenCount: chunk.usage.thoughtsTokenCount,
                promptTokensDetails: chunk.usage.promptTokensDetails,
                candidatesTokensDetails: chunk.usage.candidatesTokensDetails
            };
        }
        
        // 保存结束原因（如果有）
        if (chunk.finishReason) {
            this.finishReason = chunk.finishReason;
        }
        
        // 保存模型版本（如果有）
        if (chunk.modelVersion) {
            this.modelVersion = chunk.modelVersion;
        }
        
        // 更新完成状态
        if (chunk.done) {
            this.isDone = true;
        }
    }
    
    /**
     * 设置 API 提供商类型
     * 用于确定思考签名的存储格式
     */
    setProviderType(type: 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom'): void {
        this.providerType = type;
    }
    
    /**
     * 获取 API 提供商类型
     */
    getProviderType(): 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom' {
        return this.providerType;
    }
    
    /**
     * 添加单个 part
     *
     * 简化策略：直接存储 API 返回的原始 part 格式
     * - 文本 part：尝试与相同类型的最后一个 part 合并
     * - 非文本 part（functionCall、thoughtSignature 等）：直接添加，保持原始结构
     */
    private addPart(part: ContentPart): void {
        // 提取 thoughtSignature 用于内部追踪
        if ((part as any).thoughtSignature) {
            this.thoughtSignatures[this.providerType] = (part as any).thoughtSignature;
        }
        if (part.thoughtSignatures) {
            Object.assign(this.thoughtSignatures, part.thoughtSignatures);
        }
        
        const isFunctionCall = !!(part as any).functionCall;
        
        // 处理非文本 part
        if (!('text' in part)) {
            if (part.functionCall) {
                const fc = part.functionCall as any;
                
                console.log('[Accumulator] Received FC part:', JSON.stringify({
                    index: fc.index,
                    id: fc.id,
                    name: fc.name,
                    partialArgs: fc.partialArgs,
                    existingPartsCount: this.parts.length,
                    existingFCIndices: this.parts.filter(p => p.functionCall).map(p => (p.functionCall as any).index)
                }));
                
                // 倒序搜索现有的 parts，寻找可以合并的工具调用块
                // 解决并行调用或中间穿插其他消息导致的 lastPart 匹配失败问题
                for (let i = this.parts.length - 1; i >= 0; i--) {
                    const existingPart = this.parts[i];
                    if (!existingPart.functionCall) continue;
                    
                    const lastFc = existingPart.functionCall as any;
                    
                    // 优化合并判断逻辑
                    let canMerge = false;
                    
                    // OpenAI 模式：优先使用 index 匹配（数字类型，包括 0）
                    if (typeof fc.index === 'number' && typeof lastFc.index === 'number') {
                        canMerge = fc.index === lastFc.index;
                        console.log(`[Accumulator] Index match check: fc.index=${fc.index}, lastFc.index=${lastFc.index}, canMerge=${canMerge}`);
                    }
                    // Anthropic 模式：使用 id 标识
                    else if (fc.id && lastFc.id) {
                        canMerge = fc.id === lastFc.id;
                        console.log(`[Accumulator] ID match check: fc.id=${fc.id}, lastFc.id=${lastFc.id}, canMerge=${canMerge}`);
                    }
                    // 纯增量模式：没有 id 也没有 index，但有 partialArgs，且是最后一个 FC
                    else if (!fc.id && typeof fc.index !== 'number' && fc.partialArgs !== undefined && i === this.parts.length - 1) {
                        canMerge = true;
                        console.log(`[Accumulator] Pure increment mode, canMerge=true`);
                    } else {
                        console.log(`[Accumulator] No match: fc.index=${fc.index}(${typeof fc.index}), lastFc.index=${lastFc.index}(${typeof lastFc.index}), fc.id=${fc.id}, lastFc.id=${lastFc.id}`);
                    }
                    
                    if (canMerge) {
                        console.log(`[Accumulator] Merging into existing FC at index ${i}`);
                        // 合并名称（如果有）
                        if (fc.name && !lastFc.name) {
                            lastFc.name = fc.name;
                        }
                        // 合并 ID（如果有）
                        if (fc.id && !lastFc.id) {
                            lastFc.id = fc.id;
                        }
                        // 合并 index（如果有）
                        if (typeof fc.index === 'number' && typeof lastFc.index !== 'number') {
                            lastFc.index = fc.index;
                        }
                        // 合并思考签名等其他属性
                        if (part.thoughtSignatures) {
                            existingPart.thoughtSignatures = { 
                                ...(existingPart.thoughtSignatures || {}), 
                                ...part.thoughtSignatures 
                            };
                        }
                        if ((part as any).thoughtSignature) {
                            existingPart.thoughtSignatures = {
                                ...(existingPart.thoughtSignatures || {}),
                                [this.providerType]: (part as any).thoughtSignature
                            };
                        }
                        // 合并 partialArgs
                        if (fc.partialArgs !== undefined) {
                            lastFc.partialArgs = (lastFc.partialArgs || '') + fc.partialArgs;
                            console.log(`[Accumulator] After merge, partialArgs length: ${lastFc.partialArgs.length}`);
                            
                            // 尝试解析完整的 JSON 参数
                            if (lastFc.partialArgs.trim()) {
                                try {
                                    const parsed = JSON.parse(lastFc.partialArgs);
                                    lastFc.args = parsed;
                                    console.log(`[Accumulator] Successfully parsed args:`, JSON.stringify(parsed));
                                } catch (e) {
                                    // 解析失败（JSON 不完整），继续等待更多增量
                                }
                            }
                        }
                        return; // 成功合并，直接返回
                    }
                }
                
                // 找不到可合并的块，作为新块添加
                console.log(`[Accumulator] No mergeable FC found, adding new FC part`);
                // 添加前尝试解析初始参数
                if (fc.partialArgs) {
                    try {
                        fc.args = JSON.parse(fc.partialArgs);
                    } catch (e) {}
                }
                
                // 构建新 Part，但排除 API 原始格式的 thoughtSignature（单数）
                const { thoughtSignature: rawSignature, ...restPart } = part as any;
                const newPart: ContentPart = { ...restPart };
                // 确保 functionCall 是深拷贝的，且处理了 args
                newPart.functionCall = { ...fc };
                if (fc.args) newPart.functionCall.args = { ...fc.args };
                
                // 如果有 API 原始格式的 thoughtSignature，转换为 thoughtSignatures 格式
                if (rawSignature) {
                    newPart.thoughtSignatures = {
                        ...(newPart.thoughtSignatures || {}),
                        [this.providerType]: rawSignature
                    };
                }
                
                this.parts.push(newPart);
                console.log(`[Accumulator] After adding, parts count: ${this.parts.length}`);
                return;
            }
            
            // 其他非文本 Part（如图片、文件等）
            // 排除 API 原始格式的 thoughtSignature（单数），转换为 thoughtSignatures 格式
            const { thoughtSignature: rawSig, ...restNonTextPart } = part as any;
            const nonTextPart: ContentPart = { ...restNonTextPart };
            if (rawSig) {
                nonTextPart.thoughtSignatures = {
                    ...(nonTextPart.thoughtSignatures || {}),
                    [this.providerType]: rawSig
                };
            }
            this.parts.push(nonTextPart);
            return;
        }
        
        // 文本 part：尝试合并
        const isThought = part.thought === true;
        
        // 思考计时逻辑
        if (isThought) {
            // 记录思考开始时间（仅首次）
            if (this.thinkingStartTime === undefined) {
                this.thinkingStartTime = Date.now();
            }
        } else if (part.text) {
            // 收到普通文本时，计算思考持续时间
            if (this.thinkingStartTime !== undefined && !this.hasReceivedNormalText) {
                this.hasReceivedNormalText = true;
                this.thinkingDuration = Date.now() - this.thinkingStartTime;
            }
        }
        
        const lastPart = this.parts[this.parts.length - 1];
        
        // 检查是否可以与最后一个 part 合并（都是文本且思考类型相同）
        if (lastPart && 'text' in lastPart && !lastPart.functionCall) {
            const lastIsThought = lastPart.thought === true;
            
            if (lastIsThought === isThought) {
                lastPart.text += part.text;
                // 检测并转换完整的 JSON 工具调用
                this.extractAndConvertToolCalls();
                return;
            }
        }
        
        // 无法合并，添加新 part
        // 排除 API 原始格式的 thoughtSignature（单数），转换为 thoughtSignatures 格式
        const { thoughtSignature: rawTextSig, ...restTextPart } = part as any;
        const textPart: ContentPart = { ...restTextPart };
        if (rawTextSig) {
            textPart.thoughtSignatures = {
                ...(textPart.thoughtSignatures || {}),
                [this.providerType]: rawTextSig
            };
        }
        this.parts.push(textPart);
        // 检测并转换完整的 JSON 工具调用
        this.extractAndConvertToolCalls();
    }
    
    /**
     * 检测并转换文本中的工具调用标记为 functionCall
     * 根据 toolMode 选择解析的格式：
     * - 'xml': 解析 <tool_use>...</tool_use>
     * - 'json': 解析 <<<TOOL_CALL>>>...<<<END_TOOL_CALL>>>
     * - 'function_call': 不解析文本标记（由 API 返回 functionCall）
     * 实时处理，让前端能立即显示工具调用组件
     */
    private extractAndConvertToolCalls(): void {
        // 获取当前工具模式
        const toolMode = this.getToolMode();
        
        // function_call 模式不需要解析文本标记
        if (toolMode === 'function_call') {
            return;
        }
        
        const newParts: ContentPart[] = [];
        
        for (const part of this.parts) {
            if (!('text' in part)) {
                newParts.push(part);
                continue;
            }
            
            // 根据 toolMode 选择检查的标记
            const hasJsonMarker = toolMode === 'json' && part.text.includes(TOOL_CALL_START);
            const hasXmlMarker = toolMode === 'xml' && part.text.includes(XML_TOOL_START);
            
            if (!hasJsonMarker && !hasXmlMarker) {
                newParts.push(part);
                continue;
            }
            
            let text = part.text;
            const isThought = part.thought === true;
            
            // 循环提取所有完整的工具调用
            // 根据 toolMode 只解析对应格式，避免误解析代码示例中的标记
            while (true) {
                if (toolMode === 'json') {
                    // JSON 模式：只检查 JSON 格式标记
                    const jsonStartIdx = text.indexOf(TOOL_CALL_START);
                    const jsonEndIdx = text.indexOf(TOOL_CALL_END);
                    
                    if (jsonStartIdx === -1 || jsonEndIdx === -1 || jsonEndIdx <= jsonStartIdx) {
                        break;
                    }
                    
                    // 处理 JSON 格式
                    const textBefore = text.substring(0, jsonStartIdx).trim();
                    if (textBefore) {
                        newParts.push(isThought ? { text: textBefore, thought: true } : { text: textBefore });
                    }
                    
                    const jsonStart = jsonStartIdx + TOOL_CALL_START.length;
                    const jsonStr = text.substring(jsonStart, jsonEndIdx).trim();
                    
                    try {
                        const toolCall = JSON.parse(jsonStr);
                        if (toolCall.tool && toolCall.parameters) {
                            newParts.push({
                                functionCall: {
                                    name: toolCall.tool,
                                    args: toolCall.parameters,
                                    id: `fc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
                                }
                            });
                        } else {
                            // 格式不正确，保留原文本
                            newParts.push({ text: text.substring(jsonStartIdx, jsonEndIdx + TOOL_CALL_END.length) });
                        }
                    } catch {
                        // JSON 解析失败，保留原文本
                        newParts.push({ text: text.substring(jsonStartIdx, jsonEndIdx + TOOL_CALL_END.length) });
                    }
                    
                    text = text.substring(jsonEndIdx + TOOL_CALL_END.length);
                } else if (toolMode === 'xml') {
                    // XML 模式：只检查 XML 格式标记
                    const xmlStartIdx = text.indexOf(XML_TOOL_START);
                    const xmlEndIdx = text.indexOf(XML_TOOL_END);
                    
                    if (xmlStartIdx === -1 || xmlEndIdx === -1 || xmlEndIdx <= xmlStartIdx) {
                        break;
                    }
                    
                    // 处理 XML 格式
                    const textBefore = text.substring(0, xmlStartIdx).trim();
                    if (textBefore) {
                        newParts.push(isThought ? { text: textBefore, thought: true } : { text: textBefore });
                    }
                    
                    const xmlContent = text.substring(xmlStartIdx, xmlEndIdx + XML_TOOL_END.length);
                    
                    try {
                        const xmlCalls = parseXMLToolCalls(xmlContent);
                        if (xmlCalls.length > 0) {
                            for (const xmlCall of xmlCalls) {
                                newParts.push({
                                    functionCall: {
                                        name: xmlCall.name,
                                        args: xmlCall.args,
                                        id: `fc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
                                    }
                                });
                            }
                        } else {
                            // 解析失败，保留原文本
                            newParts.push({ text: xmlContent });
                        }
                    } catch {
                        // XML 解析失败，保留原文本
                        newParts.push({ text: xmlContent });
                    }
                    
                    text = text.substring(xmlEndIdx + XML_TOOL_END.length);
                } else {
                    // 未知模式，退出循环
                    break;
                }
            }
            
            // 添加剩余文本
            if (text) {
                newParts.push(isThought ? { text, thought: true } : { text });
            }
        }
        
        this.parts = newParts;
    }
    
    /**
     * 获取当前累加的完整 Content
     *
     * @returns 完整的 Content 对象
     */
    getContent(): Content {
        // 直接使用存储的 parts，只过滤掉空文本
        // 同时清理掉仅用于流式过程的中间字段（如 index, partialArgs）
        let parts = this.parts
            .map(p => {
                const part = { ...p };
                if (part.functionCall) {
                    const fc = { ...part.functionCall } as any;
                    delete fc.index;
                    delete fc.partialArgs;
                    part.functionCall = fc;
                }
                return part;
            })
            .filter(p => {
                // 保留非文本 part（functionCall 等）
                if (!('text' in p) || p.functionCall) return true;
                // 过滤空文本（但保留有意义的内容）
                if ('text' in p && p.text === '' && !p.thought) return false;
                return true;
            });
        
        // 添加思考签名到 parts 中
        // 如果有收集到的思考签名，需要作为单独的 part 添加
        // 这样可以在后续发送给 API 时正确传递签名
        if (Object.keys(this.thoughtSignatures).length > 0) {
            // 检查 parts 中是否已经有包含 thoughtSignatures 的 part
            const hasSignaturePart = parts.some(p => p.thoughtSignatures);
            if (!hasSignaturePart) {
                // 添加一个包含所有格式签名的 part
                parts.push({ thoughtSignatures: { ...this.thoughtSignatures } });
            }
        }
        
        // 尝试解析所有未完成的 partialArgs
        for (const p of parts) {
            if (p.functionCall?.partialArgs && (!p.functionCall.args || Object.keys(p.functionCall.args).length === 0)) {
                try {
                    p.functionCall.args = JSON.parse(p.functionCall.partialArgs);
                } catch (e) {
                    // 仍然无法解析，忽略
                }
            }
        }
        
        const content: Content = {
            role: 'model',
            parts
        };
        
        // 添加模型版本
        if (this.modelVersion) {
            content.modelVersion = this.modelVersion;
        }
        
        // 添加完整的 usageMetadata
        if (this.usageMetadata) {
            content.usageMetadata = { ...this.usageMetadata };
        }
        
        // 添加思考开始时间（用于前端实时显示）
        if (this.thinkingStartTime !== undefined) {
            content.thinkingStartTime = this.thinkingStartTime;
        }
        
        // 添加思考持续时间
        // 如果有思考内容但没有普通文本，在获取 Content 时计算最终持续时间
        if (this.thinkingStartTime !== undefined) {
            if (this.thinkingDuration !== undefined) {
                content.thinkingDuration = this.thinkingDuration;
            } else if (!this.hasReceivedNormalText) {
                // 消息只有思考内容没有普通文本，使用当前时间计算
                content.thinkingDuration = Date.now() - this.thinkingStartTime;
            }
        }
        
        // 添加流式统计信息
        content.chunkCount = this.chunkCount;
        if (this.firstChunkTime !== undefined) {
            content.firstChunkTime = this.firstChunkTime;
        }
        
        // 计算响应持续时间（从请求开始到最后一个块）
        if (this.requestStartTime !== undefined && this.lastChunkTime !== undefined) {
            content.responseDuration = this.lastChunkTime - this.requestStartTime;
        } else if (this.requestStartTime !== undefined) {
            // 如果还没收到任何块，使用当前时间
            content.responseDuration = Date.now() - this.requestStartTime;
        }
        
        // 计算流式持续时间（从第一个块到最后一个块）
        if (this.firstChunkTime !== undefined && this.lastChunkTime !== undefined) {
            content.streamDuration = this.lastChunkTime - this.firstChunkTime;
        } else if (this.firstChunkTime !== undefined) {
            // 如果只收到第一个块，使用当前时间
            content.streamDuration = Date.now() - this.firstChunkTime;
        }
        
        return content;
    }
    
    /**
     * 获取当前文本内容（用于实时显示）
     * 
     * @param options 选项
     * @returns 当前累加的文本
     */
    getText(options?: {
        /** 是否包含思考内容 */
        includeThoughts?: boolean;
    }): string {
        const includeThoughts = options?.includeThoughts ?? false;
        
        return this.parts
            .filter(part => {
                if (!('text' in part)) {
                    return false;
                }
                // 如果不包含思考内容，过滤掉思考 part
                if (!includeThoughts && part.thought === true) {
                    return false;
                }
                return true;
            })
            .map(part => ('text' in part ? part.text : ''))
            .join('');
    }
    
    /**
     * 获取思考内容（单独获取）
     * 
     * @returns 思考内容文本
     */
    getThoughts(): string {
        return this.parts
            .filter(part => 'text' in part && part.thought === true)
            .map(part => ('text' in part ? part.text : ''))
            .join('');
    }
    
    /**
     * 获取普通内容（不含思考）
     * 
     * @returns 普通内容文本
     */
    getNormalText(): string {
        return this.parts
            .filter(part => 'text' in part && part.thought !== true)
            .map(part => ('text' in part ? part.text : ''))
            .join('');
    }
    
    /**
     * 检查是否完成
     */
    isComplete(): boolean {
        return this.isDone;
    }
    
    /**
     * 获取结束原因
     */
    getFinishReason(): string | undefined {
        return this.finishReason;
    }
    
    /**
     * 获取模型版本
     */
    getModelVersion(): string | undefined {
        return this.modelVersion;
    }
    
    /**
     * 设置模型版本
     */
    setModelVersion(modelVersion: string): void {
        this.modelVersion = modelVersion;
    }
    
    /**
     * 重置累加器
     */
    reset(): void {
        this.parts = [];
        this.isDone = false;
        this.usageMetadata = undefined;
        this.finishReason = undefined;
        this.modelVersion = undefined;
        this.thoughtSignatures = {};
        this.thinkingStartTime = undefined;
        this.thinkingDuration = undefined;
        this.hasReceivedNormalText = false;
        this.chunkCount = 0;
        this.firstChunkTime = undefined;
        this.lastChunkTime = undefined;
        this.requestStartTime = undefined;
    }
    
    /**
     * 设置请求开始时间
     * 用于计算 responseDuration
     */
    setRequestStartTime(time: number): void {
        this.requestStartTime = time;
    }
    
    /**
     * 获取流式块计数
     */
    getChunkCount(): number {
        return this.chunkCount;
    }
    
    /**
     * 获取第一个流式块时间
     */
    getFirstChunkTime(): number | undefined {
        return this.firstChunkTime;
    }
    
    /**
     * 获取最后一个流式块时间
     */
    getLastChunkTime(): number | undefined {
        return this.lastChunkTime;
    }
    
    /**
     * 获取思考签名（多格式）
     */
    getThoughtSignatures(): ThoughtSignatures {
        return { ...this.thoughtSignatures };
    }
    
    /**
     * 获取指定格式的思考签名
     */
    getThoughtSignature(format: string = 'gemini'): string | undefined {
        return this.thoughtSignatures[format];
    }
    
    /**
     * 获取 token 使用统计
     */
    getUsageMetadata(): UsageMetadata | undefined {
        return this.usageMetadata ? { ...this.usageMetadata } : undefined;
    }
    
    /**
     * 获取加密思考内容
     *
     * @returns 加密思考内容数组（可能有多个块）
     */
    getRedactedThinking(): string[] {
        return this.parts
            .filter(part => part.redactedThinking)
            .map(part => part.redactedThinking!);
    }
    
    /**
     * 获取思考持续时间
     */
    getThinkingDuration(): number | undefined {
        if (this.thinkingDuration !== undefined) {
            return this.thinkingDuration;
        }
        if (this.thinkingStartTime !== undefined && !this.hasReceivedNormalText) {
            return Date.now() - this.thinkingStartTime;
        }
        return undefined;
    }
    
    /**
     * 获取统计信息
     */
    getStats(): {
        partCount: number;
        textLength: number;
        thoughtsLength: number;
        normalTextLength: number;
        hasThoughts: boolean;
        hasRedactedThinking: boolean;
        hasThoughtSignatures: boolean;
        thoughtSignatureFormats: string[];
        usageMetadata?: UsageMetadata;
        thinkingDuration?: number;
        chunkCount: number;
        firstChunkTime?: number;
        lastChunkTime?: number;
    } {
        const signatureFormats = Object.keys(this.thoughtSignatures).filter(k => this.thoughtSignatures[k]);
        return {
            partCount: this.parts.length,
            textLength: this.getText({ includeThoughts: true }).length,
            thoughtsLength: this.getThoughts().length,
            normalTextLength: this.getNormalText().length,
            hasThoughts: this.parts.some(p => 'thought' in p && p.thought === true),
            hasRedactedThinking: this.parts.some(p => p.redactedThinking),
            hasThoughtSignatures: signatureFormats.length > 0,
            thoughtSignatureFormats: signatureFormats,
            usageMetadata: this.usageMetadata,
            thinkingDuration: this.getThinkingDuration(),
            chunkCount: this.chunkCount,
            firstChunkTime: this.firstChunkTime,
            lastChunkTime: this.lastChunkTime
        };
    }
}