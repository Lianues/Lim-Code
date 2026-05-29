/**
 * LimCode - Skills 类型定义
 *
 * Skills 是用户自定义的知识模块，可以动态加载到 AI 上下文中
 */

/**
 * Skill 来源
 */
/**
 * 为什么要改：插件内置 Skill 需要进入同一套扫描、诊断和 read_skill 读取链路，旧 legacy 目录则不再作为运行时来源。
 * 怎么改：新增通用 builtin 来源，并移除 legacy 运行时来源枚举；旧目录只通过不带 source 的诊断提示迁移。
 * 目的：未来新增内置 Skill 只需添加 resources/skills/<id>/ 目录，不再为具体 Skill 写特判。
 */
export type SkillSource = 'project-limcode' | 'project-agents' | 'user-limcode' | 'user-agents' | 'builtin';

export type SkillResourceKind = 'script' | 'reference' | 'asset' | 'other';

export type SkillDiagnosticSeverity = 'fatal' | 'warning' | 'info';

export interface SkillDiagnostic {
    /**
     * 为什么要加：Skill 加载失败过去只写 console，前端、测试和 headless 场景都看不到原因。
     * 怎么改：把诊断建模为 loader/formatter/UI 都能复用的结构化记录。
     * 目的：区分 fatal/warning/info，避免把会导致 Skill 不加载的问题伪装成普通建议。
     */
    severity: SkillDiagnosticSeverity;
    code: string;
    message: string;
    field?: string;
    skillId?: string;
    filePath?: string;
    source?: SkillSource;
}

export interface SkillResourceManifestItem {
    skillUri: string;
    relativePath: string;
    kind: SkillResourceKind;
    size: number;
    sha256: string;
    maybeExecutable: boolean;
    textReadable: boolean;
    truncatedReason?: string;
}

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

    /** Skill 所在目录的绝对路径（仅供服务端内部解析资源；不要返回给模型） */
    basePath: string;

    /** 规范化后的 Skill 根目录真实路径（仅服务端内部使用） */
    canonicalBasePath: string;

    /** 模型可见的 Skill URI，不泄露本地绝对路径 */
    skillUri: string;

    /** Skill 附属资源的有界清单 */
    resources: SkillResourceManifestItem[];

    /**
     * 为什么要加：合法 YAML frontmatter 里可能包含跨生态字段，loader 不能丢数据也不能赋予它们核心行为。
     * 怎么改：Skill 对象保留 extras 供诊断/展示使用，运行时发现仍只依赖 name 和 description。
     * 目的：无损兼容其它生态，同时避免 triggers/allowed-tools/scripts 形成第二套机制。
     */
    extras?: Record<string, unknown>;

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

    /** 可选：显式允许作为脚本资源的相对路径 */
    scripts?: string[];

    /**
     * 为什么要加：跨生态 Skill 会携带 triggers、allowed-tools、metadata 等非 LimCode 核心字段。
     * 怎么改：把 name/description 之外的合法 YAML 字段原样保存在 extras，不赋予发现或权限语义。
     * 目的：既不丢用户字段，又避免形成 description 之外的第二套触发/权限机制。
     */
    extras?: Record<string, unknown>;
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
