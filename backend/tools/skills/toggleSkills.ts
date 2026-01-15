/**
 * LimCode - Skills Toggle Tool
 *
 * Allows AI to dynamically toggle whether to send skill content
 * Tool parameters are dynamically generated, each parameter corresponds to a skill
 */

import type { Tool, ToolDeclaration, ToolResult, ToolRegistration } from '../types';
import { getSkillsManager } from '../../modules/skills';

/**
 * Dynamically generate skills tool declaration
 *
 * Generate tool parameters based on currently enabled skills
 * Only enabled skills are included in the tool parameters
 */
export function generateSkillsToolDeclaration(): ToolDeclaration {
    const skillsManager = getSkillsManager();
    const properties: Record<string, any> = {};
    
    if (skillsManager) {
        // Only include enabled skills in tool parameters
        const enabledSkills = skillsManager.getEnabledSkills();
        
        for (const skill of enabledSkills) {
            properties[skill.name] = {
                type: 'boolean',
                description: skill.description
            };
        }
    }
    
    return {
        name: 'toggle_skills',
        description: 'Toggle whether to send skill content to the conversation. Skills are user-defined knowledge modules that provide specialized context and instructions. Each parameter is a skill name - set to true to send content, false to stop sending. The skill content will be included in subsequent messages. Enable a skill when you need its specific content for the current task; disable it when no longer needed to save conversation space.',
        category: 'skills',
        parameters: {
            type: 'object',
            properties,
            required: []  // All parameters are optional
        }
    };
}

/**
 * Skills toggle tool handler function
 */
async function handleToggleSkills(args: Record<string, boolean>): Promise<ToolResult> {
    const skillsManager = getSkillsManager();
    
    if (!skillsManager) {
        return {
            success: false,
            error: 'Skills manager not initialized'
        };
    }
    
    // Track not found skills
    const notFound: string[] = [];
    
    // Get name to ID mapping for all skills
    const skills = skillsManager.getAllSkills();
    const nameToId: Record<string, string> = {};
    for (const skill of skills) {
        nameToId[skill.name] = skill.id;
    }
    
    // Process each argument
    for (const [name, shouldSend] of Object.entries(args)) {
        const skillId = nameToId[name];
        
        if (!skillId) {
            notFound.push(name);
            continue;
        }
        
        // Toggle the sendContent state in SkillsManager
        skillsManager.setSkillSendContent(skillId, shouldSend);
    }
    
    // If some skills not found, return partial success
    if (notFound.length > 0) {
        return {
            success: true,
            error: `Some skills not found: ${notFound.join(', ')}`
        };
    }
    
    return {
        success: true
    };
}

/**
 * Get Skills tool
 *
 * Returns dynamically generated skills toggle tool
 */
export function getSkillsTool(): Tool {
    return {
        declaration: generateSkillsToolDeclaration(),
        handler: handleToggleSkills
    };
}

/**
 * Get Skills tool registration function
 */
export function getSkillsToolRegistration(): ToolRegistration {
    return () => getSkillsTool();
}

/**
 * Check if there are enabled skills
 *
 * If no skills are enabled, this tool should not be sent
 */
export function hasAvailableSkills(): boolean {
    const skillsManager = getSkillsManager();
    return skillsManager !== null && skillsManager.getEnabledSkills().length > 0;
}
