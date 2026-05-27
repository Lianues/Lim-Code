
/**
 * LimCode - 工具系统类型定义
 * 
 * 定义工具的标准接口和类型
 */

/**
 * 通用工具进度事件。
 *
 * 修改原因：SubAgent Monitor、长耗时工具和未来 MCP 工具都需要实时进度，不能为 SubAgent 单独发明一套事件协议。
 * 修改方式：在工具系统类型层新增通用 envelope，payload 继续允许复用现有工具、流式内容和业务结果结构。
 * 修改目的：主聊天、SubAgent Monitor 和后续长任务工具可以共享同一条进度语义，避免再次出现“主流程升级但 SubAgent 漏升级”。
 */
export interface ToolProgressEvent {
    /** 事件所属运行实例；SubAgent 使用 runId，普通工具可不填 */
    runId?: string;
    /** 事件类型，覆盖结构级、内容级和工具级进度 */
    type: 'run_created' | 'run_updated' | 'run_completed' | 'run_failed' | 'run_cancelled'
        // 修改原因：SubAgent Monitor 新增暂停、恢复、等待用户操作和扩展重载中断状态，需要通过同一进度 envelope 广播。
        // 修改方式：把 run_paused/run_resumed/run_awaiting_monitor_action/run_interrupted 纳入通用事件类型，而不是在 SubAgent 单独绕开类型系统。
        // 修改目的：保持主聊天、SubAgent Monitor 和未来长任务的进度事件仍然使用同一协议。
        | 'run_paused' | 'run_resumed' | 'run_awaiting_monitor_action' | 'run_interrupted'
        // 修改原因：ChannelManager 的局部 retryStatusCallback 会把 SubAgent 内部自动重试状态转发给 Monitor。
        // 修改方式：把 retrying/retrySuccess/retryFailed 纳入通用进度事件类型。
        // 修改目的：自动重试仍由 ChannelManager 负责，Monitor 可通过同一事件总线观察状态。
        | 'retrying' | 'retrySuccess' | 'retryFailed'
        | 'llm_delta' | 'content_snapshot'
        | 'tool_started' | 'tool_progress' | 'tool_completed' | 'tool_failed';
    /** 工具调用 ID；工具级事件使用 */
    toolId?: string;
    /** 工具名；工具级事件使用 */
    toolName?: string;
    /** 事件时间戳；发送方不填时由桥接层补齐 */
    timestamp?: number;
    /** 复用现有结构的事件主体，例如 ToolUsage、ToolExecutionResult、ContentPart 或 StreamChunk */
    payload?: unknown;
}

/**
 * 通用工具进度发射函数。
 *
 * 修改原因：工具 handler 只能拿到 ToolContext；把进度能力放在这里，所有工具都能复用。
 * 修改方式：定义统一函数类型，由调用方按场景桥接到主聊天 toolStatus 或 SubAgent Monitor。
 * 修改目的：避免为每个长任务工具或 SubAgent 单独加回调字段。
 */
export type ToolProgressEmitter = (event: ToolProgressEvent) => void | Promise<void>;


/**
 * 工具声明（Gemini Function Calling 格式）
 */
export interface ToolDeclaration {
    /** 工具名称 */
    name: string;
    
    /** 工具描述 */
    description: string;
    
    /** 工具分类（如 file, search, terminal） */
    category?: string;
    
    /** 参数定义（JSON Schema） */
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    
    /**
     * 工具依赖列表
     *
     * 指定此工具运行所需的外部依赖包名称
     * 如果依赖未安装，工具将不会对 AI 可用
     *
     * @example ['sharp'] - 表示需要 sharp 库
     */
    dependencies?: string[];

    /**
     * 工具别名（兼容重命名后的旧对话历史）
     *
     */
    aliases?: string[];

    /**
     * 是否启用 strict 模式（API 端强制 schema 校验）
     *
     * 开启后，API 会使用 grammar-constrained sampling 保证模型输出
     * 严格符合参数 schema，消除类型错误和缺失字段。
     *
     * 各渠道行为：
     * - Anthropic: 工具定义中加 strict: true，请求头加 beta header
     * - OpenAI Chat Completions: 工具定义中加 strict: true
     * - OpenAI Responses: 默认即 strict，不需要额外设置
     * - Gemini: 不支持，此字段无效
     */
    strict?: boolean;
}

/**
 * 工具执行参数
 */
export interface ToolArgs {
    [key: string]: any;
}

/**
 * 多模态能力（从 utils.ts 复制以避免循环依赖）
 */
export interface MultimodalCapability {
    /** 是否支持图片 */
    supportsImages: boolean;
    /** 是否支持文档（PDF） */
    supportsDocuments: boolean;
    /** 是否支持回传多模态数据到历史记录 */
    supportsHistoryMultimodal: boolean;
}

/**
 * 裁切图片工具配置
 */
export interface CropImageToolOptions {
    /**
     * 是否使用归一化坐标
     *
     * - true: 使用 0-1000 归一化坐标系统（适用于 Gemini 等模型）
     * - false: 模型直接输出像素坐标（适用于能自行计算坐标的模型）
     *
     * 默认值：true
     */
    useNormalizedCoordinates?: boolean;
}

/**
 * 工具配置
 *
 * 各工具的渠道级配置
 */
export interface ToolOptions {
    /** 裁切图片工具配置 */
    cropImage?: CropImageToolOptions;
}

/**
 * 对话存储接口
 *
 * 用于存储和获取对话的自定义元数据
 */
export interface ConversationStore {
    /**
     * 获取自定义元数据
     *
     * @param conversationId 对话 ID
     * @param key 元数据键
     * @returns 元数据值
     */
    getCustomMetadata(conversationId: string, key: string): Promise<unknown>;
    
    /**
     * 设置自定义元数据
     *
     * @param conversationId 对话 ID
     * @param key 元数据键
     * @param value 元数据值
     */
    setCustomMetadata(conversationId: string, key: string, value: unknown): Promise<void>;
}

/**
 * 工具执行上下文
 *
 * 包含工具执行时可能需要的额外信息
 */
export interface ToolContext {
    /** 工具配置（来自 SettingsManager） */
    config?: Record<string, unknown>;
    
    /**
     * 是否启用多模态工具
     *
     * 当启用时，read_file 等工具可以读取图片和 PDF 等多模态文件
     * 禁用时，仅支持读取纯文本文件
     */
    multimodalEnabled?: boolean;
    
    /**
     * 多模态能力
     *
     * 根据渠道类型和工具模式计算得出的多模态支持能力
     * 工具可以根据这个能力决定能否读取特定类型的文件
     */
    capability?: MultimodalCapability;
    
    /**
     * 取消信号
     *
     * 当用户取消对话或重载时，此信号会被触发
     * 工具应该在长时间操作中检查此信号并及时终止
     */
    abortSignal?: AbortSignal;
    
    /**
     * 工具调用 ID
     *
     * 由 ChatHandler 生成的唯一标识符，用于追踪和取消特定的工具调用
     * 格式为: `tool_{timestamp}_{random}`
     */
    toolId?: string;
    
    /**
     * 工具配置
     *
     * 各工具的渠道级配置项，由渠道配置传递
     */
    toolOptions?: ToolOptions;
    
    /**
     * 对话 ID
     *
     * 当前对话的唯一标识符
     */
    conversationId?: string;
    
    /**
     * 对话存储
     *
     * 用于存储和获取对话的自定义元数据
     */
    conversationStore?: {
        getCustomMetadata: (conversationId: string, key: string) => Promise<unknown>;
        setCustomMetadata: (conversationId: string, key: string, value: unknown) => Promise<void>;
    };

    /**
     * 通用工具进度发射器。
     *
     * 修改原因：SubAgent Monitor 需要观察内部工具进度，但这个能力本质上属于所有长耗时工具。
     * 修改方式：由 ToolExecutionService 在构造 ToolContext 时注入，工具内部按需调用。
     * 修改目的：让主聊天和 SubAgent Monitor 能通过同一套进度协议显示工具运行状态。
     */
    emitProgress?: ToolProgressEmitter;
    
    /** 其他上下文信息 */
    [key: string]: unknown;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
    /** 是否成功 */
    success: boolean;
    
    /** 返回数据（成功时） */
    data?: any;
    
    /** 错误信息（失败时） */
    error?: string;
    
    /** 多模态数据（可选） */
    multimodal?: MultimodalData[];
    
    /** 是否被用户取消（可选） */
    cancelled?: boolean;
    
    /**
     * 工具执行成功后，要求暂停 AI 的工具迭代循环，等待用户手动操作后再继续。
     * 与 autoExec 不同：autoExec 控制"是否自动执行工具"（执行前的门闸），
     * 而此字段控制"工具执行后是否继续 AI 循环"（执行后的门闸）。
     */
    requiresUserConfirmation?: boolean;
}

/**
 * 多模态数据
 */
export interface MultimodalData {
    /** MIME 类型 */
    mimeType: string;
    
    /** Base64 编码的数据 */
    data: string;
    
    /** 文件名（可选） */
    name?: string;
}

/**
 * 工具处理器函数
 */
export type ToolHandler = (args: ToolArgs, context?: ToolContext) => Promise<ToolResult>;

/**
 * 工具定义（完整）
 */
export interface Tool {
    /** 工具声明 */
    declaration: ToolDeclaration;
    
    /** 工具处理器 */
    handler: ToolHandler;
}

/**
 * 工具注册函数
 */
export type ToolRegistration = () => Tool;