/**
 * LimCode - Skills Read Tool
 *
 * 替代原有的 toggle_skills 工具。
 * AI 通过 read_skill 工具按需读取 Skill 内容，
 * 不再使用拼接注入模式。
 * 
 * 对齐 Agent Skills 开放标准的两层渐进式披露：
 * - Layer 1：工具描述中包含所有已启用 Skill 的 name + description（YAML 格式）
 * - Layer 2：AI 调用 read_skill 时返回 SKILL.md 全文内容和不泄露绝对路径的资源清单
 */

import { stringify } from 'yaml';
import type { Tool, ToolDeclaration, ToolResult, ToolRegistration } from '../types';
import { getSkillsManager } from '../../modules/skills';
import { t } from '../../i18n';

/** 工具描述中 Skill 列表的最大字符预算（参考 Claude Code 的 15,000 字符上限） */
const SKILL_LIST_BUDGET = 15000;

/** 单个 Skill description 在工具声明中的最大字符数，避免一个 Skill 挤掉其它 Skill。 */
const SKILL_DESCRIPTION_BUDGET = 500;

export function sanitizeSkillDescriptionForToolList(description: string, options: { maxLen?: number } = {}): string {
    const maxLen = Math.max(1, options.maxLen ?? SKILL_DESCRIPTION_BUDGET);
    // 为什么要改：Layer-1 摘要是模型选择 Skill 的入口，原始 description 可能包含换行、控制字符或伪 YAML 列表项。
    // 怎么改：先移除控制字符，再把所有空白折叠为单空格，最后按单条预算截断。
    // 目的：保证任何进入 read_skill 工具声明的文本都是单行、可预算、不可注入伪 Skill 的安全摘要。
    const normalized = String(description ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (normalized.length <= maxLen) return normalized;
    if (maxLen === 1) return '…';
    return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * 将 Skill 摘要列表格式化为 YAML 字符串
 * YAML 格式 token 消耗最少，优于 JSON 和 XML
 */
export function formatSkillSummariesAsYaml(summaries: Array<{ name: string; description: string }>): string {
    if (summaries.length === 0) return '';
    
    let result = '';
    let truncatedCount = 0;
    
    for (let index = 0; index < summaries.length; index++) {
        const summary = summaries[index];
        const safeSummary = {
            name: summary.name,
            description: sanitizeSkillDescriptionForToolList(summary.description)
        };
        // 为什么要改：手写 `description: ${text}` 无法正确处理冒号、#、&、* 等 YAML 特殊字符。
        // 怎么改：把单个摘要交给 yaml.stringify，再继续沿用全局预算逐项拼接。
        // 目的：既保留 YAML 的低 token 成本，又让输出始终能被 YAML parser 还原成同一个摘要数组。
        const line = `${stringify([safeSummary], { lineWidth: 0 }).trimEnd()}\n`;
        if (result.length + line.length > SKILL_LIST_BUDGET) {
            truncatedCount = summaries.length - index;
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
Pass the skill name to read its full content.

Security model:
- read_skill does not expose local absolute skill paths.
- Use read_skill_resource to read text resources from the returned manifest.
- Use execute_skill_script to run allowlisted Skill scripts. Do not use execute_command to access Skill directories or construct filesystem paths manually.`
        : `Read the full content of a skill by its name. No skills are currently available.

Skills are user-defined knowledge modules that provide specialized context and instructions. To create the first LimCode Skill without relying on the removed legacy how-to-create-skill auto-template, create a folder such as .limcode/skills/my-skill/ or .agents/skills/my-skill/ and add SKILL.md with YAML frontmatter containing name and description. The name must exactly match the folder name, use lowercase letters, digits, and hyphens, and avoid consecutive hyphens.

Security model:
- read_skill does not expose local absolute skill paths.
- Use read_skill_resource to read text resources from the returned manifest.
- Use execute_skill_script to run allowlisted Skill scripts. Do not use execute_command to access Skill directories or construct filesystem paths manually.`;
    
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
 *
 * 注意：新版返回 schemaVersion=2，不向模型暴露本地绝对 basePath。
 * Skill 附属资源通过 skillUri + resources manifest 表达，后续用
 * read_skill_resource / execute_skill_script 访问。
 */
async function handleReadSkill(args: { name: string }): Promise<ToolResult> {
    const skillsManager = getSkillsManager();
    
    if (!skillsManager) {
        return {
            success: false,
            error: t('tools.skills.errors.managerNotInitialized'),
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
            schemaVersion: 2,
            name: skill.name,
            skillName: skill.name,
            skillUri: skill.skillUri,
            content: skill.content,
            resources: skill.resources,
            resourceAccess: {
                readTextTool: 'read_skill_resource',
                executeScriptTool: 'execute_skill_script',
                note: 'Use manifest relativePath values only. Local Skill filesystem roots are intentionally not exposed.'
            }
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
