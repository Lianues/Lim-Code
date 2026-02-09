
/**
 * LimCode - 工具系统类型定义
 * 
 * 定义工具的标准接口和类型
 */

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