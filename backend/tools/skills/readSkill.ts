/**
 * LimCode - Skills Read Tool
 *
 * 替代原有的 toggle_skills 工具。
 * AI 通过 read_skill 工具按需读取 Skill 内容，
 * 不再使用拼接注入模式。
 * 
 * 对齐 Agent Skills 开放标准的两层渐进式披露：
 * - Layer 1：工具描述中包含所有已启用 Skill 的 name + description（YAML 格式）
 * - Layer 2：AI 调用 read_skill 时返回 SKILL.md 全文内容
 */

import type { Tool, ToolDeclaration, ToolResult, ToolRegistration } from '../types';
import { getSkillsManager } from '../../modules/skills';

/** 工具描述中 Skill 列表的最大字符预算（参考 Claude Code 的 15,000 字符上限） */
const SKILL_LIST_BUDGET = 15000;

/**
 * 将 Skill 摘要列表格式化为 YAML 字符串
 * YAML 格式 token 消耗最少，优于 JSON 和 XML
 */
function formatSkillSummariesAsYaml(summaries: Array<{ name: string; description: string }>): string {
    if (summaries.length === 0) return '';
    
    let result = '';
    let truncatedCount = 0;
    
    for (const summary of summaries) {
        const line = `- name: ${summary.name}\n  description: ${summary.description}\n`;
        if (result.length + line.length > SKILL_LIST_BUDGET) {
            truncatedCount = summaries.length - summaries.indexOf(summary);
            break;
        }
        result += line;
    }
    
    if (truncatedCount > 0) {
        result += `(... and ${truncatedCount} more skills)\n`;
    }
    
    return result;
}

/**
 * 动态生成 read_skill 工具声明
 * 
 * 工具描述中包含所有已启用 Skill 的 YAML 格式摘要列表，
 * AI 根据列表判断是否需要加载某个 Skill。
 */
export function generateReadSkillDeclaration(): ToolDeclaration {
    const skillsManager = getSkillsManager();
    let yamlList = '';
    
    if (skillsManager) {
        const summaries = skillsManager.getSkillSummaries();
        yamlList = formatSkillSummariesAsYaml(summaries);
    }
    
    const description = yamlList
        ? `Read the full content of a skill by its name.

Skills are user-defined knowledge modules that provide specialized context and instructions for specific tasks. Each skill provides domain expertise that is loaded on demand. When a task matches an available skill's description, you should proactively load it.

Available skills:
${yamlList}
Pass the skill name to read its full content.`
        : `Read the full content of a skill by its name. No skills are currently available.`;
    
    return {
        name: 'read_skill',
        description,
        category: 'skills',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'The name of the skill to read (from the available skills list above)',
                },
            },
            required: ['name'],
        },
    };
}

/**
 * read_skill 工具的 handler
 * 
 * 根据 name 查找 Skill 并返回其完整内容。
 * 返回的 basePath 让 AI 能定位同目录下的脚本等资源文件。
 */
async function handleReadSkill(args: { name: string }): Promise<ToolResult> {
    const skillsManager = getSkillsManager();
    
    if (!skillsManager) {
        return {
            success: false,
            error: 'Skills manager not initialized',
        };
    }
    
    const skill = skillsManager.getSkillByName(args.name);
    if (!skill) {
        return {
            success: false,
            error: `Skill not found: "${args.name}". Use the available skills listed in the tool description.`,
        };
    }
    
    if (!skill.enabled) {
        return {
            success: false,
            error: `Skill "${args.name}" is disabled by user. Do not attempt to read it again.`,
        };
    }
    
    return {
        success: true,
        data: {
            name: skill.name,
            basePath: skill.basePath,
            content: skill.content,
        },
    };
}

/**
 * 获取 read_skill 工具
 */
export function getReadSkillTool(): Tool {
    return {
        declaration: generateReadSkillDeclaration(),
        handler: handleReadSkill,
    };
}

/**
 * 获取 read_skill 工具注册函数
 */
export function getReadSkillToolRegistration(): ToolRegistration {
    return () => getReadSkillTool();
}

/**
 * 检查是否有可用的 Skills
 * 
 * 如果没有已启用的 Skills，read_skill 工具不注册
 */
export function hasAvailableSkills(): boolean {
    const skillsManager = getSkillsManager();
    return skillsManager !== null && skillsManager.getEnabledSkills().length > 0;
}
