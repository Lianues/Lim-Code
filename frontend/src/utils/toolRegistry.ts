/**
 * 工具注册表
 * 管理所有工具的显示配置
 */

import type { Component } from 'vue'
import type { ToolUsage } from '../types'

export interface ToolActionContext {
  /** 当前主聊天对话 ID，历史 SubAgent 卡片打开 Monitor 时需要用它恢复 metadata 快照 */
  conversationId?: string | null
}

export interface ToolActionConfig {
  /** 操作 ID，用于按钮 key 和日志定位 */
  id: string
  /** 操作文案 */
  label: string | ((tool: ToolUsage, context: ToolActionContext) => string)
  /** 悬停提示 */
  title?: string | ((tool: ToolUsage, context: ToolActionContext) => string)
  /** codicon 图标 */
  icon?: string
  /** 是否显示该操作 */
  visible?: (tool: ToolUsage, context: ToolActionContext) => boolean
  /** 操作执行函数 */
  run: (tool: ToolUsage, context: ToolActionContext) => Promise<void> | void
  /** 视觉样式 */
  variant?: 'default' | 'primary' | 'danger'
}

/**
 * 工具配置
 */
export interface ToolConfig {
  /** 工具名称 */
  name: string
  
  /** 工具显示标签（可选，默认使用name） */
  label?: string
  
  /** 动态标签生成器 - 根据参数生成标签文本（优先级高于 label） */
  labelFormatter?: (args: Record<string, unknown>) => string
  
  /** 图标 (codicon) */
  icon?: string
  
  /** 描述生成器 - 根据参数生成描述文本 */
  descriptionFormatter: (args: Record<string, unknown>) => string
  
  /** 内容面板组件 - 用于展开后显示详细信息 */
  contentComponent?: Component
  
  /** 默认内容渲染器 - 如果没有自定义组件，使用此函数渲染 */
  contentFormatter?: (args: Record<string, unknown>, result?: Record<string, unknown>) => string
  
  /** 是否可展开（默认为 true，如果设置为 false 则不显示展开按钮和详细内容） */
  expandable?: boolean
  
  /**
   * 工具头部显眼操作按钮。
   *
   * 修改原因：subagents 需要像 write_file/apply_diff 一样把“打开详情”放在工具卡片显眼位置，但不能在 ToolMessage.vue 写工具名特例。
   * 修改方式：把按钮声明抽象到 ToolConfig，由 ToolMessage 统一渲染并传入 ToolUsage 与当前对话上下文。
   * 修改目的：未来其它工具也可以复用“打开产物/查看详情”等显眼动作，避免 UI 逻辑继续分叉。
   */
  actions?: ToolActionConfig[]
  
  /** 是否隐藏此工具（不在消息列表中显示） */
  hidden?: boolean
}

/**
 * 工具注册表
 */
class ToolRegistry {
  private tools = new Map<string, ToolConfig>()

  /**
   * 注册工具
   */
  register(name: string, config: ToolConfig): void {
    this.tools.set(name, config)
  }

  /**
   * 获取工具配置
   */
  get(name: string): ToolConfig | undefined {
    return this.tools.get(name)
  }

  /**
   * 获取所有工具
   */
  getAll(): Map<string, ToolConfig> {
    return this.tools
  }

  /**
   * 检查工具是否已注册
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }
}

// 导出单例
export const toolRegistry = new ToolRegistry()

/**
 * 注册工具的便捷方法
 */
export function registerTool(name: string, config: ToolConfig): void {
  toolRegistry.register(name, config)
}

/**
 * 获取工具配置
 */
export function getToolConfig(name: string): ToolConfig | undefined {
  return toolRegistry.get(name)
}