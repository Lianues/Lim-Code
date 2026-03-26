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

export const FileType = {
    File: 1,
    Directory: 2,
};

export const Position = jest.fn();
export const Range = jest.fn();
export const commands = { executeCommand: jest.fn() };
export const SymbolKind = {};
