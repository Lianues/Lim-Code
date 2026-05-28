/**
 * WP10: promptToolParser 表征测试（characterization tests）
 *
 * 为什么写这个文件：promptToolParser.ts 是 prompt-mode JSON/XML 工具调用的增量解析器，
 * 在 StreamAccumulator 中被热路径调用（appendText 每 chunk 触发一次），
 * 但没有任何单元测试覆盖。本文件先锁定所有核心行为。
 *
 * 测试范围：
 * - detectPromptToolMode：检测文本中首先出现 JSON 还是 XML 标记
 * - IncrementalPromptToolParser：增量解析（appendText / flushIncompleteAsText / reset / getPendingText）
 * - extractPromptToolParts：一次性静态提取
 * - 边界：多块解析、跨 chunk、不完整标记保护、空输入
 *
 * 不改热路径：只验证当前行为。
 */

import {
    PromptToolMode,
    detectPromptToolMode,
    IncrementalPromptToolParser,
    extractPromptToolParts,
    ExtractPromptToolPartsResult,
} from '../../tools/promptToolParser';

// --------------- detectPromptToolMode ---------------

describe('detectPromptToolMode', () => {
    it('纯文本无标记返回 null', () => {
        expect(detectPromptToolMode('hello world')).toBeNull();
    });

    it('空字符串返回 null', () => {
        expect(detectPromptToolMode('')).toBeNull();
    });

    it('包含 JSON 标记时返回 json', () => {
        expect(detectPromptToolMode('some text <<<TOOL_CALL>>>')).toBe('json');
    });

    it('包含 XML 标记时返回 xml', () => {
        expect(detectPromptToolMode('some text <tool_use>')).toBe('xml');
    });

    it('两者都出现时，先出现的优先', () => {
        // JSON 标记先出现
        expect(detectPromptToolMode('<<<TOOL_CALL>>>  <tool_use>')).toBe('json');
        // XML 标记先出现
        expect(detectPromptToolMode('<tool_use>  <<<TOOL_CALL>>>')).toBe('xml');
    });

    it('同时出现时 JSON 优先（平局规则）', () => {
        // 为什么测试：当 jsonIndex === xmlIndex 时（都是0），
        // 当前实现用 jsonIndex <= xmlIndex 判断，所以 JSON 会赢。
        // 锁定此行为。
        // 构造一个两者同时出现的情况：<tool_use> 和 <<<TOOL_CALL>>> 都在开头
        // 实际上它们不会同时出现在同一位置，但表征平局规则
        const text = '<<<TOOL_CALL>>><tool_use>';
        // <<<TOOL_CALL>>> 在 index 0，<tool_use> 在 index 15
        expect(detectPromptToolMode(text)).toBe('json');
    });
});

// --------------- IncrementalPromptToolParser ---------------

describe('IncrementalPromptToolParser', () => {
    // ---------- JSON 模式 ----------

    describe('JSON mode', () => {
        let parser: IncrementalPromptToolParser;

        beforeEach(() => {
            parser = new IncrementalPromptToolParser('json');
        });

        it('空 fragment 返回空数组', () => {
            expect(parser.appendText('')).toEqual([]);
        });

        it('纯文本直接作为 text part 输出', () => {
            const parts = parser.appendText('hello world');
            expect(parts).toEqual([{ text: 'hello world' }]);
        });

        it('完整 JSON 工具调用被解析为 functionCall part', () => {
            const parts = parser.appendText(
                '<<<TOOL_CALL>>>\n{"tool":"read_file","parameters":{"path":"test.txt"}}\n<<<END_TOOL_CALL>>>'
            );
            expect(parts).toHaveLength(1);
            expect(parts[0].functionCall).toBeDefined();
            expect(parts[0].functionCall!.name).toBe('read_file');
            expect(parts[0].functionCall!.args).toEqual({ path: 'test.txt' });
        });

        it('多个 JSON 工具调用全部解析', () => {
            const parts = parser.appendText(
                '<<<TOOL_CALL>>>\n{"tool":"read_file","parameters":{"path":"a.txt"}}\n<<<END_TOOL_CALL>>>\n' +
                '<<<TOOL_CALL>>>\n{"tool":"write_file","parameters":{"path":"b.txt","content":"hi"}}\n<<<END_TOOL_CALL>>>'
            );
            const fcs = parts.filter(p => p.functionCall);
            expect(fcs).toHaveLength(2);
            expect(fcs[0].functionCall!.name).toBe('read_file');
            expect(fcs[1].functionCall!.name).toBe('write_file');
        });

        it('标记之间的纯文本作为 text part 输出', () => {
            const parts = parser.appendText(
                'before text <<<TOOL_CALL>>>\n{"tool":"t","parameters":{}}\n<<<END_TOOL_CALL>>> after text'
            );
            expect(parts).toHaveLength(3);
            expect(parts[0]).toEqual({ text: 'before text ' });
            expect(parts[1].functionCall).toBeDefined();
            expect(parts[2]).toEqual({ text: ' after text' });
        });

        it('不完整的标记（只有开头）不消耗，保留在 buffer', () => {
            const parts = parser.appendText('text before <<<TOOL_CALL>>>\n{"tool":"incomplete');
            // 应该有 text part（标记之前的内容），标记和内容留在 buffer
            expect(parts.length).toBeGreaterThanOrEqual(1);
            expect(parts[0].text).toBe('text before ');
            // buffer 中保留了未完成的内容
            expect(parser.getPendingText().length).toBeGreaterThan(0);
        });

        it('flushIncompleteAsText 将残留 buffer 作为 text 输出', () => {
            parser.appendText('<<<TOOL_CALL>>>\n{"tool":"incomplete');
            const flushed = parser.flushIncompleteAsText();
            // 未完成的应被作为纯文本输出
            expect(flushed.length).toBeGreaterThan(0);
            expect(flushed[0].text).toBeDefined();
            // flush 后 buffer 清空
            expect(parser.getPendingText()).toBe('');
        });

        it('reset 清空 buffer', () => {
            parser.appendText('<<<TOOL_CALL>>>\n{"tool":"incomplete');
            expect(parser.getPendingText().length).toBeGreaterThan(0);
            parser.reset();
            expect(parser.getPendingText()).toBe('');
        });

        it('跨 chunk 增量解析：标记跨两个 fragment', () => {
            // 第一个 chunk：部分标记
            const parts1 = parser.appendText('<<<TOOL_C');
            // 不应输出任何已完成的 part
            const fcs1 = parts1.filter(p => p.functionCall);
            expect(fcs1).toHaveLength(0);

            // 第二个 chunk：补全标记和内容
            const parts2 = parser.appendText('ALL>>>\n{"tool":"test","parameters":{}}\n<<<END_TOOL_CALL>>>');
            const fcs2 = parts2.filter(p => p.functionCall);
            expect(fcs2).toHaveLength(1);
            expect(fcs2[0].functionCall!.name).toBe('test');
        });

        it('跨 chunk：标记头部跨片，尾部完整', () => {
            // 验证 longestSuffixPrefixLength 机制：前缀保护避免
            // 部分匹配的标记被误当作普通文本输出。
            // 发送 "<<<TOOL_CA" 作为第一个 chunk
            const parts1 = parser.appendText('<<<TOOL_CA');
            // 不应输出任何内容（因为全部是标记前缀）
            expect(parts1).toHaveLength(0);
            expect(parser.getPendingText()).toBe('<<<TOOL_CA');

            // 发送剩余部分
            const parts2 = parser.appendText('LL>>>\n{"tool":"t","parameters":{}}\n<<<END_TOOL_CALL>>>');
            const fcs = parts2.filter(p => p.functionCall);
            expect(fcs).toHaveLength(1);
        });

        it('无效 JSON 的工具调用块被当作纯文本输出', () => {
            // 为什么测试：parser 内部调用 toFunctionCallParts，它调用 parseJSONToolCalls。
            // 如果 JSON 解析失败返回 null，该块应作为普通文本输出而非丢弃。
            const parts = parser.appendText(
                '<<<TOOL_CALL>>>\n{invalid json}\n<<<END_TOOL_CALL>>>'
            );
            // 解析失败，整个块作为 text
            expect(parts.filter(p => p.functionCall)).toHaveLength(0);
            expect(parts.filter(p => p.text)).toHaveLength(1);
            expect(parts[0].text).toContain('<<<TOOL_CALL>>>');
        });
    });

    // ---------- XML 模式 ----------

    describe('XML mode', () => {
        let parser: IncrementalPromptToolParser;

        beforeEach(() => {
            parser = new IncrementalPromptToolParser('xml');
        });

        it('完整 XML 工具调用被解析为 functionCall part', () => {
            const parts = parser.appendText(
                '<tool_use>\n  <tool_name>read_file</tool_name>\n  <parameters>\n    <path>test.txt</path>\n  </parameters>\n</tool_use>'
            );
            const fcs = parts.filter(p => p.functionCall);
            expect(fcs).toHaveLength(1);
            expect(fcs[0].functionCall!.name).toBe('read_file');
            expect(fcs[0].functionCall!.args).toEqual({ path: 'test.txt' });
        });

        it('多个 XML 工具调用全部解析', () => {
            const parts = parser.appendText(
                '<tool_use><tool_name>read_file</tool_name><parameters><path>a.txt</path></parameters></tool_use>\n' +
                '<tool_use><tool_name>write_file</tool_name><parameters><path>b.txt</path></parameters></tool_use>'
            );
            const fcs = parts.filter(p => p.functionCall);
            expect(fcs).toHaveLength(2);
        });

        it('不完整的 XML 标记保留在 buffer', () => {
            parser.appendText('text <tool_use><tool_name>incomplete');
            expect(parser.getPendingText().length).toBeGreaterThan(0);
        });

        it('跨 chunk 增量解析', () => {
            parser.appendText('<tool');
            const parts2 = parser.appendText(
                '_use><tool_name>test</tool_name><parameters><x>1</x></parameters></tool_use>'
            );
            const fcs = parts2.filter(p => p.functionCall);
            expect(fcs).toHaveLength(1);
            expect(fcs[0].functionCall!.name).toBe('test');
        });
    });

    // ---------- 通用行为 ----------

    describe('通用行为', () => {
        it('reset 后可以重新开始解析', () => {
            const parser = new IncrementalPromptToolParser('json');
            parser.appendText('<<<TOOL_CALL>>>\n{"tool":"incomplete');
            parser.reset();
            expect(parser.getPendingText()).toBe('');

            const parts = parser.appendText(
                '<<<TOOL_CALL>>>\n{"tool":"test","parameters":{}}\n<<<END_TOOL_CALL>>>'
            );
            expect(parts.filter(p => p.functionCall)).toHaveLength(1);
        });

        it('flushIncompleteAsText 后 buffer 为空', () => {
            const parser = new IncrementalPromptToolParser('json');
            parser.appendText('<<<TOOL_CALL>>>\n{"tool":"incomplete');
            parser.flushIncompleteAsText();
            expect(parser.getPendingText()).toBe('');
        });
    });
});

// --------------- extractPromptToolParts ---------------

describe('extractPromptToolParts', () => {
    it('JSON 模式：完整文本解析出 functionCall', () => {
        const result = extractPromptToolParts(
            '<<<TOOL_CALL>>>\n{"tool":"read_file","parameters":{"path":"test.txt"}}\n<<<END_TOOL_CALL>>>',
            'json'
        );
        expect(result.parts.filter(p => p.functionCall)).toHaveLength(1);
        expect(result.trailingIncomplete).toBeUndefined();
    });

    it('XML 模式：完整文本解析出 functionCall', () => {
        const result = extractPromptToolParts(
            '<tool_use><tool_name>test</tool_name><parameters><x>1</x></parameters></tool_use>',
            'xml'
        );
        expect(result.parts.filter(p => p.functionCall)).toHaveLength(1);
    });

    it('flushIncompleteTailAsText: true（默认）时残留作为 text 输出', () => {
        const result = extractPromptToolParts(
            '<<<TOOL_CALL>>>\n{"tool":"incomplete',
            'json'
        );
        // 未完成的内容也应出现在 parts 中
        expect(result.parts.length).toBeGreaterThan(0);
        expect(result.trailingIncomplete).toBeUndefined();
    });

    it('flushIncompleteTailAsText: false 时残留放在 trailingIncomplete', () => {
        const result = extractPromptToolParts(
            '<<<TOOL_CALL>>>\n{"tool":"incomplete',
            'json',
            { flushIncompleteTailAsText: false }
        );
        expect(result.trailingIncomplete).toBeDefined();
        expect(result.trailingIncomplete!.length).toBeGreaterThan(0);
    });

    it('纯文本无标记时全部作为 text part', () => {
        const result = extractPromptToolParts('hello world', 'json');
        expect(result.parts).toEqual([{ text: 'hello world' }]);
    });
});
