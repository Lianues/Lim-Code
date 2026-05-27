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
        const patternDescription = tool.declaration.parameters.properties.pattern.description;

        // 这个测试锁定 search_in_files 的中文提示词契约。
        // 为什么要测 description：模型是否把 file search 当成 history_search 使用，主要取决于工具声明，而不是 handler 内部实现。
        // 怎么测：只断言关键行为提示，避免完整快照让自然语言微调变得脆弱。
        // 目的：防止后续维护重新丢失“空格兜底、| 只属正则、没有 read 模式”的边界说明。
        expect(description).toContain('空格分隔的多关键词查询会先尝试完整短语');
        expect(description).toContain('需要使用 "foo|bar" 这类正则 OR 时，请设置 isRegex=true');
        expect(description).toContain('非正则模式下 "|" 是普通字面字符');
        expect(description).toContain('本工具没有 read 模式，也没有 start_line/end_line 参数');
        expect(description).toContain('需要读取匹配文件时请使用 read_file');
        expect(description).toContain('path 参数只能填写一个文件或一个目录');
        expect(description).toContain('请分别并行调用多次 search_in_files');
        expect(queryDescription).toContain('自动降级为关键词 OR 搜索');
        expect(pathDescription).toContain('只能填写一个文件或一个目录');
        expect(pathDescription).toContain('分别并行调用多次 search_in_files');
        // 为什么要测 pattern 文案：模型常把 *.ts 误当递归匹配，导致路径正确但子目录文件漏搜。
        // 怎么测：只锁定递归语义关键词，不对完整中文描述做快照，避免措辞调整导致测试脆弱。
        // 目的：防止 search_in_files 重新退回到只给 glob 示例、没有解释递归差异的提示词。
        expect(patternDescription).toContain('"*.ts" 只匹配搜索路径直属的一层文件');
        expect(patternDescription).toContain('递归搜索子目录，请使用 "**/*.ts"');
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
