/**
 * LimCode - 设置 API 类型定义
 * 
 * 前后端交互的设置相关数据结构
 */

import type { GlobalSettings, ToolsEnabledState, ProxySettings, ListFilesToolConfig, ApplyDiffToolConfig } from '../../settings/types';

/**
 * ========== 请求类型 ==========
 */

/**
 * 获取设置请求（无需参数）
 */
export interface GetSettingsRequest {
    // 空对象，仅用于类型标记
}

/**
 * 更新设置请求
 */
export interface UpdateSettingsRequest {
    /** 要更新的设置（部分更新） */
    settings: Partial<GlobalSettings>;
}

/**
 * 设置活动渠道请求
 */
export interface SetActiveChannelRequest {
    /** 渠道 ID */
    channelId: string;
}

/**
 * 设置工具启用状态请求
 */
export interface SetToolEnabledRequest {
    /** 工具名称 */
    toolName: string;
    
    /** 是否启用 */
    enabled: boolean;
}

/**
 * 批量设置工具启用状态请求
 */
export interface SetToolsEnabledRequest {
    /** 工具启用状态映射 */
    toolsEnabled: ToolsEnabledState;
}

/**
 * 设置默认工具模式请求
 */
export interface SetDefaultToolModeRequest {
    /** 工具模式 */
    mode: 'function_call' | 'xml';
}

/**
 * 更新 UI 设置请求
 */
export interface UpdateUISettingsRequest {
    /** UI 设置（部分更新） */
    uiSettings: Partial<NonNullable<GlobalSettings['ui']>>;
}

/**
 * 更新代理设置请求
 */
export interface UpdateProxySettingsRequest {
    /** 代理设置（部分更新） */
    proxySettings: Partial<ProxySettings>;
}

/**
 * 重置设置请求（无需参数）
 */
export interface ResetSettingsRequest {
    // 空对象，仅用于类型标记
}

/**
 * ========== 响应类型 ==========
 */

/**
 * 获取设置成功响应
 */
export interface GetSettingsSuccessData {
    success: true;
    
    /** 完整的设置数据 */
    settings: GlobalSettings;
}

/**
 * 获取设置失败响应
 */
export interface GetSettingsErrorData {
    success: false;
    
    /** 错误信息 */
    error: {
        code: string;
        message: string;
    };
}

/**
 * 获取设置响应
 */
export type GetSettingsResponse = GetSettingsSuccessData | GetSettingsErrorData;

/**
 * 更新设置成功响应
 */
export interface UpdateSettingsSuccessData {
    success: true;
    
    /** 更新后的完整设置 */
    settings: GlobalSettings;
}

/**
 * 更新设置失败响应
 */
export interface UpdateSettingsErrorData {
    success: false;
    
    /** 错误信息 */
    error: {
        code: string;
        message: string;
    };
}

/**
 * 更新设置响应
 */
export type UpdateSettingsResponse = UpdateSettingsSuccessData | UpdateSettingsErrorData;

/**
 * 设置变更通知数据
 *
 * 用于实时推送设置变更到前端
 */
export interface SettingsChangeNotification {
    /** 通知类型 */
    type: 'settingsChanged';
    
    /** 变更类型 */
    changeType: 'channel' | 'tools' | 'toolMode' | 'proxy' | 'storagePath' | 'ui' | 'full';
    
    /** 变更的字段路径（如 'toolsEnabled.read_file'） */
    path?: string;
    
    /** 新的完整设置 */
    settings: GlobalSettings;
}

/**
 * ========== 工具相关 ==========
 */

/**
 * 获取工具列表请求（无需参数）
 */
export interface GetToolsListRequest {
    // 空对象，仅用于类型标记
}

/**
 * 工具信息
 */
export interface ToolInfo {
    /** 工具名称 */
    name: string;
    
    /** 工具描述 */
    description: string;
    
    /** 是否启用 */
    enabled: boolean;
    
    /** 工具分类（如 file, search, terminal） */
    category?: string;
}

/**
 * 获取工具列表成功响应
 */
export interface GetToolsListSuccessData {
    success: true;
    
    /** 工具列表 */
    tools: ToolInfo[];
}

/**
 * 获取工具列表失败响应
 */
export interface GetToolsListErrorData {
    success: false;
    
    /** 错误信息 */
    error: {
        code: string;
        message: string;
    };
}

/**
 * 获取工具列表响应
 */
export type GetToolsListResponse = GetToolsListSuccessData | GetToolsListErrorData;

/**
 * ========== 工具配置相关 ==========
 */

/**
 * 获取工具配置请求
 */
export interface GetToolConfigRequest {
    /** 工具名称 */
    toolName: string;
}

/**
 * 获取工具配置成功响应
 */
export interface GetToolConfigSuccessData {
    success: true;
    
    /** 工具配置 */
    config: Record<string, unknown>;
}

/**
 * 获取工具配置失败响应
 */
export interface GetToolConfigErrorData {
    success: false;
    
    /** 错误信息 */
    error: {
        code: string;
        message: string;
    };
}

/**
 * 获取工具配置响应
 */
export type GetToolConfigResponse = GetToolConfigSuccessData | GetToolConfigErrorData;

/**
 * 更新工具配置请求
 */
export interface UpdateToolConfigRequest {
    /** 工具名称 */
    toolName: string;
    
    /** 配置内容 */
    config: Record<string, unknown>;
}

/**
 * 更新 list_files 配置请求
 */
export interface UpdateListFilesConfigRequest {
    /** 配置内容 */
    config: Partial<ListFilesToolConfig>;
}

/**
 * 更新 apply_diff 配置请求
 */
export interface UpdateApplyDiffConfigRequest {
    /** 配置内容 */
    config: Partial<ApplyDiffToolConfig>;
}

/**
 * 更新工具配置响应
 */
export type UpdateToolConfigResponse = UpdateSettingsResponse;