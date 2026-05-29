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
    StorageStats,
    // 为什么要改：execute_command 的 Skill 目录 break-glass 设置需要被测试和外部设置管理模块明确引用。
    // 怎么改：从 settings 统一出口导出 SecuritySettings 类型，而不是让调用方绕过模块边界直接访问内部文件。
    // 目的：保持设置模块公共 API 完整，避免新增安全配置后出现散落的深层 import。
    SecuritySettings
} from './types';
export {
    DEFAULT_GLOBAL_SETTINGS,
    DEFAULT_LIST_FILES_CONFIG,
    DEFAULT_APPLY_DIFF_CONFIG,
    // 为什么要改：单测需要复用 fail-closed 默认安全配置，避免在测试中手写一份可能漂移的默认值。
    // 怎么改：从 settings 统一出口导出 DEFAULT_SECURITY_SETTINGS。
    // 目的：保证测试、运行时和设置迁移共享同一份默认安全语义。
    DEFAULT_SECURITY_SETTINGS,
    getDefaultExecuteCommandConfig
} from './types';
