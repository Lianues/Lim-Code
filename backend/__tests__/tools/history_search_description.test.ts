import { createHistorySearchToolDeclaration, registerHistorySearch } from '../../tools/history/history_search';
import type { Content } from '../../modules/conversation/types';

function createConversationContext(messages: Content[]) {
    return {
        conversationId: 'history-search-test',
        conversationStore: {
            getHistory: jest.fn().mockResolvedValue(messages)
        }
    } as any;
}

describe('history_search tool description', () => {
    it('explains the search-then-read workflow and snake_case parameters', () => {
        const declaration = createHistorySearchToolDeclaration();
        const description = declaration.description;

        // 这个测试锁定 history_search 的中文提示词契约。
        // 为什么要测 description：模型是否正确使用 history_search 主要取决于工具声明，而不是 handler 内部逻辑。
        // 怎么测：只断言关键行为提示，不做完整快照，避免文案微调造成脆弱测试。
        // 目的：防止后续维护时重新引入 startLine/endLine 或“search 等于完整读取”的误导。
        expect(description).toContain('search 只返回匹配行号和少量上下文');
        expect(description).toContain('"ssh.*root"');
        expect(description).toContain('必须设置 is_regex=true');
        expect(description).toContain('工具不会自动切换到正则模式');
        expect(description).toContain('mode="read"');
        expect(description).toContain('start_line 和 end_line');
        expect(description).toContain('不要使用 read_file 的 startLine/endLine');
        expect(description).toContain('而不是仓库文件');
        expect(description).toContain('单行读取永不截断');
    });

    it('marks search query as required and documents whitespace keyword fallback', () => {
        const declaration = createHistorySearchToolDeclaration();
        const queryDescription = declaration.parameters.properties.query.description;

        // query 不能在 JSON Schema 中条件必填，所以必须在参数 description 里说清楚。
        // 这里同时锁定多关键词兜底说明，因为模型经常用 “关键词 关键词 关键词” 的查询形态。
        expect(queryDescription).toContain('[search 模式，必填]');
        expect(queryDescription).toContain('空格分隔关键词');
        expect(queryDescription).toContain('".*"');
        expect(queryDescription).toContain('"\\."');
        expect(queryDescription).toContain('不是完整历史内容');
        const isRegexDescription = declaration.parameters.properties.is_regex.description;
        expect(isRegexDescription).toContain('"foo|bar"');
        expect(isRegexDescription).toContain('false 表示严格字面量搜索');
    });
});

describe('history_search keyword fallback', () => {
    it('returns suspected_regex diagnostics for regex-like literal zero-result queries without auto rerunning regex', async () => {
        const tool = registerHistorySearch();
        const context = createConversationContext([
            {
                role: 'user',
                parts: [{ text: 'ssh -i .ssh/id_ed25519 root@38.12.23.18' }]
            }
        ]);

        const result = await tool.handler(
            { mode: 'search', query: 'VPS0|38\\.12\\.23|moeblack\\.top|ssh.*root', is_regex: false },
            context
        );

        // 为什么测 history_search：它和 search_in_files 一样支持正则，但参数名是 is_regex，容易漏传后静默字面量零命中。
        // 怎么测：历史中有正则模式可命中的 ssh/root/IP 内容，但 literal 搜索不能命中，只应返回 suspected_regex 诊断。
        // 目的：确保工具提示模型显式重试 is_regex=true，而不是在后端自动改变搜索语义。
        expect(result.success).toBe(true);
        const output = String(result.data);
        expect(output).toContain('未找到');
        expect(output).toContain('[suspected_regex]');
        expect(output).toContain('is_regex=true');
        expect(output).toContain('.*');
        expect(output).toContain('\\.');
    });

    it('falls back to individual whitespace-separated keywords when the exact non-regex phrase has no match', async () => {
        const tool = registerHistorySearch();
        const context = createConversationContext([
            {
                role: 'user',
                parts: [{ text: 'Alpha decision was made in an earlier turn.' }]
            },
            {
                role: 'model',
                parts: [{ text: 'Beta implementation details were discussed separately.' }]
            }
        ]);

        const result = await tool.handler(
            { mode: 'search', query: 'Alpha Beta', is_regex: false },
            context
        );

        // 为什么测行为而不只测文案：description 能引导模型，但真正解决问题的是 handler 支持多关键词兜底。
        // 怎么测：历史中没有 “Alpha Beta” 完整短语，只有分散的 Alpha/Beta 行；期望仍能命中并返回兜底说明。
        // 目的：防止后续维护把非正则搜索又退回为只能匹配完整短语。
        expect(result.success).toBe(true);
        const output = String(result.data);
        expect(output).toContain('Alpha');
        expect(output).toContain('Beta');
        expect(output).toContain('Alpha, Beta');
        expect(output).toContain('>');
    });
});
