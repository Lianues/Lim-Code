import { describe, it, expect } from 'vitest';
import { isPlanPathAllowed, getReadonlyModeDangerousTools } from '../backend/modules/settings/modeToolsPolicy';

/**
 * 模式工具策略测试
 * 聚焦"模式→工具集"强制执行里最容易回归的规则
 */

describe('Mode Tools Policy', () => {
    describe('Plan Mode - Plan Document Write Exception Path Rules', () => {
        it('should allow .cursor/plans/xxx.plan.md paths', () => {
            expect(isPlanPathAllowed('.cursor/plans/test.plan.md')).toBe(true);
            expect(isPlanPathAllowed('.cursor/plans/my-plan.plan.md')).toBe(true);
            expect(isPlanPathAllowed('.cursor/plans/subdir/project.plan.md')).toBe(true);
        });

        it('should allow .cursor/plans/sub/xxx.md paths', () => {
            expect(isPlanPathAllowed('.cursor/plans/sub/test.md')).toBe(true);
            expect(isPlanPathAllowed('.cursor/plans/nested/deep/file.md')).toBe(true);
            expect(isPlanPathAllowed('.cursor/plans/subdir/document.md')).toBe(true);
        });

        it('should reject paths outside .cursor/plans/', () => {
            expect(isPlanPathAllowed('src/index.ts')).toBe(false);
            expect(isPlanPathAllowed('package.json')).toBe(false);
            expect(isPlanPathAllowed('backend/modules/settings/types.ts')).toBe(false);
        });

        it('should reject paths in .cursor/other/ directory', () => {
            expect(isPlanPathAllowed('.cursor/other/test.md')).toBe(false);
            expect(isPlanPathAllowed('.cursor/other/xxx.md')).toBe(false);
            expect(isPlanPathAllowed('.cursor/config/settings.json')).toBe(false);
        });

        it('should reject .cursor/plans/ paths with non-md extensions', () => {
            expect(isPlanPathAllowed('.cursor/plans/test.txt')).toBe(false);
            expect(isPlanPathAllowed('.cursor/plans/plan.json')).toBe(false);
            expect(isPlanPathAllowed('.cursor/plans/doc.js')).toBe(false);
            expect(isPlanPathAllowed('.cursor/plans/file.ts')).toBe(false);
        });

        it('should reject .cursor/plans/ paths without extension', () => {
            expect(isPlanPathAllowed('.cursor/plans/test')).toBe(false);
            expect(isPlanPathAllowed('.cursor/plans/file')).toBe(false);
        });

        it('should handle edge cases correctly', () => {
            // 空字符串
            expect(isPlanPathAllowed('')).toBe(false);
            // 只有目录名
            expect(isPlanPathAllowed('.cursor/plans/')).toBe(false);
            // 绝对路径
            expect(isPlanPathAllowed('/absolute/path/.cursor/plans/test.md')).toBe(false);
        });
    });

    describe('Readonly Mode - Dangerous Tools List', () => {
        it('should have readonly mode dangerous tools list', () => {
            const dangerousTools = getReadonlyModeDangerousTools();
            expect(dangerousTools).toBeInstanceOf(Set);
            expect(dangerousTools.size).toBeGreaterThan(0);
        });

        it('should include apply_diff in readonly mode dangerous tools', () => {
            const dangerousTools = getReadonlyModeDangerousTools();
            expect(dangerousTools.has('apply_diff')).toBe(true);
        });

        it('should include write_file in readonly mode dangerous tools', () => {
            const dangerousTools = getReadonlyModeDangerousTools();
            expect(dangerousTools.has('write_file')).toBe(true);
        });

        it('should include delete_file in readonly mode dangerous tools', () => {
            const dangerousTools = getReadonlyModeDangerousTools();
            expect(dangerousTools.has('delete_file')).toBe(true);
        });

        it('should include create_directory in readonly mode dangerous tools', () => {
            const dangerousTools = getReadonlyModeDangerousTools();
            expect(dangerousTools.has('create_directory')).toBe(true);
        });

        it('should include execute_command in readonly mode dangerous tools', () => {
            const dangerousTools = getReadonlyModeDangerousTools();
            expect(dangerousTools.has('execute_command')).toBe(true);
        });

        it('should include all required dangerous tools', () => {
            const dangerousTools = getReadonlyModeDangerousTools();
            const requiredTools = [
                'apply_diff',
                'write_file',
                'delete_file',
                'create_directory',
                'execute_command'
            ];

            requiredTools.forEach(tool => {
                expect(dangerousTools.has(tool)).toBe(true);
            });
        });
    });
});
