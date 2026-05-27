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
        const pathDescription = tool.declaration.parameters.properties.path.description;

        // 这个测试锁定 search_in_files 的提示词契约。
        // 为什么要测 description：模型是否把 file search 当成 history_search 使用，主要取决于工具声明，而不是 handler 内部实现。
        // 怎么测：只断言关键行为提示，避免完整快照让自然语言微调变得脆弱。
        // 目的：防止后续维护重新丢失“空格兜底、| 只属正则、没有 read 模式”的边界说明。
        expect(description).toContain('whitespace-separated multi-keyword queries first try the exact phrase');
        expect(description).toContain('Use isRegex=true for regex OR such as "foo|bar"');
        expect(description).toContain('in non-regex mode "|" is a literal character');
        expect(description).toContain('This tool has no read mode or start_line/end_line parameters');
        expect(description).toContain('use read_file to read matched files');
        expect(description).toContain('The path parameter accepts exactly one file or directory');
        expect(description).toContain('call search_in_files separately for each path in parallel');
        expect(queryDescription).toContain('automatically fall back to keyword OR search');
        expect(pathDescription).toContain('accepts exactly one file or directory');
        expect(pathDescription).toContain('make separate parallel search_in_files calls');
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

    it('returns a path warning when a zero-result search path looks like multiple whitespace-separated paths', async () => {
        setupWorkspace({
            'backend/modules/settings/index.ts': 'export const configValue = true;\n',
            'webview/handlers/SubAgentsHandlers.ts': 'export const handlerValue = true;\n'
        });

        const tool = registerSearchInFiles();
        const result = await tool.handler({
            mode: 'search',
            query: 'missingNeedle',
            path: 'backend/modules/settings webview/handlers frontend/src/components/settings',
            pattern: '*.ts',
            isRegex: false,
            maxResults: 10
        });

        // 这个测试锁定 path 参数的安全兜底。
        // 为什么不自动拆 path：真实目录名可能包含空格，自动拆分会把一个合法路径误拆成多个搜索范围。
        // 怎么测：当零命中且 path 明显像多个路径时，结果携带纠错信息，但仍不替用户扩展搜索范围。
        // 目的：引导模型把多个目录拆成多次并行 search_in_files 调用，避免静默搜索一个不存在的合成路径。
        expect(result.success).toBe(true);
        expect((result.data as any).count).toBe(0);
        expect((result.data as any).pathWarning).toMatchObject({
            type: 'possible_multiple_paths',
            candidates: ['backend/modules/settings', 'webview/handlers', 'frontend/src/components/settings']
        });
        expect((result.data as any).pathWarning.message).toContain('Run separate parallel search_in_files calls for each path');
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
