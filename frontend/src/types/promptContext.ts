/**
 * 提示词上下文项类型
 */
export interface PromptContextItem {
  id: string
  type: 'file' | 'text' | 'snippet'  // 文件、自定义文本、代码片段
  title: string           // 显示标题
  content: string         // 实际内容
  filePath?: string       // 如果是文件类型，记录路径
  language?: string       // 如果是代码片段，记录语言
  isTextContent?: boolean // false 表示二进制/非文本，仅显示徽章框架
  enabled: boolean        // 是否启用
  addedAt: number         // 添加时间
}
