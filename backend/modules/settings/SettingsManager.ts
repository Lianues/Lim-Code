/**
 * LimCode - 设置管理器
 * 
 * 负责全局设置的管理、持久化和通知
 */

import type {
    GlobalSettings,
    SettingsChangeEvent,
    SettingsChangeListener,
    ToolsEnabledState,
    ToolAutoExecConfig,
    ProxySettings,
    ToolsConfig,
    ListFilesToolConfig,
    FindFilesToolConfig,
    SearchInFilesToolConfig,
    ApplyDiffToolConfig,
    DeleteFileToolConfig,
    ExecuteCommandToolConfig,
    ShellConfig,
    CheckpointConfig,
    SummarizeConfig,
    GenerateImageToolConfig,
    RemoveBackgroundToolConfig,
    CropImageToolConfig,
    ResizeImageToolConfig,
    RotateImageToolConfig,
    GoogleSearchToolConfig,
    ContextAwarenessConfig,
    DiagnosticsConfig,
    PinnedFilesConfig,
    PinnedFileItem,
    SystemPromptConfig,
    StoragePathConfig,
    StorageStats,
    TokenCountConfig
} from './types';
import {
    DEFAULT_GLOBAL_SETTINGS,
    DEFAULT_LIST_FILES_CONFIG,
    DEFAULT_FIND_FILES_CONFIG,
    DEFAULT_SEARCH_IN_FILES_CONFIG,
    DEFAULT_APPLY_DIFF_CONFIG,
    DEFAULT_DELETE_FILE_CONFIG,
    DEFAULT_CHECKPOINT_CONFIG,
    DEFAULT_TOOL_AUTO_EXEC_CONFIG,
    DEFAULT_SUMMARIZE_CONFIG,
    DEFAULT_GENERATE_IMAGE_CONFIG,
    DEFAULT_REMOVE_BACKGROUND_CONFIG,
    DEFAULT_CROP_IMAGE_CONFIG,
    DEFAULT_RESIZE_IMAGE_CONFIG,
    DEFAULT_ROTATE_IMAGE_CONFIG,
    DEFAULT_GOOGLE_SEARCH_CONFIG,
    DEFAULT_CONTEXT_AWARENESS_CONFIG,
    DEFAULT_DIAGNOSTICS_CONFIG,
    DEFAULT_PINNED_FILES_CONFIG,
    DEFAULT_SYSTEM_PROMPT_CONFIG,
    DEFAULT_MAX_TOOL_ITERATIONS,
    DEFAULT_TOKEN_COUNT_CONFIG,
    getDefaultExecuteCommandConfig
} from './types';

/**
 * 设置存储接口
 * 
 * 抽象存储层，支持不同的存储实现
 */
export interface SettingsStorage {
    /**
     * 加载设置
     */
    load(): Promise<GlobalSettings | null>;
    
    /**
     * 保存设置
     */
    save(settings: GlobalSettings): Promise<void>;
}

/**
 * 设置管理器
 * 
 * 功能：
 * 1. 全局设置的读写
 * 2. 设置持久化
 * 3. 变更通知机制
 * 4. 工具启用/禁用管理
 */
export class SettingsManager {
    private settings: GlobalSettings;
    private listeners: Set<SettingsChangeListener> = new Set();
    private storage: SettingsStorage;
    
    constructor(storage: SettingsStorage) {
        this.storage = storage;
        this.settings = { ...DEFAULT_GLOBAL_SETTINGS };
    }
    
    /**
     * 初始化：从存储加载设置
     */
    async initialize(): Promise<void> {
        const stored = await this.storage.load();
        if (stored) {
            this.settings = {
                ...DEFAULT_GLOBAL_SETTINGS,
                ...stored,
                // 合并工具启用状态（保留默认值）
                toolsEnabled: {
                    ...DEFAULT_GLOBAL_SETTINGS.toolsEnabled,
                    ...stored.toolsEnabled
                },
                // 合并工具配置（保留默认值和存储值）
                toolsConfig: {
                    ...DEFAULT_GLOBAL_SETTINGS.toolsConfig,
                    ...stored.toolsConfig
                }
            };
        }
    }
    
    /**
     * 获取完整设置
     */
    getSettings(): Readonly<GlobalSettings> {
        return { ...this.settings };
    }
    
    /**
     * 更新设置（部分更新）
     */
    async updateSettings(updates: Partial<GlobalSettings>): Promise<void> {
        const oldSettings = { ...this.settings };
        
        // 合并更新
        this.settings = {
            ...this.settings,
            ...updates,
            lastUpdated: Date.now()
        };
        
        // 保存到存储
        await this.storage.save(this.settings);
        
        // 通知变更
        this.notifyChange({
            type: 'full',
            oldValue: oldSettings,
            newValue: this.settings,
            settings: this.settings
        });
    }
    
    // ========== 工具调用配置 ==========
    
    /**
     * 获取单回合最大工具调用次数
     */
    getMaxToolIterations(): number {
        return this.settings.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    }
    
    /**
     * 设置单回合最大工具调用次数
     *
     * @param value 最大次数，-1 表示无限制，正整数表示具体次数
     */
    async setMaxToolIterations(value: number): Promise<void> {
        // -1 表示无限制，正整数表示具体次数，最小为 1
        const safeValue = value === -1 ? -1 : Math.max(1, value);
        const oldValue = this.settings.maxToolIterations;
        this.settings.maxToolIterations = safeValue;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'maxToolIterations',
            oldValue,
            newValue: safeValue,
            settings: this.settings
        });
    }
    
    // ========== 渠道管理 ==========
    
    /**
     * 获取当前激活的渠道 ID
     */
    getActiveChannelId(): string | undefined {
        return this.settings.activeChannelId;
    }
    
    /**
     * 设置激活的渠道 ID
     */
    async setActiveChannelId(channelId: string): Promise<void> {
        const oldValue = this.settings.activeChannelId;
        this.settings.activeChannelId = channelId;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'channel',
            path: 'activeChannelId',
            oldValue,
            newValue: channelId,
            settings: this.settings
        });
    }
    
    // ========== 工具管理 ==========
    
    /**
     * 获取工具启用状态
     */
    getToolsEnabled(): Readonly<ToolsEnabledState> {
        return { ...this.settings.toolsEnabled };
    }
    
    /**
     * 检查工具是否启用
     * 
     * @param toolName 工具名称
     * @returns 是否启用（未配置时默认启用）
     */
    isToolEnabled(toolName: string): boolean {
        // 如果未配置，默认启用
        return this.settings.toolsEnabled[toolName] !== false;
    }
    
    /**
     * 设置工具启用状态
     * 
     * @param toolName 工具名称
     * @param enabled 是否启用
     */
    async setToolEnabled(toolName: string, enabled: boolean): Promise<void> {
        const oldValue = this.settings.toolsEnabled[toolName];
        this.settings.toolsEnabled[toolName] = enabled;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: `toolsEnabled.${toolName}`,
            oldValue,
            newValue: enabled,
            settings: this.settings
        });
    }
    
    /**
     * 批量设置工具启用状态
     * 
     * @param states 工具名称到启用状态的映射
     */
    async setToolsEnabled(states: ToolsEnabledState): Promise<void> {
        const oldValue = { ...this.settings.toolsEnabled };
        this.settings.toolsEnabled = {
            ...this.settings.toolsEnabled,
            ...states
        };
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsEnabled',
            oldValue,
            newValue: this.settings.toolsEnabled,
            settings: this.settings
        });
    }
    
    /**
     * 获取启用的工具列表
     *
     * @param allTools 所有可用工具名称
     * @returns 启用的工具名称数组
     */
    getEnabledTools(allTools: string[]): string[] {
        return allTools.filter(name => this.isToolEnabled(name));
    }
    
    // ========== 工具自动执行管理 ==========
    
    /**
     * 获取工具自动执行配置
     */
    getToolAutoExecConfig(): Readonly<ToolAutoExecConfig> {
        return this.settings.toolAutoExec || DEFAULT_TOOL_AUTO_EXEC_CONFIG;
    }
    
    /**
     * 检查工具是否可以自动执行（无需用户确认）
     *
     * @param toolName 工具名称
     * @returns true = 自动执行，false = 需要确认
     */
    isToolAutoExec(toolName: string): boolean {
        const config = this.settings.toolAutoExec || DEFAULT_TOOL_AUTO_EXEC_CONFIG;
        // 如果未配置，默认自动执行
        if (config[toolName] === undefined) {
            return true;
        }
        return config[toolName];
    }
    
    /**
     * 设置工具是否可以自动执行
     *
     * @param toolName 工具名称
     * @param autoExec true = 自动执行，false = 需要确认
     */
    async setToolAutoExec(toolName: string, autoExec: boolean): Promise<void> {
        const oldConfig = { ...this.getToolAutoExecConfig() };
        
        if (!this.settings.toolAutoExec) {
            this.settings.toolAutoExec = { ...DEFAULT_TOOL_AUTO_EXEC_CONFIG };
        }
        this.settings.toolAutoExec[toolName] = autoExec;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: `toolAutoExec.${toolName}`,
            oldValue: oldConfig[toolName],
            newValue: autoExec,
            settings: this.settings
        });
    }
    
    /**
     * 批量设置工具自动执行配置
     */
    async setToolAutoExecConfig(config: ToolAutoExecConfig): Promise<void> {
        const oldConfig = this.getToolAutoExecConfig();
        this.settings.toolAutoExec = {
            ...this.settings.toolAutoExec,
            ...config
        };
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolAutoExec',
            oldValue: oldConfig,
            newValue: this.settings.toolAutoExec,
            settings: this.settings
        });
    }
    
    /**
     * 获取需要确认的工具列表
     *
     * @param allTools 所有可用工具名称
     * @returns 需要确认的工具名称数组
     */
    getToolsRequiringConfirmation(allTools: string[]): string[] {
        return allTools.filter(name => !this.isToolAutoExec(name));
    }
    
    // ========== 工具配置管理 ==========
    
    /**
     * 获取工具配置
     */
    getToolsConfig(): Readonly<ToolsConfig> {
        return this.settings.toolsConfig || {};
    }
    
    /**
     * 获取 list_files 工具配置
     */
    getListFilesConfig(): Readonly<ListFilesToolConfig> {
        return this.settings.toolsConfig?.list_files || DEFAULT_LIST_FILES_CONFIG;
    }
    
    /**
     * 更新 list_files 工具配置
     */
    async updateListFilesConfig(config: Partial<ListFilesToolConfig>): Promise<void> {
        const oldConfig = this.getListFilesConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.list_files = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.list_files',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取 find_files 工具配置
     */
    getFindFilesConfig(): Readonly<FindFilesToolConfig> {
        return this.settings.toolsConfig?.find_files || DEFAULT_FIND_FILES_CONFIG;
    }
    
    /**
     * 更新 find_files 工具配置
     */
    async updateFindFilesConfig(config: Partial<FindFilesToolConfig>): Promise<void> {
        const oldConfig = this.getFindFilesConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.find_files = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.find_files',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取 search_in_files 工具配置
     */
    getSearchInFilesConfig(): Readonly<SearchInFilesToolConfig> {
        return this.settings.toolsConfig?.search_in_files || DEFAULT_SEARCH_IN_FILES_CONFIG;
    }
    
    /**
     * 更新 search_in_files 工具配置
     */
    async updateSearchInFilesConfig(config: Partial<SearchInFilesToolConfig>): Promise<void> {
        const oldConfig = this.getSearchInFilesConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.search_in_files = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.search_in_files',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 更新工具配置
     */
    async updateToolConfig(toolName: string, config: Record<string, unknown>): Promise<void> {
        const oldConfig = this.settings.toolsConfig?.[toolName] || {};
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig[toolName] = newConfig as any;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: `toolsConfig.${toolName}`,
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取 apply_diff 工具配置
     */
    getApplyDiffConfig(): Readonly<ApplyDiffToolConfig> {
        return this.settings.toolsConfig?.apply_diff || DEFAULT_APPLY_DIFF_CONFIG;
    }
    
    /**
     * 更新 apply_diff 工具配置
     */
    async updateApplyDiffConfig(config: Partial<ApplyDiffToolConfig>): Promise<void> {
        const oldConfig = this.getApplyDiffConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.apply_diff = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.apply_diff',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取 delete_file 工具配置
     */
    getDeleteFileConfig(): Readonly<DeleteFileToolConfig> {
        return this.settings.toolsConfig?.delete_file || DEFAULT_DELETE_FILE_CONFIG;
    }
    
    /**
     * 更新 delete_file 工具配置
     */
    async updateDeleteFileConfig(config: Partial<DeleteFileToolConfig>): Promise<void> {
        const oldConfig = this.getDeleteFileConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.delete_file = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.delete_file',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取 execute_command 工具配置
     */
    getExecuteCommandConfig(): Readonly<ExecuteCommandToolConfig> {
        return this.settings.toolsConfig?.execute_command || getDefaultExecuteCommandConfig();
    }
    
    /**
     * 更新 execute_command 工具配置
     */
    async updateExecuteCommandConfig(config: Partial<ExecuteCommandToolConfig>): Promise<void> {
        const oldConfig = this.getExecuteCommandConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.execute_command = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.execute_command',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取启用的 Shell 列表
     */
    getEnabledShells(): ShellConfig[] {
        const config = this.getExecuteCommandConfig();
        return config.shells.filter(shell => shell.enabled);
    }
    
    /**
     * 获取默认 Shell 类型
     */
    getDefaultShell(): string {
        return this.getExecuteCommandConfig().defaultShell;
    }
    
    /**
     * 设置默认 Shell
     */
    async setDefaultShell(shellType: string): Promise<void> {
        await this.updateExecuteCommandConfig({ defaultShell: shellType });
    }
    
    /**
     * 更新 Shell 配置
     */
    async updateShellConfig(shellType: string, updates: Partial<ShellConfig>): Promise<void> {
        const config = this.getExecuteCommandConfig();
        const shells = config.shells.map(shell =>
            shell.type === shellType ? { ...shell, ...updates } : shell
        );
        await this.updateExecuteCommandConfig({ shells });
    }
    
    /**
     * 启用/禁用 Shell
     */
    async setShellEnabled(shellType: string, enabled: boolean): Promise<void> {
        await this.updateShellConfig(shellType, { enabled });
    }
    
    // ========== 存档点配置管理 ==========
    
    /**
     * 获取存档点配置
     */
    getCheckpointConfig(): Readonly<CheckpointConfig> {
        return this.settings.toolsConfig?.checkpoint || DEFAULT_CHECKPOINT_CONFIG;
    }
    
    /**
     * 更新存档点配置
     */
    async updateCheckpointConfig(config: Partial<CheckpointConfig>): Promise<void> {
        const oldConfig = this.getCheckpointConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.checkpoint = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.checkpoint',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 检查工具是否需要在执行前创建备份
     */
    shouldCreateBeforeCheckpoint(toolName: string): boolean {
        const config = this.getCheckpointConfig();
        return config.enabled && config.beforeTools.includes(toolName);
    }
    
    /**
     * 检查工具是否需要在执行后创建备份
     */
    shouldCreateAfterCheckpoint(toolName: string): boolean {
        const config = this.getCheckpointConfig();
        return config.enabled && config.afterTools.includes(toolName);
    }
    
    /**
     * 启用/禁用存档点功能
     */
    async setCheckpointEnabled(enabled: boolean): Promise<void> {
        await this.updateCheckpointConfig({ enabled });
    }
    
    /**
     * 设置工具的备份阶段
     */
    async setToolCheckpointPhase(toolName: string, before: boolean, after: boolean): Promise<void> {
        const config = this.getCheckpointConfig();
        
        const beforeTools = [...config.beforeTools];
        const afterTools = [...config.afterTools];
        
        // 更新 beforeTools
        const beforeIndex = beforeTools.indexOf(toolName);
        if (before && beforeIndex === -1) {
            beforeTools.push(toolName);
        } else if (!before && beforeIndex !== -1) {
            beforeTools.splice(beforeIndex, 1);
        }
        
        // 更新 afterTools
        const afterIndex = afterTools.indexOf(toolName);
        if (after && afterIndex === -1) {
            afterTools.push(toolName);
        } else if (!after && afterIndex !== -1) {
            afterTools.splice(afterIndex, 1);
        }
        
        await this.updateCheckpointConfig({ beforeTools, afterTools });
    }
    
    /**
     * 检查是否需要在用户消息前创建存档点
     */
    shouldCreateBeforeUserMessageCheckpoint(): boolean {
        const config = this.getCheckpointConfig();
        return config.enabled && (config.messageCheckpoint?.beforeMessages?.includes('user') ?? false);
    }
    
    /**
     * 检查是否需要在用户消息后创建存档点
     */
    shouldCreateAfterUserMessageCheckpoint(): boolean {
        const config = this.getCheckpointConfig();
        return config.enabled && (config.messageCheckpoint?.afterMessages?.includes('user') ?? false);
    }
    
    /**
     * 检查是否需要在模型消息前创建存档点
     */
    shouldCreateBeforeModelMessageCheckpoint(): boolean {
        const config = this.getCheckpointConfig();
        return config.enabled && (config.messageCheckpoint?.beforeMessages?.includes('model') ?? false);
    }
    
    /**
     * 检查是否需要在模型消息后创建存档点（不包含工具调用的纯文本回复）
     */
    shouldCreateAfterModelMessageCheckpoint(): boolean {
        const config = this.getCheckpointConfig();
        return config.enabled && (config.messageCheckpoint?.afterMessages?.includes('model') ?? false);
    }
    
    /**
     * 检查是否只在最外层创建模型消息存档点
     *
     * 当返回 true 时，连续工具调用时只在第一次和最后一次创建存档点
     * 当返回 false 时，每次迭代都创建存档点
     */
    isModelOuterLayerOnly(): boolean {
        const config = this.getCheckpointConfig();
        // 默认为 true（只在最外层创建）
        return config.messageCheckpoint?.modelOuterLayerOnly ?? true;
    }
    
    // ========== 工具模式管理 ==========
    
    /**
     * 获取默认工具模式
     */
    getDefaultToolMode(): 'function_call' | 'xml' {
        return this.settings.defaultToolMode || 'function_call';
    }
    
    /**
     * 设置默认工具模式
     */
    async setDefaultToolMode(mode: 'function_call' | 'xml'): Promise<void> {
        const oldValue = this.settings.defaultToolMode;
        this.settings.defaultToolMode = mode;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'toolMode',
            path: 'defaultToolMode',
            oldValue,
            newValue: mode,
            settings: this.settings
        });
    }
    
    // ========== 代理设置管理 ==========
    
    /**
     * 获取代理设置
     */
    getProxySettings(): Readonly<ProxySettings> {
        return this.settings.proxy || { enabled: false };
    }
    
    /**
     * 获取有效的代理 URL
     *
     * 仅当代理启用且 URL 有效时返回代理地址
     * @returns 代理 URL 或 undefined
     */
    getEffectiveProxyUrl(): string | undefined {
        const proxy = this.settings.proxy;
        if (proxy?.enabled && proxy.url && proxy.url.trim()) {
            return proxy.url.trim();
        }
        return undefined;
    }
    
    /**
     * 更新代理设置
     */
    async updateProxySettings(proxySettings: Partial<ProxySettings>): Promise<void> {
        const oldValue = this.settings.proxy;
        this.settings.proxy = {
            ...this.settings.proxy,
            ...proxySettings
        };
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'proxy',
            path: 'proxy',
            oldValue,
            newValue: this.settings.proxy,
            settings: this.settings
        });
    }
    
    /**
     * 设置代理启用状态
     */
    async setProxyEnabled(enabled: boolean): Promise<void> {
        await this.updateProxySettings({ enabled });
    }
    
    /**
     * 设置代理 URL
     */
    async setProxyUrl(url: string | undefined): Promise<void> {
        await this.updateProxySettings({ url });
    }
    
    // ========== 总结配置管理 ==========
    
    /**
     * 获取总结配置
     */
    getSummarizeConfig(): Readonly<SummarizeConfig> {
        return this.settings.toolsConfig?.summarize || DEFAULT_SUMMARIZE_CONFIG;
    }
    
    // ========== 图像生成配置管理 ==========
    
    /**
     * 获取图像生成工具配置
     */
    getGenerateImageConfig(): Readonly<GenerateImageToolConfig> {
        return this.settings.toolsConfig?.generate_image || DEFAULT_GENERATE_IMAGE_CONFIG;
    }
    
    /**
     * 更新图像生成工具配置
     */
    async updateGenerateImageConfig(config: Partial<GenerateImageToolConfig>): Promise<void> {
        const oldConfig = this.getGenerateImageConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.generate_image = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.generate_image',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    // ========== 抠图工具配置管理 ==========
    
    /**
     * 获取抠图工具配置
     */
    getRemoveBackgroundConfig(): Readonly<RemoveBackgroundToolConfig> {
        return this.settings.toolsConfig?.remove_background || DEFAULT_REMOVE_BACKGROUND_CONFIG;
    }
    
    /**
     * 更新抠图工具配置
     */
    async updateRemoveBackgroundConfig(config: Partial<RemoveBackgroundToolConfig>): Promise<void> {
        const oldConfig = this.getRemoveBackgroundConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.remove_background = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.remove_background',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    // ========== 裁切图片工具配置管理 ==========
    
    /**
     * 获取裁切图片工具配置
     */
    getCropImageConfig(): Readonly<CropImageToolConfig> {
        return this.settings.toolsConfig?.crop_image || DEFAULT_CROP_IMAGE_CONFIG;
    }
    
    /**
     * 更新裁切图片工具配置
     */
    async updateCropImageConfig(config: Partial<CropImageToolConfig>): Promise<void> {
        const oldConfig = this.getCropImageConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.crop_image = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.crop_image',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    // ========== 缩放图片工具配置管理 ==========
    
    /**
     * 获取缩放图片工具配置
     */
    getResizeImageConfig(): Readonly<ResizeImageToolConfig> {
        return this.settings.toolsConfig?.resize_image || DEFAULT_RESIZE_IMAGE_CONFIG;
    }
    
    /**
     * 更新缩放图片工具配置
     */
    async updateResizeImageConfig(config: Partial<ResizeImageToolConfig>): Promise<void> {
        const oldConfig = this.getResizeImageConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.resize_image = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.resize_image',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    // ========== 旋转图片工具配置管理 ==========
    
    /**
     * 获取旋转图片工具配置
     */
    getRotateImageConfig(): Readonly<RotateImageToolConfig> {
        return this.settings.toolsConfig?.rotate_image || DEFAULT_ROTATE_IMAGE_CONFIG;
    }
    
    /**
     * 更新旋转图片工具配置
     */
    async updateRotateImageConfig(config: Partial<RotateImageToolConfig>): Promise<void> {
        const oldConfig = this.getRotateImageConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.rotate_image = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.rotate_image',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }

    /**
     * 获取 Google 搜索工具配置
     */
    getGoogleSearchConfig(): Readonly<GoogleSearchToolConfig> {
        return this.settings.toolsConfig?.google_search || DEFAULT_GOOGLE_SEARCH_CONFIG;
    }

    /**
     * 更新 Google 搜索工具配置
     */
    async updateGoogleSearchConfig(config: Partial<GoogleSearchToolConfig>): Promise<void> {
        const oldConfig = this.getGoogleSearchConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.google_search = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.google_search',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 更新总结配置
     */
    async updateSummarizeConfig(config: Partial<SummarizeConfig>): Promise<void> {
        const oldConfig = this.getSummarizeConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.summarize = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.summarize',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    // ========== 上下文感知配置管理 ==========
    
    /**
     * 获取上下文感知配置
     */
    getContextAwarenessConfig(): Readonly<ContextAwarenessConfig> {
        return this.settings.toolsConfig?.context_awareness || DEFAULT_CONTEXT_AWARENESS_CONFIG;
    }
    
    /**
     * 更新上下文感知配置
     */
    async updateContextAwarenessConfig(config: Partial<ContextAwarenessConfig>): Promise<void> {
        const oldConfig = this.getContextAwarenessConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.context_awareness = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.context_awareness',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 检查是否应该包含工作区文件树
     */
    shouldIncludeWorkspaceFiles(): boolean {
        return this.getContextAwarenessConfig().includeWorkspaceFiles;
    }
    
    /**
     * 获取文件树最大深度
     * @returns 最大深度，-1 表示无限制
     */
    getMaxFileDepth(): number {
        return this.getContextAwarenessConfig().maxFileDepth;
    }
    
    /**
     * 检查是否应该包含打开的标签页
     */
    shouldIncludeOpenTabs(): boolean {
        return this.getContextAwarenessConfig().includeOpenTabs;
    }
    
    /**
     * 获取打开标签页最大数量
     * @returns 最大数量，-1 表示无限制
     */
    getMaxOpenTabs(): number {
        return this.getContextAwarenessConfig().maxOpenTabs;
    }
    
    /**
     * 检查是否应该包含当前活动编辑器路径
     */
    shouldIncludeActiveEditor(): boolean {
        return this.getContextAwarenessConfig().includeActiveEditor;
    }
    
    /**
     * 获取自定义忽略模式
     */
    getContextIgnorePatterns(): string[] {
        return this.getContextAwarenessConfig().ignorePatterns || [];
    }
    
    // ========== 诊断信息配置管理 ==========
    
    /**
     * 获取诊断信息配置
     */
    getDiagnosticsConfig(): Readonly<DiagnosticsConfig> {
        return this.getContextAwarenessConfig().diagnostics || DEFAULT_DIAGNOSTICS_CONFIG;
    }
    
    /**
     * 更新诊断信息配置
     */
    async updateDiagnosticsConfig(config: Partial<DiagnosticsConfig>): Promise<void> {
        const contextConfig = this.getContextAwarenessConfig();
        const oldConfig = this.getDiagnosticsConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        await this.updateContextAwarenessConfig({
            ...contextConfig,
            diagnostics: newConfig
        });
    }
    
    /**
     * 检查诊断功能是否启用
     */
    isDiagnosticsEnabled(): boolean {
        return this.getDiagnosticsConfig().enabled;
    }
    
    /**
     * 设置诊断功能启用状态
     */
    async setDiagnosticsEnabled(enabled: boolean): Promise<void> {
        await this.updateDiagnosticsConfig({ enabled });
    }
    
    /**
     * 获取包含的诊断严重程度级别
     */
    getDiagnosticsSeverities(): string[] {
        return this.getDiagnosticsConfig().includeSeverities;
    }
    
    /**
     * 设置包含的诊断严重程度级别
     */
    async setDiagnosticsSeverities(severities: ('error' | 'warning' | 'information' | 'hint')[]): Promise<void> {
        await this.updateDiagnosticsConfig({ includeSeverities: severities });
    }
    
    // ========== 固定文件配置管理 ==========
    
    /**
     * 获取固定文件配置
     */
    getPinnedFilesConfig(): Readonly<PinnedFilesConfig> {
        return this.settings.toolsConfig?.pinned_files || DEFAULT_PINNED_FILES_CONFIG;
    }
    
    /**
     * 更新固定文件配置
     */
    async updatePinnedFilesConfig(config: Partial<PinnedFilesConfig>): Promise<void> {
        const oldConfig = this.getPinnedFilesConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.pinned_files = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.pinned_files',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取固定文件列表
     */
    getPinnedFiles(): PinnedFileItem[] {
        return this.getPinnedFilesConfig().files || [];
    }
    
    /**
     * 获取启用的固定文件列表
     */
    getEnabledPinnedFiles(): PinnedFileItem[] {
        return this.getPinnedFiles().filter(file => file.enabled);
    }
    
    /**
     * 添加固定文件
     * @param path 文件路径（相对于工作区）
     * @param workspaceUri 工作区 URI
     * @returns 新添加的文件项
     */
    async addPinnedFile(path: string, workspaceUri: string): Promise<PinnedFileItem> {
        const files = [...this.getPinnedFiles()];
        
        // 检查是否已存在（同一工作区同一路径）
        if (files.some(f => f.path === path && f.workspaceUri === workspaceUri)) {
            throw new Error(`File already pinned: ${path}`);
        }
        
        const newFile: PinnedFileItem = {
            id: `pinned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            path,
            workspaceUri,
            enabled: true,
            addedAt: Date.now()
        };
        
        files.push(newFile);
        await this.updatePinnedFilesConfig({ files });
        
        return newFile;
    }
    
    /**
     * 获取当前工作区的固定文件列表
     * @param workspaceUri 当前工作区 URI
     */
    getPinnedFilesForWorkspace(workspaceUri: string): PinnedFileItem[] {
        return this.getPinnedFiles().filter(f => f.workspaceUri === workspaceUri);
    }
    
    /**
     * 获取当前工作区启用的固定文件列表
     * @param workspaceUri 当前工作区 URI
     */
    getEnabledPinnedFilesForWorkspace(workspaceUri: string): PinnedFileItem[] {
        return this.getPinnedFilesForWorkspace(workspaceUri).filter(f => f.enabled);
    }
    
    /**
     * 移除固定文件
     * @param id 文件 ID
     */
    async removePinnedFile(id: string): Promise<void> {
        const files = this.getPinnedFiles().filter(f => f.id !== id);
        await this.updatePinnedFilesConfig({ files });
    }
    
    /**
     * 切换固定文件的启用状态
     * @param id 文件 ID
     * @param enabled 是否启用
     */
    async setPinnedFileEnabled(id: string, enabled: boolean): Promise<void> {
        const files = this.getPinnedFiles().map(f =>
            f.id === id ? { ...f, enabled } : f
        );
        await this.updatePinnedFilesConfig({ files });
    }
    
    /**
     * 更新固定文件路径
     * @param id 文件 ID
     * @param newPath 新路径
     */
    async updatePinnedFilePath(id: string, newPath: string): Promise<void> {
        const files = this.getPinnedFiles().map(f =>
            f.id === id ? { ...f, path: newPath } : f
        );
        await this.updatePinnedFilesConfig({ files });
    }
    
    /**
     * 清空所有固定文件
     */
    async clearPinnedFiles(): Promise<void> {
        await this.updatePinnedFilesConfig({ files: [] });
    }
    
    /**
     * 检查文件是否已固定
     * @param path 文件路径
     */
    isFilePinned(path: string): boolean {
        return this.getPinnedFiles().some(f => f.path === path);
    }
    
    /**
     * 获取固定文件段落标题
     */
    getPinnedFilesSectionTitle(): string {
        return this.getPinnedFilesConfig().sectionTitle || 'PINNED FILES CONTENT';
    }
    
    // ========== 系统提示词配置管理 ==========
    
    /**
     * 获取系统提示词配置
     */
    getSystemPromptConfig(): Readonly<SystemPromptConfig> {
        return this.settings.toolsConfig?.system_prompt || DEFAULT_SYSTEM_PROMPT_CONFIG;
    }
    
    /**
     * 更新系统提示词配置
     */
    async updateSystemPromptConfig(config: Partial<SystemPromptConfig>): Promise<void> {
        const oldConfig = this.getSystemPromptConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.system_prompt = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.system_prompt',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 获取系统提示词模板
     */
    getSystemPromptTemplate(): string {
        return this.getSystemPromptConfig().template;
    }
    
    /**
     * 获取自定义前缀
     */
    getSystemPromptPrefix(): string {
        return this.getSystemPromptConfig().customPrefix;
    }
    
    /**
     * 获取自定义后缀
     */
    getSystemPromptSuffix(): string {
        return this.getSystemPromptConfig().customSuffix;
    }
    
    // ========== Token 计数配置管理 ==========
    
    /**
     * 获取 Token 计数配置
     */
    getTokenCountConfig(): Readonly<TokenCountConfig> {
        return this.settings.toolsConfig?.token_count || DEFAULT_TOKEN_COUNT_CONFIG;
    }
    
    /**
     * 更新 Token 计数配置
     */
    async updateTokenCountConfig(config: Partial<TokenCountConfig>): Promise<void> {
        const oldConfig = this.getTokenCountConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        if (!this.settings.toolsConfig) {
            this.settings.toolsConfig = {};
        }
        this.settings.toolsConfig.token_count = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'tools',
            path: 'toolsConfig.token_count',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 检查指定渠道的 Token 计数是否已启用
     *
     * @param channelType 渠道类型 (gemini, openai, anthropic)
     * @returns 是否启用
     */
    isTokenCountEnabled(channelType: 'gemini' | 'openai' | 'anthropic'): boolean {
        const config = this.getTokenCountConfig();
        return config[channelType]?.enabled ?? false;
    }
    
    // ========== UI 设置管理 ==========
    
    /**
     * 获取 UI 设置
     */
    getUISettings() {
        return this.settings.ui || {};
    }
    
    /**
     * 更新 UI 设置
     */
    async updateUISettings(uiSettings: Partial<NonNullable<GlobalSettings['ui']>>): Promise<void> {
        const oldValue = this.settings.ui;
        this.settings.ui = {
            ...this.settings.ui,
            ...uiSettings
        };
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'ui',
            path: 'ui',
            oldValue,
            newValue: this.settings.ui,
            settings: this.settings
        });
    }
    
    // ========== 事件监听 ==========
    
    /**
     * 添加设置变更监听器
     */
    addChangeListener(listener: SettingsChangeListener): void {
        this.listeners.add(listener);
    }
    
    /**
     * 移除设置变更监听器
     */
    removeChangeListener(listener: SettingsChangeListener): void {
        this.listeners.delete(listener);
    }
    
    /**
     * 通知设置变更
     */
    private notifyChange(event: SettingsChangeEvent): void {
        for (const listener of this.listeners) {
            // 异步执行，避免阻塞
            Promise.resolve(listener(event)).catch(error => {
                console.error('Settings change listener error:', error);
            });
        }
    }
    
    // ========== 存储路径管理 ==========
    
    /**
     * 获取存储路径配置
     */
    getStoragePathConfig(): Readonly<StoragePathConfig> {
        return this.settings.storagePath || {};
    }
    
    /**
     * 获取自定义数据存储路径
     * 如果未设置返回 undefined
     */
    getCustomDataPath(): string | undefined {
        return this.settings.storagePath?.customDataPath;
    }
    
    /**
     * 更新存储路径配置
     */
    async updateStoragePathConfig(config: Partial<StoragePathConfig>): Promise<void> {
        const oldConfig = this.getStoragePathConfig();
        const newConfig = {
            ...oldConfig,
            ...config
        };
        
        this.settings.storagePath = newConfig;
        this.settings.lastUpdated = Date.now();
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'full',
            path: 'storagePath',
            oldValue: oldConfig,
            newValue: newConfig,
            settings: this.settings
        });
    }
    
    /**
     * 设置自定义数据存储路径
     * 设置后需要迁移数据
     */
    async setCustomDataPath(path: string | undefined): Promise<void> {
        await this.updateStoragePathConfig({
            customDataPath: path,
            migrationStatus: path ? 'pending' : 'none'
        });
    }
    
    /**
     * 标记迁移开始
     */
    async markMigrationStarted(): Promise<void> {
        await this.updateStoragePathConfig({
            migrationStatus: 'in_progress'
        });
    }
    
    /**
     * 标记迁移完成
     */
    async markMigrationCompleted(): Promise<void> {
        await this.updateStoragePathConfig({
            migrationStatus: 'completed',
            lastMigrationAt: Date.now(),
            migrationError: undefined
        });
    }
    
    /**
     * 标记迁移失败
     */
    async markMigrationFailed(error: string): Promise<void> {
        await this.updateStoragePathConfig({
            migrationStatus: 'failed',
            migrationError: error
        });
    }
    
    // ========== 工具方法 ==========
    
    /**
     * 重置为默认设置
     */
    async reset(): Promise<void> {
        const oldSettings = { ...this.settings };
        this.settings = {
            ...DEFAULT_GLOBAL_SETTINGS,
            lastUpdated: Date.now()
        };
        
        await this.storage.save(this.settings);
        
        this.notifyChange({
            type: 'full',
            oldValue: oldSettings,
            newValue: this.settings,
            settings: this.settings
        });
    }
}