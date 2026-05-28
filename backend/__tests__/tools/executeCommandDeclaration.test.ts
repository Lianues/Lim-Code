/**
 * 1.2.2-fix：execute_command 工具声明提示词测试。
 *
 * 为什么要改：execute_command 的 cwd 规则属于提示词契约，缺少测试时后续整理描述很容易删掉关键约束。
 * 怎么改：直接实例化工具声明，分别覆盖单根与多根工作区下主描述和 cwd 参数描述中的路径规则。
 * 目的：确保 AI 能持续看到“workspace 内用相对路径、多根工作区显式前缀、workspace 外目标写在 command 内”的规则。
 */

jest.mock('child_process', () => ({
    execSync: jest.fn(),
    exec: jest.fn(),
    spawn: jest.fn(),
}));

import * as vscode from 'vscode';
import { createExecuteCommandTool } from '../../tools/terminal/execute_command';

function setWorkspaceFolders(folders: Array<{ name: string; fsPath: string }>): void {
    (vscode.workspace as any).workspaceFolders = folders.map(folder => ({
        name: folder.name,
        uri: { fsPath: folder.fsPath }
    }));
}

function getCwdDescription(): string {
    const tool = createExecuteCommandTool();
    return tool.declaration.parameters.properties.cwd.description;
}

describe('execute_command declaration cwd guidance', () => {
    afterEach(() => {
        (vscode.workspace as any).workspaceFolders = [];
    });

    it('documents single-root workspace cwd rules in the main and parameter descriptions', () => {
        setWorkspaceFolders([{ name: 'Lim-code', fsPath: 'C:/repo/Lim-code' }]);

        const tool = createExecuteCommandTool();
        const mainDescription = tool.declaration.description;
        const cwdDescription = tool.declaration.parameters.properties.cwd.description;

        expect(mainDescription).toContain('## cwd 工作目录规则');
        expect(mainDescription).toContain('`cwd` 是 Shell 的启动工作目录，不是要操作的文件或目录参数');
        expect(mainDescription).toContain('不要把 workspace 根目录拼成绝对路径');
        expect(mainDescription).toContain('单根工作区中，不传 `cwd` 或传 `.` 表示当前 workspace 根目录');

        expect(cwdDescription).toContain('workspace 内使用相对路径');
        expect(cwdDescription).toContain('单根工作区不传或填 "." 表示 workspace 根目录');
        expect(cwdDescription).toContain('workspace 外目标使用 command 内的绝对路径');
    });

    it('documents explicit workspace prefixes for multi-root workspaces', () => {
        setWorkspaceFolders([
            { name: 'backend-root', fsPath: 'C:/repo/backend-root' },
            { name: 'frontend-root', fsPath: 'C:/repo/frontend-root' },
        ]);

        const tool = createExecuteCommandTool();
        const mainDescription = tool.declaration.description;
        const cwdDescription = getCwdDescription();

        expect(mainDescription).toContain('多根工作区不要依赖省略 `cwd` 的默认首个工作区');
        expect(mainDescription).toContain('workspace_name/path');
        expect(mainDescription).toContain('@workspace_name/path');
        expect(mainDescription).toContain('当前可用工作区：backend-root, frontend-root');

        expect(cwdDescription).toContain('多根工作区必须使用 "workspace_name/path" 或 "@workspace_name/path"');
        expect(cwdDescription).toContain('Available workspaces: backend-root, frontend-root');
    });
});
