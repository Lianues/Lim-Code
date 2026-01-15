/**
 * LimCode - Skills 模块导出
 *
 * Skills 是用户自定义的知识模块，可以动态加载到 AI 上下文中
 */

// 导出类型
export type {
    Skill,
    SkillFrontmatter,
    SkillsState,
    SkillsChangeEvent,
    SkillsChangeListener
} from './types';

// 导出 SkillsManager
export {
    SkillsManager,
    getSkillsManager,
    setSkillsManager,
    createSkillsManager
} from './SkillsManager';
