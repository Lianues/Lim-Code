/**
 * SubAgents 注册器
 *
 * 管理所有可用的子代理
 */

import type {
    SubAgentType,
    SubAgentConfig,
    SubAgentRegistryEntry,
    SubAgentExecutor,
    SubAgentExecutorContext
} from './types';
import { createDefaultExecutor, getSubAgentExecutorContext } from './executor';

/**
 * 子代理注册器
 */
export class SubAgentRegistry {
    private agents = new Map<SubAgentType, SubAgentRegistryEntry>();
    
    /**
     * 注册子代理
     * 
     * @param config 代理配置
     * @param executor 代理执行器（可选，不提供则使用默认执行器）
     */
    register(config: SubAgentConfig, executor?: SubAgentExecutor): void {
        if (this.agents.has(config.type)) {
            console.warn(`SubAgent "${config.type}" already registered, overwriting...`);
        }
        
        this.agents.set(config.type, { config, executor });
    }
    
    /**
     * 从配置注册子代理
     * 
     * 简化版本，只需提供配置，自动使用默认执行器
     * 
     * @param config 代理配置
     */
    registerFromConfig(config: SubAgentConfig): void {
        this.register(config);
    }
    
    /**
     * 批量注册子代理
     * 
     * @param configs 代理配置数组
     */
    registerBatch(configs: SubAgentConfig[]): void {
        for (const config of configs) {
            this.registerFromConfig(config);
        }
    }
    
    /**
     * 获取子代理
     * 
     * @param type 代理类型
     * @returns 代理注册项，不存在则返回 undefined
     */
    get(type: SubAgentType): SubAgentRegistryEntry | undefined {
        const entry = this.agents.get(type);
        if (!entry) {
            return undefined;
        }
        
        // 如果没有提供执行器，创建默认执行器
        if (!entry.executor) {
            const context = getSubAgentExecutorContext();
            if (context) {
                entry.executor = createDefaultExecutor(entry.config, context);
            }
        }
        
        return entry;
    }
    
    /**
     * 获取子代理执行器
     * 
     * @param type 代理类型
     * @returns 执行器，不存在则返回 undefined
     */
    getExecutor(type: SubAgentType): SubAgentExecutor | undefined {
        const entry = this.get(type);
        return entry?.executor;
    }
    
    /**
     * 获取所有已注册的子代理类型
     * 
     * @returns 代理类型数组
     */
    getTypes(): SubAgentType[] {
        return Array.from(this.agents.keys()).filter(type => {
            const entry = this.agents.get(type);
            return entry?.config.enabled !== false;
        });
    }
    
    /**
     * 获取所有子代理配置
     * 
     * @returns 代理配置数组（仅启用的）
     */
    getAllConfigs(): SubAgentConfig[] {
        return Array.from(this.agents.values())
            .filter(entry => entry.config.enabled !== false)
            .map(entry => entry.config);
    }
    
    /**
     * 获取所有子代理配置（包括禁用的）
     * 
     * @returns 所有代理配置数组
     */
    getAllConfigsIncludingDisabled(): SubAgentConfig[] {
        return Array.from(this.agents.values()).map(entry => entry.config);
    }
    
    /**
     * 获取所有启用的子代理名称
     * 
     * @returns 代理名称数组
     */
    getNames(): string[] {
        return Array.from(this.agents.values())
            .filter(entry => entry.config.enabled !== false)
            .map(entry => entry.config.name);
    }
    
    /**
     * 根据名称获取子代理
     * 
     * @param name 代理名称
     * @returns 代理注册项，不存在则返回 undefined
     */
    getByName(name: string): SubAgentRegistryEntry | undefined {
        for (const entry of this.agents.values()) {
            if (entry.config.name === name && entry.config.enabled !== false) {
                // 如果没有提供执行器，创建默认执行器
                if (!entry.executor) {
                    const context = getSubAgentExecutorContext();
                    if (context) {
                        entry.executor = createDefaultExecutor(entry.config, context);
                    }
                }
                return entry;
            }
        }
        return undefined;
    }
    
    /**
     * 检查子代理是否已注册
     * 
     * @param type 代理类型
     * @returns 是否已注册
     */
    has(type: SubAgentType): boolean {
        return this.agents.has(type);
    }
    
    /**
     * 检查子代理是否启用
     * 
     * @param type 代理类型
     * @returns 是否启用
     */
    isEnabled(type: SubAgentType): boolean {
        const entry = this.agents.get(type);
        return entry?.config.enabled !== false;
    }
    
    /**
     * 启用/禁用子代理
     * 
     * @param type 代理类型
     * @param enabled 是否启用
     * @returns 是否成功
     */
    setEnabled(type: SubAgentType, enabled: boolean): boolean {
        const entry = this.agents.get(type);
        if (!entry) {
            return false;
        }
        entry.config.enabled = enabled;
        return true;
    }
    
    /**
     * 更新子代理配置
     * 
     * @param type 代理类型
     * @param updates 要更新的配置字段
     * @returns 是否成功
     */
    updateConfig(type: SubAgentType, updates: Partial<SubAgentConfig>): boolean {
        const entry = this.agents.get(type);
        if (!entry) {
            return false;
        }
        
        // 不允许更改 type
        const { type: _, ...safeUpdates } = updates;
        Object.assign(entry.config, safeUpdates);
        
        // 清除缓存的执行器（以便下次使用时重新创建）
        entry.executor = undefined;
        
        return true;
    }
    
    /**
     * 注销子代理
     * 
     * @param type 代理类型
     * @returns 是否成功注销
     */
    unregister(type: SubAgentType): boolean {
        return this.agents.delete(type);
    }
    
    /**
     * 清空所有子代理
     */
    clear(): void {
        this.agents.clear();
    }
    
    /**
     * 获取已注册的子代理数量
     */
    count(): number {
        return this.agents.size;
    }
    
    /**
     * 获取启用的子代理数量
     */
    countEnabled(): number {
        return this.getTypes().length;
    }
}

/**
 * 全局子代理注册器实例
 */
export const subAgentRegistry = new SubAgentRegistry();
