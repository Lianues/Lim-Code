import { describe, it, expect } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT_CONFIG } from '../backend/modules/settings/types';

describe('Plan Mode and Ask Mode Configuration', () => {
    describe('Mode Existence', () => {
        it('should have plan mode in DEFAULT_SYSTEM_PROMPT_CONFIG.modes', () => {
            expect(DEFAULT_SYSTEM_PROMPT_CONFIG.modes).toBeDefined();
            expect(DEFAULT_SYSTEM_PROMPT_CONFIG.modes).toHaveProperty('plan');
            expect(DEFAULT_SYSTEM_PROMPT_CONFIG.modes.plan).toBeDefined();
        });

        it('should have ask mode in DEFAULT_SYSTEM_PROMPT_CONFIG.modes', () => {
            expect(DEFAULT_SYSTEM_PROMPT_CONFIG.modes).toBeDefined();
            expect(DEFAULT_SYSTEM_PROMPT_CONFIG.modes).toHaveProperty('ask');
            expect(DEFAULT_SYSTEM_PROMPT_CONFIG.modes.ask).toBeDefined();
        });
    });

    describe('Template Keywords', () => {
        it('should have plan mode template containing PLAN MODE keyword', () => {
            const planMode = DEFAULT_SYSTEM_PROMPT_CONFIG.modes.plan;
            expect(planMode).toBeDefined();
            expect(planMode?.template).toBeDefined();
            expect(planMode?.template).toBeTruthy();
            
            const template = planMode?.template || '';
            // 检查是否包含 "PLAN MODE" 或 "计划模式" 或 "plan mode" 等关键字
            const hasPlanKeyword = 
                template.includes('PLAN MODE') || 
                template.includes('计划模式') || 
                template.includes('plan mode') ||
                template.includes('Plan Mode') ||
                template.toLowerCase().includes('plan');
            
            expect(hasPlanKeyword).toBe(true);
        });

        it('should have ask mode template containing ASK MODE keyword', () => {
            const askMode = DEFAULT_SYSTEM_PROMPT_CONFIG.modes.ask;
            expect(askMode).toBeDefined();
            expect(askMode?.template).toBeDefined();
            expect(askMode?.template).toBeTruthy();
            
            const template = askMode?.template || '';
            // 检查是否包含 "ASK MODE" 或 "询问模式" 或 "ask mode" 等关键字
            const hasAskKeyword = 
                template.includes('ASK MODE') || 
                template.includes('询问模式') || 
                template.includes('ask mode') ||
                template.includes('Ask Mode') ||
                template.toLowerCase().includes('ask');
            
            expect(hasAskKeyword).toBe(true);
        });
    });

    describe('Tool Policy Configuration', () => {
        it('should have plan mode with toolPolicy field', () => {
            const planMode = DEFAULT_SYSTEM_PROMPT_CONFIG.modes.plan;
            expect(planMode).toBeDefined();
            
            // 使用类型断言来访问可能不存在的 toolPolicy 字段
            const planModeWithPolicy = planMode as typeof planMode & { toolPolicy?: string[] };
            expect(planModeWithPolicy.toolPolicy).toBeDefined();
            expect(Array.isArray(planModeWithPolicy.toolPolicy)).toBe(true);
        });

        it('should have ask mode with toolPolicy field', () => {
            const askMode = DEFAULT_SYSTEM_PROMPT_CONFIG.modes.ask;
            expect(askMode).toBeDefined();
            
            // 使用类型断言来访问可能不存在的 toolPolicy 字段
            const askModeWithPolicy = askMode as typeof askMode & { toolPolicy?: string[] };
            expect(askModeWithPolicy.toolPolicy).toBeDefined();
            expect(Array.isArray(askModeWithPolicy.toolPolicy)).toBe(true);
        });

        it('should have ask mode toolPolicy that excludes dangerous write tools', () => {
            const askMode = DEFAULT_SYSTEM_PROMPT_CONFIG.modes.ask;
            expect(askMode).toBeDefined();
            
            const askModeWithPolicy = askMode as typeof askMode & { toolPolicy?: string[] };
            const toolPolicy = askModeWithPolicy.toolPolicy || [];
            
            // ask 模式应该不包含以下危险工具
            const dangerousTools = [
                'apply_diff',
                'delete_file',
                'create_directory',
                'execute_command',
                'write_file'
            ];
            
            dangerousTools.forEach(tool => {
                expect(toolPolicy).not.toContain(tool);
            });
        });

        it('should have plan mode toolPolicy that allows write_file but excludes other dangerous tools', () => {
            const planMode = DEFAULT_SYSTEM_PROMPT_CONFIG.modes.plan;
            expect(planMode).toBeDefined();
            
            const planModeWithPolicy = planMode as typeof planMode & { toolPolicy?: string[] };
            const toolPolicy = planModeWithPolicy.toolPolicy || [];
            
            // plan 模式应该允许 write_file（用于 .cursor/plans 的计划文档）
            expect(toolPolicy).toContain('write_file');
            
            // plan 模式应该不包含其他危险工具
            const dangerousTools = [
                'apply_diff',
                'delete_file',
                'create_directory',
                'execute_command'
            ];
            
            dangerousTools.forEach(tool => {
                expect(toolPolicy).not.toContain(tool);
            });
        });
    });
});
