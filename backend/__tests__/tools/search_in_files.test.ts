import * as vscode from 'vscode';
import { createSearchInFilesTool, registerSearchInFiles } from '../../tools/search/search_in_files';

const encoder = new TextEncoder();

function uri(fsPath: string) {
    return { fsPath, path: fsPath, scheme: 'file' };
}

function setupWorkspace(files: Record<string, string>): void {
    (vscode.workspace as any).workspaceFolders = [
        {
            name: 'workspace',
            uri: uri('C:/repo')
        }
    ];

    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(
        Object.keys(files).map(file => uri(`C:/repo/${file}`))
    );

    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ size: 128, type: vscode.FileType.File });
    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (fileUri: { fsPath: string }) => {
        const relativePath = fileUri.fsPath.replace(/^C:\/repo\//, '');
        return encoder.encode(files[relativePath] ?? '');
    });
}

describe('search_in_files tool description', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupWorkspace({});
    });

    it('documents whitespace keyword fallback and keeps pipe as regex-only OR syntax', () => {
        const tool = createSearchInFilesTool();
        const description = tool.declaration.description;
        const queryDescription = tool.declaration.parameters.properties.query.description;

        // 这个测试锁定 search_in_files 的提示词契约。
        // 为什么要测 description：模型是否把 file search 当成 history_search 使用，主要取决于工具声明，而不是 handler 内部实现。
        // 怎么测：只断言关键行为提示，避免完整快照让自然语言微调变得脆弱。
        // 目的：防止后续维护重新丢失“空格兜底、| 只属正则、没有 read 模式”的边界说明。
        expect(description).toContain('whitespace-separated multi-keyword queries first try the exact phrase');
        expect(description).toContain('Use isRegex=true for regex OR such as "foo|bar"');
        expect(description).toContain('in non-regex mode "|" is a literal character');
        expect(description).toContain('This tool has no read mode or start_line/end_line parameters');
        expect(description).toContain('use read_file to read matched files');
        expect(queryDescription).toContain('automatically fall back to keyword OR search');
    });
});

describe('search_in_files whitespace keyword fallback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('falls back to escaped keyword OR search when a non-regex exact phrase has no matches', async () => {
        setupWorkspace({
            'alpha.ts': 'const alphaValue = 1;\n',
            'beta.ts': 'const betaValue = 2;\n',
            'literal-pipe.ts': 'const union: Alpha | Beta = value;\n'
        });

        const tool = registerSearchInFiles();
        const result = await tool.handler({
            mode: 'search',
            query: 'alphaValue betaValue',
            path: '.',
            pattern: '**/*.ts',
            isRegex: false,
            maxResults: 10
        });

        // 这个测试锁定“完整短语优先，失败后空格关键词兜底”的行为。
        // 为什么要测 handler：提示词只能减少误用，真正避免零命中的是搜索逻辑本身。
        // 怎么测：测试文件中没有完整短语 alphaValue betaValue，但分别存在两个关键词；期望第二轮 OR 搜索命中两个文件。
        // 目的：让 search_in_files 与 history_search 的非正则多关键词体验一致，同时保留返回中的 queryFallback 证据。
        expect(result.success).toBe(true);
        expect((result.data as any).count).toBe(2);
        expect((result.data as any).results.map((item: any) => item.file).sort()).toEqual(['alpha.ts', 'beta.ts']);
        expect((result.data as any).queryFallback).toEqual({
            applied: true,
            originalQuery: 'alphaValue betaValue',
            keywords: ['alphaValue', 'betaValue']
        });
    });

    it('does not split pipe characters in non-regex search', async () => {
        setupWorkspace({
            'union.ts': 'type Pair = Alpha | Beta;\n',
            'alpha.ts': 'const AlphaOnly = true;\n',
            'beta.ts': 'const BetaOnly = true;\n'
        });

        const tool = registerSearchInFiles();
        const result = await tool.handler({
            mode: 'search',
            query: 'Alpha | Beta',
            path: '.',
            pattern: '**/*.ts',
            isRegex: false,
            maxResults: 10
        });

        // 这个测试锁定 `|` 的非正则字面量语义。
        // 为什么要测：如果把 `|` 当作普通分隔符，会误把 TypeScript 联合类型、Shell 管道和 Markdown 表格当成多关键词搜索。
        // 怎么测：完整短语 Alpha | Beta 存在时必须直接命中 union.ts，不触发空格兜底。
        // 目的：保留正则模式的 OR 能力，同时避免普通文件搜索产生过宽召回。
        expect(result.success).toBe(true);
        expect((result.data as any).count).toBe(1);
        expect((result.data as any).results[0].file).toBe('union.ts');
        expect((result.data as any).queryFallback).toBeUndefined();
    });
});
