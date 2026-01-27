/**
 * LimCode - 设置模块
 *
 * 导出设置相关的所有接口和实现
 */

export { SettingsManager } from './SettingsManager';
export type { SettingsStorage } from './SettingsManager';
export { FileSettingsStorage, MemorySettingsStorage } from './storage';
export { VSCodeSettingsStorage } from './VSCodeSettingsStorage';
export { StoragePathManager } from './StoragePathManager';
export type {
    GlobalSettings,
    ToolsEnabledState,
    SettingsChangeEvent,
    SettingsChangeListener,
    ProxySettings,
    ToolsConfig,
    ListFilesToolConfig,
    ApplyDiffToolConfig,
    ExecuteCommandToolConfig,
    ShellConfig,
    StoragePathConfig,
    StorageStats
} from './types';
export {
    DEFAULT_GLOBAL_SETTINGS,
    DEFAULT_LIST_FILES_CONFIG,
    DEFAULT_APPLY_DIFF_CONFIG,
    getDefaultExecuteCommandConfig
} from './types';