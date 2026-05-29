/**
 * 1.2.2-fix：execute_command 工具声明提示词测试。
 *
 * 为什么要改：execute_command 的 cwd 规则属于提示词契约，缺少测试时后续整理描述很容易删掉关键约束。
 * 怎么改：直接实例化工具声明，分别覆盖单根与多根工作区下主描述和 cwd 参数描述中的路径规则。
 * 目的：确保 AI 能持续看到“workspace 内用相对路径、多根工作区显式前缀、workspace 外目标写在 command 内”的规则。
 */

jest.mock('child_process', () => {
    const { EventEmitter } = require('events');

    const exec = jest.fn((_command: string, _options: unknown, callback: (error: Error | null) => void) => {
        callback(null);
    });

    const spawn = jest.fn(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.pid = 12345;
        process.nextTick(() => proc.emit('close', 0));
        return proc;
    });

    return {
        execSync: jest.fn(),
        exec,
        spawn,
    };
});

jest.mock('../../core/settingsContext', () => ({
    getGlobalSettingsManager: jest.fn(),
}));

import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getGlobalSettingsManager } from '../../core/settingsContext';
import { getDefaultExecuteCommandConfig, DEFAULT_SECURITY_SETTINGS } from '../../modules/settings';
import { createExecuteCommandTool } from '../../tools/terminal/execute_command';
import { SkillsManager, setSkillsManager } from '../../modules/skills';

function setWorkspaceFolders(folders: Array<{ name: string; fsPath: string }>): void {
    (vscode.workspace as any).workspaceFolders = folders.map(folder => ({
        name: folder.name,
        uri: { fsPath: folder.fsPath }
    }));
}

function mockSettings(security: { allowSkillDirectoryAccessViaExecuteCommand: unknown } = DEFAULT_SECURITY_SETTINGS): void {
    const executeCommandConfig = {
        ...getDefaultExecuteCommandConfig(),
        defaultShell: 'powershell',
        shells: [
            { type: 'powershell', enabled: true, displayName: 'PowerShell' }
        ]
    };

    (getGlobalSettingsManager as jest.Mock).mockReturnValue({
        getExecuteCommandConfig: jest.fn(() => executeCommandConfig),
        getSecuritySettings: jest.fn(() => security),
    });
}

async function writeTestSkill(root: string, id: string, description: string): Promise<void> {
    const skillDir = path.join(root, id);
    await fs.promises.mkdir(skillDir, { recursive: true });
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ${id}
description: ${description}
---
# ${id}`, 'utf-8');
}

function getCwdDescription(): string {
    const tool = createExecuteCommandTool();
    return tool.declaration.parameters.properties.cwd.description;
}

describe('execute_command declaration cwd guidance', () => {
    beforeEach(() => {
        mockSettings();
        jest.clearAllMocks();
    });

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

    it('does not expose the Skill directory break-glass setting as a tool parameter', () => {
        setWorkspaceFolders([{ name: 'Lim-code', fsPath: 'C:/repo/Lim-code' }]);

        const tool = createExecuteCommandTool();
        const properties = tool.declaration.parameters.properties;

        // 为什么要改：高危开关只能由宿主机器级设置控制，不能让模型在单次 function call 中传参打开。
        // 怎么改：断言 execute_command schema 仍然只暴露命令执行所需参数。
        // 目的：阻断 prompt injection 通过工具参数绕过 Skill 目录 preflight。
        expect(properties).toHaveProperty('command');
        expect(properties).toHaveProperty('cwd');
        expect(properties).toHaveProperty('shell');
        expect(properties).toHaveProperty('timeout');
        expect(properties).not.toHaveProperty('allowSkillDirectoryAccessViaExecuteCommand');
    });
});

describe('execute_command Skill access preflight policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorkspaceFolders([{ name: 'Lim-code', fsPath: 'C:/repo/Lim-code' }]);
    });

    afterEach(() => {
        (vscode.workspace as any).workspaceFolders = [];
    });

    it('rejects Skill directory access by default', async () => {
        mockSettings();

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: 'Get-Content .limcode/skills/example/SKILL.md' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Direct shell access to Skill directories is blocked');
        expect(cp.exec).not.toHaveBeenCalled();
        expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('does not treat string true as permission to bypass Skill directory preflight', async () => {
        mockSettings({ allowSkillDirectoryAccessViaExecuteCommand: 'true' });

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: 'Get-Content .limcode/skills/example/SKILL.md' });

        // 为什么要改：settings/webview 边界可能传入字符串或其它 truthy 值。
        // 怎么改：测试运行时只接受严格布尔 true。
        // 目的：防止非预期配置形态打开 Skill 目录 shell 访问。
        expect(result.success).toBe(false);
        expect(result.error).toContain('Direct shell access to Skill directories is blocked');
        expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('rejects PowerShell string concatenation that reconstructs a builtin Skill path', async () => {
        mockSettings();

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: "Get-Content ('resources/skill' + 's/write-a-skill/SKILL.md')" });

        // 为什么要加：只检查原始命令 substring 会漏掉 PowerShell 在执行前拼接出来的 resources/skills 路径。
        // 怎么改：测试静态可见的简单 `+` 拼接会被 execute_command preflight 拒绝。
        // 目的：阻止模型绕过 read_skill_resource 的 manifest/hash 路径直接读取内置 Skill。
        expect(result.success).toBe(false);
        expect(result.error).toContain('Direct shell access to Skill directories is blocked');
        expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('rejects POSIX quote concatenation that reconstructs a builtin Skill path', async () => {
        mockSettings();

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: "cat resources/skill''s/write-a-skill/SKILL.md", shell: 'sh' });

        // 为什么要加：POSIX shell 会把相邻 quoted/unquoted 片段拼成一个 argv，原始文本不一定含有 resources/skills 连续字面量。
        // 怎么改：测试去引号后的检测变体能识别 resources/skills。
        // 目的：让 sh/gitbash 场景也不能用引用拼接绕过 Skill 资源访问边界。
        expect(result.success).toBe(false);
        expect(result.error).toContain('Direct shell access to Skill directories is blocked');
        expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('rejects relative segment normalization that resolves into a builtin Skill path', async () => {
        mockSettings();

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: "Get-Content 'resources/not-here/../skills/write-a-skill/SKILL.md'" });

        // 为什么要加：shell 和文件系统会归一化 segment/..，但旧 preflight 不折叠 `..` 时看不到 resources/skills marker。
        // 怎么改：测试保守折叠后的检测变体能拒绝等价 Skill 路径。
        // 目的：防止通过 `..` 变体直接读取内置 Skill 文件。
        expect(result.success).toBe(false);
        expect(result.error).toContain('Direct shell access to Skill directories is blocked');
        expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('rejects glob patterns that can expand into a builtin Skill path', async () => {
        mockSettings();

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: "Get-Content 'resources/skill?/write-a-skill/SKILL.md'" });

        // 为什么要加：shell glob 可以把 skill? 展开成 skills，使原始文本不包含 resources/skills 连续字面量。
        // 怎么改：测试 preflight 的 glob 检测变体能拒绝常见通配符路径。
        // 目的：继续强制内置 Skill 文件通过 read_skill_resource 的 manifest/hash 访问。
        expect(result.success).toBe(false);
        expect(result.error).toContain('Direct shell access to Skill directories is blocked');
        expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('rejects protected Skill cwd paths after relative segment normalization', async () => {
        mockSettings();

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: 'Get-Content SKILL.md', cwd: 'resources/not-here/../skills/write-a-skill' });

        // 为什么要加：即使命令本身不含 Skill 路径，cwd 指向 Skill 目录也能让相对文件名绕过 manifest/hash 读取。
        // 怎么改：把 cwd 和 command 一起生成检测变体，并折叠 cwd 中的 `..`。
        // 目的：阻止 cwd+相对路径组合直接访问内置 Skill 文件。
        expect(result.success).toBe(false);
        expect(result.error).toContain('Direct shell access to Skill directories is blocked');
        expect(cp.spawn).not.toHaveBeenCalled();
    });

    it('rejects direct access to a shadowed builtin Skill root', async () => {
        mockSettings();
        const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-exec-shadow-workspace-'));
        const globalStorage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-exec-shadow-global-'));
        const builtinSkillsPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-exec-shadow-builtin-'));
        try {
            await writeTestSkill(path.join(workspace, '.limcode', 'skills'), 'shadowed-skill', 'Project shadows builtin');
            await writeTestSkill(builtinSkillsPath, 'shadowed-skill', 'Builtin must remain protected');
            const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage, builtinSkillsPath });
            await manager.initialize();
            setSkillsManager(manager);

            const tool = createExecuteCommandTool();
            const directBuiltinFile = path.join(builtinSkillsPath, 'shadowed-skill', 'SKILL.md');
            const result = await tool.handler({ command: `Get-Content "${directBuiltinFile}"` });

            // 为什么要改：被项目同名 Skill shadow 的 builtin 目录不会进入已加载 Skill 列表，但仍是受保护 Skill 资源区域。
            // 怎么改：构造 project 覆盖 builtin 的真实扫描状态，并尝试通过 execute_command 直接读取 builtin 文件。
            // 目的：防止模型绕过 read_skill_resource 的 manifest、textReadable 和 sha256 校验。
            expect(manager.getSkill('shadowed-skill')?.source).toBe('project-limcode');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Direct shell access to a Skill root is blocked');
            expect(cp.spawn).not.toHaveBeenCalled();
        } finally {
            await fs.promises.rm(workspace, { recursive: true, force: true });
            await fs.promises.rm(globalStorage, { recursive: true, force: true });
            await fs.promises.rm(builtinSkillsPath, { recursive: true, force: true });
        }
    });

    it('skips only the Skill preflight when the machine-level break-glass setting is strictly true', async () => {
        mockSettings({ allowSkillDirectoryAccessViaExecuteCommand: true });

        const tool = createExecuteCommandTool();
        const result = await tool.handler({ command: 'Write-Output "ok"', cwd: '.limcode/skills/example' });

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        expect(cp.exec).toHaveBeenCalled();
        expect(cp.spawn).toHaveBeenCalled();
    });
});
