/**
 * 输入组件类型定义
 */

export interface ChannelOption {
  id: string
  name: string
  model: string
  type: string
}

export interface PromptMode {
  id: string
  name: string
  icon?: string
}

export interface ModelInfo {
  id: string
  name?: string
  description?: string
}
