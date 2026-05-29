/**
 * SkillsManager builtin source integration tests.
 *
 * 为什么要加：插件内置 Skill 现在作为通用 builtin 来源进入扫描链路，不能只靠项目级 .limcode/skills 测试间接覆盖。
 * 怎么改：用临时 resources/skills 目录构造内置 Skill，验证扫描、启停、资源 manifest、安全读取和同名覆盖。
 * 目的：确保未来新增内置 Skill 只需添加目录，不会重新引入具体 Skill ID 特判或绕过 read_skill 资源安全边界。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillsManager } from '../../../modules/skills/SkillsManager';

async function writeSkill(root: string, id: string, description: string, body = '# Body'): Promise<void> {
    const skillDir = path.join(root, id);
    await fs.promises.mkdir(skillDir, { recursive: true });
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ${id}
description: ${description}
---
${body}`, 'utf-8');
}

async function writeWorkspaceSkill(workspace: string, id: string, description: string): Promise<void> {
    await writeSkill(path.join(workspace, '.limcode', 'skills'), id, description);
}

describe('SkillsManager builtin source integration', () => {
    let workspace: string;
    let globalStorage: string;
    let builtinSkillsPath: string;

    beforeEach(async () => {
        workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-builtin-workspace-'));
        globalStorage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-builtin-global-'));
        builtinSkillsPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-builtin-source-'));
    });

    afterEach(async () => {
        await fs.promises.rm(workspace, { recursive: true, force: true });
        await fs.promises.rm(globalStorage, { recursive: true, force: true });
        await fs.promises.rm(builtinSkillsPath, { recursive: true, force: true });
    });

    it('scans builtin skills from builtinSkillsPath and marks their source as builtin', async () => {
        await writeSkill(builtinSkillsPath, 'builtin-skill', 'Built in test skill');
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage, builtinSkillsPath });

        await manager.initialize();

        expect(manager.getSkill('builtin-skill')).toEqual(expect.objectContaining({
            id: 'builtin-skill',
            description: 'Built in test skill',
            source: 'builtin'
        }));
    });

    it('allows builtin skills to use the normal enable and summary flow', async () => {
        await writeSkill(builtinSkillsPath, 'builtin-summary', 'Summary comes from builtin source');
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage, builtinSkillsPath });

        await manager.initialize();
        manager.enableSkill('builtin-summary');

        expect(manager.getSkillSummaries()).toEqual(expect.arrayContaining([
            { name: 'builtin-summary', description: 'Summary comes from builtin source' }
        ]));
        manager.disableSkill('builtin-summary');
        expect(manager.getEnabledSkills().some(skill => skill.id === 'builtin-summary')).toBe(false);
    });

    it('exposes builtin reference resources through the same manifest resolver', async () => {
        await writeSkill(builtinSkillsPath, 'builtin-resource', 'Has bundled reference');
        const referenceDir = path.join(builtinSkillsPath, 'builtin-resource', 'references');
        await fs.promises.mkdir(referenceDir, { recursive: true });
        await fs.promises.writeFile(path.join(referenceDir, 'guide.md'), '# Builtin Guide\nUse manifest access only.', 'utf-8');
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage, builtinSkillsPath });

        await manager.initialize();
        manager.enableSkill('builtin-resource');
        const resolved = await manager.resolveManifestResource('builtin-resource', 'references/guide.md', { requireTextReadable: true });

        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
            expect(resolved.item.kind).toBe('reference');
            await expect(resolved.readText()).resolves.toContain('Use manifest access only.');
        }
    });

    it('lets project skills shadow builtin skills with the same id and records a diagnostic', async () => {
        await writeWorkspaceSkill(workspace, 'shadowed-skill', 'Project version wins');
        await writeSkill(builtinSkillsPath, 'shadowed-skill', 'Builtin version loses');
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage, builtinSkillsPath });

        await manager.initialize();

        expect(manager.getSkill('shadowed-skill')).toEqual(expect.objectContaining({
            description: 'Project version wins',
            source: 'project-limcode'
        }));
        expect(manager.getDiagnostics()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                severity: 'warning',
                code: 'skill-duplicate-shadowed',
                skillId: 'shadowed-skill',
                source: 'builtin'
            })
        ]));
    });

    it('handles a missing builtinSkillsPath without crashing', async () => {
        const missingBuiltinPath = path.join(builtinSkillsPath, 'missing');
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage, builtinSkillsPath: missingBuiltinPath });

        await expect(manager.initialize()).resolves.toBeUndefined();
        expect(manager.getSkill('anything-from-missing-builtin')).toBeUndefined();
    });
});
