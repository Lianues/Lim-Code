/**
 * LimCode 前端类型定义
 */

// ============ 消息相关类型 ============

/**
 * ContentPart - Gemini API 内容片段
 */
export interface ContentPart {
  text?: string
  inlineData?: {
    mimeType: string
    data: string  // Base64
  }
  fileData?: {
    mimeType: string
    fileUri: string
    displayName?: string
  }
  functionCall?: {
    name: string
    args: Record<string, unknown>
    id?: string
    /**
     * 是否已被用户拒绝执行
     *
     * 当用户在工具等待确认时点击终止按钮，此字段会被设置为 true
     * 用于在重新加载对话时正确显示工具状态
     */
    rejected?: boolean
    /**
     * 流式响应中的索引 (OpenAI 格式)
     */
    index?: number
    /**
     * 流式响应中的原始参数片段
     */
    partialArgs?: string
  }
  functionResponse?: {
    name: string
    response: Record<string, unknown>
    id?: string  // 用于匹配工具调用请求
    parts?: ContentPart[]
  }
  thoughtSignature?: string
  thought?: boolean
}

/**
 * Token 详情条目
 */
export interface TokenDetailsEntry {
  /** 模态类型: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" */
  modality: string
  /** Token 数量 */
  tokenCount: number
}

/**
 * Token 使用统计（Gemini usageMetadata 格式）
 */
export interface UsageMetadata {
  /** 输入 prompt 的 token 数量 */
  promptTokenCount?: number
  
  /** 候选输出内容的 token 数量 */
  candidatesTokenCount?: number
  
  /** 总 token 数量 */
  totalTokenCount?: number
  
  /** 思考部分的 token 数量 */
  thoughtsTokenCount?: number
  
  /** Prompt token 详情（按模态分类） */
  promptTokensDetails?: TokenDetailsEntry[]
  
  /** 候选输出 token 详情（按模态分类，如 IMAGE、TEXT 等） */
  candidatesTokensDetails?: TokenDetailsEntry[]
}

/**
 * Content - Gemini API 消息格式
 */
export interface Content {
  role: 'user' | 'model'
  parts: ContentPart[]
  /**
   * 消息在后端历史记录中的索引
   *
   * 由后端在返回消息时填充，前端在删除/重试时直接使用此索引
   */
  index?: number
  /** 模型版本（仅 model 消息有值），如 "gemini-2.5-flash" */
  modelVersion?: string
  /** Token 使用统计（仅 model 消息有值） */
  usageMetadata?: UsageMetadata
  /** 是否为函数响应消息 */
  isFunctionResponse?: boolean
  /** 是否为上下文总结消息 */
  isSummary?: boolean
  /** 总结消息覆盖的消息数量 */
  summarizedMessageCount?: number
  /**
   * 思考开始时间戳（毫秒）
   *
   * 仅在流式响应过程中使用，用于前端实时显示思考时间
   * 完成后会被移除，只保留 thinkingDuration
   */
  thinkingStartTime?: number
  /**
   * 思考持续时间（毫秒）
   *
   * 仅对包含思考内容的 model 消息有值
   * 由后端计算并保存，记录从收到第一个思考块到收到第一个非思考内容块之间的时间
   */
  thinkingDuration?: number
  /**
   * 响应持续时间（毫秒）
   *
   * 从发出请求到响应正常结束的时间
   */
  responseDuration?: number
  /**
   * 第一个流式块时间戳（毫秒）
   *
   * 用于计算 Token 速率
   */
  firstChunkTime?: number
  /**
   * 流式响应持续时间（毫秒）
   *
   * 从收到第一个流式块到响应结束的时间
   */
  streamDuration?: number
  /**
   * 流式块数量
   *
   * 用于判断是否只有一个块
   */
  chunkCount?: number
  /**
   * 消息创建时间戳（毫秒）
   *
   * 用于前端显示消息发送时间
   */
  timestamp?: number
  /** @deprecated 使用 usageMetadata.thoughtsTokenCount */
  thoughtsTokenCount?: number
  /** @deprecated 使用 usageMetadata.candidatesTokenCount */
  candidatesTokenCount?: number
}

/**
 * Message - 前端展示用的消息格式
 *
 * 存储架构：
 * - allMessages: 存储所有消息，包括 functionResponse 消息，索引与后端一一对应
 * - messages: 计算属性，过滤掉 functionResponse 消息，用于显示
 *
 * 工具调用和响应通过 id 字段匹配，无需额外的索引映射
 */
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  attachments?: Attachment[]
  metadata?: MessageMetadata
  streaming?: boolean
  parts?: ContentPart[]  // 保留原始 Gemini 格式
  toolCalls?: ToolCall[]  // 工具调用列表
  toolResults?: ToolResult[]  // 工具执行结果
  tools?: ToolUsage[]  // 工具使用信息（合并后的数据）
  /**
   * 是否为 functionResponse 消息
   *
   * 这类消息在消息列表中隐藏，但用于和工具调用配对。
   * 工具调用和响应通过 ToolUsage.id / functionResponse.id 匹配。
   */
  isFunctionResponse?: boolean
  /**
   * 是否为上下文总结消息
   *
   * 总结消息以特殊样式显示，包含之前对话的压缩摘要
   */
  isSummary?: boolean
  /**
   * 总结消息覆盖的消息数量
   */
  summarizedMessageCount?: number
}

export interface MessageMetadata {
  /** 模型版本，如 "gemini-2.5-flash" */
  modelVersion?: string
  /** @deprecated 使用 modelVersion */
  model?: string
  tokens?: number
  latency?: number
  /** 完整的 token 使用统计 */
  usageMetadata?: UsageMetadata
  /**
   * 思考开始时间戳（毫秒）
   *
   * 仅在流式响应过程中使用，用于前端实时显示思考时间
   * 完成后会被移除，只保留 thinkingDuration
   */
  thinkingStartTime?: number
  /**
   * 思考持续时间（毫秒）
   *
   * 仅对包含思考内容的消息有值
   * 由后端计算并保存，记录从收到第一个思考块到收到第一个非思考内容块之间的时间
   */
  thinkingDuration?: number
  /**
   * 响应持续时间（毫秒）
   *
   * 由后端计算，从发出请求到响应正常结束的时间
   */
  responseDuration?: number
  /**
   * 第一个流式块时间戳（毫秒）
   *
   * 用于计算 Token 速率
   */
  firstChunkTime?: number
  /**
   * 流式响应持续时间（毫秒）
   *
   * 由后端计算，从收到第一个流式块到响应结束的时间
   */
  streamDuration?: number
  /**
   * 流式块数量
   *
   * 由后端记录，用于判断是否只有一个块
   */
  chunkCount?: number
  /** @deprecated 使用 usageMetadata.thoughtsTokenCount */
  thoughtsTokenCount?: number
  /** @deprecated 使用 usageMetadata.candidatesTokenCount */
  candidatesTokenCount?: number
  [key: string]: any
}

// ============ 工具相关类型 ============

/**
 * 工具调用信息
 */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status?: 'pending' | 'running' | 'success' | 'error'
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  id: string
  name: string
  result: Record<string, unknown>
  error?: string
  duration?: number
}

/**
 * 工具使用信息 - 用于在消息中显示
 */
export interface ToolUsage {
  id: string
  name: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  duration?: number
  status?: 'pending' | 'running' | 'success' | 'error' | 'warning'
  awaitingConfirmation?: boolean
}

// ============ 附件相关类型 ============

export type AttachmentType = 'image' | 'video' | 'audio' | 'document' | 'code'

export interface Attachment {
  id: string
  name: string
  type: AttachmentType
  size: number
  url?: string
  data?: string  // base64 或其他数据
  mimeType: string
  thumbnail?: string
  metadata?: AttachmentMetadata
}

export interface AttachmentMetadata {
  width?: number
  height?: number
  duration?: number
  language?: string
  [key: string]: any
}

// ============ 会话相关类型 ============

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  preview?: string
  metadata?: SessionMetadata
}

export interface SessionMetadata {
  model?: string
  tags?: string[]
  [key: string]: any
}

// ============ 配置相关类型 ============

export interface ChatConfig {
  model: string
  provider: 'gemini' | 'openai' | 'anthropic' | 'custom'
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stream?: boolean
}

export interface UIConfig {
  theme: 'auto' | 'light' | 'dark'
  fontSize: number
  codeTheme: string
  enableAnimations: boolean
  compactMode: boolean
}

// ============ VSCode 通信类型 ============

export interface VSCodeMessage<T = any> {
  type: string
  requestId?: string
  data: T
}

export interface VSCodeRequest {
  type: 'chat' | 'chatStream' | 'retry' | 'retryStream' | 'editAndRetry' | 'editAndRetryStream' |
        'deleteMessage' | 'getHistory' | 'getConfig' | 'updateConfig'
  data: any
  requestId: string
}

export interface VSCodeResponse<T = any> {
  type: string
  requestId: string
  success: boolean
  data?: T
  error?: ErrorInfo
}

// ============ Chat API 请求类型 ============

export interface ChatRequest {
  conversationId: string
  configId: string
  message: string
}

export interface RetryRequest {
  conversationId: string
  configId: string
}

export interface EditAndRetryRequest {
  conversationId: string
  messageIndex: number
  newMessage: string
  configId: string
}

export interface DeleteMessageRequest {
  conversationId: string
  targetIndex: number
}

// ============ Chat API 响应类型 ============

export interface ChatSuccessResponse {
  success: true
  content: Content
}

export interface ChatErrorResponse {
  success: false
  error: ErrorInfo
}

/**
 * 后端 StreamChunk 格式（来自 ChannelManager）
 */
export interface BackendStreamChunk {
  delta: ContentPart[]
  done: boolean
  usage?: UsageMetadata
  finishReason?: string
  /** 模型版本（仅最后一个块包含） */
  modelVersion?: string
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
  id?: string
  name: string
  result: Record<string, unknown>
}

/**
 * 待确认的工具调用
 */
export interface PendingToolCall {
  /** 工具调用 ID */
  id: string
  /** 工具名称 */
  name: string
  /** 工具参数 */
  args: Record<string, unknown>
}

/**
 * 前端接收的流式消息格式
 */
export interface StreamChunk {
  type: 'chunk' | 'complete' | 'error' | 'toolIteration' | 'cancelled' | 'checkpoints' | 'awaitingConfirmation' | 'toolsExecuting'
  conversationId: string
  chunk?: BackendStreamChunk
  content?: Content
  error?: ErrorInfo
  /** 是否为工具迭代（工具调用后还有后续消息） */
  toolIteration?: boolean
  /** 工具执行结果列表 */
  toolResults?: ToolExecutionResult[]
  /** 创建的检查点列表 */
  checkpoints?: CheckpointRecord[]
  /** 等待确认的工具调用列表（当 type 为 'awaitingConfirmation' 时） */
  pendingToolCalls?: PendingToolCall[]
  /** 标记工具即将开始执行（用于在工具执行前先发送计时信息） */
  toolsExecuting?: boolean
  /** 是否需要用户批注（文件修改工具执行后暂停等待用户确认） */
  needAnnotation?: boolean
  /** 需要用户确认的文件修改工具 ID 列表（后端直接告知，前端无需推断） */
  pendingDiffToolIds?: string[]
  /** 批注已被使用（后端已将批注添加到对话历史），前端应清空输入框并显示用户消息 */
  annotationUsed?: string
  /**
   * 待处理的批注（当有 diff 工具需要确认时，批注暂存于此，前端应在 diff 确认时重新发送）
   * 【重要】此字段由 ChatViewProvider 从后端中转，需确保 webview 层正确转发
   */
  pendingAnnotation?: string
}

// ============ 错误类型 ============

export interface ErrorInfo {
  code: string
  message: string
  details?: any
}

// ============ UI 状态类型 ============

export type ModalType = 'settings' | 'history' | 'attachment' | null

export interface AppState {
  loading: boolean
  error: ErrorInfo | null
  modalType: ModalType
  currentSession: string | null
}

// ============ 事件类型 ============

export interface ChatEvent {
  type: 'send' | 'receive' | 'error' | 'stream'
  message?: Message
  error?: ErrorInfo
}

// ============ 工具函数类型 ============

export type MessageFormatter = (message: Message) => string
export type AttachmentValidator = (file: File) => boolean | string

// ============ 常量 ============

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_MESSAGE_LENGTH = 10000
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/webm']
export const SUPPORTED_AUDIO_TYPES = ['audio/mp3', 'audio/wav', 'audio/ogg']

// ============ 检查点相关类型 ============

/**
 * 检查点记录
 *
 * 与对话消息索引关联的代码库快照记录
 */
export interface CheckpointRecord {
  /** 检查点唯一 ID */
  id: string
  
  /** 关联的对话 ID */
  conversationId: string
  
  /**
   * 关联的消息索引
   *
   * 表示此检查点是在处理该索引消息时创建的
   */
  messageIndex: number
  
  /** 触发备份的工具名称 */
  toolName: string
  
  /**
   * 备份阶段
   * - before: 工具执行前
   * - after: 工具执行后
   */
  phase: 'before' | 'after'
  
  /** 创建时间戳 */
  timestamp: number
  
  /** 备份目录名 */
  backupDir: string
  
  /** 备份的文件数量 */
  fileCount: number
  
  /** 内容签名（用于比较两个检查点是否内容一致） */
  contentHash: string
  
  /** 描述信息 */
  description?: string
}

// ============ 模型相关类型 ============

/**
 * 模型信息
 */
export interface ModelInfo {
  /** 模型 ID */
  id: string
  
  /** 模型名称 */
  name?: string
  
  /** 模型描述 */
  description?: string
  
  /** 上下文窗口大小 */
  contextWindow?: number
  
  /** 最大输出token */
  maxOutputTokens?: number
}
export const SUPPORTED_DOCUMENT_TYPES = ['application/pdf', 'text/plain', 'application/json']

// ============ MCP 相关类型 ============

/**
 * MCP 服务器传输类型
 */
export type McpTransportType = 'stdio' | 'sse' | 'streamable-http'

/**
 * MCP 服务器状态
 */
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Stdio 传输配置
 */
export interface StdioTransportConfig {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

/**
 * SSE 传输配置
 */
export interface SseTransportConfig {
  type: 'sse'
  url: string
  headers?: Record<string, string>
}

/**
 * Streamable HTTP 传输配置
 */
export interface StreamableHttpTransportConfig {
  type: 'streamable-http'
  url: string
  headers?: Record<string, string>
}

/**
 * MCP 传输配置
 */
export type McpTransportConfig = StdioTransportConfig | SseTransportConfig | StreamableHttpTransportConfig

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
  id: string
  name: string
  description?: string
  transport: McpTransportConfig
  enabled: boolean
  autoConnect: boolean
  timeout?: number
  /**
   * 是否清理 JSON Schema
   *
   * 如果为 true，会移除 JSON Schema 中不兼容的字段（如 $schema, additionalProperties）
   * 某些 API（如 Gemini）不支持这些字段
   *
   * 默认为 true
   */
  cleanSchema?: boolean
  createdAt: number
  updatedAt: number
}

/**
 * MCP 工具定义
 */
export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

/**
 * MCP 资源定义
 */
export interface McpResourceDefinition {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/**
 * MCP 提示模板定义
 */
export interface McpPromptDefinition {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

/**
 * MCP 服务器能力
 */
export interface McpServerCapabilities {
  tools?: McpToolDefinition[]
  resources?: McpResourceDefinition[]
  prompts?: McpPromptDefinition[]
  sampling?: boolean
  logging?: boolean
}

/**
 * MCP 服务器运行时信息
 */
export interface McpServerInfo {
  config: McpServerConfig
  status: McpServerStatus
  capabilities?: McpServerCapabilities
  protocolVersion?: string
  serverVersion?: string
  serverDescription?: string
  lastError?: string
  connectedAt?: number
}

/**
 * 创建 MCP 服务器输入
 */
export type CreateMcpServerInput = Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>

/**
 * 更新 MCP 服务器输入
 */
export type UpdateMcpServerInput = Partial<Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>>