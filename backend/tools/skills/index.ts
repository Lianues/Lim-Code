/**
 * LimCode - Skills Tools
 *
 * Export all skills-related tools
 */

export {
    generateReadSkillDeclaration,
    getReadSkillTool,
    getReadSkillToolRegistration,
    hasAvailableSkills
} from './readSkill';

export {
    generateReadSkillResourceDeclaration,
    getReadSkillResourceTool,
    getReadSkillResourceToolRegistration
} from './readSkillResource';

export {
    generateExecuteSkillScriptDeclaration,
    getExecuteSkillScriptTool,
    getExecuteSkillScriptToolRegistration
} from './executeSkillScript';

export function getSkillsToolRegistrations() {
    const { getReadSkillToolRegistration } = require('./readSkill');
    const { getReadSkillResourceToolRegistration } = require('./readSkillResource');
    const { getExecuteSkillScriptToolRegistration } = require('./executeSkillScript');
    return [
        getReadSkillToolRegistration(),
        getReadSkillResourceToolRegistration(),
        getExecuteSkillScriptToolRegistration()
    ];
}
