import * as vscode from 'vscode';
import { registerListFiles } from '../../tools/file/list_files';
import { registerFindFiles } from '../../tools/search/find_files';

function setupWorkspace(): void {
    // 修改原因：list_files 和 find_files 都依赖 VS Code workspaceFolders 与 Uri.joinPath，单测需要稳定的工作区根。
    // 修改方式：构造一个最小单根工作区，并让 joinPath 使用可预测的 fsPath 拼接。
    // 修改目的：测试文件行数元数据时不依赖真实文件系统或 VS Code 运行时。
    (vscode.workspace as any).workspaceFolders = [
        {
            name: 'workspace',
            uri: { fsPath: 'C:/repo', path: 'C:/repo', scheme: 'file' }
        }
    ];

    (vscode.Uri.joinPath as jest.Mock).mockImplementation((base: any, ...segments: string[]) => {
        // 修改原因：list_files 会用 joinPath(workspace, '.') 解析根目录，直接拼接会得到 C:/repo/./file，导致测试 fixture 查表失败。
        // 修改方式：在测试替身里过滤 '.' 片段，保持和真实 VS Code URI 解析接近的规范路径。
        // 修改目的：让单测验证 lineCount 行为本身，而不是被 mock 的路径格式差异干扰。
        const joined = [base.fsPath, ...segments.filter(segment => segment !== '.')].join('/');
        return { fsPath: joined, path: joined, scheme: 'file' };
    });
}

function setupReadFileByPath(files: Record<string, string | Uint8Array>): void {
    // 修改原因：行数统计通过 vscode.workspace.fs.readFile 读取文件内容，需要按 URI 返回不同 fixture。
    // 修改方式：用 fsPath 作为 key 查表，字符串自动转 Buffer，二进制 fixture 原样返回。
    // 修改目的：同一测试可同时覆盖文本文件和二进制文件的 lineCount 行为。
    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: any) => {
        const value = files[uri.fsPath];
        if (value === undefined) {
            throw new Error(`Unexpected readFile path: ${uri.fsPath}`);
        }
        return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    });
}

describe('file discovery line count metadata', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupWorkspace();
    });

    it('list_files 为文本文件 entry 添加 lineCount，并跳过二进制文件', async () => {
        // 修改原因：用户需要在目录列表阶段看到文件行数，以便决定是否范围读取。
        // 修改方式：模拟一个文本文件和一个 PNG 文件，断言只有文本 entry 有 lineCount。
        // 修改目的：锁定 list_files 的返回结构向后兼容地增加行数元数据。
        (vscode.workspace.fs as any).readDirectory = jest.fn().mockResolvedValue([
            ['notes.txt', vscode.FileType.File],
            ['image.png', vscode.FileType.File],
            ['src', vscode.FileType.Directory]
        ]);
        setupReadFileByPath({
            'C:/repo/notes.txt': 'alpha\nbeta\ngamma',
            'C:/repo/image.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
        });

        const result = await registerListFiles().handler({ paths: ['.'] });

        expect(result.success).toBe(true);
        const entries = result.data.results[0].entries;
        expect(entries).toContainEqual({ name: 'notes.txt', type: 'file', lineCount: 3 });
        expect(entries).toContainEqual({ name: 'image.png', type: 'file', lineCount: undefined });
        expect(entries).toContainEqual({ name: 'src/', type: 'directory' });
    });

    it('find_files 保留 files 数组，并在 fileDetails 中添加 lineCount', async () => {
        // 修改原因：find_files 现有调用方依赖 files 是字符串数组，不能为了行数把它改成对象数组。
        // 修改方式：保持 files 不变，新增 fileDetails: [{ path, lineCount }] 作为增强元数据。
        // 修改目的：兼顾向后兼容与模型读取决策所需的行数信息。
        (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
            { fsPath: 'C:/repo/src/a.ts', path: 'C:/repo/src/a.ts', scheme: 'file' },
            { fsPath: 'C:/repo/src/b.ts', path: 'C:/repo/src/b.ts', scheme: 'file' }
        ]);
        setupReadFileByPath({
            'C:/repo/src/a.ts': 'one\ntwo',
            'C:/repo/src/b.ts': 'single'
        });

        const result = await registerFindFiles().handler({ patterns: ['src/*.ts'] });

        expect(result.success).toBe(true);
        expect(result.data.results[0].files).toEqual(['src/a.ts', 'src/b.ts']);
        expect(result.data.results[0].fileDetails).toEqual([
            { path: 'src/a.ts', lineCount: 2 },
            { path: 'src/b.ts', lineCount: 1 }
        ]);
    });
});
