/**
 * LimCode - Skills 类型定义
 *
 * Skills 是用户自定义的知识模块，可以动态加载到 AI 上下文中
 */

/**
 * Skill 定义
 */
export interface Skill {
    /** Skill 唯一标识（文件夹名称） */
    id: string;
    
    /** Skill 名称（来自 frontmatter） */
    name: string;
    
    /** Skill 描述（来自 frontmatter） */
    description: string;
    
    /** Skill 完整内容（包含 frontmatter 后的正文） */
    content: string;
    
    /** Skill 文件路径 */
    path: string;
    
    /** 是否当前启用（在对话中可用） */
    enabled: boolean;
    
    /** 是否发送内容给 AI */
    sendContent: boolean;
}

/**
 * Skill Frontmatter 数据
 */
export interface SkillFrontmatter {
    /** Skill 名称 */
    name: string;
    
    /** Skill 描述 */
    description: string;
}

/**
 * Skills 状态
 */
export interface SkillsState {
    /** 已启用的 skill IDs */
    enabledSkills: Set<string>;
}

/**
 * Skills 变更事件
 */
export interface SkillsChangeEvent {
    /** 变更类型 */
    type: 'enabled' | 'disabled' | 'refresh';
    
    /** 变更的 skill IDs */
    skillIds: string[];
}

/**
 * Skills 变更监听器
 */
export type SkillsChangeListener = (event: SkillsChangeEvent) => void;
