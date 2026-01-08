/**
 * LimCode - 工具调用解析服务
 *
 * 负责解析和转换各种格式的工具调用：
 * - Function Call 格式（Gemini/OpenAI 原生）
 * - XML 格式（<tool_use> 标签）
 * - JSON 边界标记格式（<<<TOOL_CALL>>>）
 */

import type { Content, ContentPart } from '../../../conversation/types';
import { parseXMLToolCalls } from '../../../../tools/xmlFormatter';
import { parseJSONToolCalls, TOOL_CALL_START } from '../../../../tools/jsonFormatter';
import { generateToolCallId, type FunctionCallInfo } from '../utils';

/**
 * 工具调用解析服务
 *
 * 职责：
 * 1. 从 Content 中提取函数调用（支持多种格式）
 * 2. 将 XML/JSON 格式的工具调用转换为统一的 functionCall 格式
 * 3. 确保所有 functionCall 都有唯一 ID
 */
export class ToolCallParserService {
    /**
     * 从 Content 中提取函数调用
     *
     * 支持三种模式：
     * 1. Function Call 模式：从 part.functionCall 提取
     * 2. XML 模式：从 part.text 中解析 <tool_use> XML 标签
     * 3. JSON 边界标记模式：从 part.text 中解析 <<<TOOL_CALL>>> 标记
     *
     * @param content 消息内容
     * @returns 函数调用列表
     */
    extractFunctionCalls(content: Content): FunctionCallInfo[] {
        const calls: FunctionCallInfo[] = [];
        
        for (const part of content.parts) {
            // Function Call 模式
            if (part.functionCall) {
                calls.push({
                    name: part.functionCall.name,
                    args: part.functionCall.args,
                    id: part.functionCall.id || generateToolCallId()
                });
            }
            
            // XML 模式：从文本中解析工具调用（支持多个调用）
            if (part.text && part.text.includes('<tool_use>')) {
                const xmlCalls = parseXMLToolCalls(part.text);
                for (const xmlCall of xmlCalls) {
                    calls.push({
                        name: xmlCall.name,
                        args: xmlCall.args,
                        id: generateToolCallId()
                    });
                }
            }
            
            // JSON 边界标记模式：从文本中解析工具调用（支持多个调用）
            if (part.text && part.text.includes(TOOL_CALL_START)) {
                const jsonCalls = parseJSONToolCalls(part.text);
                for (const jsonCall of jsonCalls) {
                    calls.push({
                        name: jsonCall.tool,
                        args: jsonCall.parameters,
                        id: generateToolCallId()
                    });
                }
            }
        }
        
        return calls;
    }
    
    /**
     * 将 XML/JSON 工具调用转换为 functionCall 格式
     *
     * 当使用 XML 或 JSON 模式时，模型返回的文本中包含工具调用标记。
     * 此方法将文本中的工具调用解析出来，并转换为 functionCall 格式的 parts。
     * 这样存储和前端显示都使用统一的 functionCall 格式。
     *
     * 注意：此方法会直接修改传入的 content 对象
     *
     * @param content 消息内容（会被修改）
     */
    convertXMLToolCallsToFunctionCalls(content: Content): void {
        const newParts: ContentPart[] = [];
        
        for (const part of content.parts) {
            // 检查文本中是否包含 XML 工具调用（支持多个调用）
            if (part.text && part.text.includes('<tool_use>')) {
                const xmlCalls = parseXMLToolCalls(part.text);
                if (xmlCalls.length > 0) {
                    // 提取所有工具调用，并分离前后文本
                    let remainingText = part.text;
                    
                    for (const xmlCall of xmlCalls) {
                        // 查找当前工具调用的位置
                        const startMarkerIdx = remainingText.indexOf('<tool_use>');
                        const endMarkerIdx = remainingText.indexOf('</tool_use>');
                        
                        if (startMarkerIdx !== -1 && endMarkerIdx !== -1) {
                            // 添加工具调用前的文本
                            const textBefore = remainingText.substring(0, startMarkerIdx).trim();
                            if (textBefore) {
                                newParts.push({ text: textBefore });
                            }
                            
                            // 添加 functionCall
                            newParts.push({
                                functionCall: {
                                    name: xmlCall.name,
                                    args: xmlCall.args,
                                    id: generateToolCallId()
                                }
                            });
                            
                            // 更新剩余文本
                            remainingText = remainingText.substring(endMarkerIdx + '</tool_use>'.length);
                        }
                    }
                    
                    // 添加最后剩余的文本
                    const finalText = remainingText.trim();
                    if (finalText) {
                        newParts.push({ text: finalText });
                    }
                } else {
                    // 解析失败，保留原文本
                    newParts.push(part);
                }
            }
            // 检查文本中是否包含 JSON 边界标记工具调用
            else if (part.text && part.text.includes(TOOL_CALL_START)) {
                const jsonCalls = parseJSONToolCalls(part.text);
                if (jsonCalls.length > 0) {
                    // 提取所有工具调用，并分离前后文本
                    let remainingText = part.text;
                    
                    for (const jsonCall of jsonCalls) {
                        // 查找当前工具调用的位置
                        const startMarkerIdx = remainingText.indexOf(TOOL_CALL_START);
                        const endMarkerIdx = remainingText.indexOf('<<<END_TOOL_CALL>>>');
                        
                        if (startMarkerIdx !== -1 && endMarkerIdx !== -1) {
                            // 添加工具调用前的文本
                            const textBefore = remainingText.substring(0, startMarkerIdx).trim();
                            if (textBefore) {
                                newParts.push({ text: textBefore });
                            }
                            
                            // 添加 functionCall
                            newParts.push({
                                functionCall: {
                                    name: jsonCall.tool,
                                    args: jsonCall.parameters,
                                    id: generateToolCallId()
                                }
                            });
                            
                            // 更新剩余文本
                            remainingText = remainingText.substring(endMarkerIdx + '<<<END_TOOL_CALL>>>'.length);
                        }
                    }
                    
                    // 添加最后剩余的文本
                    const finalText = remainingText.trim();
                    if (finalText) {
                        newParts.push({ text: finalText });
                    }
                } else {
                    // 解析失败，保留原文本
                    newParts.push(part);
                }
            } else {
                // 不包含工具调用，保留原 part
                newParts.push(part);
            }
        }
        
        // 替换 parts
        content.parts = newParts;
    }
    
    /**
     * 确保 Content 中的所有 functionCall 都有唯一 id
     *
     * Gemini 格式的响应不包含 functionCall.id，
     * 我们在保存到历史之前为其添加唯一 id，
     * 以便前端可以通过 id 匹配 functionCall 和 functionResponse
     *
     * 对于 OpenAI 格式，如果已经有 id 则保留原有 id
     *
     * 注意：此方法会直接修改传入的 content 对象
     *
     * @param content 消息内容（会被修改）
     */
    ensureFunctionCallIds(content: Content): void {
        for (const part of content.parts) {
            if (part.functionCall && !part.functionCall.id) {
                part.functionCall.id = generateToolCallId();
            }
        }
    }
}
