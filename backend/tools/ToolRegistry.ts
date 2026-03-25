/**
 * LimCode - 工具注册器
 *
 * 负责管理和注册所有工具
 */

import type { Tool, ToolDeclaration, ToolRegistration } from './types';
import { t } from '../i18n';

/**
 * 依赖检查器接口
 */
export interface DependencyChecker {
    /**
     * 检查依赖是否已安装
     * @param name 依赖名称
     * @returns 是否已安装
     */
    isInstalled(name: string): boolean;
}

/**
 * 工具注册器
 */
export class ToolRegistry {
    private tools = new Map<string, Tool>();
    private registrations = new Map<string, ToolRegistration>();
    private dependencyChecker: DependencyChecker | null = null;
    
    /**
     * 设置依赖检查器
     *
     * @param checker 依赖检查器实例
     */
    setDependencyChecker(checker: DependencyChecker): void {
        this.dependencyChecker = checker;
    }

    /**
     * 注册单个工具
     * 
     * @param registration 工具注册函数
     */
    register(registration: ToolRegistration): void {
        const tool = registration();
        const name = tool.declaration.name;
        
        if (this.tools.has(name)) {
            throw new Error(t('tools.common.toolAlreadyExists', { name }));
        }
        
        this.tools.set(name, tool);
        this.registrations.set(name, registration);
    }

    /**
     * 批量注册工具
     * 
     * @param registrations 工具注册函数数组
     */
    registerBatch(registrations: ToolRegistration[]): void {
        for (const registration of registrations) {
            this.register(registration);
        }
    }

    /**
     * 获取工具
     * 
     * @param name 工具名称
     * @returns 工具实例，不存在则返回 undefined
     */
    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /**
     * 获取所有工具
     * 
     * @returns 所有工具的数组
     */
    getAllTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * 检查工具的依赖是否都已安装
     *
     * @param tool 工具实例
     * @returns 依赖是否都已安装
     */
    private areDependenciesInstalled(tool: Tool): boolean {
        const deps = tool.declaration.dependencies;
        if (!deps || deps.length === 0) {
            return true;
        }
        
        if (!this.dependencyChecker) {
            // 没有依赖检查器，默认认为依赖已安装
            return true;
        }
        
        return deps.every(dep => this.dependencyChecker!.isInstalled(dep));
    }

    /**
     * 获取所有工具声明
     *
     * @returns 所有工具声明的数组
     */
    getAllDeclarations(): ToolDeclaration[] {
        return Array.from(this.tools.values()).map(tool => tool.declaration);
    }
    
    /**
     * 获取可用的工具声明（依赖已安装的）
     *
     * @returns 可用的工具声明数组
     */
    getAvailableDeclarations(): ToolDeclaration[] {
        return Array.from(this.tools.values())
            .filter(tool => this.areDependenciesInstalled(tool))
            .map(tool => tool.declaration);
    }
    
    /**
     * 获取过滤后的工具声明
     *
     * @param enabledTools 启用的工具名称数组
     * @returns 过滤后的工具声明数组
     */
    getFilteredDeclarations(enabledTools: string[]): ToolDeclaration[] {
        const enabledSet = new Set(enabledTools);
        return Array.from(this.tools.values())
            .filter(tool => enabledSet.has(tool.declaration.name) && this.areDependenciesInstalled(tool))
            .map(tool => tool.declaration);
    }
    
    /**
     * 根据过滤函数获取工具声明
     *
     * @param filter 过滤函数，返回 true 表示包含该工具
     * @returns 过滤后的工具声明数组
     */
    getDeclarationsBy(filter: (toolName: string) => boolean): ToolDeclaration[] {
        return Array.from(this.tools.values())
            .filter(tool => filter(tool.declaration.name) && this.areDependenciesInstalled(tool))
            .map(tool => tool.declaration);
    }
    
    /**
     * 获取工具缺失的依赖
     *
     * @param name 工具名称
     * @returns 缺失的依赖数组
     */
    getMissingDependencies(name: string): string[] {
        const tool = this.tools.get(name);
        if (!tool) {
            return [];
        }
        
        const deps = tool.declaration.dependencies;
        if (!deps || deps.length === 0) {
            return [];
        }
        
        if (!this.dependencyChecker) {
            return [];
        }
        
        return deps.filter(dep => !this.dependencyChecker!.isInstalled(dep));
    }
    
    /**
     * 检查工具是否可用（依赖已安装）
     *
     * @param name 工具名称
     * @returns 是否可用
     */
    isToolAvailable(name: string): boolean {
        const tool = this.tools.get(name);
        if (!tool) {
            return false;
        }
        return this.areDependenciesInstalled(tool);
    }

    /**
     * 检查工具是否存在
     * 
     * @param name 工具名称
     * @returns 是否存在
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * 获取已注册的工具数量
     * 
     * @returns 工具数量
     */
    count(): number {
        return this.tools.size;
    }

    /**
     * 获取所有工具名称
     * 
     * @returns 工具名称数组
     */
    getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * 注销工具
     * 
     * @param name 工具名称
     * @returns 是否成功注销
     */
    unregister(name: string): boolean {
        this.registrations.delete(name);
        return this.tools.delete(name);
    }

    /**
     * 刷新指定工具的声明
     * 
     * 重新调用工厂函数生成新的 Tool 实例，替换缓存的旧实例。
     * 用于需要动态更新声明的工具（如 read_skill 的描述随 Skill 启用状态变化）。
     * 
     * @param name 工具名称
     * @returns 是否成功刷新
     */
    refreshTool(name: string): boolean {
        const registration = this.registrations.get(name);
        if (!registration) {
            return false;
        }
        
        // 重新调用工厂函数，生成包含最新状态的 Tool 实例
        const tool = registration();
        this.tools.set(name, tool);
        return true;
    }

    /**
     * 清空所有工具
     */
    clear(): void {
        this.tools.clear();
        this.registrations.clear();
    }
}

/**
 * 全局工具注册器实例
 */
export const toolRegistry = new ToolRegistry();