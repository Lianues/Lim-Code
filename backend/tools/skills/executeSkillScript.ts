import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Tool, ToolContext, ToolDeclaration, ToolResult, ToolRegistration } from '../types';
import { getSkillsManager } from '../../modules/skills';
import { getGlobalSettingsManager } from '../../core/settingsContext';
import { hashFile } from '../../modules/skills/resourceManifest';
import { getAllWorkspaces, parseWorkspacePath } from '../utils';

interface ExecuteSkillScriptArgs {
    name: string;
    relativePath: string;
    args?: string[];
    cwd?: string;
    timeout?: number;
}

const DEFAULT_SKILL_SCRIPT_TIMEOUT_MS = 60000;
const MAX_SKILL_SCRIPT_TIMEOUT_MS = 300000;

function normalizeSkillScriptTimeout(timeout?: number): number {
    // 为什么要改：旧逻辑允许 0 或负数关闭计时器，Skill 脚本可无限运行。
    // 怎么改：非正数/非有限值回落默认值，正数再钳制到最大 5 分钟。
    // 目的：保留用户可配置超时，同时避免脚本执行成为 DoS 面。
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
        return DEFAULT_SKILL_SCRIPT_TIMEOUT_MS;
    }
    return Math.min(timeout, MAX_SKILL_SCRIPT_TIMEOUT_MS);
}

function getExtension(relativePath: string): string {
    return path.posix.extname(relativePath).toLowerCase();
}

function resolveRunner(stagedPath: string, relativePath: string): { command: string; args: string[] } | { error: string } {
    const ext = getExtension(relativePath);
    const isWin = process.platform === 'win32';

    if (ext === '.py') return { command: isWin ? 'python' : 'python3', args: [stagedPath] };
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return { command: 'node', args: [stagedPath] };
    if (ext === '.ps1') return { command: isWin ? 'powershell.exe' : 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stagedPath] };
    if (ext === '.sh' || ext === '.bash' || ext === '.zsh') {
        if (isWin) return { command: 'bash.exe', args: [stagedPath] };
        return { command: ext === '.zsh' ? 'zsh' : 'sh', args: [stagedPath] };
    }
    if (ext === '.cmd' || ext === '.bat') {
        return { error: `${ext} scripts are not supported by execute_skill_script because cmd.exe requires shell parsing. Use PowerShell, Python, Node, or sh scripts instead.` };
    }
    return { error: `Unsupported skill script extension: ${ext || '(none)'}` };
}

export function generateExecuteSkillScriptDeclaration(): ToolDeclaration {
    return {
        name: 'execute_skill_script',
        description: `Execute an allowlisted script bundled with a Skill using structured arguments.

Use this instead of execute_command when a Skill instructs you to run a script from its scripts/ directory. Do not construct absolute Skill paths manually. The tool validates the manifest entry, checks Skill trust/enabled state, stages the verified script content, and executes via argv (not shell string concatenation). This tool normally requires user confirmation and is rejected when Skill shell execution is disabled.`,
        category: 'skills',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Skill name from read_skill.' },
                relativePath: { type: 'string', description: 'Script manifest relativePath, e.g. scripts/check.py.' },
                args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the script as argv strings.' },
                cwd: { type: 'string', description: 'Optional workspace-relative working directory for the script process. Defaults to the extension process cwd.' },
                timeout: { type: 'number', description: 'Timeout in milliseconds. Defaults to 60000.' }
            },
            required: ['name', 'relativePath']
        }
    };
}

async function stageScript(sourcePath: string, relativePath: string, expectedSha256: string): Promise<{ dir: string; file: string }> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-skill-script-'));
    const stagedName = `script${path.extname(relativePath) || '.txt'}`;
    const file = path.join(dir, stagedName);
    await fs.promises.copyFile(sourcePath, file);
    const stagedHash = await hashFile(file);
    if (stagedHash !== expectedSha256) {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw new Error('Skill script changed before staging. Refresh skills and ask for confirmation again.');
    }
    if (process.platform !== 'win32') {
        await fs.promises.chmod(file, 0o500);
    }
    return { dir, file };
}

function cleanupStaging(dir: string): void {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

function redactStagingPaths(output: string, stagedDir: string, stagedFile: string): string {
    return output
        .split(stagedFile).join('[skill-script]')
        .split(stagedDir).join('[skill-staging]');
}

function resolveWorkspaceCwd(cwd?: string): { ok: true; cwd: string } | { ok: false; error: string } {
    const workspaces = getAllWorkspaces();
    if (workspaces.length === 0) {
        return { ok: true, cwd: process.cwd() };
    }

    if (!cwd || cwd.trim() === '.') {
        return { ok: true, cwd: workspaces[0].fsPath };
    }
    if (path.isAbsolute(cwd) || /^[a-zA-Z]:/.test(cwd) || cwd.startsWith('\\\\')) {
        return { ok: false, error: 'execute_skill_script.cwd must be workspace-relative, not an absolute path.' };
    }

    const parsed = parseWorkspacePath(cwd);
    if (!parsed.workspace) {
        return { ok: false, error: parsed.error || `Invalid workspace-relative cwd: ${cwd}` };
    }
    const workspaceRoot = path.resolve(parsed.workspace.fsPath);
    const resolvedCwd = path.resolve(path.join(workspaceRoot, parsed.relativePath));
    const rel = path.relative(workspaceRoot, resolvedCwd);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { ok: false, error: 'execute_skill_script.cwd must stay inside the selected workspace.' };
    }
    return { ok: true, cwd: resolvedCwd };
}

async function handleExecuteSkillScript(args: ExecuteSkillScriptArgs, context?: ToolContext): Promise<ToolResult> {
    const settingsManager = getGlobalSettingsManager();
    const skillsConfig = settingsManager?.getSkillsConfig() as any;
    if (skillsConfig?.disableSkillShellExecution === true) {
        return { success: false, error: 'Skill shell execution is disabled by settings.' };
    }

    const skillsManager = getSkillsManager();
    if (!skillsManager) return { success: false, error: 'Skills manager not initialized' };

    const resolved = await skillsManager.resolveManifestResource(args.name, args.relativePath, { requireScript: true });
    if (resolved.ok === false) return { success: false, error: resolved.error };

    const scriptArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    const cwdResolution = resolveWorkspaceCwd(args.cwd);
    if (cwdResolution.ok === false) return { success: false, error: cwdResolution.error };

    let staged: { dir: string; file: string };
    try {
        staged = await stageScript(resolved.realPath, resolved.item.relativePath, resolved.item.sha256);
    } catch (error: any) {
        return { success: false, error: error?.message || 'Failed to stage skill script' };
    }
    const runner = resolveRunner(staged.file, resolved.item.relativePath);
    if ('error' in runner) {
        cleanupStaging(staged.dir);
        return { success: false, error: runner.error };
    }

    const timeout = normalizeSkillScriptTimeout(args.timeout);
    const finalArgs = [...runner.args, ...scriptArgs];

    return await new Promise<ToolResult>((resolve) => {
        const output: string[] = [];
        const proc = cp.spawn(runner.command, finalArgs, {
            cwd: cwdResolution.cwd,
            shell: false,
            windowsHide: true,
            env: { ...process.env, LIMCODE_SKILL_NAME: resolved.skill.name, LIMCODE_SKILL_URI: resolved.item.skillUri }
        });

        let killed = false;
        const timer = timeout > 0 ? setTimeout(() => {
            killed = true;
            proc.kill('SIGTERM');
        }, timeout) : undefined;

        proc.stdout?.on('data', chunk => output.push(String(chunk)));
        proc.stderr?.on('data', chunk => output.push(String(chunk)));
        proc.on('error', error => {
            if (timer) clearTimeout(timer);
            cleanupStaging(staged.dir);
            resolve({ success: false, error: error.message });
        });
        proc.on('close', code => {
            if (timer) clearTimeout(timer);
            cleanupStaging(staged.dir);
            const joined = redactStagingPaths(output.join(''), staged.dir, staged.file);
            resolve({
                success: code === 0 && !killed,
                data: {
                    schemaVersion: 1,
                    skillName: resolved.skill.name,
                    skillUri: resolved.item.skillUri,
                    relativePath: resolved.item.relativePath,
                    runner: runner.command,
                    args: scriptArgs,
                    exitCode: code,
                    killed,
                    output: joined.length > 20000 ? `${joined.slice(-20000)}\n(Output truncated)` : joined
                },
                error: killed ? `Skill script timed out after ${timeout}ms` : (code === 0 ? undefined : `Skill script exited with code ${code}`)
            });
        });

        context?.abortSignal?.addEventListener('abort', () => {
            killed = true;
            proc.kill('SIGTERM');
        }, { once: true });
    });
}

export function getExecuteSkillScriptTool(): Tool {
    return {
        declaration: generateExecuteSkillScriptDeclaration(),
        handler: handleExecuteSkillScript
    };
}

export function getExecuteSkillScriptToolRegistration(): ToolRegistration {
    return () => getExecuteSkillScriptTool();
}
