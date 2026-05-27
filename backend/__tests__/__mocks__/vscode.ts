// Minimal vscode mock for unit tests
export const workspace = {
    workspaceFolders: [],
    fs: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        stat: jest.fn(),
        createDirectory: jest.fn(),
        delete: jest.fn(),
    },
    findFiles: jest.fn(),
    openTextDocument: jest.fn(),
    asRelativePath: jest.fn(),
    getWorkspaceFolder: jest.fn(),
};

export const Uri = {
    file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
    joinPath: jest.fn(),
};

/**
 * vscode.RelativePattern 的最小测试替身。
 *
 * 为什么要改：search_in_files 的真实实现会用 RelativePattern 约束搜索根和 glob，旧 mock 没有该构造器，导致无法覆盖文件搜索行为。
 * 怎么改：保留 base 与 pattern 两个字段，足够让单测验证 findFiles 的调用路径，同时不模拟 VS Code 内部 glob 引擎。
 * 目的：让搜索工具的行为测试可以直接执行 handler，而不是只测试提示词或私有函数。
 */
export const RelativePattern = jest.fn().mockImplementation((base: unknown, pattern: string) => ({
    base,
    pattern,
}));

export const FileType = {
    File: 1,
    Directory: 2,
};

export const Position = jest.fn();
export const Range = jest.fn();
export const commands = { executeCommand: jest.fn() };
export const SymbolKind = {};
