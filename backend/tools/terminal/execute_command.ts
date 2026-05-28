/**
 * 执行命令工具
 *
 * 使用 child_process 执行命令，捕获输出并返回
 * 支持实时输出推送到前端
 * 支持多工作区（Multi-root Workspaces）
 */

import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';
import { TextDecoder } from 'util';
import type { Tool, ToolResult, ToolContext } from '../types';

// tree-kill 库，用于跨平台终止进程树
// eslint-disable-next-line @typescript-eslint/no-var-requires
const treeKill = require('tree-kill') as (pid: number, signal?: string, callback?: (error?: Error) => void) => void;
import { getGlobalSettingsManager } from '../../core/settingsContext';
import { getDefaultExecuteCommandConfig } from '../../modules/settings';
import type { ShellConfig } from '../../modules/settings';
import { TaskManager, type TaskEvent } from '../taskManager';
import { getAllWorkspaces, parseWorkspacePath } from '../utils';
import { t } from '../../i18n';

/** 终端任务类型常量 */
const TASK_TYPE_TERMINAL = 'terminal';

/**
 * Shell 类型定义
 */
type ShellType = 'default' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'sh' | 'gitbash' | 'wsl';

type WorkspaceRootPromptInfo = { name: string; path: string };

/**
 * 终端进程信息
 */
interface TerminalProcess {
    id: string;
    command: string;
    cwd: string;
    shell: ShellType;
    process: cp.ChildProcess;
    output: string[];
    startTime: number;
    endTime?: number;
    exitCode?: number;
    killed?: boolean;
    error?: string;
}

/**
 * 活动终端进程管理
 */
const activeProcesses: Map<string, TerminalProcess> = new Map();

/**
 * 终端事件发射器
 * 用于实时推送终端输出到前端
 */
const terminalEmitter = new EventEmitter();

/**
 * 终端输出事件类型
 */
export interface TerminalOutputEvent {
    terminalId: string;
    type: 'start' | 'output' | 'error' | 'exit';
    data?: string;
    command?: string;  // start 事件时包含命令
    cwd?: string;      // start 事件时包含工作目录
    shell?: string;    // start 事件时包含 shell 类型
    exitCode?: number;
    killed?: boolean;
    duration?: number;
}

/**
 * 订阅终端输出
 * @param listener 监听器函数
 * @returns 取消订阅函数
 */
export function onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void {
    terminalEmitter.on('output', listener);
    return () => terminalEmitter.off('output', listener);
}

/**
 * 订阅终端任务事件（使用 TaskManager）
 * 这是统一事件系统的入口，可用于未来替换 terminalEmitter
 * @param listener 监听器函数
 * @returns 取消订阅函数
 */
export function onTerminalTaskEvent(listener: (event: TaskEvent) => void): () => void {
    return TaskManager.onTaskEventByType(TASK_TYPE_TERMINAL, listener);
}

/**
 * 发送终端输出事件
 */
function emitTerminalOutput(event: TerminalOutputEvent): void {
    terminalEmitter.emit('output', event);
}

/**
 * 获取最大输出行数配置
 * 从设置中读取，默认 50 行
 * -1 表示无限制
 */
function getMaxOutputLines(): number {
    const settingsManager = getGlobalSettingsManager();
    const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
    return config.maxOutputLines ?? 50;
}

/**
 * 生成唯一终端 ID（使用 TaskManager）
 */
function generateTerminalId(): string {
    return TaskManager.generateTaskId('terminal');
}

/**
 * 获取 shell 配置（从设置中读取）
 */
function getShellConfig(shellType: ShellType): {
    shell: string;
    shellArgs?: string[];
    prependCommand?: string;  // 在命令前添加的命令（用于设置编码等）
} {
    const platform = os.platform();
    const settingsManager = getGlobalSettingsManager();
    const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
    
    // 如果是 default，使用配置中的默认 shell
    let actualShellType = shellType;
    if (shellType === 'default') {
        actualShellType = config.defaultShell as ShellType;
    }
    
    // 从配置中查找 shell
    const shellConfig = config.shells.find(s => s.type === actualShellType);
    
    // 使用配置的路径或默认路径
    const customPath = shellConfig?.path;
    
    switch (actualShellType) {
        case 'powershell':
            if (platform === 'win32') {
                // PowerShell 需要设置输出编码为 UTF-8，同时设置控制台编码
                return {
                    shell: customPath || 'powershell.exe',
                    shellArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'],
                    prependCommand: '$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8;'
                };
            }
            return { shell: customPath || 'pwsh', shellArgs: ['-NoProfile', '-Command'] };
            
        case 'cmd':
            if (platform === 'win32') {
                // Windows cmd：直接使用 cmd.exe，通过 chcp 65001 设置 UTF-8 编码
                // 不再使用 PowerShell 包装，避免命令语法不兼容问题（如 && 运算符）
                // 使用 /s /c 参数确保命令中的引号被正确处理
                return {
                    shell: customPath || 'cmd.exe',
                    shellArgs: ['/s', '/c'],
                    prependCommand: 'chcp 65001 >nul &&'
                };
            }
            return {
                shell: customPath || 'cmd.exe',
                shellArgs: ['/s', '/c'],
                prependCommand: 'chcp 65001 >nul &&'
            };
            
        case 'bash':
            if (platform === 'win32') {
                // Windows: 优先使用 PATH 中的 bash
                return {
                    shell: customPath || 'bash.exe',
                    shellArgs: ['-c']
                };
            }
            return { shell: customPath || '/bin/bash', shellArgs: ['-c'] };
            
        case 'zsh':
            if (platform === 'win32') {
                // Windows 无 zsh，降级到 PowerShell（带 UTF-8 编码）
                return {
                    shell: 'powershell.exe',
                    shellArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'],
                    prependCommand: '$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8;'
                };
            }
            return { shell: customPath || '/bin/zsh', shellArgs: ['-c'] };
            
        case 'sh':
            if (platform === 'win32') {
                // Windows: 优先使用 PATH 中的 sh
                return {
                    shell: customPath || 'sh.exe',
                    shellArgs: ['-c']
                };
            }
            return { shell: customPath || '/bin/sh', shellArgs: ['-c'] };
            
        case 'gitbash':
            // Git Bash: 优先使用 PATH 中的 bash
            return {
                shell: customPath || 'bash.exe',
                shellArgs: ['-c']
            };
            
        case 'wsl':
            return { shell: 'wsl.exe', shellArgs: ['--', 'bash', '-c'] };
            
        default:
            // 使用配置的默认 shell
            if (platform === 'win32') {
                // Windows 默认使用 PowerShell（带 UTF-8 编码）
                return {
                    shell: 'powershell.exe',
                    shellArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'],
                    prependCommand: '$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8;'
                };
            }
            return { shell: '/bin/sh', shellArgs: ['-c'] };
    }
}

/**
 * 获取启用的 shell 列表（用于工具描述）
 */
export function getEnabledShellTypes(): string[] {
    const settingsManager = getGlobalSettingsManager();
    const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
    return config.shells.filter(s => s.enabled).map(s => s.type);
}

/**
 * 获取 Shell 的默认可执行文件路径（用于可用性检测）
 * 这个路径应该与 getShellConfig 中使用的路径一致
 */
function getDefaultShellPath(shellType: string): string {
    const platform = os.platform();
    
    switch (shellType) {
        case 'powershell':
            return platform === 'win32' ? 'powershell.exe' : 'pwsh';
        case 'cmd':
            return 'cmd.exe';
        case 'bash':
            // Windows 使用 PATH 中的 bash
            return platform === 'win32' ? 'bash.exe' : '/bin/bash';
        case 'zsh':
            return platform === 'win32' ? 'zsh.exe' : '/bin/zsh';
        case 'sh':
            // Windows 使用 PATH 中的 sh
            return platform === 'win32' ? 'sh.exe' : '/bin/sh';
        case 'gitbash':
            // Git Bash 使用 PATH 中的 bash
            return 'bash.exe';
        case 'wsl':
            return 'wsl.exe';
        default:
            return shellType;
    }
}

/**
 * 检测单个 Shell 是否可用
 */
export async function checkShellAvailability(shellType: string, customPath?: string): Promise<{
    available: boolean;
    reason?: string;
}> {
    const platform = os.platform();
    const shellPath = customPath || getDefaultShellPath(shellType);
    
    // Windows 特殊处理
    if (platform === 'win32') {
        // WSL 需要特殊检测
        if (shellType === 'wsl') {
            return new Promise((resolve) => {
                cp.exec('wsl --status', { timeout: 5000 }, (error) => {
                    if (error) {
                        resolve({ available: false, reason: t('tools.terminal.shellCheck.wslNotInstalled') });
                    } else {
                        resolve({ available: true });
                    }
                });
            });
        }
        
        // 对于绝对路径，检查文件是否存在
        if (shellPath.includes('\\') || shellPath.includes('/')) {
            const fs = require('fs');
            try {
                fs.accessSync(shellPath, fs.constants.X_OK);
                return { available: true };
            } catch {
                return { available: false, reason: t('tools.terminal.shellCheck.shellNotFound', { shellPath }) };
            }
        }
        
        // 对于命令名，使用 where 命令检查 PATH
        return new Promise((resolve) => {
            cp.exec(`where ${shellPath}`, { timeout: 5000 }, (error) => {
                if (error) {
                    resolve({ available: false, reason: t('tools.terminal.shellCheck.shellNotInPath', { shellPath }) });
                } else {
                    resolve({ available: true });
                }
            });
        });
    } else {
        // Unix 系统
        // 对于绝对路径，检查文件是否存在
        if (shellPath.startsWith('/')) {
            const fs = require('fs');
            try {
                fs.accessSync(shellPath, fs.constants.X_OK);
                return { available: true };
            } catch {
                return { available: false, reason: t('tools.terminal.shellCheck.shellNotFound', { shellPath }) };
            }
        }
        
        // 对于命令名，使用 which 命令检查 PATH
        return new Promise((resolve) => {
            cp.exec(`which ${shellPath}`, { timeout: 5000 }, (error) => {
                if (error) {
                    resolve({ available: false, reason: t('tools.terminal.shellCheck.shellNotInPath', { shellPath }) });
                } else {
                    resolve({ available: true });
                }
            });
        });
    }
}

/**
 * 检测所有 Shell 的可用性
 */
export async function checkAllShellsAvailability(shells: Array<{ type: string; path?: string }>): Promise<Map<string, { available: boolean; reason?: string }>> {
    const results = new Map<string, { available: boolean; reason?: string }>();
    
    await Promise.all(
        shells.map(async (shell) => {
            const result = await checkShellAvailability(shell.type, shell.path);
            results.set(shell.type, result);
        })
    );
    
    return results;
}

/**
 * 获取工作区根目录路径（默认返回第一个）
 */
function getWorkspaceRootPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * 获取所有工作区路径
 */
function getAllWorkspaceRoots(): WorkspaceRootPromptInfo[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return [];
    return folders.map(f => ({ name: f.name, path: f.uri.fsPath }));
}

/**
 * 根据名称获取工作区路径
 */
function getWorkspacePathByName(name: string): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return undefined;
    const folder = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
    return folder?.uri.fsPath;
}

/**
 * 截取最后 N 行
 */
function getLastLines(lines: string[], n: number): string[] {
    if (lines.length <= n) {
        return lines;
    }
    return lines.slice(-n);
}

type StreamDecodeMode = 'utf8' | 'gbk';

/**
 * 统计 Unicode 替换字符数量
 *
 * 当字节流按错误编码解码时，通常会出现大量 U+FFFD（�）
 */
function countReplacementChars(text: string): number {
    let count = 0;
    for (const ch of text) {
        if (ch === '\uFFFD') {
            count += 1;
        }
    }
    return count;
}

/**
 * 判断是否应从 UTF-8 降级到 GBK 解码
 */
function shouldFallbackToGbk(utf8Text: string, gbkText: string, chunk: Buffer): boolean {
    // 纯 ASCII 内容不需要降级
    if (!chunk.some(byte => byte >= 0x80)) {
        return false;
    }

    const utf8ReplacementCount = countReplacementChars(utf8Text);
    if (utf8ReplacementCount === 0) {
        return false;
    }

    const gbkReplacementCount = countReplacementChars(gbkText);
    return gbkReplacementCount < utf8ReplacementCount;
}

/**
 * 根据当前模式解码流式输出
 */
function decodeWithMode(
    chunk: Buffer,
    modeRef: { mode: StreamDecodeMode },
    utf8Decoder: StringDecoder,
    gbkDecoder?: TextDecoder
): string {
    if (modeRef.mode === 'gbk' && gbkDecoder) {
        return gbkDecoder.decode(chunk, { stream: true });
    }

    const utf8Text = utf8Decoder.write(chunk);
    if (!gbkDecoder) {
        return utf8Text;
    }

    const gbkPreview = new TextDecoder('gbk').decode(chunk);
    if (shouldFallbackToGbk(utf8Text, gbkPreview, chunk)) {
        modeRef.mode = 'gbk';
        return gbkDecoder.decode(chunk, { stream: true });
    }

    return utf8Text;
}

/**
 * 获取操作系统名称
 */
function getOSName(): string {
    const platform = os.platform();
    switch (platform) {
        case 'win32':
            return 'Windows';
        case 'darwin':
            return 'macOS';
        case 'linux':
            return 'Linux';
        case 'freebsd':
            return 'FreeBSD';
        default:
            return platform;
    }
}

/**
 * 同步检测 Shell 是否可用
 */
function checkShellAvailabilitySync(shellType: string, customPath?: string): boolean {
    const platform = os.platform();
    const shellPath = customPath || getDefaultShellPath(shellType);
    
    try {
        if (platform === 'win32') {
            // WSL 特殊处理
            if (shellType === 'wsl') {
                cp.execSync('wsl --status', { timeout: 3000, stdio: 'ignore' });
                return true;
            }
            
            // 绝对路径检查文件存在
            if (shellPath.includes('\\') || shellPath.includes('/')) {
                const fs = require('fs');
                fs.accessSync(shellPath, fs.constants.X_OK);
                return true;
            }
            
            // 使用 where 检查 PATH
            cp.execSync(`where ${shellPath}`, { timeout: 3000, stdio: 'ignore' });
            return true;
        } else {
            // 绝对路径检查文件存在
            if (shellPath.startsWith('/')) {
                const fs = require('fs');
                fs.accessSync(shellPath, fs.constants.X_OK);
                return true;
            }
            
            // 使用 which 检查 PATH
            cp.execSync(`which ${shellPath}`, { timeout: 3000, stdio: 'ignore' });
            return true;
        }
    } catch {
        return false;
    }
}

/**
 * 获取启用且可用的 Shell 列表
 */
function getAvailableShells(): Array<{ type: string; displayName: string; isDefault: boolean }> {
    const settingsManager = getGlobalSettingsManager();
    const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
    
    return config.shells
        .filter(s => s.enabled && checkShellAvailabilitySync(s.type, s.path))
        .map(s => ({
            type: s.type,
            displayName: s.displayName,
            isDefault: s.type === config.defaultShell
        }));
}

/**
 * 获取可用的 Shell 描述
 */
function getAvailableShellsDescription(): string {
    const availableShells = getAvailableShells();
    
    if (availableShells.length === 0) {
        return '- No available Shell';
    }
    
    return availableShells
        .map(s => `- ${s.type}: ${s.displayName}${s.isDefault ? ' (default)' : ''}`)
        .join('\n');
}

/**
 * 获取默认 Shell 名称
 */
function getDefaultShellName(): string {
    const settingsManager = getGlobalSettingsManager();
    const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
    const defaultShell = config.shells.find(s => s.type === config.defaultShell);
    return defaultShell?.displayName || config.defaultShell;
}

/**
 * 获取启用且可用的 Shell 类型列表（用于 enum）
 */
function getEnabledShellTypesForEnum(): string[] {
    const availableShells = getAvailableShells();
    
    const types = availableShells.map(s => s.type);
    
    // 确保 default 始终在列表开头
    return ['default', ...types];
}

/**
 * 获取默认 Shell 类型
 */
function getDefaultShellType(): string {
    const settingsManager = getGlobalSettingsManager();
    const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
    return config.defaultShell;
}

/**
 * 获取已启用但当前不可用的 Shell 描述
 */
function getUnavailableShellsDescription(): string {
    const settingsManager = getGlobalSettingsManager();
    const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
    const availableTypes = new Set(getAvailableShells().map(s => s.type));
    const unavailableShells = config.shells
        .filter(s => s.enabled && !availableTypes.has(s.type))
        .map(s => `- ${s.type}: ${s.displayName}`);

    if (unavailableShells.length === 0) {
        return '- 无';
    }

    return unavailableShells.join('\n');
}

/**
 * execute_command 的中文 Shell 使用提示词。
 *
 * 设计原则：保持 execute_command 作为 pure shell 工具，不新增 argv/script/stdin 模式；
 * 通过明确每种 shell 的解析规则降低模型误用概率。
 */
function getExecuteCommandShellGuidanceDescription(
    workspaceRoots: WorkspaceRootPromptInfo[],
    isMultiRoot: boolean
): string {
    const defaultShellType = getDefaultShellType();
    const maxOutputLines = getMaxOutputLines() === -1 ? '全部' : `最后 ${getMaxOutputLines()}`;

    return [
        '## 重要语义',
        '',
        '`command` 是一段 Shell 文本，不是 argv 数组。Function Calling 只负责把字符串交给工具；随后该字符串会被 `shell` 参数指定的 Shell 继续解析。你必须按照所选 Shell 的语法书写命令。',
        '',
        getCwdGuidanceDescription(workspaceRoots, isMultiRoot),
        '',
        '## Shell 选择规则',
        '',
        `- 如果不传 \`shell\` 或设置为 \`default\`，将使用当前默认 Shell：\`${defaultShellType}\`（${getDefaultShellName()}）。`,
        '- 当前只能选择 “Enabled Shells” 列表和参数 enum 中出现的 shell；不要选择不可用的 shell。',
        '- Windows 文件系统、PowerShell cmdlet、对象管道：优先选择 `powershell`。',
        '- CMD 内置命令、批处理兼容行为：选择 `cmd`。',
        '- POSIX sh 语法、`grep` / `sed` / `find` / `head`、heredoc：选择 `sh` / `bash` / `gitbash`。',
        '- macOS 默认通常是 `zsh`；Linux 默认通常是 `bash`。',
        '- 返回输出默认只保留' + maxOutputLines + '行；长任务请设置 `timeout`，单位毫秒，`0` 表示不超时。',
        '',
        '## 当前已配置但不可用的 Shell',
        '',
        getUnavailableShellsDescription(),
        '',
        getPowerShellGuidanceDescription(),
        '',
        getCmdGuidanceDescription(),
        '',
        getPosixShellGuidanceDescription('sh'),
        '',
        getPosixShellGuidanceDescription('bash'),
        '',
        getGitMsysGuidanceDescription(),
        '',
        getWslGuidanceDescription(),
        '',
        getZshGuidanceDescription(),
        '',
        getPipeGuidanceDescription(),
        '',
        getComplexCommandGuidanceDescription(),
        '',
        getSshGuidanceDescription()
    ].join('\n');
}

/**
 * 1.2.1-fix：补全 execute_command 的 cwd 选择规则。
 *
 * 为什么要改：模型只看到“relative to workspace root”时，容易把 `cwd`、`command` 内路径、workspace 内外绝对路径混在一起。
 * 怎么改：在主工具描述中集中解释 `cwd` 的职责、单根/多根工作区格式，以及 workspace 内外路径边界。
 * 目的：让模型稳定选择工作目录，减少把 workspace 根目录拼成绝对路径或在多根工作区误用默认根目录的情况。
 */
function getCwdGuidanceDescription(workspaceRoots: WorkspaceRootPromptInfo[], isMultiRoot: boolean): string {
    const baseRules = [
        '## cwd 工作目录规则',
        '',
        '- `cwd` 是 Shell 的启动工作目录，不是要操作的文件或目录参数；真正的操作目标仍应写在 `command` 里。',
        '- `cwd` 主要用于 workspace 内目录；当操作目标在 workspace 根目录之内时，`cwd` 和 `command` 里的路径都应使用相对路径。',
        '- 不要把 workspace 根目录拼成绝对路径，例如不要把 `backend` 写成 `C:\\...\\workspace\\backend`。',
        '- 文件就在 workspace 根目录时，`cwd` 不填或填 `.`，并在 `command` 中直接写文件名，例如 `Get-Content package.json`。',
        '- 子目录操作时，`cwd` 写相对目录，例如 `backend`、`frontend/src`，命令内再写相对于该 `cwd` 的路径。',
        '- 只有操作目标位于 workspace 之外时，才在 `command` 中使用绝对路径，例如系统临时目录、下载目录或其他盘符；`cwd` 仍优先保持在 workspace 内。'
    ];

    if (workspaceRoots.length === 0) {
        return [
            ...baseRules,
            '- 当前没有打开 workspace，工具执行时会报错；打开 workspace 后再按上述规则填写 `cwd`。'
        ].join('\n');
    }

    if (isMultiRoot) {
        return [
            ...baseRules,
            '- 多根工作区不要依赖省略 `cwd` 的默认首个工作区；必须显式写 `workspace_name/path` 或 `@workspace_name/path`。',
            '- 多根工作区的根目录写 `workspace_name` 或 `@workspace_name`；子目录写 `workspace_name/backend`、`@workspace_name/frontend/src`。',
            `- 当前可用工作区：${workspaceRoots.map(w => w.name).join(', ')}。`
        ].join('\n');
    }

    return [
        ...baseRules,
        '- 单根工作区中，不传 `cwd` 或传 `.` 表示当前 workspace 根目录。'
    ].join('\n');
}

/**
 * 1.2.1-fix：把同一套 cwd 规则压缩到参数 schema 描述里。
 *
 * 为什么要改：不同模型有时只读参数描述，不一定完整读完主工具描述。
 * 怎么改：让 `cwd` 字段本身也说明根目录、相对路径、多根工作区和外部路径边界。
 * 目的：在 Function Calling 参数层直接降低 `cwd` 填错概率。
 */
function getCwdParameterDescription(workspaceRoots: WorkspaceRootPromptInfo[], isMultiRoot: boolean): string {
    const common = '`cwd` 是 Shell 启动工作目录，不是目标文件路径；workspace 内使用相对路径，不要拼接 workspace 绝对路径。';

    if (workspaceRoots.length === 0) {
        return `${common} 当前没有打开 workspace，工具执行时会报错。`;
    }

    if (isMultiRoot) {
        return `${common} 多根工作区必须使用 "workspace_name/path" 或 "@workspace_name/path"；根目录写 workspace_name 或 @workspace_name。Available workspaces: ${workspaceRoots.map(w => w.name).join(', ')}`;
    }

    return `${common} 单根工作区不传或填 "." 表示 workspace 根目录；子目录写 "backend"、"frontend/src"；workspace 外目标使用 command 内的绝对路径。`;
}

function getPowerShellGuidanceDescription(): string {
    return [
        '## PowerShell 规则（`shell: "powershell"`）',
        '',
        '- PowerShell 不是 Bash；不要把 Bash 语法直接写进 PowerShell。',
        '- 单引号保留字面量：`\'a|b\'`、`\'$HOME\'`、`\'$(hostname)\'`。',
        '- 双引号会展开 PowerShell 变量和子表达式：`"$env:TEMP"`、`"$(Get-Date)"`。',
        '- 环境变量写法是 `$env:NAME`，例如 `$env:TEMP`，不是 Bash 的 `$NAME`。',
        '- 未引用的 `|` 是 PowerShell 管道，示例：`Get-ChildItem | Select-Object -First 10`。',
        '- 调用路径含空格的可执行文件，用 `&`：`& "C:\\Program Files\\nodejs\\node.exe" --version`。',
        '- 调 native exe 时，PowerShell 解析后还会进入 Windows/native argv 规则；引号和反斜杠紧贴双引号时要格外小心。',
        '- 复杂 Node/Python/JSON/正则内容不要硬写成 `node -e "..."`，优先用 single-quoted here-string 写临时脚本。'
    ].join('\n');
}

function getCmdGuidanceDescription(): string {
    return [
        '## CMD 规则（`shell: "cmd"`）',
        '',
        '- CMD 不是 PowerShell，也不是 Bash。',
        '- 环境变量写法是 `%NAME%`，例如 `%TEMP%`。',
        '- `|`、`<`、`>`、`&`、`^` 是 CMD 特殊字符。',
        '- 管道示例：`dir | findstr foo`。',
        '- 字面管道符可放进双引号：`"a|b"`；必要时使用 `a^|b`。如果已经在双引号内，不要额外写 `^|`。',
        '- 多命令串联可用 `&&`：`npm install && npm test`。',
        '- 路径含空格时使用双引号。复杂脚本通常优先改用 PowerShell 或 sh。'
    ].join('\n');
}

function getPosixShellGuidanceDescription(shellName: 'sh' | 'bash'): string {
    return [
        `## ${shellName} 规则（\`shell: "${shellName}"\`）`,
        '',
        `- 使用 POSIX/${shellName} 风格语法，不要使用 PowerShell 的 \`$env:NAME\` 或 CMD 的 \`%NAME%\`。`,
        '- 单引号保留字面量：`\'a|b\'`、`\'$HOME\'`、`\'$(hostname)\'`。',
        '- 双引号允许变量展开和命令替换：`"$HOME"`、`"$(hostname)"`。',
        '- 未引用的 `|` 是管道，示例：`find . -name \'*.ts\' | head`。',
        '- 复杂多行内容优先使用强字面量 heredoc：`cat > /tmp/probe.sh <<\'EOF\' ... EOF`。',
        '- 如果这是 Windows 上的 Git sh/Git Bash，还要遵守 Git/MSYS 路径转换规则。'
    ].join('\n');
}

function getGitMsysGuidanceDescription(): string {
    return [
        '## Git Bash / Git sh / MSYS 额外规则',
        '',
        '- Git Bash/Git sh 使用类 sh/bash 语法，但运行在 Windows/MSYS 环境中，不等于真实 Linux。',
        '- 传给 Windows 原生程序的以 `/` 开头参数可能被自动转换为 Windows 路径，例如 `/a/b/c` 可能变成 `A:/b/c`。',
        '- 正则 `/xxx/`、Linux 远端路径、Docker volume、`-L/regex/` 等要小心路径转换污染。',
        '- 必要时可在命令前设置 `MSYS_NO_PATHCONV=1`，或使用 `MSYS2_ARG_CONV_EXCL=*`。'
    ].join('\n');
}

function getWslGuidanceDescription(): string {
    return [
        '## WSL 规则（`shell: "wsl"`）',
        '',
        '- WSL 模式通过 `wsl.exe -- bash -c <command>` 执行，命令进入 WSL 内的 bash 解析。',
        '- 路径应使用 WSL/Linux 格式，例如 `/mnt/c/Users/...`，不要直接使用 PowerShell 的 `$env:TEMP`。',
        '- 从 WSL 调 Windows 程序通常需要写 `.exe`，例如 `notepad.exe`。',
        '- 如果当前环境提示 WSL 未安装或未启用，不要选择 `wsl`。'
    ].join('\n');
}

function getZshGuidanceDescription(): string {
    return [
        '## Zsh 规则（`shell: "zsh"`）',
        '',
        '- Zsh 是类 POSIX shell，常见管道、重定向、单引号、双引号、heredoc 规则接近 sh/bash。',
        '- 单引号保留字面量；双引号允许参数展开和命令替换。',
        '- Zsh 有自己的 glob、alias、扩展规则；不要假定所有 Bash 专有行为完全一致。',
        '- 复杂多行内容仍优先写临时脚本再执行。'
    ].join('\n');
}

function getPipeGuidanceDescription(): string {
    return [
        '## 管道符 `|` 规则',
        '',
        '- `|` 是否是管道，取决于当前 shell 是否在未引用状态下看到它。',
        '- 作为管道：PowerShell `Get-ChildItem | Select-Object -First 10`；CMD `dir | findstr foo`；sh/bash/zsh `find . -name \'*.ts\' | head`。',
        '- 作为普通字符：PowerShell `\'a|b\'`；CMD `"a|b"` 或必要时 `a^|b`；sh/bash/zsh `\'a|b\'`。',
        '- 不要把一个 shell 的转义规则套到另一个 shell：PowerShell 不使用 CMD 的 `^|`；CMD 不依赖 Bash 单引号；sh/bash 不使用 `$env:NAME`。'
    ].join('\n');
}

function getComplexCommandGuidanceDescription(): string {
    return [
        '## 复杂命令规则',
        '',
        '- 简单命令可以直接内联；包含多层引号、JSON、正则、Node/Python 代码、Nginx/systemd 配置、SSH 远端脚本时，不要强行写成一行。',
        '- PowerShell 推荐：用 `@\' ... \'@` single-quoted here-string 写入临时脚本，再用 `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))` 保存为 UTF-8 无 BOM 后执行。',
        '- sh/bash/zsh 推荐：用 `cat > /tmp/script.sh <<\'EOF\' ... EOF` 写强字面量 heredoc，再执行脚本。',
        '- CMD 不适合承载复杂多行脚本；除非用户明确要求 CMD，否则复杂逻辑优先用 PowerShell 或 sh。',
        '- 诊断引号/管道问题时，先写一个 argv/hex 探针确认目标程序实际收到什么，不要猜。'
    ].join('\n');
}

function getSshGuidanceDescription(): string {
    return [
        '## SSH 多层解析规则',
        '',
        '- SSH 至少有两层解析：本地 shell 先解析整条 `ssh ...` 命令；远端用户 shell 再解析远端命令。远端命令不是 argv 直达目标程序。',
        '- 在 PowerShell 中调用 SSH，外层单引号只能阻止本地 PowerShell 展开；远端 shell 仍会解释 `$HOME`、`$(hostname)`、`|` 等。',
        '- 当前实测链路 PowerShell → ssh → 远端 bash 中，如果需要远端 shell 用双引号保护参数，PowerShell 命令里通常要写 `\\"`；如果要远端收到字面 `$HOME`，写 `\\"\\$HOME\\"`；字面 `$(hostname)` 写 `\\"\\$(hostname)\\"`。',
        '- 复杂远端操作不要硬塞一行：优先本地生成脚本，`scp` 上传到远端 `/tmp/...`，`ssh` 执行远端脚本，完成后清理脚本。',
        '- Windows 用户目录 SSH key 示例：`ssh -i "$env:USERPROFILE\\.ssh\\id_ed25519" root@host \'hostname\'`。'
    ].join('\n');
}

/**
 * 创建执行命令工具
 */
export function createExecuteCommandTool(): Tool {
    const osName = getOSName();
    const osArch = os.arch();
    const osRelease = os.release();
    
    // 获取工作区信息
    const workspaceRoots = getAllWorkspaceRoots();
    const isMultiRoot = workspaceRoots.length > 1;
    
    // 生成工作区说明
    let workspaceDescription = '';
    if (isMultiRoot) {
        workspaceDescription = '\n\n**Multi-root Workspace Mode:**\n' +
            workspaceRoots.map(ws => `- ${ws.name}: ${ws.path}`).join('\n') +
            '\n\nUse "workspace_name/path" format to specify the working directory';
    }
    
    // 1.2.1-fix：cwd 参数描述复用统一规则生成器。
    // 为什么要改：旧描述过短，模型经常不知道应填工作区相对路径还是绝对路径。
    // 怎么改：按单根/多根工作区动态生成 schema 字段说明。
    // 目的：让只读取参数 schema 的模型也能正确选择 cwd。
    const cwdDescription = getCwdParameterDescription(workspaceRoots, isMultiRoot);
    
    return {
        declaration: {
            name: 'execute_command',
            category: 'terminal',
            strict: true,  // API 端强制 schema 校验
            description: `执行 Shell 命令并返回输出。

**当前用户环境：**
- OS: ${osName} (${osArch})
- OS Version: ${osRelease}
- Default Shell: ${getDefaultShellName()}

**Enabled Shells / 当前可用 Shell：**
${getAvailableShellsDescription()}${workspaceDescription}

${getExecuteCommandShellGuidanceDescription(workspaceRoots, isMultiRoot)}`,
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: '要执行的 Shell 命令文本。注意：这是给所选 shell 解析的命令字符串，不是 argv 数组。'
                    },
                    cwd: {
                        type: 'string',
                        description: cwdDescription
                    },
                    shell: {
                        type: 'string',
                        description: `Shell 类型。可选值：${getEnabledShellTypesForEnum().join(', ')}。不传或传 default 时使用当前默认 Shell。`,
                        enum: getEnabledShellTypesForEnum(),
                        default: 'default'
                    },
                    timeout: {
                        type: 'number',
                        description: '超时时间（毫秒）。0 表示不超时，默认 60000（60 秒）。',
                        default: 60000
                    }
                },
                required: ['command']
            }
        },
        handler: async (args, context?: ToolContext): Promise<ToolResult> => {
            const command = args.command as string;
            const cwd = args.cwd as string | undefined;
            const shell = (args.shell as ShellType) || 'default';
            const timeout = (args.timeout as number) ?? 60000;
            
            // 使用 context 中的 toolId 或生成新的
            const terminalId = context?.toolId as string || generateTerminalId();
            
            // 获取外部的 abortSignal（用于用户取消对话时终止终端）
            const externalAbortSignal = context?.abortSignal as AbortSignal | undefined;

            if (!command) {
                return { success: false, error: 'command is required' };
            }

            const workspaces = getAllWorkspaces();
            if (workspaces.length === 0) {
                return { success: false, error: 'No workspace folder open' };
            }

            // 获取设置管理器和配置
            const settingsManager = getGlobalSettingsManager();
            const config = settingsManager?.getExecuteCommandConfig() || getDefaultExecuteCommandConfig();
            
            // 确定实际使用的 shell 类型
            let actualShellType = shell;
            if (shell === 'default') {
                actualShellType = config.defaultShell as ShellType;
            }
            
            // 检查 shell 是否启用
            const shellInfo = config.shells.find(s => s.type === actualShellType);
            if (shellInfo && !shellInfo.enabled) {
                return {
                    success: false,
                    error: `Shell "${actualShellType}" is not enabled, please enable it in settings and try again`
                };
            }
            
            // 检查 shell 可用性
            const availability = await checkShellAvailability(actualShellType, shellInfo?.path);
            if (!availability.available) {
                return {
                    success: false,
                    error: `Shell "${actualShellType}" is not available: ${availability.reason || 'unknown reason'}. Please configure the correct path in settings.`
                };
            }

            // 计算工作目录（支持多工作区）
            let workingDir: string;
            let workspaceName: string | undefined;
            
            if (cwd) {
                // 解析带工作区前缀的路径
                const { workspace, relativePath } = parseWorkspacePath(cwd);
                if (workspace) {
                    workingDir = path.join(workspace.fsPath, relativePath);
                    workspaceName = workspaces.length > 1 ? workspace.name : undefined;
                } else {
                    // 使用默认工作区
                    workingDir = path.join(workspaces[0].fsPath, cwd);
                }
            } else {
                // 默认使用第一个工作区
                workingDir = workspaces[0].fsPath;
            }

            // 获取 shell 配置
            const shellConfig = getShellConfig(shell);

            return new Promise((resolve) => {
                // 检查是否已经取消
                if (externalAbortSignal?.aborted) {
                    resolve({
                        success: false,
                        error: '⚠️ User cancelled the command execution. Please wait for user\'s next instruction.',
                        cancelled: true
                    });
                    return;
                }
                
                try {
                    // 构建最终命令（可能需要添加前置命令）
                    let finalCommand = shellConfig.prependCommand
                        ? `${shellConfig.prependCommand} ${command}`
                        : command;

                    // CMD /s /c 特殊处理：需要将整个命令用双引号包裹
                    // /s 参数会去除最外层引号，同时保留命令中的内层引号
                    // 这解决了 FINDSTR 等命令中多个搜索词被错误解析的问题
                    const isCmdWithS = shellConfig.shell.toLowerCase().includes('cmd') &&
                        shellConfig.shellArgs?.includes('/s');
                    const isWindows = os.platform() === 'win32';
                    if (isCmdWithS) {
                        finalCommand = `"${finalCommand}"`;
                    }

                    // 构建命令参数
                    const spawnArgs = shellConfig.shellArgs
                        ? [...shellConfig.shellArgs, finalCommand]
                        : [finalCommand];

                    // 注入环境变量以便更好地支持 UTF-8（主要针对 Windows 上的 Unix 工具）
                    const env = { ...process.env };
                    if (isWindows) {
                        // 很多工具（如 git, node, python）在 Windows 上通过这些变量识别编码
                        if (!env.LANG) env.LANG = 'en_US.UTF-8';
                        if (!env.PYTHONIOENCODING) env.PYTHONIOENCODING = 'utf-8';
                    }

                    // 启动进程
                    const proc = cp.spawn(shellConfig.shell, spawnArgs, {
                        cwd: workingDir,
                        shell: false,
                        env,
                        windowsHide: true,
                        // 在 Windows 上，如果是 cmd.exe 且使用了 /s 参数，
                        // 我们需要使用 windowsVerbatimArguments 来防止 Node.js 转义引号。
                        // 因为我们已经手动在 finalCommand 两边加上了引号。
                        // @ts-ignore - windowsVerbatimArguments is a valid option on Windows
                        windowsVerbatimArguments: isWindows && isCmdWithS
                    });

                    // 创建终端进程信息
                    const terminalProcess: TerminalProcess = {
                        id: terminalId,
                        command,
                        cwd: workingDir,
                        shell,
                        process: proc,
                        output: [],
                        startTime: Date.now()
                    };

                    activeProcesses.set(terminalId, terminalProcess);
                    
                    // 使用 TaskManager 注册任务
                    // 创建一个 AbortController 用于统一取消
                    const taskAbortController = new AbortController();
                    
                    // 监听 taskAbortController 的 signal（通过 TaskManager.cancelTask 取消时触发）
                    {
                        const taskAbortHandler = () => {
                            // 通过 TaskManager 取消时，终止进程树
                            killTerminalProcess(terminalId);
                        };
                        
                        taskAbortController.signal.addEventListener('abort', taskAbortHandler, { once: true });
                        
                        // 进程结束时移除监听器
                        proc.on('close', () => {
                            taskAbortController.signal.removeEventListener('abort', taskAbortHandler);
                        });
                    }
                    
                    TaskManager.registerTask(terminalId, TASK_TYPE_TERMINAL, taskAbortController, {
                        command,
                        cwd: workingDir,
                        shell
                    });
                    
                    // 监听外部的 abortSignal（用户取消对话时触发）
                    if (externalAbortSignal) {
                        const abortHandler = () => {
                            // 调用 killTerminalProcess 终止进程
                            killTerminalProcess(terminalId);
                        };
                        
                        externalAbortSignal.addEventListener('abort', abortHandler, { once: true });
                        
                        // 进程结束时移除监听器
                        proc.on('close', () => {
                            externalAbortSignal.removeEventListener('abort', abortHandler);
                        });
                    }
                    
                    // 发送 start 事件，通知前端进程已启动
                    emitTerminalOutput({
                        terminalId,
                        type: 'start',
                        command,
                        cwd: workingDir,
                        shell
                    });

                    // 默认按 UTF-8 解码；Windows 上所有 shell 均支持自动降级到 GBK
                    const canUseGbkFallback = isWindows;
                    const stdoutUtf8Decoder = new StringDecoder('utf8');
                    const stderrUtf8Decoder = new StringDecoder('utf8');
                    const stdoutGbkDecoder = canUseGbkFallback ? new TextDecoder('gbk') : undefined;
                    const stderrGbkDecoder = canUseGbkFallback ? new TextDecoder('gbk') : undefined;
                    const stdoutDecodeModeRef: { mode: StreamDecodeMode } = { mode: 'utf8' };
                    const stderrDecodeModeRef: { mode: StreamDecodeMode } = { mode: 'utf8' };

                    let stdoutRemaining = '';
                    let stderrRemaining = '';

                    // 收集输出并实时推送
                    proc.stdout?.on('data', (data: Buffer) => {
                        const text = decodeWithMode(data, stdoutDecodeModeRef, stdoutUtf8Decoder, stdoutGbkDecoder);
                        const content = stdoutRemaining + text;
                        const lines = content.split(/\r?\n/);
                        stdoutRemaining = lines.pop() || '';
                        
                        if (lines.length > 0) {
                            terminalProcess.output.push(...lines);
                        }
                        
                        // 实时推送输出到前端
                        emitTerminalOutput({
                            terminalId,
                            type: 'output',
                            data: text
                        });
                    });

                    proc.stderr?.on('data', (data: Buffer) => {
                        const text = decodeWithMode(data, stderrDecodeModeRef, stderrUtf8Decoder, stderrGbkDecoder);
                        const content = stderrRemaining + text;
                        const lines = content.split(/\r?\n/);
                        stderrRemaining = lines.pop() || '';

                        if (lines.length > 0) {
                            terminalProcess.output.push(...lines);
                        }
                        
                        // 实时推送错误输出到前端
                        emitTerminalOutput({
                            terminalId,
                            type: 'error',
                            data: text
                        });
                    });

                    // 进程结束时处理剩余的输出
                    proc.on('close', () => {
                        const stdoutTail = (stdoutDecodeModeRef.mode === 'gbk' && stdoutGbkDecoder)
                            ? stdoutGbkDecoder.decode()
                            : stdoutUtf8Decoder.end();

                        if (stdoutTail) {
                            const content = stdoutRemaining + stdoutTail;
                            const lines = content.split(/\r?\n/);
                            stdoutRemaining = lines.pop() || '';
                            if (lines.length > 0) {
                                terminalProcess.output.push(...lines);
                            }
                        }

                        const stderrTail = (stderrDecodeModeRef.mode === 'gbk' && stderrGbkDecoder)
                            ? stderrGbkDecoder.decode()
                            : stderrUtf8Decoder.end();

                        if (stderrTail) {
                            const content = stderrRemaining + stderrTail;
                            const lines = content.split(/\r?\n/);
                            stderrRemaining = lines.pop() || '';
                            if (lines.length > 0) {
                                terminalProcess.output.push(...lines);
                            }
                        }

                        if (stdoutRemaining) {
                            terminalProcess.output.push(stdoutRemaining);
                            stdoutRemaining = '';
                        }
                        if (stderrRemaining) {
                            terminalProcess.output.push(stderrRemaining);
                            stderrRemaining = '';
                        }
                    });

                    // 设置超时
                    let timeoutHandle: NodeJS.Timeout | undefined;
                    if (timeout > 0) {
                        timeoutHandle = setTimeout(() => {
                            terminalProcess.killed = true;
                            terminalProcess.error = `Command timed out after ${timeout}ms`;
                            // 使用 tree-kill 终止整个进程树，而非仅杀父进程
                            const pid = proc.pid;
                            if (pid) {
                                treeKill(pid, 'SIGTERM', (err) => {
                                    if (err) {
                                        try {
                                            proc.kill('SIGKILL');
                                        } catch {
                                            // 忽略错误，进程可能已经退出
                                        }
                                    }
                                });
                            } else {
                                proc.kill('SIGTERM');
                            }
                        }, timeout);
                    }

                    // 进程结束
                    proc.on('close', (code) => {
                        if (timeoutHandle) {
                            clearTimeout(timeoutHandle);
                        }

                        terminalProcess.endTime = Date.now();
                        terminalProcess.exitCode = code ?? undefined;

                        // 从配置获取最大输出行数
                        const maxLines = getMaxOutputLines();
                        const lastOutput = maxLines === -1
                            ? terminalProcess.output
                            : getLastLines(terminalProcess.output, maxLines);
                        const duration = terminalProcess.endTime - terminalProcess.startTime;

                        // 从活动进程中移除
                        activeProcesses.delete(terminalId);
                        
                        // 使用 TaskManager 注销任务
                        const status = terminalProcess.killed ? 'cancelled' : (code === 0 ? 'completed' : 'error');
                        TaskManager.unregisterTask(terminalId, status, {
                            exitCode: code,
                            duration,
                            killed: terminalProcess.killed
                        });

                        // 检查是否是外部 abortSignal 触发的终止
                        const isExternalAbort = externalAbortSignal?.aborted && terminalProcess.killed;
                        
                        // 被用户杀死的进程也算成功（不显示错误）
                        const success = code === 0 || terminalProcess.killed === true;
                        
                        // 确定错误信息
                        let error: string | undefined;
                        if (isExternalAbort) {
                            // 外部取消（用户点击中断按钮）
                            error = 'User cancelled the command execution. Please wait for user\'s next instruction.';
                        } else if (terminalProcess.error) {
                            // 超时等系统错误
                            error = terminalProcess.error;
                        } else if (terminalProcess.killed) {
                            // 用户通过终端 UI 手动终止，不设置 error（成功状态）
                            error = undefined;
                        } else if (code !== 0 && code !== null) {
                            // 非零退出码
                            error = `Command exited with code ${code}`;
                        }

                        // 推送退出事件到前端
                        emitTerminalOutput({
                            terminalId,
                            type: 'exit',
                            exitCode: code ?? undefined,
                            killed: terminalProcess.killed,
                            duration
                        });

                        // 简化返回结构：AI 已知 command/cwd/shell，只需返回结果
                        // 如果输出被截断，添加简单提示
                        const wasTruncated = maxLines !== -1 && terminalProcess.output.length > maxLines;
                        const truncatedNote = wasTruncated
                            ? `(Output truncated: showing last ${lastOutput.length} of ${terminalProcess.output.length} lines)`
                            : undefined;
                        
                        resolve({
                            success: isExternalAbort ? false : success,
                            data: {
                                // 前端需要这些用于 UI 显示，但 AI 不需要（会在 ConversationManager 中过滤）
                                terminalId,
                                command,
                                cwd: workingDir,
                                shell,
                                exitCode: code,
                                killed: terminalProcess.killed || false,
                                duration,
                                // AI 只需要 output 和 exitCode
                                output: lastOutput.join('\n'),
                                truncatedNote
                            },
                            error,
                            cancelled: isExternalAbort
                        });
                    });

                    proc.on('error', (err) => {
                        if (timeoutHandle) {
                            clearTimeout(timeoutHandle);
                        }

                        terminalProcess.endTime = Date.now();
                        terminalProcess.error = err.message;

                        const errMaxLines = getMaxOutputLines();
                        const lastOutput = errMaxLines === -1
                            ? terminalProcess.output
                            : getLastLines(terminalProcess.output, errMaxLines);
                        const duration = terminalProcess.endTime - terminalProcess.startTime;

                        // 从活动进程中移除
                        activeProcesses.delete(terminalId);
                        
                        // 使用 TaskManager 注销任务
                        TaskManager.unregisterTask(terminalId, 'error', {
                            error: err.message,
                            duration
                        });

                        // 推送错误退出事件
                        emitTerminalOutput({
                            terminalId,
                            type: 'exit',
                            exitCode: -1,
                            killed: false,
                            duration
                        });

                        resolve({
                            success: false,
                            data: {
                                // 前端需要这些用于 UI 显示
                                terminalId,
                                command,
                                cwd: workingDir,
                                shell,
                                output: lastOutput.join('\n')
                            },
                            error: `Failed to execute command: ${err.message}`
                        });
                    });

                } catch (error) {
                    resolve({
                        success: false,
                        error: `Failed to start command: ${error instanceof Error ? error.message : String(error)}`
                    });
                }
            });
        }
    };
}

/**
 * 杀掉终端进程
 * 同时支持直接调用和通过 TaskManager 取消
 *
 * 使用 tree-kill 库来跨平台终止进程树（包括所有子进程）
 * tree-kill 在 Windows 上使用 taskkill /T，在 Unix 上使用 SIGTERM/SIGKILL
 */
export function killTerminalProcess(terminalId: string): {
    success: boolean;
    output?: string;
    error?: string;
} {
    const terminalProcess = activeProcesses.get(terminalId);
    
    if (!terminalProcess) {
        // 尝试通过 TaskManager 取消（可能任务存在但进程已结束）
        const taskResult = TaskManager.cancelTask(terminalId);
        if (taskResult.success) {
            return { success: true };
        }
        return {
            success: false,
            error: `Terminal ${terminalId} not found or already exited`
        };
    }

    try {
        const pid = terminalProcess.process.pid;
        
        if (pid) {
            // 使用 tree-kill 终止进程树
            // tree-kill 会自动处理不同平台的差异：
            // - Windows: 使用 taskkill /F /T /PID
            // - Unix: 使用 ps 查找子进程并发送信号
            treeKill(pid, 'SIGTERM', (err) => {
                if (err) {
                    // 如果 tree-kill 失败，回退到直接终止进程
                    try {
                        terminalProcess.process.kill('SIGKILL');
                    } catch {
                        // 忽略错误，进程可能已经退出
                    }
                }
            });
        } else {
            // 没有 PID，使用默认方式
            terminalProcess.process.kill('SIGTERM');
        }
        
        terminalProcess.killed = true;
        terminalProcess.endTime = Date.now();

        const killMaxLines = getMaxOutputLines();
        const lastOutput = killMaxLines === -1
            ? terminalProcess.output
            : getLastLines(terminalProcess.output, killMaxLines);
        
        // TaskManager 会在 proc.on('close') 事件中自动注销
        
        return {
            success: true,
            output: lastOutput.join('\n')
        };
    } catch (error) {
        return {
            success: false,
            error: `Failed to kill terminal: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * 通过 TaskManager 取消终端任务
 * 这是统一的取消接口
 */
export function cancelTerminalTask(terminalId: string): {
    success: boolean;
    error?: string;
} {
    // 先尝试杀掉进程
    const killResult = killTerminalProcess(terminalId);
    if (killResult.success) {
        return { success: true };
    }
    
    // 如果进程不存在，尝试通过 TaskManager 取消
    return TaskManager.cancelTask(terminalId);
}

/**
 * 获取终端进程输出
 */
export function getTerminalOutput(terminalId: string): {
    success: boolean;
    output?: string;
    running?: boolean;
    error?: string;
} {
    const terminalProcess = activeProcesses.get(terminalId);
    
    if (!terminalProcess) {
        return {
            success: false,
            error: `Terminal ${terminalId} not found`
        };
    }

    const outputMaxLines = getMaxOutputLines();
    const lastOutput = outputMaxLines === -1
        ? terminalProcess.output
        : getLastLines(terminalProcess.output, outputMaxLines);
    
    return {
        success: true,
        output: lastOutput.join('\n'),
        running: terminalProcess.endTime === undefined
    };
}

/**
 * 获取所有活动终端
 */
export function getActiveTerminalProcesses(): Array<{
    id: string;
    command: string;
    cwd: string;
    shell: ShellType;
    running: boolean;
    startTime: number;
}> {
    const result = [];
    for (const [id, proc] of activeProcesses) {
        result.push({
            id,
            command: proc.command,
            cwd: proc.cwd,
            shell: proc.shell,
            running: proc.endTime === undefined,
            startTime: proc.startTime
        });
    }
    return result;
}

/**
 * 清理已完成的终端进程
 */
export function cleanupTerminals(): void {
    for (const [id, proc] of activeProcesses) {
        if (proc.endTime !== undefined) {
            activeProcesses.delete(id);
        }
    }
}

/**
 * 注册执行命令工具
 */
export function registerExecuteCommand(): Tool {
    return createExecuteCommandTool();
}

/**
 * 导出活动终端 Map（用于其他模块）
 */
export function getActiveTerminals(): Map<string, TerminalProcess> {
    return activeProcesses;
}