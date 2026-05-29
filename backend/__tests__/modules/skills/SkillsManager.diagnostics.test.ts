/**
 * SkillsManager parser and diagnostics integration tests.
 *
 * 为什么要改：只测试 frontmatter 纯函数无法证明真实扫描、加载、摘要和诊断链路会使用新 parser。
 * 怎么改：在临时 workspace 中创建真实 SKILL.md，通过 SkillsManager.refresh() 这个公共接口验证结果。
 * 目的：确保 block scalar Skill 可加载、fatal 加载失败可见、loaded Skill 的 info 诊断也能被 headless/API 读取。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillsManager } from '../../../modules/skills/SkillsManager';

async function writeSkill(workspace: string, id: string, content: string): Promise<void> {
    const skillDir = path.join(workspace, '.limcode', 'skills', id);
    await fs.promises.mkdir(skillDir, { recursive: true });
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
}

describe('SkillsManager diagnostics integration', () => {
    let workspace: string;
    let globalStorage: string;

    beforeEach(async () => {
        workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-skills-workspace-'));
        globalStorage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-skills-global-'));
    });

    afterEach(async () => {
        await fs.promises.rm(workspace, { recursive: true, force: true });
        await fs.promises.rm(globalStorage, { recursive: true, force: true });
    });

    it('loads a skill whose description uses YAML folded block scalar', async () => {
        await writeSkill(workspace, 'block-skill', `---
name: block-skill
description: >-
  Use when the user asks for
  YAML block scalar support.
---
# Body`);
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage });

        await manager.refresh();
        manager.enableSkill('block-skill');

        expect(manager.getSkill('block-skill')?.description).toBe('Use when the user asks for YAML block scalar support.');
        expect(manager.getSkillSummaries()).toEqual([
            { name: 'block-skill', description: 'Use when the user asks for YAML block scalar support.' }
        ]);
        expect(manager.getDiagnostics().filter(d => d.skillId === 'block-skill' && d.severity === 'fatal')).toEqual([]);
    });

    it('exposes fatal diagnostics for skipped skills', async () => {
        await writeSkill(workspace, 'broken-skill', `---
name: other-skill
description: Broken
---
# Body`);
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage });

        await manager.refresh();

        expect(manager.getSkill('broken-skill')).toBeUndefined();
        expect(manager.getLoadReport().skipped).toEqual(expect.arrayContaining([
            expect.objectContaining({
                severity: 'fatal',
                code: 'skill-name-mismatch',
                skillId: 'broken-skill',
                field: 'name'
            })
        ]));
    });

    it('exposes loaded skill info diagnostics for non-core ecosystem fields', async () => {
        await writeSkill(workspace, 'metadata-skill', `---
name: metadata-skill
description: Has extras
triggers:
  - debug
allowed-tools:
  - read
---
# Body`);
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage });

        await manager.refresh();

        const report = manager.getLoadReport();
        const loaded = report.loaded.find(item => item.skill.id === 'metadata-skill');
        expect(loaded?.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'info', code: 'skill-field-preserved-as-metadata', field: 'triggers' }),
            expect.objectContaining({ severity: 'info', code: 'skill-field-preserved-as-metadata', field: 'allowed-tools' })
        ]));
        expect(manager.getDiagnostics()).toEqual(expect.arrayContaining(loaded?.diagnostics || []));
    });

    it('keeps enabled count tied to currently loaded skills', async () => {
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage });

        manager.setSkillsState({ 'missing-skill': true });

        expect(manager.getEnabledSkillsCount()).toBe(0);
    });

    it('does not auto-create the retired legacy skills directory during initialize', async () => {
        // 为什么要改：legacy globalStoragePath/skills 已从运行时来源中删除，初始化不能再创建空旧目录。
        // 怎么改：初始化后检查 legacy 根目录本身不存在，而不只是检查旧 how-to-create-skill 文件不存在。
        // 目的：防止未来维护者为了兼容又恢复 ensureSkillsDirectory，重新污染用户 globalStorage。
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage });

        await manager.initialize();

        expect(fs.existsSync(path.join(globalStorage, 'skills'))).toBe(false);
    });

    it('does not load existing legacy skills but emits a migration diagnostic without touching files', async () => {
        // 为什么要改：删除 legacy 运行时扫描不能静默吞掉旧用户文件，也不能继续把旧目录暴露给 read_skill。
        // 怎么改：预先写入 legacy 文件，初始化后断言文件未变、Skill 未加载、诊断提示迁移。
        // 目的：同时固定“不破坏用户资料”和“legacy 不再是运行时来源”的升级边界。
        const legacyDir = path.join(globalStorage, 'skills', 'how-to-create-skill');
        const legacyFile = path.join(legacyDir, 'SKILL.md');
        const legacyContent = `---
name: how-to-create-skill
description: User kept legacy skill
---
# User custom content`;
        await fs.promises.mkdir(legacyDir, { recursive: true });
        await fs.promises.writeFile(legacyFile, legacyContent, 'utf-8');
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage });

        await manager.initialize();

        expect(await fs.promises.readFile(legacyFile, 'utf-8')).toBe(legacyContent);
        expect(manager.getSkill('how-to-create-skill')).toBeUndefined();
        expect(manager.getDiagnostics()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                severity: 'warning',
                code: 'legacy-directory-detected',
                skillId: 'how-to-create-skill',
                filePath: legacyFile
            })
        ]));
    });

    it('does not emit legacy migration diagnostics for an empty retired directory', async () => {
        // 为什么要改：只要 legacy root 存在就报 warning 会让无实际旧 Skill 的用户看到噪音。
        // 怎么改：构造空 globalStoragePath/skills，验证只读检测不产生 legacy-directory-detected。
        // 目的：迁移提示只针对真实可迁移的旧 SKILL.md。
        await fs.promises.mkdir(path.join(globalStorage, 'skills'), { recursive: true });
        const manager = new SkillsManager({ workspacePath: workspace, globalStoragePath: globalStorage });

        await manager.initialize();

        expect(manager.getDiagnostics().some(d => d.code === 'legacy-directory-detected')).toBe(false);
    });
});
