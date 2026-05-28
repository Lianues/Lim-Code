/**
 * WP10: jsonFormatter 表征测试（characterization tests）
 *
 * 为什么写这个文件：jsonFormatter.ts 在 prompt-mode JSON 工具调用解析路径上没有
 * 任何单元测试覆盖。本文件先锁定现有行为，作为后续收敛和重构的安全网。
 *
 * 测试范围：
 * - convertToolsToJSON / convertFunctionCallToJSON / convertFunctionResponseToJSON（格式化）
 * - parseJSONToolCalls / parseJSONToolCall / hasJSONToolCallStart / hasCompleteJSONBlock / extractIncompleteToolCall（解析）
 * - TOOL_CALL_START / TOOL_CALL_END 常量
 *
 * 不改热路径：只验证当前行为，不改 provider（openai.ts/anthropic.ts/gemini.ts）调用方式。
 */

import {
    TOOL_CALL_START,
    TOOL_CALL_END,
    JSONToolCall,
    convertToolsToJSON,
    convertFunctionCallToJSON,
    convertFunctionResponseToJSON,
    parseJSONToolCalls,
    parseJSONToolCall,
    hasJSONToolCallStart,
    hasCompleteJSONBlock,
    extractIncompleteToolCall,
} from '../../tools/jsonFormatter';
import type { ToolDeclaration } from '../../tools/types';

// --------------- 标记常量 ---------------

describe('JSON tool call markers', () => {
    it('TOOL_CALL_START 是固定字符串 <<<TOOL_CALL>>>', () => {
        expect(TOOL_CALL_START).toBe('<<<TOOL_CALL>>>');
    });

    it('TOOL_CALL_END 是固定字符串 <<<END_TOOL_CALL>>>', () => {
        expect(TOOL_CALL_END).toBe('<<<END_TOOL_CALL>>>');
    });
});

// --------------- convertToolsToJSON ---------------

describe('convertToolsToJSON', () => {
    it('空数组返回空字符串', () => {
        expect(convertToolsToJSON([])).toBe('');
    });

    it('null/undefined 输入返回空字符串（防御性）', () => {
        // 为什么测试这个：当前实现用 if (!tools || tools.length === 0) 守卫，
        // 需要表征并锁定此行为，防止后续改动引入 NPE。
        expect(convertToolsToJSON(null as any)).toBe('');
        expect(convertToolsToJSON(undefined as any)).toBe('');
    });

    it('单个工具生成包含工具名和 Tool Usage Guide 的提示词', () => {
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

        const result = convertToolsToJSON(tools);

        // 关键行为表征：必须包含引导文字
        expect(result).toContain('Tool Usage Guide');
        expect(result).toContain(TOOL_CALL_START);
        expect(result).toContain(TOOL_CALL_END);
        // 工具名称出现在提示词中
        expect(result).toContain('read_file');
        // 必需参数有 [required] 标记
        expect(result).toContain('[required]');
    });

    it('多个工具之间用 --- 分隔', () => {
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

        const result = convertToolsToJSON(tools);
        expect(result).toContain('---');
        expect(result).toContain('tool_a');
        expect(result).toContain('tool_b');
    });

    it('Best Practices 包含"Wait only when dependent"原则', () => {
        // 为什么测试：WP02/G0 已知此文案是批量工具调用的核心指导，
        // 改动会改变 LLM 行为。锁定文案防止意外变更。
        const tools: ToolDeclaration[] = [
            {
                name: 'dummy',
                description: 'dummy',
                parameters: { type: 'object', properties: {}, required: [] },
            },
        ];
        const result = convertToolsToJSON(tools);
        expect(result).toContain('Wait only when dependent');
        expect(result).toContain('Combine tools effectively');
    });
});

// --------------- convertFunctionCallToJSON ---------------

describe('convertFunctionCallToJSON', () => {
    it('基本的 name + args 生成正确 JSON 块', () => {
        const result = convertFunctionCallToJSON('read_file', { path: 'test.txt' });
        expect(result).toContain(TOOL_CALL_START);
        expect(result).toContain('"tool": "read_file"');
        expect(result).toContain('"path": "test.txt"');
        expect(result).toContain(TOOL_CALL_END);
    });

    it('嵌套对象参数正常序列化', () => {
        const result = convertFunctionCallToJSON('apply_diff', {
            path: 'a.ts',
            hunks: [{ oldContent: 'x', newContent: 'y' }],
        });
        const parsed = JSON.parse(
            result.substring(
                result.indexOf('\n') + 1,
                result.lastIndexOf('\n')
            )
        );
        expect(parsed.tool).toBe('apply_diff');
        expect(parsed.parameters.hunks).toEqual([{ oldContent: 'x', newContent: 'y' }]);
    });
});

// --------------- convertFunctionResponseToJSON ---------------

describe('convertFunctionResponseToJSON', () => {
    it('生成包含工具名的响应文本', () => {
        const result = convertFunctionResponseToJSON('read_file', { content: 'hello' });
        expect(result).toContain('read_file');
        expect(result).toContain('hello');
    });

    it('移除 multimodal 字段避免 base64 嵌入文本', () => {
        // 为什么测试：multimodal 数据必须作为 inlineData parts 单独发送，
        // 嵌入文本会导致上下文爆炸。锁定此行为。
        const result = convertFunctionResponseToJSON('read_file', {
            content: 'text',
            multimodal: 'base64stuff',
        });
        expect(result).toContain('content');
        expect(result).not.toContain('multimodal');
        expect(result).not.toContain('base64stuff');
    });
});

// --------------- parseJSONToolCalls ---------------

describe('parseJSONToolCalls', () => {
    it('空文本返回空数组', () => {
        expect(parseJSONToolCalls('')).toEqual([]);
    });

    it('无标记的普通文本返回空数组', () => {
        expect(parseJSONToolCalls('hello world')).toEqual([]);
    });

    it('正确解析单个工具调用', () => {
        const text = `${TOOL_CALL_START}\n{"tool":"read_file","parameters":{"path":"test.txt"}}\n${TOOL_CALL_END}`;
        const result = parseJSONToolCalls(text);
        expect(result).toHaveLength(1);
        expect(result[0].tool).toBe('read_file');
        expect(result[0].parameters).toEqual({ path: 'test.txt' });
    });

    it('正确解析多个工具调用', () => {
        const text = [
            `${TOOL_CALL_START}\n{"tool":"read_file","parameters":{"path":"a.txt"}}\n${TOOL_CALL_END}`,
            `${TOOL_CALL_START}\n{"tool":"write_file","parameters":{"path":"b.txt","content":"hi"}}\n${TOOL_CALL_END}`,
        ].join('\n');

        const result = parseJSONToolCalls(text);
        expect(result).toHaveLength(2);
        expect(result[0].tool).toBe('read_file');
        expect(result[1].tool).toBe('write_file');
    });

    it('标记之间的空白被容忍', () => {
        const text = `${TOOL_CALL_START}   \n  {"tool":"test","parameters":{}}  \n   ${TOOL_CALL_END}`;
        const result = parseJSONToolCalls(text);
        expect(result).toHaveLength(1);
        expect(result[0].tool).toBe('test');
    });

    it('缺少 tool 字段的 JSON 不会被视为工具调用', () => {
        const text = `${TOOL_CALL_START}\n{"foo":"bar"}\n${TOOL_CALL_END}`;
        const result = parseJSONToolCalls(text);
        expect(result).toEqual([]);
    });

    it('无效 JSON 被跳过且不抛异常', () => {
        // 为什么测试：当前实现吞掉 JSON 解析错误并 console.warn。
        // 表征此行为——调用者永远收到空数组而非异常。
        const text = `${TOOL_CALL_START}\n{not valid json}\n${TOOL_CALL_END}`;
        expect(() => parseJSONToolCalls(text)).not.toThrow();
        expect(parseJSONToolCalls(text)).toEqual([]);
    });

    it('无 parameters 字段时默认为空对象', () => {
        const text = `${TOOL_CALL_START}\n{"tool":"test"}\n${TOOL_CALL_END}`;
        const result = parseJSONToolCalls(text);
        expect(result).toHaveLength(1);
        expect(result[0].parameters).toEqual({});
    });

    it('标记之间的文本也被正确提取', () => {
        // 验证标记之外的前导/尾随文本不影响解析
        const text = `some text before\n${TOOL_CALL_START}\n{"tool":"test","parameters":{}}\n${TOOL_CALL_END}\nsome text after`;
        const result = parseJSONToolCalls(text);
        expect(result).toHaveLength(1);
        expect(result[0].tool).toBe('test');
    });

    it('标记之间的代码块不干扰解析', () => {
        // 为什么测试：如果参数内容包含特殊字符如代码块标记，
        // 非贪婪匹配应仍能正确配对标记。
        // 注意：测试中规避了 \n 和反引号在 JSON 字符串内的嵌套引号问题。
        const text = TOOL_CALL_START + '\n{"tool":"write_file","parameters":{"content":"some code block here"}}\n' + TOOL_CALL_END;
        const result = parseJSONToolCalls(text);
        expect(result).toHaveLength(1);
    });
});

// --------------- parseJSONToolCall (单条便捷函数) ---------------

describe('parseJSONToolCall', () => {
    it('没有工具调用时返回 null', () => {
        expect(parseJSONToolCall('plain text')).toBeNull();
    });

    it('有工具调用时返回第一条', () => {
        const text = `${TOOL_CALL_START}\n{"tool":"test","parameters":{"x":1}}\n${TOOL_CALL_END}`;
        const result = parseJSONToolCall(text);
        expect(result).not.toBeNull();
        expect(result!.tool).toBe('test');
    });
});

// --------------- 流式辅助函数 ---------------

describe('hasJSONToolCallStart', () => {
    it('包含开始标记时返回 true', () => {
        expect(hasJSONToolCallStart(`text ${TOOL_CALL_START} more`)).toBe(true);
    });

    it('不包含开始标记时返回 false', () => {
        expect(hasJSONToolCallStart('plain text')).toBe(false);
    });
});

describe('hasCompleteJSONBlock', () => {
    it('完整的块返回 true', () => {
        const text = `${TOOL_CALL_START}\n{"tool":"t","parameters":{}}\n${TOOL_CALL_END}`;
        expect(hasCompleteJSONBlock(text)).toBe(true);
    });

    it('只有开始标记时返回 false', () => {
        expect(hasCompleteJSONBlock(`${TOOL_CALL_START}\n{"tool":"t"`)).toBe(false);
    });

    it('多个开始标记且结束标记足够时返回 true', () => {
        const text = [
            `${TOOL_CALL_START}\n{"tool":"a","parameters":{}}\n${TOOL_CALL_END}`,
            `${TOOL_CALL_START}\n{"tool":"b","parameters":{}}\n${TOOL_CALL_END}`,
        ].join('\n');
        expect(hasCompleteJSONBlock(text)).toBe(true);
    });
});

describe('extractIncompleteToolCall', () => {
    it('未完成的块返回内容', () => {
        const text = `${TOOL_CALL_START}\n{"tool":"test","param`;
        const result = extractIncompleteToolCall(text);
        expect(result).toContain('"tool":"test"');
    });

    it('已完成块返回 null', () => {
        const text = `${TOOL_CALL_START}\n{"tool":"t","parameters":{}}\n${TOOL_CALL_END}`;
        expect(extractIncompleteToolCall(text)).toBeNull();
    });

    it('没有开始标记返回 null', () => {
        expect(extractIncompleteToolCall('plain text')).toBeNull();
    });
});
