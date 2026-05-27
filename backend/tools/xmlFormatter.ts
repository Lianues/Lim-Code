/**
 * LimCode - XML 工具格式转换器
 *
 * 将工具声明转换为 XML 提示词格式
 * 使用 fast-xml-parser 进行 XML 解析
 */

import { XMLParser } from 'fast-xml-parser';
import type { ToolDeclaration } from './types';

/**
 * XML 解析器配置
 */
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true
});

/**
 * 格式化参数类型信息
 */
function formatParameterType(schema: any): string {
    if (schema.type === 'array') {
        const itemType = schema.items?.type || 'any';
        return `array of ${itemType}`;
    }
    if (schema.type === 'object' && schema.properties) {
        const props = Object.keys(schema.properties).join(', ');
        return `object with properties: ${props}`;
    }
    return schema.type || 'any';
}

/**
 * 将工具声明转换为 XML 格式的提示词
 *
 * @param tools 工具声明数组
 * @returns XML 格式的工具说明文本
 */
export function convertToolsToXML(tools: ToolDeclaration[]): string {
    if (!tools || tools.length === 0) {
        return '';
    }
    
    const toolDescriptions = tools.map(tool => {
        // 生成参数说明
        const params = tool.parameters.properties;
        const required = tool.parameters.required || [];
        
        const paramsList = Object.entries(params).map(([name, schema]: [string, any]) => {
            const isRequired = required.includes(name);
            const requiredTag = isRequired ? ' (required)' : ' (optional)';
            const typeInfo = formatParameterType(schema);
            const description = schema.description || '';
            return `  - ${name}${requiredTag} [${typeInfo}]: ${description}`;
        }).join('\n');
        
        return `<tool name="${tool.name}">
  <description>
${tool.description}
  </description>
  <parameters>
${paramsList}
  </parameters>
</tool>`;
    }).join('\n\n');
    
    return `## Tool Usage Guide

You are a powerful AI assistant with access to various tools. You should actively use these tools to gather information, perform actions, and provide accurate responses.

### How to Call Tools

When you need to use a tool, respond with XML format:
<tool_use>
  <tool_name>tool name here</tool_name>
  <parameters>
    <parameter_name>value</parameter_name>
    <!-- For array parameters, use multiple <item> elements: -->
    <array_param>
      <item>value1</item>
      <item>value2</item>
    </array_param>
    <!-- For object parameters, use nested elements: -->
    <object_param>
      <property1>value1</property1>
      <property2>value2</property2>
    </object_param>
  </parameters>
</tool_use>

### Examples

Reading files:
<tool_use>
  <tool_name>read_file</tool_name>
  <parameters>
    <path>file1.txt</path>
  </parameters>
</tool_use>

Writing files:
<tool_use>
  <tool_name>write_file</tool_name>
  <parameters>
    <path>file1.txt</path>
    <content>Hello, World!</content>
  </parameters>
</tool_use>

### Best Practices

1. **Actively use tools**: When you need information you don't have, use the appropriate tool to get it. Don't guess or make assumptions when tools can provide accurate data.

2. **Place tool calls at the end**: Structure your response so that tool calls appear at the end of your message. First provide any explanations or context, then call the necessary tools.

3. **One step at a time**: After each tool call, wait for the result before proceeding. Use the tool results to inform your next steps.

4. **Combine tools effectively**: You can call multiple tools in a single response when needed. Use the results from one tool to inform subsequent tool calls.

---

## Available Tools

${toolDescriptions}`;
}

/**
 * 将 functionCall 转换为 XML 格式的文本
 *
 * @param name 工具名称
 * @param args 工具参数
 * @returns XML 格式的工具调用文本
 */
export function convertFunctionCallToXML(name: string, args: Record<string, any>): string {
    const params = Object.entries(args)
        .map(([key, value]) => {
            // 处理不同类型的值
            let valueStr: string;
            if (typeof value === 'object') {
                valueStr = JSON.stringify(value);
            } else {
                valueStr = String(value);
            }
            return `    <${key}>${valueStr}</${key}>`;
        })
        .join('\n');
    
    return `<tool_use>
  <tool_name>${name}</tool_name>
  <parameters>
${params}
  </parameters>
</tool_use>`;
}

/**
 * 将 functionResponse 转换为 XML 格式的文本
 *
 * @param name 工具名称
 * @param response 工具响应
 * @returns XML 格式的工具响应文本
 *
 * 注意：multimodal 字段会被移除，因为多模态数据应该作为 inlineData 附件单独发送
 */
export function convertFunctionResponseToXML(name: string, response: Record<string, any>): string {
    // 移除 multimodal 字段，避免将 base64 图片数据嵌入文本
    // multimodal 数据应该作为 inlineData parts 单独发送
    const { multimodal, ...textResponse } = response;
    return `<tool_result tool="${name}">
${JSON.stringify(textResponse, null, 2)}
</tool_result>`;
}

/**
 * 递归处理参数值，将 XML 结构转换为正确的 JavaScript 类型
 */
function processParameterValue(value: any): any {
    // 如果是 null 或 undefined，直接返回
    if (value === null || value === undefined) {
        return value;
    }
    
    // 如果是原始类型（字符串、数字、布尔），直接返回
    if (typeof value !== 'object') {
        return value;
    }
    
    // 检查是否是数组格式（包含 item 属性）
    if (value.item !== undefined) {
        // 确保 item 是数组
        const items = Array.isArray(value.item) ? value.item : [value.item];
        // 递归处理数组中的每个元素
        return items.map((item: any) => processParameterValue(item));
    }
    
    // 如果是对象，递归处理每个属性
    if (typeof value === 'object') {
        const result: Record<string, any> = {};
        for (const [key, val] of Object.entries(value)) {
            // 跳过内部属性
            if (key.startsWith('@_') || key === '#text') {
                continue;
            }
            result[key] = processParameterValue(val);
        }
        return result;
    }
    
    return value;
}

/**
 * XML 工具调用的格式定义
 */
export interface XMLToolCall {
    name: string;
    args: Record<string, any>;
}

/**
 * 解析单个 tool_use 节点
 */
function parseToolUseNode(toolUse: any): XMLToolCall | null {
    // 提取工具名称
    const name = toolUse.tool_name;
    if (!name) {
        return null;
    }
    
    // 提取参数
    const args: Record<string, any> = {};
    const parameters = toolUse.parameters;
    
    if (parameters && typeof parameters === 'object') {
        // 遍历所有参数
        for (const [key, value] of Object.entries(parameters)) {
            // 跳过内部属性
            if (key.startsWith('@_') || key === '#text') {
                continue;
            }
            // 递归处理参数值（处理数组和嵌套对象）
            args[key] = processParameterValue(value);
        }
    }
    
    return { name, args };
}

/**
 * 从文本中提取所有 XML 工具调用
 *
 * 支持：
 * - 多个 <tool_use> 块
 * - 单个块内多个工具调用（通过数组解析）
 *
 * @param xmlText 包含 XML 工具调用的文本
 * @returns 解析出的工具调用数组
 */
export function parseXMLToolCalls(xmlText: string): XMLToolCall[] {
    const results: XMLToolCall[] = [];
    
    // 使用正则匹配所有 <tool_use>...</tool_use> 块
    const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g;
    let match;
    
    while ((match = toolUseRegex.exec(xmlText)) !== null) {
        try {
            const toolUseXml = `<tool_use>${match[1]}</tool_use>`;
            const parsed = xmlParser.parse(toolUseXml);
            
            if (parsed.tool_use) {
                const toolUse = parsed.tool_use;
                
                // 检查是否是数组（多个工具调用在一个块内）
                if (Array.isArray(toolUse)) {
                    for (const tu of toolUse) {
                        const call = parseToolUseNode(tu);
                        if (call) {
                            results.push(call);
                        }
                    }
                } else {
                    const call = parseToolUseNode(toolUse);
                    if (call) {
                        results.push(call);
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to parse XML tool call block:', error);
        }
    }
    
    return results;
}

/**
 * 从文本中提取第一个 XML 工具调用
 *
 * 便捷函数，当只需要第一个工具调用时使用
 *
 * @param xmlText 包含 XML 工具调用的文本
 * @returns 第一个工具调用，如果没有找到返回 null
 */
export function parseXMLToolCall(xmlText: string): XMLToolCall | null {
    const calls = parseXMLToolCalls(xmlText);
    return calls.length > 0 ? calls[0] : null;
}