/**
 * LimCode - JSON 工具格式转换器
 *
 * 将工具声明转换为 JSON 提示词格式
 * 使用动态边界（类似 heredoc）避免内容中的代码块干扰解析
 *
 * 格式：
 * <<<TOOL_CALL>>>
 * {"tool": "...", "parameters": {...}}
 * <<<END_TOOL_CALL>>>
 */

import type { ToolDeclaration } from './types';

/**
 * 工具调用边界标记
 */
export const TOOL_CALL_START = '<<<TOOL_CALL>>>';
export const TOOL_CALL_END = '<<<END_TOOL_CALL>>>';

/**
 * JSON 工具调用的格式定义
 */
export interface JSONToolCall {
    tool: string;
    parameters: Record<string, any>;
}

/**
 * 将参数 schema 转换为简化的类型描述
 */
function schemaToTypeDescription(schema: any): string {
    if (!schema) return 'any';
    
    if (schema.type === 'array') {
        const itemType = schema.items?.type || 'any';
        return `${itemType}[]`;
    }
    
    if (schema.type === 'object' && schema.properties) {
        const props = Object.entries(schema.properties)
            .map(([key, val]: [string, any]) => `${key}: ${schemaToTypeDescription(val)}`)
            .join(', ');
        return `{ ${props} }`;
    }
    
    return schema.type || 'any';
}

/**
 * 生成参数的 JSON Schema 示例
 */
function generateParameterExample(schema: any): any {
    if (!schema) return null;
    
    if (schema.type === 'string') {
        return schema.example || 'string_value';
    }
    if (schema.type === 'number' || schema.type === 'integer') {
        return schema.example || 0;
    }
    if (schema.type === 'boolean') {
        return schema.example ?? true;
    }
    if (schema.type === 'array') {
        const itemExample = generateParameterExample(schema.items);
        return [itemExample];
    }
    if (schema.type === 'object' && schema.properties) {
        const obj: Record<string, any> = {};
        for (const [key, val] of Object.entries(schema.properties)) {
            obj[key] = generateParameterExample(val);
        }
        return obj;
    }
    return null;
}

/**
 * 将工具声明转换为 JSON 格式的提示词
 * 
 * @param tools 工具声明数组
 * @returns JSON 格式的工具说明文本
 */
export function convertToolsToJSON(tools: ToolDeclaration[]): string {
    if (!tools || tools.length === 0) {
        return '';
    }
    
    // 生成工具列表描述
    const toolDescriptions = tools.map(tool => {
        const params = tool.parameters.properties;
        const required = tool.parameters.required || [];
        
        // 生成参数说明
        const paramsList = Object.entries(params).map(([name, schema]: [string, any]) => {
            const isRequired = required.includes(name);
            const typeInfo = schemaToTypeDescription(schema);
            const description = schema.description || '';
            return `    - ${name} (${typeInfo})${isRequired ? ' [required]' : ''}: ${description}`;
        }).join('\n');
        
        // 生成示例参数
        const exampleParams: Record<string, any> = {};
        for (const [name, schema] of Object.entries(params)) {
            exampleParams[name] = generateParameterExample(schema);
        }
        
        return `### ${tool.name}
${tool.description}

Parameters:
${paramsList}

Example:
\`\`\`json
${JSON.stringify({ tool: tool.name, parameters: exampleParams }, null, 2)}
\`\`\``;
    }).join('\n\n---\n\n');
    
    // 修改原因：原 Best Practices 中的“One step at a time”会让模型在输出一个工具调用后停下，即使后续工具互不依赖。
    // 修改方式：保留“结果驱动”的安全原则，但改成“只有后续调用依赖结果时才等待”；同时强化独立操作应同轮批量输出。
    // 修改目的：让 JSON prompt 工具模式和 function-call 模式形成一致心智，避免 apply_diff/write_file 每轮只调用一次。
    return `## Tool Usage Guide

You are a powerful AI assistant with access to various tools. You should actively use these tools to gather information, perform actions, and provide accurate responses.

### How to Call Tools

When you need to use a tool, output a JSON object wrapped in special boundary markers:

${TOOL_CALL_START}
{"tool": "tool_name", "parameters": {...}}
${TOOL_CALL_END}

You can call multiple tools by outputting multiple tool blocks:

${TOOL_CALL_START}
{"tool": "read_file", "parameters": {"path": "file1.txt"}}
${TOOL_CALL_END}

${TOOL_CALL_START}
{"tool": "write_file", "parameters": {"path": "output.txt", "content": "Hello!"}}
${TOOL_CALL_END}

### Best Practices

1. **Actively use tools**: When you need information you don't have, use the appropriate tool to get it. Don't guess or make assumptions when tools can provide accurate data.

2. **Place tool calls at the end**: Structure your response so that tool calls appear at the end of your message. First provide any explanations or context, then call the necessary tools.

3. **Wait only when dependent**: Wait for a tool result only when later tool calls depend on that result. For independent operations, output all relevant tool calls in the same response.

4. **Combine tools effectively**: You can call multiple tools in a single response when needed. If a plan requires changing several independent files, emit multiple apply_diff or write_file tool blocks in that same response instead of stopping after the first file.

### Syntax Rules

- Each tool call must be wrapped in ${TOOL_CALL_START} and ${TOOL_CALL_END} markers
- The content between markers must be a valid JSON object
- Use proper JSON syntax (double quotes for strings, no trailing commas)
- Arrays use standard JSON array syntax: ["item1", "item2"]
- The boundary markers ensure that any code blocks in parameters won't interfere with parsing

---

## Available Tools

${toolDescriptions}`;
}

/**
 * 将 functionCall 转换为 JSON 格式的文本（使用边界标记）
 *
 * @param name 工具名称
 * @param args 工具参数
 * @returns 带边界标记的 JSON 工具调用文本
 */
export function convertFunctionCallToJSON(name: string, args: Record<string, any>): string {
    const toolCall: JSONToolCall = {
        tool: name,
        parameters: args
    };
    return `${TOOL_CALL_START}\n${JSON.stringify(toolCall, null, 2)}\n${TOOL_CALL_END}`;
}

/**
 * 将 functionResponse 转换为 JSON 格式的文本
 *
 * @param name 工具名称
 * @param response 工具响应
 * @returns 工具响应文本
 *
 * 注意：multimodal 字段会被移除，因为多模态数据应该作为 inlineData 附件单独发送
 */
export function convertFunctionResponseToJSON(name: string, response: Record<string, any>): string {
    // 移除 multimodal 字段，避免将 base64 图片数据嵌入文本
    // multimodal 数据应该作为 inlineData parts 单独发送
    const { multimodal, ...textResponse } = response;
    return `Tool result for "${name}":\n${JSON.stringify(textResponse, null, 2)}`;
}

/**
 * 从文本中提取所有 JSON 工具调用
 *
 * @param text 包含工具调用边界标记的文本
 * @returns 解析出的工具调用数组
 */
export function parseJSONToolCalls(text: string): JSONToolCall[] {
    const results: JSONToolCall[] = [];
    
    // 匹配 <<<TOOL_CALL>>> ... <<<END_TOOL_CALL>>> 边界
    // 使用非贪婪匹配，确保正确处理多个工具调用
    const toolCallRegex = new RegExp(
        `${escapeRegExp(TOOL_CALL_START)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(TOOL_CALL_END)}`,
        'g'
    );
    let match;
    
    while ((match = toolCallRegex.exec(text)) !== null) {
        try {
            const jsonStr = match[1].trim();
            const parsed = JSON.parse(jsonStr);
            
            // 验证是否是有效的工具调用格式
            if (parsed.tool && typeof parsed.tool === 'string') {
                results.push({
                    tool: parsed.tool,
                    parameters: parsed.parameters || {}
                });
            }
        } catch (error) {
            // JSON 解析失败，跳过这个块
            console.warn('Failed to parse JSON tool call:', error);
        }
    }
    
    return results;
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从文本中提取单个 JSON 工具调用（用于流式解析）
 *
 * @param text 包含工具调用的文本
 * @returns 解析出的工具调用，如果没有找到返回 null
 */
export function parseJSONToolCall(text: string): JSONToolCall | null {
    const calls = parseJSONToolCalls(text);
    return calls.length > 0 ? calls[0] : null;
}

/**
 * 检查文本中是否包含工具调用开始标记
 * 用于流式解析时判断是否需要等待更多内容
 *
 * @param text 文本内容
 * @returns 是否包含工具调用开始标记
 */
export function hasJSONToolCallStart(text: string): boolean {
    return text.includes(TOOL_CALL_START);
}

/**
 * 检查工具调用块是否完整
 *
 * @param text 文本内容
 * @returns 是否包含完整的工具调用块
 */
export function hasCompleteJSONBlock(text: string): boolean {
    const startCount = (text.match(new RegExp(escapeRegExp(TOOL_CALL_START), 'g')) || []).length;
    const endCount = (text.match(new RegExp(escapeRegExp(TOOL_CALL_END), 'g')) || []).length;
    return startCount > 0 && endCount >= startCount;
}

/**
 * 提取未完成的工具调用内容（用于流式解析）
 *
 * @param text 文本内容
 * @returns 未完成的工具调用内容，如果没有则返回 null
 */
export function extractIncompleteToolCall(text: string): string | null {
    const lastStartIndex = text.lastIndexOf(TOOL_CALL_START);
    if (lastStartIndex === -1) {
        return null;
    }
    
    const afterStart = text.substring(lastStartIndex + TOOL_CALL_START.length);
    const endIndex = afterStart.indexOf(TOOL_CALL_END);
    
    // 如果找到了结束标记，说明这个块是完整的
    if (endIndex !== -1) {
        return null;
    }
    
    // 返回未完成的内容
    return afterStart.trim();
}