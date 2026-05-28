/**
 * WP10: xmlFormatter 表征测试（characterization tests）
 *
 * 为什么写这个文件：xmlFormatter.ts 在 prompt-mode XML 工具调用解析路径上没有
 * 任何单元测试覆盖。本文件先锁定现有行为，作为后续收敛和重构的安全网。
 *
 * 测试范围：
 * - convertToolsToXML / convertFunctionCallToXML / convertFunctionResponseToXML（格式化）
 * - parseXMLToolCalls / parseXMLToolCall（解析）
 * - XML 转义边界行为（当前实现不转义 & < >，表征当前行为）
 *
 * 不改热路径：只验证当前行为，不改 provider（openai.ts/anthropic.ts/gemini.ts）调用方式。
 */

import {
    XMLToolCall,
    convertToolsToXML,
    convertFunctionCallToXML,
    convertFunctionResponseToXML,
    parseXMLToolCalls,
    parseXMLToolCall,
} from '../../tools/xmlFormatter';
import type { ToolDeclaration } from '../../tools/types';

// --------------- convertToolsToXML ---------------

describe('convertToolsToXML', () => {
    it('空数组返回空字符串', () => {
        expect(convertToolsToXML([])).toBe('');
    });

    it('null/undefined 输入返回空字符串（防御性）', () => {
        // 为什么测试：当前实现用 if (!tools || tools.length === 0) 守卫。
        expect(convertToolsToXML(null as any)).toBe('');
        expect(convertToolsToXML(undefined as any)).toBe('');
    });

    it('单个工具生成包含 <tool> 和 Tool Usage Guide 的提示词', () => {
        const tools: ToolDeclaration[] = [
            {
                name: 'read_file',
                description: 'Read a file',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path' },
                    },
                    required: ['path'],
                },
            },
        ];

        const result = convertToolsToXML(tools);

        // 关键行为表征
        expect(result).toContain('Tool Usage Guide');
        expect(result).toContain('<tool_use>');
        expect(result).toContain('</tool_use>');
        expect(result).toContain('<tool name="read_file">');
        // 必需参数标记
        expect(result).toContain('(required)');
    });

    it('多个工具各自输出 <tool> 块', () => {
        const tools: ToolDeclaration[] = [
            {
                name: 'tool_a',
                description: 'First tool',
                parameters: { type: 'object', properties: {}, required: [] },
            },
            {
                name: 'tool_b',
                description: 'Second tool',
                parameters: { type: 'object', properties: {}, required: [] },
            },
        ];

        const result = convertToolsToXML(tools);
        expect(result).toContain('<tool name="tool_a">');
        expect(result).toContain('<tool name="tool_b">');
    });

    it('Best Practices 包含"Wait only when dependent"原则', () => {
        // 为什么测试：同 jsonFormatter，锁定 LLM 行为指导文案。
        const tools: ToolDeclaration[] = [
            {
                name: 'dummy',
                description: 'dummy',
                parameters: { type: 'object', properties: {}, required: [] },
            },
        ];
        const result = convertToolsToXML(tools);
        expect(result).toContain('Wait only when dependent');
        expect(result).toContain('Combine tools effectively');
    });

    it('XML 格式指南包含 <item> 数组示例', () => {
        const tools: ToolDeclaration[] = [
            {
                name: 'dummy',
                description: 'dummy',
                parameters: { type: 'object', properties: {}, required: [] },
            },
        ];
        const result = convertToolsToXML(tools);
        expect(result).toContain('<item>');
    });
});

// --------------- convertFunctionCallToXML ---------------

describe('convertFunctionCallToXML', () => {
    it('基本的 name + 字符串 args 生成正确 XML', () => {
        const result = convertFunctionCallToXML('read_file', { path: 'test.txt' });
        expect(result).toContain('<tool_use>');
        expect(result).toContain('<tool_name>read_file</tool_name>');
        expect(result).toContain('<path>test.txt</path>');
        expect(result).toContain('</tool_use>');
    });

    it('对象类型参数被 JSON.stringify 处理', () => {
        const result = convertFunctionCallToXML('apply_diff', {
            hunks: [{ oldContent: 'x', newContent: 'y' }],
        });
        expect(result).toContain('<hunks>');
        expect(result).toContain('"oldContent"');
        expect(result).toContain('</hunks>');
    });

    it('数字参数被 String() 转换', () => {
        const result = convertFunctionCallToXML('execute_command', { timeout: 60000 });
        expect(result).toContain('<timeout>60000</timeout>');
    });

    it('布尔参数被 String() 转换', () => {
        const result = convertFunctionCallToXML('list_files', { recursive: true });
        expect(result).toContain('<recursive>true</recursive>');
    });

    // ---------- XML 转义行为表征 ----------
    // 为什么测试这些：当前 convertFunctionCallToXML 不转义 & < > 等 XML 特殊字符。
    // 这可能导致内容中的 & 或 < 破坏 XML 结构，使 parseXMLToolCalls 无法正确解析。
    // 锁定当前行为，让后续收敛决策有数据支持。

    it('内容中的 & 符号当前不被转义（表征当前行为）', () => {
        // 当前行为：& 直接嵌入 XML，不转义为 &amp;
        // 风险：如果一个 tool 参数值包含 &，生成的 XML 可能格式不正确。
        const result = convertFunctionCallToXML('search', { query: 'A & B' });
        // 表征：当前不转义
        expect(result).toContain('A & B');
        expect(result).not.toContain('&amp;');
    });

    it('内容中的 < 符号当前不被转义（表征当前行为）', () => {
        // 当前行为：< 直接嵌入 XML，不转义为 &lt;
        // 风险：可能导致 XML 解析失败。
        const result = convertFunctionCallToXML('write_file', { content: 'a < b' });
        expect(result).toContain('a < b');
        expect(result).not.toContain('&lt;');
    });

    it('内容中的 > 符号当前不被转义（表征当前行为）', () => {
        const result = convertFunctionCallToXML('write_file', { content: 'a > b' });
        expect(result).toContain('a > b');
        expect(result).not.toContain('&gt;');
    });
});

// --------------- convertFunctionResponseToXML ---------------

describe('convertFunctionResponseToXML', () => {
    it('生成包含 tool 属性的 <tool_result>', () => {
        const result = convertFunctionResponseToXML('read_file', { content: 'hello' });
        expect(result).toContain('<tool_result tool="read_file">');
        expect(result).toContain('hello');
    });

    it('移除 multimodal 字段', () => {
        // 为什么测试：同 jsonFormatter，锁定 multimodal 剥离行为。
        const result = convertFunctionResponseToXML('read_file', {
            content: 'text',
            multimodal: 'base64stuff',
        });
        expect(result).toContain('content');
        expect(result).not.toContain('multimodal');
        expect(result).not.toContain('base64stuff');
    });
});

// --------------- parseXMLToolCalls ---------------

describe('parseXMLToolCalls', () => {
    it('空文本返回空数组', () => {
        expect(parseXMLToolCalls('')).toEqual([]);
    });

    it('无 <tool_use> 的普通文本返回空数组', () => {
        expect(parseXMLToolCalls('hello world')).toEqual([]);
    });

    it('正确解析单个工具调用', () => {
        const xml = `<tool_use>
  <tool_name>read_file</tool_name>
  <parameters>
    <path>test.txt</path>
  </parameters>
</tool_use>`;

        const result = parseXMLToolCalls(xml);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('read_file');
        expect(result[0].args).toEqual({ path: 'test.txt' });
    });

    it('正确解析多个 <tool_use> 块', () => {
        const xml = `<tool_use>
  <tool_name>read_file</tool_name>
  <parameters>
    <path>a.txt</path>
  </parameters>
</tool_use>
<tool_use>
  <tool_name>write_file</tool_name>
  <parameters>
    <path>b.txt</path>
    <content>hi</content>
  </parameters>
</tool_use>`;

        const result = parseXMLToolCalls(xml);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('read_file');
        expect(result[1].name).toBe('write_file');
        expect(result[1].args.content).toBe('hi');
    });

    it('数组参数通过 <item> 正确解析', () => {
        const xml = `<tool_use>
  <tool_name>insert_code</tool_name>
  <parameters>
    <files>
      <item>
        <path>a.txt</path>
        <content>hello</content>
      </item>
      <item>
        <path>b.txt</path>
        <content>world</content>
      </item>
    </files>
  </parameters>
</tool_use>`;

        const result = parseXMLToolCalls(xml);
        expect(result).toHaveLength(1);
        expect(Array.isArray(result[0].args.files)).toBe(true);
        expect(result[0].args.files).toHaveLength(2);
        expect(result[0].args.files[0].path).toBe('a.txt');
    });

    it('无效 XML 被跳过且不抛异常', () => {
        // 为什么测试：当前实现用 try/catch 吞掉解析错误。
        // 表征此行为：调用者永远收到空数组而非异常。
        const xml = '<tool_use><<unclosed';
        expect(() => parseXMLToolCalls(xml)).not.toThrow();
        expect(parseXMLToolCalls(xml)).toEqual([]);
    });

    it('缺少 tool_name 的块返回空数组', () => {
        const xml = `<tool_use>
  <parameters>
    <path>test.txt</path>
  </parameters>
</tool_use>`;
        const result = parseXMLToolCalls(xml);
        expect(result).toEqual([]);
    });

    it('<tool_use> 外的文本不影响解析', () => {
        const xml = `some text before
<tool_use>
  <tool_name>read_file</tool_name>
  <parameters>
    <path>test.txt</path>
  </parameters>
</tool_use>
some text after`;

        const result = parseXMLToolCalls(xml);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('read_file');
    });

    it('数字参数被 fast-xml-parser 自动推断为 number 类型（表征当前行为）', () => {
        // 为什么测试：fast-xml-parser 在默认配置下会自动将数字文本转为 number。
        // 这是 XML 解析器的行为而非业务逻辑决定。锁定此行为确保后续改动知情。
        const xml = `<tool_use>
  <tool_name>execute_command</tool_name>
  <parameters>
    <timeout>60000</timeout>
  </parameters>
</tool_use>`;

        const result = parseXMLToolCalls(xml);
        // 当前行为：数字被自动转为 number（fast-xml-parser 默认行为）
        expect(typeof result[0].args.timeout).toBe('number');
        expect(result[0].args.timeout).toBe(60000);
    });
});

// --------------- parseXMLToolCall (单条便捷函数) ---------------

describe('parseXMLToolCall', () => {
    it('没有工具调用时返回 null', () => {
        expect(parseXMLToolCall('plain text')).toBeNull();
    });

    it('有工具调用时返回第一条', () => {
        const xml = `<tool_use>
  <tool_name>test</tool_name>
  <parameters>
    <x>1</x>
  </parameters>
</tool_use>`;
        const result = parseXMLToolCall(xml);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('test');
    });
});
