/**
 * LimCode - Skills 类型定义
 *
 * Skills 是用户自定义的知识模块，可以动态加载到 AI 上下文中
 */

/**
 * Skill 来源
 */
export type SkillSource = 'project-limcode' | 'project-agents' | 'legacy' | 'user-limcode' | 'user-agents';

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

    /** Skill 所在目录的绝对路径（用于 AI 定位相关资源） */
    basePath: string;

    /** Skill 来源 */
    source: SkillSource;
    
    /** 是否当前启用（在对话中可用） */
    enabled: boolean;
    
    /** 
     * 是否发送内容给 AI 
     * @deprecated 不再使用拼接注入模式。Skills 现在通过 read_skill 工具按需读取。
     */
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
    type: 'enabled' | 'disabled' | 'refresh' | 'update';
    
    /** 变更的 skill IDs */
    skillIds: string[];
}

/**
 * Skills 变更监听器
 */
export type SkillsChangeListener = (event: SkillsChangeEvent) => void;
