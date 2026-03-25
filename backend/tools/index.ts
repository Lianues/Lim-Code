/**
 * LimCode - 工具系统主导出
 *
 * VSCode 扩展工具管理
 */

import type { Tool } from './types';
import { DependencyManager } from '../modules/dependencies';
import { getReadSkillToolRegistration } from './skills';

// 导出设置上下文（从 core 模块重新导出）
export { setGlobalSettingsManager, getGlobalSettingsManager } from '../core/settingsContext';

// 导出类型
export type {
    Tool,
    ToolDeclaration,
    ToolArgs,
    ToolResult,
    ToolHandler,
    ToolRegistration,
    MultimodalData
} from './types';

// 导出注册器
export { ToolRegistry, toolRegistry, type DependencyChecker } from './ToolRegistry';

// 导出工具模块
export * from './file';
export * from './search';
export * from './terminal';
export * from './media';
export * from './lsp';
export * from './subagents';
export * from './todo';
export * from './design';
export * from './plan';
export * from './review';
export * from './history';

// 导出工具辅助函数
export * from './utils';

// 导出格式化器
export * from './xmlFormatter';
export * from './jsonFormatter';

// 导出任务管理器
export {
    TaskManager,
    type TaskType,
    type TaskStatus,
    type TaskInfo,
    type TaskEventType,
    type TaskEvent,
    type CancelResult
} from './taskManager';

/**
 * 获取所有 VSCode 工具
 *
 * @returns 所有工具的数组
 */
export function getAllTools(): Tool[] {
    const { getFileToolRegistrations } = require('./file');
    const { getSearchToolRegistrations } = require('./search');
    const { getTerminalToolRegistrations } = require('./terminal');
    const { getMediaToolRegistrations } = require('./media');
    const { getLspToolRegistrations } = require('./lsp');
    const { getSubAgentsToolRegistrations } = require('./subagents');
    const { getTodoToolRegistrations } = require('./todo');
    const { getDesignToolRegistrations } = require('./design');
    const { getPlanToolRegistrations } = require('./plan');
    const { getReviewToolRegistrations } = require('./review');
    const { getHistoryToolRegistrations } = require('./history');
    
    const registrations = [
        ...getFileToolRegistrations(),
        ...getSearchToolRegistrations(),
        ...getTerminalToolRegistrations(),
        ...getMediaToolRegistrations(),
        ...getLspToolRegistrations(),
        ...getTodoToolRegistrations(),
        ...getDesignToolRegistrations(),
        ...getPlanToolRegistrations(),
        ...getReviewToolRegistrations(),
        ...getHistoryToolRegistrations()
    ];
    
    const tools = registrations.map(reg => reg());
    
    // 始终添加 read_skill 工具（工具描述中会动态反映当前启用的 Skill 列表）
    tools.push(getReadSkillToolRegistration()());

    // 始终添加 subagents 工具（工具内部会动态判断是否有可用的子代理）
    const subAgentRegistrations = getSubAgentsToolRegistrations();
    tools.push(...subAgentRegistrations.map((reg: () => Tool) => reg()));
    
    return tools;
}

/**
 * 注册所有工具到注册器
 *
 * @param registry 工具注册器实例
 */
export function registerAllTools(
    registry: typeof import('./ToolRegistry').toolRegistry
): void {
    const tools = getAllTools();
    
    // 注册所有工具（read_skill 除外，它需要特殊处理）
    for (const tool of tools) {
        // read_skill 已在下面通过工厂函数单独注册，跳过
        if (tool.declaration.name === 'read_skill') {
            continue;
        }
        registry.register(() => tool);
    }

    // 用真正的工厂函数注册 read_skill，使 refreshTool('read_skill') 能重新生成声明
    registry.register(getReadSkillToolRegistration());
}

/**
 * 初始化工具系统
 *
 * 这个函数需要在工具系统启动时调用，它会：
 * 1. 将 DependencyManager 连接到 ToolRegistry 作为依赖检查器
 * 2. 注册所有工具
 *
 * @param registry 工具注册器实例
 */
export function initializeToolSystem(
    registry: typeof import('./ToolRegistry').toolRegistry
): void {
    try {
        // 获取 DependencyManager 实例并设置为依赖检查器
        const depManager = DependencyManager.getInstance();
        registry.setDependencyChecker({
            isInstalled: (name: string) => depManager.isInstalledSync(name)
        });
    } catch (e) {
        // DependencyManager 可能未初始化，忽略错误
        console.log('DependencyManager not initialized yet, skipping dependency checker setup');
    }
    
    // 注册所有工具
    registerAllTools(registry);
}

/**
 * 刷新工具依赖状态
 *
 * 当依赖安装状态变化后调用此函数刷新
 */
export async function refreshToolDependencies(): Promise<void> {
    try {
        const depManager = DependencyManager.getInstance();
        await depManager.refreshInstalledCache();
    } catch {
        // 忽略错误
    }
}