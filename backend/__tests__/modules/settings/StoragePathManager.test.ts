/**
 * StoragePathManager migration regression tests.
 *
 * 为什么要加：legacy globalStoragePath/skills 已退役，普通数据迁移不能再把旧 Skill 静默复制到新位置。
 * 怎么改：用临时默认数据目录构造 conversations 和 legacy skills，执行 migrateData 后断言只迁移运行时数据目录。
 * 目的：确保旧 Skill 只通过显式迁移提示处理，不被存储路径迁移流程自动复制或删除。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StoragePathManager } from '../../../modules/settings/StoragePathManager';

describe('StoragePathManager data migration', () => {
    let sourcePath: string;
    let targetPath: string;

    beforeEach(async () => {
        sourcePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-storage-source-'));
        targetPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'limcode-storage-target-'));
    });

    afterEach(async () => {
        await fs.promises.rm(sourcePath, { recursive: true, force: true });
        await fs.promises.rm(targetPath, { recursive: true, force: true });
    });

    it('does not copy retired legacy skills during ordinary storage migration', async () => {
        await fs.promises.mkdir(path.join(sourcePath, 'conversations'), { recursive: true });
        await fs.promises.writeFile(path.join(sourcePath, 'conversations', 'conversation.json'), '{"ok":true}', 'utf-8');
        const legacySkillDir = path.join(sourcePath, 'skills', 'private-legacy-skill');
        await fs.promises.mkdir(legacySkillDir, { recursive: true });
        await fs.promises.writeFile(path.join(legacySkillDir, 'SKILL.md'), `---
name: private-legacy-skill
description: Should not be silently copied
---
# Private`, 'utf-8');

        const settingsManager = {
            getStoragePathConfig: jest.fn(() => ({ migrationStatus: 'not_started' })),
            markMigrationStarted: jest.fn().mockResolvedValue(undefined),
            markMigrationFailed: jest.fn().mockResolvedValue(undefined),
            updateStoragePathConfig: jest.fn().mockResolvedValue(undefined)
        } as any;
        const manager = new StoragePathManager(settingsManager, {
            globalStorageUri: { fsPath: sourcePath }
        } as any);

        const result = await manager.migrateData(targetPath);

        expect(result.success).toBe(true);
        expect(fs.existsSync(path.join(targetPath, 'conversations', 'conversation.json'))).toBe(true);
        expect(fs.existsSync(path.join(targetPath, 'skills'))).toBe(false);
        expect(fs.existsSync(path.join(sourcePath, 'skills', 'private-legacy-skill', 'SKILL.md'))).toBe(true);
        expect(settingsManager.updateStoragePathConfig).toHaveBeenCalledWith(expect.objectContaining({
            customDataPath: targetPath,
            migrationStatus: 'completed'
        }));
    });
});
