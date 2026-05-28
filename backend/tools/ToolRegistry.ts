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
     * Alias → 主名称索引。
     *
     * 修改原因：旧 getTool() 的 alias 查找是 O(n) 线性扫描，每次 alias 命中都要遍历全部 tools。
     * 修改方式：新增 aliasToName Map，在 register/unregister/clear/refreshTool 时同步维护。
     * 修改目的：将 getTool() alias 查找降为 O(1)，消除 WP11 的 alias O(n) 线性扫描问题。
     *
     * 冲突策略：同一个 alias 被重复注册时抛错（与主名称冲突行为一致），防止歧义查找。
     */
    private aliasToName = new Map<string, string>();
    
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
        
        // === WP11 修复 2：补齐双向冲突策略 — 主名称不能是已有别名 ===
        // 为什么改：旧 register() 只检测"新 alias 是否与已有主名称/别名冲突"，
        //   但没检测"新主名称是否已被其他工具注册为别名"。如果先注册 tool_a (alias:['b'])，
        //   再注册主名称为 'b' 的 tool_b，aliasToName 中 'b' 指向 tool_a，
        //   但 tools Map 中 tool_b 直接按 'b' 注册，导致 getTool('b') 按主名称命中 tool_b，
        //   不再是 alias 指向 tool_a——形成事实歧义。
        // 怎么改：在 register() 开头（tools.has(name) 之后）增加反向检查：
        //   如果 name 已被其他工具作为 alias 注册，抛错。
        // 目的：彻底消除 alias ↔ 主名称的双向歧义，任何时候 getTool(x) 都不会有两条可能的解析路径。
        const conflictingOwner = this.aliasToName.get(name);
        if (conflictingOwner !== undefined) {
            throw new Error(
                `Tool name "${name}" is already registered as an alias of "${conflictingOwner}". ` +
                `Registering it as a main name would cause ambiguity.`
            );
        }
        
        // 修改原因：注册时必须同步维护 aliasToName 索引，确保 getTool() 的 alias 查找是 O(1)。
        // 修改方式：先检测 alias 冲突（别名被另一工具占用或已是某工具的主名称），再逐条写入索引。
        // 修改目的：防止别名歧义，与主名称冲突行为保持一致。
        const aliases = tool.declaration.aliases;
        if (aliases && aliases.length > 0) {
            for (const alias of aliases) {
                // 别名不能与已有主名称冲突
                if (this.tools.has(alias)) {
                    throw new Error(
                        `Tool alias "${alias}" conflicts with an existing tool name`
                    );
                }
                // 别名不能被另一个工具注册为别名
                const existingOwner = this.aliasToName.get(alias);
                if (existingOwner !== undefined && existingOwner !== name) {
                    throw new Error(
                        `Tool alias "${alias}" is already registered by "${existingOwner}"`
                    );
                }
                this.aliasToName.set(alias, name);
            }
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
        // 1. 按主名称查找（O(1)）
        const tool = this.tools.get(name);
        if (tool) {
            return tool;
        }

        // 2. 按别名查找（O(1)，通过 aliasToName 索引定位主名称再查 tools）
        // 修改原因：旧代码遍历 this.tools.values() 检查每个 tool 的 aliases 数组，O(n)。
        // 修改方式：用 aliasToName Map 将 alias → 主名称，一步定位，O(1)。
        // 修改目的：消除 WP11 的 alias O(n) 线性扫描，兼容工具重命名后的旧对话历史。
        const mainName = this.aliasToName.get(name);
        if (mainName !== undefined) {
            return this.tools.get(mainName);
        }

        return undefined;
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
        // 修改原因：注销工具时必须同步清理 aliasToName 索引，防止残留 alias 指向已被删除的工具。
        // 修改方式：在删除 tools 之前先读取该工具的 aliases，逐条从索引中移除。
        // 修改目的：保持 aliasToName 与 tools 始终一致。
        const tool = this.tools.get(name);
        if (tool) {
            const aliases = tool.declaration.aliases;
            if (aliases && aliases.length > 0) {
                for (const alias of aliases) {
                    // 只删除确实指向本工具的 alias 条目（防御性编程）
                    if (this.aliasToName.get(alias) === name) {
                        this.aliasToName.delete(alias);
                    }
                }
            }
        }
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
        
        // 修改原因：refreshTool 重新调用工厂函数后 aliases 可能变化（如 read_skill 的描述随 Skill 启用状态变化）。
        // 修改方式：先移除旧 aliases，再注册新 aliases，最后更新 tools Map。
        // 修改目的：确保 aliasToName 索引与刷新后的 Tool 实例同步。
        const oldTool = this.tools.get(name);
        if (oldTool) {
            const oldAliases = oldTool.declaration.aliases;
            if (oldAliases && oldAliases.length > 0) {
                for (const alias of oldAliases) {
                    if (this.aliasToName.get(alias) === name) {
                        this.aliasToName.delete(alias);
                    }
                }
            }
        }
        
        // 重新调用工厂函数，生成包含最新状态的 Tool 实例
        const tool = registration();
        
        // === WP11 修复 1：refreshTool 必须复用与 register() 相同的冲突检测 ===
        // 为什么改：旧 refreshTool 直接将新 aliases set 进 Map，不检测别名冲突。
        //   如果工厂函数刷新后返回的 aliases 与另一工具的主名称或别名冲突，
        //   会导致 getTool() 在运行时产生歧义查找（与 register() 的设计原则矛盾）。
        // 怎么改：逐个检测新 alias 是否与已有主名称冲突，是否被另一工具注册为别名。
        // 目的：确保 refreshTool 与 register 共享同一冲突策略——任何时刻 aliasToName 都不含歧义。
        const newAliases = tool.declaration.aliases;
        if (newAliases && newAliases.length > 0) {
            for (const alias of newAliases) {
                // 别名不能与已有主名称冲突（排除当前刷新工具自身）
                if (this.tools.has(alias) && alias !== name) {
                    throw new Error(
                        `Tool alias "${alias}" conflicts with an existing tool name`
                    );
                }
                // 别名不能被另一个工具注册为别名（排除当前刷新工具自身）
                const existingOwner = this.aliasToName.get(alias);
                if (existingOwner !== undefined && existingOwner !== name) {
                    throw new Error(
                        `Tool alias "${alias}" is already registered by "${existingOwner}"`
                    );
                }
                this.aliasToName.set(alias, name);
            }
        }
        
        this.tools.set(name, tool);
        return true;
    }

    /**
     * 清空所有工具
     */
    clear(): void {
        // 修改原因：清空所有工具时必须同步清空 aliasToName 索引。
        // 修改方式：增加 aliasToName.clear()。
        // 修改目的：保持三个 Map 的一致性。
        this.tools.clear();
        this.registrations.clear();
        this.aliasToName.clear();
    }
}

/**
 * 全局工具注册器实例
 */
export const toolRegistry = new ToolRegistry();