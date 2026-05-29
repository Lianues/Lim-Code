/**
 * 提示词上下文项类型
 */
export interface PromptContextItem {
  id: string
  type: 'file' | 'text' | 'snippet' | 'skill' | 'agent' | (string & {})  // 文件、自定义文本、代码片段或扩展上下文芯片
  title: string           // 显示标题
  content: string         // 实际内容
  filePath?: string       // 如果是文件类型，记录路径
  language?: string       // 如果是代码片段，记录语言
  isTextContent?: boolean // false 表示二进制/非文本，仅显示徽章框架
  /** lim-context 的额外属性；用于 skill/agent 等扩展芯片的安全往返 */
  attributes?: Record<string, string>
  enabled: boolean        // 是否启用
  addedAt: number         // 添加时间
}
