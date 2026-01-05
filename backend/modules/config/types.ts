/**
 * LimCode - 配置管理模块类型定义
 *
 * 提供统一的配置管理接口，支持多种 LLM API 格式
 */

// 导出所有配置类型（从 configs/ 目录）
export type {
    ChannelType,
    BaseChannelConfig,
    GeminiConfig,
    OpenAIConfig,
    AnthropicConfig,
    OpenAIResponsesConfig,
    ChannelConfig,
    TokenCountMethod,
    TokenCountApiConfig
} from './configs';

// 导入 ChannelConfig 以供内部使用
import type { ChannelType, ChannelConfig } from './configs';

/**
 * 创建配置时的输入类型
 *
 * 排除自动生成的字段（id、createdAt、updatedAt）
 */
export type CreateConfigInput<T extends ChannelConfig = ChannelConfig> =
    Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * 更新配置时的输入类型
 *
 * 所有字段都是可选的，除了 type（类型不可更改）
 */
export type UpdateConfigInput<T extends ChannelConfig = ChannelConfig> =
    Partial<Omit<T, 'id' | 'type' | 'createdAt' | 'updatedAt'>>;

/**
 * 配置统计信息
 */
export interface ConfigStats {
    /** 总配置数 */
    totalConfigs: number;
    
    /** 启用的配置数 */
    enabledConfigs: number;
    
    /** 禁用的配置数 */
    disabledConfigs: number;
    
    /** 按类型统计 */
    byType: Record<ChannelType, number>;
    
    /** 最近创建的配置（最多 5 个） */
    recentConfigs: Array<{
        id: string;
        name: string;
        type: ChannelType;
        createdAt: number;
    }>;
}

/**
 * 配置验证结果
 */
export interface ValidationResult {
    /** 是否有效 */
    valid: boolean;
    
    /** 错误信息（如果无效） */
    errors?: string[];
    
    /** 警告信息 */
    warnings?: string[];
}

/**
 * 配置导出选项
 */
export interface ExportOptions {
    /** 是否包含敏感信息（API Key 等） */
    includeSensitive?: boolean;
    
    /** 是否美化 JSON */
    pretty?: boolean;
}

/**
 * 配置导入选项
 */
export interface ImportOptions {
    /** 如果配置已存在，是否覆盖 */
    overwrite?: boolean;
    
    /** 是否在导入前验证 */
    validate?: boolean;
}

/**
 * 配置查询过滤器
 */
export interface ConfigFilter {
    /** 按类型过滤 */
    type?: ChannelType;
    
    /** 按启用状态过滤 */
    enabled?: boolean;
    
    /** 按标签过滤 */
    tags?: string[];
    
    /** 按名称搜索（支持部分匹配） */
    nameSearch?: string;
}

/**
 * 配置排序选项
 */
export interface ConfigSortOptions {
    /** 排序字段 */
    field: 'name' | 'createdAt' | 'updatedAt' | 'type';
    
    /** 排序方向 */
    order: 'asc' | 'desc';
}