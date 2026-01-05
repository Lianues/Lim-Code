/**
 * LimCode - 配置管理器
 *
 * 核心配置管理类，提供完整的 CRUD 和管理功能
 */

import { t } from '../../i18n';
import type {
    ChannelConfig,
    ChannelType,
    CreateConfigInput,
    UpdateConfigInput,
    ConfigStats,
    ValidationResult,
    ExportOptions,
    ImportOptions,
    ConfigFilter,
    ConfigSortOptions,
    GeminiConfig,
    OpenAIConfig
} from './types';
import type { ConfigStorageAdapter } from './storage';
import { nanoid } from 'nanoid';

/**
 * 配置管理器
 * 
 * 提供统一的配置管理接口，支持多种 LLM API 格式
 */
export class ConfigManager {
    /** 配置缓存（用于快速访问） */
    private configCache: Map<string, ChannelConfig> = new Map();
    
    /** 是否已加载 */
    private loaded: boolean = false;
    
    constructor(
        private storageAdapter: ConfigStorageAdapter
    ) {}
    
    /**
     * 初始化管理器（加载所有配置到缓存）
     */
    private async ensureLoaded(): Promise<void> {
        if (this.loaded) {
            return;
        }
        
        const configIds = await this.storageAdapter.list();
        
        for (const id of configIds) {
            const config = await this.storageAdapter.load(id);
            if (config) {
                this.configCache.set(id, config);
            }
        }
        
        this.loaded = true;
    }
    
    // ========== CRUD 操作 ==========
    
    /**
     * 获取指定类型的默认配置
     *
     * @param type 渠道类型
     * @returns 默认配置（不含 id、createdAt、updatedAt）
     */
    getDefaultConfig(type: ChannelType): Record<string, any> {
        const baseDefaults = {
            enabled: true,
            timeout: 120000,
            model: '',
            models: [],
            apiKey: '',
            toolMode: 'function_call' as const,
            retryEnabled: true,
            retryCount: 3,
            retryInterval: 3000,
            contextThresholdEnabled: false,
            contextThreshold: '80%',
            autoSummarizeEnabled: false,
            multimodalToolsEnabled: false,
            customHeadersEnabled: false,
            customHeaders: [],
            customBodyEnabled: false,
            customBody: { mode: 'simple' as const, items: [] },
            sendHistoryThoughts: false,
            sendHistoryThoughtSignatures: false,
            options: {
                stream: false
            }
        };
        
        switch (type) {
            case 'gemini':
                return {
                    ...baseDefaults,
                    url: 'https://generativelanguage.googleapis.com/v1beta',
                    options: {
                        ...baseDefaults.options,
                        temperature: 1.0,
                        maxOutputTokens: 65536,
                        // Gemini 思考配置默认值
                        thinkingConfig: {
                            includeThoughts: true,
                            mode: 'default',
                            thinkingLevel: 'low',
                            thinkingBudget: 1024
                        }
                    },
                    optionsEnabled: {
                        temperature: false,
                        maxOutputTokens: false,
                        thinkingConfig: true
                    }
                };
            
            case 'openai':
                return {
                    ...baseDefaults,
                    url: 'https://api.openai.com/v1',
                    options: {
                        ...baseDefaults.options,
                        temperature: 1.0,
                        max_tokens: 16384,
                        // OpenAI 思考配置默认值
                        reasoning: {
                            effort: 'high',
                            summaryEnabled: false,
                            summary: 'auto'
                        }
                    },
                    optionsEnabled: {
                        temperature: false,
                        max_tokens: false,
                        top_p: false,
                        frequency_penalty: false,
                        presence_penalty: false,
                        reasoning: false
                    }
                };
            
            case 'anthropic':
                return {
                    ...baseDefaults,
                    url: 'https://api.anthropic.com/v1',
                    options: {
                        ...baseDefaults.options,
                        temperature: 1.0,
                        max_tokens: 8192,
                        // Anthropic 思考配置默认值
                        thinking: {
                            type: 'enabled',
                            budget_tokens: 10000
                        }
                    },
                    optionsEnabled: {
                        temperature: false,
                        max_tokens: false,
                        top_p: false,
                        top_k: false,
                        thinking: false
                    }
                };
            
            case 'openai-responses':
                return {
                    ...baseDefaults,
                    url: 'https://api.openai.com/v1',
                    options: {
                        ...baseDefaults.options,
                        temperature: 1.0,
                        max_output_tokens: 16384,
                        truncation: 'auto',
                        reasoning: {
                            effort: 'medium',
                            summaryEnabled: false,
                            summary: 'auto'
                        }
                    },
                    optionsEnabled: {
                        temperature: false,
                        max_output_tokens: false,
                        top_p: false,
                        reasoning: false
                    }
                };
            
            default:
                return baseDefaults;
        }
    }
    
    /**
     * 创建配置
     *
     * @param input 配置输入（不含 id、createdAt、updatedAt）
     * @returns 创建的配置 ID
     *
     * @example
     * ```typescript
     * const configId = await manager.createConfig({
     *     name: 'Gemini 2.5 Flash',
     *     type: 'gemini',
     *     enabled: true
     * });
     * ```
     */
    async createConfig(input: CreateConfigInput): Promise<string> {
        await this.ensureLoaded();
        
        // 生成唯一 ID
        const id = nanoid();
        const now = Date.now();
        
        // 获取默认配置并与输入合并
        const defaults = this.getDefaultConfig(input.type);
        
        // 构建完整配置（输入值覆盖默认值）
        const config: ChannelConfig = {
            ...defaults,
            ...input,
            id,
            createdAt: now,
            updatedAt: now
        } as ChannelConfig;
        
        // 保存（不验证配置）
        await this.storageAdapter.save(config);
        this.configCache.set(id, config);
        
        return id;
    }
    
    /**
     * 获取配置
     * 
     * @param configId 配置 ID
     * @returns 配置对象，如果不存在返回 null
     */
    async getConfig(configId: string): Promise<ChannelConfig | null> {
        await this.ensureLoaded();
        
        const config = this.configCache.get(configId);
        return config ? JSON.parse(JSON.stringify(config)) : null;
    }
    
    /**
     * 更新配置
     * 
     * @param configId 配置 ID
     * @param updates 要更新的字段
     * 
     * @example
     * ```typescript
     * await manager.updateConfig('config-123', {
     *     name: '新名称',
     *     options: {
     *         temperature: 0.9
     *     }
     * });
     * ```
     */
    async updateConfig(configId: string, updates: UpdateConfigInput): Promise<void> {
        await this.ensureLoaded();
        
        const existing = this.configCache.get(configId);
        if (!existing) {
            throw new Error(t('modules.config.errors.configNotFound', { configId }));
        }
        
        // 合并更新
        const updated: ChannelConfig = {
            ...existing,
            ...updates,
            id: configId,  // 保持 ID 不变
            type: existing.type,  // 保持类型不变
            createdAt: existing.createdAt,  // 保持创建时间
            updatedAt: Date.now()  // 更新时间
        } as ChannelConfig;
        
        // 保存（不验证配置）
        await this.storageAdapter.save(updated);
        this.configCache.set(configId, updated);
    }
    
    /**
     * 删除配置
     * 
     * @param configId 配置 ID
     */
    async deleteConfig(configId: string): Promise<void> {
        await this.ensureLoaded();
        
        if (!this.configCache.has(configId)) {
            throw new Error(t('modules.config.errors.configNotFound', { configId }));
        }
        
        await this.storageAdapter.delete(configId);
        this.configCache.delete(configId);
    }
    
    /**
     * 列出所有配置
     * 
     * @param filter 过滤条件（可选）
     * @param sort 排序选项（可选）
     * @returns 配置列表
     */
    async listConfigs(
        filter?: ConfigFilter,
        sort?: ConfigSortOptions
    ): Promise<ChannelConfig[]> {
        await this.ensureLoaded();
        
        let configs = Array.from(this.configCache.values());
        
        // 应用过滤
        if (filter) {
            configs = this.applyFilter(configs, filter);
        }
        
        // 应用排序
        if (sort) {
            configs = this.applySort(configs, sort);
        }
        
        // 返回深拷贝
        return JSON.parse(JSON.stringify(configs));
    }
    
    /**
     * 按类型列出配置
     * 
     * @param type 渠道类型
     * @returns 配置列表
     */
    async listConfigsByType(type: ChannelType): Promise<ChannelConfig[]> {
        return this.listConfigs({ type });
    }
    
    /**
     * 列出启用的配置
     * 
     * @returns 配置列表
     */
    async listEnabledConfigs(): Promise<ChannelConfig[]> {
        return this.listConfigs({ enabled: true });
    }
    
    // ========== 配置管理 ==========
    
    /**
     * 启用/禁用配置
     * 
     * @param configId 配置 ID
     * @param enabled 是否启用
     */
    async setConfigEnabled(configId: string, enabled: boolean): Promise<void> {
        await this.updateConfig(configId, { enabled });
    }
    
    /**
     * 验证配置
     * 
     * @param config 要验证的配置
     * @returns 验证结果
     */
    async validateConfig(config: ChannelConfig): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        
        // 基础字段验证
        if (!config.name || config.name.trim().length === 0) {
            errors.push(t('modules.config.validation.nameRequired'));
        }
        
        if (!config.type) {
            errors.push(t('modules.config.validation.typeRequired'));
        }
        
        // 根据类型进行特定验证
        switch (config.type) {
            case 'gemini':
                this.validateGeminiConfig(config as GeminiConfig, errors, warnings);
                break;
            
            case 'openai':
                this.validateOpenAIConfig(config as any, errors, warnings);
                break;
            
            case 'openai-responses':
                this.validateOpenAIConfig(config as any, errors, warnings);
                break;
            
            case 'anthropic':
                // TODO: 实现 Anthropic 验证
                warnings.push(t('modules.config.validation.anthropicNotImplemented'));
                break;
        }
        
        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }
    
    /**
     * 验证 Gemini 配置
     */
    private validateGeminiConfig(
        config: GeminiConfig,
        errors: string[],
        warnings: string[]
    ): void {
        // URL 验证
        if (!config.url || !this.isValidUrl(config.url)) {
            errors.push(t('modules.config.validation.invalidUrl'));
        }
        
        // API Key 验证 - 仅警告，不阻止创建
        if (!config.apiKey || config.apiKey.trim().length === 0) {
            warnings.push(t('modules.config.validation.apiKeyEmpty'));
        }
        
        // 模型名称验证（允许为空，表示未选择模型）
        // 仅当有模型列表时，才检查是否选择了模型
        const models = (config as any).models || [];
        if (models.length > 0 && (!config.model || config.model.trim().length === 0)) {
            warnings.push(t('modules.config.validation.modelNotSelected'));
        }
        
        // 选项验证
        if (config.options) {
            const opts = config.options;
            
            // 温度参数
            if (opts.temperature !== undefined) {
                if (opts.temperature < 0 || opts.temperature > 2) {
                    errors.push(t('modules.config.validation.temperatureRange'));
                }
            }
            
            // 最大输出 token
            if (opts.maxOutputTokens !== undefined) {
                if (opts.maxOutputTokens < 1) {
                    errors.push(t('modules.config.validation.maxOutputTokensMin'));
                }
                
                // 警告：过大的 token 数
                if (opts.maxOutputTokens > 8192) {
                    warnings.push(t('modules.config.validation.maxOutputTokensHigh'));
                }
            }
        }
    }
    
    /**
     * 验证 OpenAI 配置
     */
    private validateOpenAIConfig(
        config: any,
        errors: string[],
        warnings: string[]
    ): void {
        // URL 验证
        if (!config.url || !this.isValidUrl(config.url)) {
            errors.push(t('modules.config.validation.invalidUrl'));
        }
        
        // API Key 验证
        if (!config.apiKey || config.apiKey.trim().length === 0) {
            warnings.push(t('modules.config.validation.apiKeyEmpty'));
        }
        
        // 模型名称验证
        const models = config.models || [];
        if (models.length > 0 && (!config.model || config.model.trim().length === 0)) {
            warnings.push(t('modules.config.validation.modelNotSelected'));
        }
    }

    /**
     * 获取统计信息
     * 
     * @returns 统计信息
     */
    async getStats(): Promise<ConfigStats> {
        await this.ensureLoaded();
        
        const configs = Array.from(this.configCache.values());
        
        // 计数
        const totalConfigs = configs.length;
        const enabledConfigs = configs.filter(c => c.enabled).length;
        const disabledConfigs = totalConfigs - enabledConfigs;
        
        // 按类型统计
        const byType: Record<ChannelType, number> = {
            gemini: 0,
            openai: 0,
            anthropic: 0,
            'openai-responses': 0
        };
        
        for (const config of configs) {
            byType[config.type]++;
        }
        
        // 最近创建的配置
        const sorted = [...configs].sort((a, b) => b.createdAt - a.createdAt);
        const recentConfigs = sorted.slice(0, 5).map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            createdAt: c.createdAt
        }));
        
        return {
            totalConfigs,
            enabledConfigs,
            disabledConfigs,
            byType,
            recentConfigs
        };
    }
    
    /**
     * 导出配置
     * 
     * @param configId 配置 ID
     * @param options 导出选项
     * @returns 导出的 JSON 对象
     */
    async exportConfig(
        configId: string,
        options: ExportOptions = {}
    ): Promise<any> {
        const config = await this.getConfig(configId);
        if (!config) {
            throw new Error(t('modules.config.errors.configNotFound', { configId }));
        }
        
        const exported = { ...config };
        
        // 移除敏感信息
        if (!options.includeSensitive) {
            if ('apiKey' in exported) {
                (exported as any).apiKey = '***REDACTED***';
            }
        }
        
        return exported;
    }
    
    /**
     * 导入配置
     * 
     * @param configData 配置数据
     * @param options 导入选项
     * @returns 导入的配置 ID
     */
    async importConfig(
        configData: any,
        options: ImportOptions = {}
    ): Promise<string> {
        await this.ensureLoaded();
        
        // 检查是否已存在
        if (configData.id && this.configCache.has(configData.id)) {
            if (!options.overwrite) {
                throw new Error(t('modules.config.errors.configExists', { configId: configData.id }));
            }
            
            // 覆盖现有配置
            const { id, createdAt, ...updates } = configData;
            await this.updateConfig(id, updates);
            return id;
        }
        
        // 创建新配置
        const { id, createdAt, updatedAt, ...input } = configData;
        return this.createConfig(input);
    }
    
    /**
     * 检查配置是否存在
     * 
     * @param configId 配置 ID
     * @returns 是否存在
     */
    async exists(configId: string): Promise<boolean> {
        await this.ensureLoaded();
        return this.configCache.has(configId);
    }
    
    // ========== 辅助方法 ==========
    
    /**
     * 应用过滤条件
     */
    private applyFilter(
        configs: ChannelConfig[],
        filter: ConfigFilter
    ): ChannelConfig[] {
        let result = configs;
        
        // 按类型过滤
        if (filter.type) {
            result = result.filter(c => c.type === filter.type);
        }
        
        // 按启用状态过滤
        if (filter.enabled !== undefined) {
            result = result.filter(c => c.enabled === filter.enabled);
        }
        
        // 按标签过滤
        if (filter.tags && filter.tags.length > 0) {
            result = result.filter(c =>
                c.tags && filter.tags!.some(tag => c.tags!.includes(tag))
            );
        }
        
        // 按名称搜索
        if (filter.nameSearch) {
            const search = filter.nameSearch.toLowerCase();
            result = result.filter(c =>
                c.name.toLowerCase().includes(search)
            );
        }
        
        return result;
    }
    
    /**
     * 应用排序
     */
    private applySort(
        configs: ChannelConfig[],
        sort: ConfigSortOptions
    ): ChannelConfig[] {
        const sorted = [...configs];
        
        sorted.sort((a, b) => {
            let aVal: any;
            let bVal: any;
            
            switch (sort.field) {
                case 'name':
                    aVal = a.name.toLowerCase();
                    bVal = b.name.toLowerCase();
                    break;
                case 'createdAt':
                    aVal = a.createdAt;
                    bVal = b.createdAt;
                    break;
                case 'updatedAt':
                    aVal = a.updatedAt;
                    bVal = b.updatedAt;
                    break;
                case 'type':
                    aVal = a.type;
                    bVal = b.type;
                    break;
            }
            
            if (sort.order === 'asc') {
                return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            } else {
                return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
            }
        });
        
        return sorted;
    }
    
    /**
     * 验证 URL
     */
    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}