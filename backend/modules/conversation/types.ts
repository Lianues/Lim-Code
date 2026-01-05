/**
 * LimCode - 对话历史管理类型定义
 * 
 * 完整支持 Gemini API 格式,包括:
 * - 文本、文件、内联数据
 * - 函数调用和函数响应
 * - 思考签名(Thinking)
 * - 思考内容(Thought)
 * - 所有高级特性
 * 
 * 存储格式: 完整的 Gemini Content[] 数组
 * 文件命名: 以对话 ID 作为文件名
 */

/**
 * 不同渠道的 Token 计数
 *
 * 由于不同渠道（Gemini、OpenAI、Anthropic）对同一消息的 token 计算方式不同，
 * 使用对象结构分开存储，便于按当前使用的渠道类型获取对应的 token 数。
 *
 * 计算方式：
 * - 通过调用各渠道的 token 计数 API 获取精确值
 * - 如果 API 调用失败，回退到估算方法
 */
export interface ChannelTokenCounts {
    /** Gemini 渠道的 token 数 */
    gemini?: number;
    
    /** OpenAI 渠道的 token 数 */
    openai?: number;
    
    /** Anthropic 渠道的 token 数 */
    anthropic?: number;
    
    /** 其他渠道的 token 数 */
    [key: string]: number | undefined;
}

/**
 * 思考签名（多格式支持）
 *
 * 不同 API 提供商返回的思考签名格式不同，
 * 使用对象结构分开存储，便于区分和管理
 *
 * 思考签名示例: "Eo4KCosKAXrI2nyWeryDa/51Rbxj4E/V/8w=="
 */
export interface ThoughtSignatures {
    /** Gemini 格式思考签名 */
    gemini?: string;
    
    /** Anthropic 格式思考签名（预留） */
    anthropic?: string;
    
    /** OpenAI 格式思考签名（预留） */
    openai?: string;
    
    /** OpenAI Responses 格式思考签名 */
    'openai-responses'?: string;
    
    /** 其他格式思考签名 */
    [key: string]: string | undefined;
}

/**
 * Gemini Content Part（内容片段）
 *
 * 支持 Gemini API 的所有内容类型:
 * - text: 文本内容
 * - inlineData: Base64 编码的内联数据(图片、音频等)
 * - fileData: 文件引用(通过 File API 上传的文件)
 * - functionCall: 模型请求调用的函数
 * - functionResponse: 函数执行结果
 * - thoughtSignatures: 思考签名(用于多轮对话中保持思考上下文)
 * - thought: 是否为思考内容标志
 */
export interface ContentPart {
    /** 文本内容 */
    text?: string;
    
    /**
     * 内联数据(Base64 编码)
     *
     * 标准 Gemini API 只需要 mimeType 和 data。
     * - displayName: Gemini API 支持的显示名称字段
     * - id 和 name 是附件元数据，仅用于存储和前端显示，
     *   发送给 AI 时会被过滤掉。
     */
    inlineData?: {
        mimeType: string;
        data: string; // Base64 编码的数据
        /** 显示名称（Gemini API 支持，可发送给 API） */
        displayName?: string;
        /** 附件 ID（仅用于存储和显示，发送 API 时过滤） */
        id?: string;
        /** 附件名称（仅用于存储和显示，发送 API 时过滤） */
        name?: string;
    };
    
    /**
     * 文件数据(File API 引用)
     *
     * displayName 在以下场景中必需：
     * - 在 functionResponse.parts 中，需要通过 {"$ref": "displayName"} 引用时
     */
    fileData?: {
        mimeType: string;
        fileUri: string;
        displayName?: string; // 用于 JSON 引用的唯一名称
    };
    
    /** 函数调用(模型请求) */
    functionCall?: {
        name: string;
        args: Record<string, unknown>;
        /** 增量解析时的原始 JSON 字符串（用于流式输出） */
        partialArgs?: string;
        id?: string; // 可选的函数调用 ID
        /**
         * 是否已被用户拒绝执行
         *
         * 当用户在工具等待确认时点击终止按钮，此字段会被设置为 true
         * 用于在重新加载对话时正确显示工具状态
         */
        rejected?: boolean;
    };
    
    /**
     * 函数响应(执行结果)
     *
     * Gemini 3 Pro+ 支持多模态函数响应：
     * - parts: 可以包含 inlineData 或 fileData 的嵌套 parts
     * - response: 可以使用 {"$ref": "displayName"} 引用 parts 中的多模态内容
     * - id: 函数调用 ID（Anthropic API 必需，用于关联 tool_use 和 tool_result）
     *
     * 示例：
     * {
     *   "functionResponse": {
     *     "name": "get_image",
     *     "id": "toolu_xxx",
     *     "response": {
     *       "image_ref": { "$ref": "cat.jpg" }
     *     },
     *     "parts": [
     *       {
     *         "fileData": {
     *           "displayName": "cat.jpg",
     *           "mimeType": "image/jpeg",
     *           "fileUri": "gs://..."
     *         }
     *       }
     *     ]
     *   }
     * }
     */
    functionResponse?: {
        name: string;
        response: Record<string, unknown>;
        id?: string; // 函数调用 ID（Anthropic 必需）
        parts?: ContentPart[]; // 嵌套的多模态 parts (Gemini 3 Pro+)
    };
    
    /**
     * 思考签名（多格式支持）
     *
     * 按提供商格式分类存储的思考签名
     *
     * 示例: { gemini: "Eo4KCosKAXLI2nyWeryDa/51Rbxj4E/V/8w==" }
     *
     * 使用场景:
     * - thoughtSignatures.gemini: Gemini API 返回的签名
     * - thoughtSignatures.anthropic: Anthropic API 返回的签名（预留）
     * - thoughtSignatures.openai: OpenAI API 返回的签名（预留）
     *
     * 发送请求时，根据目标 API 类型选择对应格式的签名发送
     *
     * 重要规则:
     * - 必须原样返回给模型，不能修改
     * - 不能与其他 part 合并
     * - 不能合并两个都含签名的 parts
     * - 对于 Gemini 3 函数调用：必须返回，否则会 400 错误
     * - 对于其他情况：推荐返回以保持推理质量
     */
    thoughtSignatures?: ThoughtSignatures;
    
    /**
     * 是否为思考内容标志
     *
     * 当设置为 true 时，表示此 part 包含模型的思考过程而非最终回答：
     * - 思考摘要：当 includeThoughts=true 时，模型返回的推理过程
     * - 与正文内容分离，用于调试或了解推理步骤
     * - 不应作为最终答案展示给用户
     *
     * 示例 1 - 思考内容:
     * {
     *   "text": "Let me think step-by-step about this problem...",
     *   "thought": true  // 这是思考过程
     * }
     *
     * 示例 2 - 正文回答:
     * {
     *   "text": "The answer is 42",
     *   "thought": false // 或省略此字段，这是最终回答
     * }
     *
     * 完整响应示例:
     * {
     *   "role": "model",
     *   "parts": [
     *     {
     *       "text": "I need to calculate... step 1, step 2...",
     *       "thought": true  // 思考过程
     *     },
     *     {
     *       "text": "Based on my analysis, the result is X",
     *       // thought 字段省略或为 false，表示这是最终回答
     *     }
     *   ]
     * }
     */
    thought?: boolean;
    
    /**
     * 加密的思考内容（Anthropic redacted_thinking）
     *
     * Anthropic Claude 在某些情况下会返回加密的思考内容，
     * 以 Base64 编码的形式存储在 redacted_thinking 块中。
     *
     * 与普通思考内容的区别：
     * - 普通思考（thought: true + text）：可读的思考过程
     * - 加密思考（redactedThinking）：不可读，但需要在后续对话中原样返回
     *
     * 存储格式：
     * {
     *   "redactedThinking": "EmwKAhgBEgy3va3pzix/LafPsn4a..."
     * }
     *
     * 发送时需要转换为：
     * {
     *   "type": "redacted_thinking",
     *   "data": "EmwKAhgBEgy3va3pzix/LafPsn4a..."
     * }
     */
    redactedThinking?: string;
}

/**
 * Token 详情条目
 *
 * 按模态（modality）分类的 token 统计
 */
export interface TokenDetailsEntry {
    /** 模态类型: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" */
    modality: string;
    /** Token 数量 */
    tokenCount: number;
}

/**
 * Token 使用统计（Gemini usageMetadata 格式）
 *
 * 仅存储在 model 角色的消息上
 */
export interface UsageMetadata {
    /** 输入 prompt 的 token 数量 */
    promptTokenCount?: number;
    
    /** 候选输出内容的 token 数量 */
    candidatesTokenCount?: number;
    
    /** 总 token 数量（prompt + candidates + thoughts） */
    totalTokenCount?: number;
    
    /** 思考部分的 token 数量 */
    thoughtsTokenCount?: number;
    
    /** Prompt token 详情（按模态分类） */
    promptTokensDetails?: TokenDetailsEntry[];
    
    /** 候选输出 token 详情（按模态分类，如 IMAGE、TEXT 等） */
    candidatesTokensDetails?: TokenDetailsEntry[];
}

/**
 * Gemini Content（消息内容）
 *
 * Gemini API 的标准消息格式
 */
export interface Content {
    /** 角色 */
    role: 'user' | 'model' | 'system';
    /** 内容片段列表 */
    parts: ContentPart[];
    
    /**
     * 消息在历史记录中的索引
     *
     * 由后端在返回消息时填充，用于前端在删除/重试时
     * 直接使用此索引，无需进行复杂的索引转换计算。
     */
    index?: number;
    
    /**
     * 模型版本（仅 model 消息有值）
     *
     * 例如: "gemini-2.5-flash", "gpt-5o"
     * 用于标识是哪个模型生成的回复
     */
    modelVersion?: string;
    
    /**
     * Token 使用统计（仅 model 消息有值）
     *
     * 包含完整的 usageMetadata：
     * - promptTokenCount: 输入 prompt 的 token 数
     * - candidatesTokenCount: 输出候选的 token 数
     * - totalTokenCount: 总 token 数
     * - thoughtsTokenCount: 思考部分的 token 数
     * - promptTokensDetails: prompt token 详情
     */
    usageMetadata?: UsageMetadata;
    
    /**
     * 思考持续时间（毫秒）
     *
     * 仅对包含思考内容的 model 消息有值
     * 记录从收到第一个思考块到收到第一个非思考内容块之间的时间
     * 用于在前端显示 AI 思考耗时
     */
    thinkingDuration?: number;
    
    /**
     * 思考开始时间戳（毫秒）
     *
     * 仅在流式响应过程中使用，用于计算思考持续时间
     * 完成后会被移除，只保留 thinkingDuration
     */
    thinkingStartTime?: number;
    
    /**
     * 响应持续时间（毫秒）
     *
     * 从发出请求到响应正常结束的时间
     * 仅对 model 消息有值
     */
    responseDuration?: number;
    
    /**
     * 第一个流式块时间戳（毫秒）
     *
     * 用于计算 Token 速率
     */
    firstChunkTime?: number;
    
    /**
     * 流式响应持续时间（毫秒）
     *
     * 从收到第一个流式块到响应结束的时间
     * 用于计算 Token 速率
     */
    streamDuration?: number;
    
    /**
     * 流式块数量
     *
     * 用于判断是否只有一个块（只有一个块时不计算速率）
     */
    chunkCount?: number;
    
    /**
     * 标识此 user 消息是否为函数调用响应
     *
     * 仅对 role='user' 的消息有意义
     * - true: 此消息包含 functionResponse（函数执行结果）
     * - false/undefined: 此消息是普通用户消息
     *
     * 用于区分普通用户消息和函数响应消息，
     * 在过滤思考签名时需要此标记来定位最后一个非函数响应的用户消息
     */
    isFunctionResponse?: boolean;
    
    /**
     * 标识此 user 消息是否为上下文总结消息
     *
     * 仅对 role='user' 的消息有意义
     * - true: 此消息是上下文总结，包含之前对话的压缩摘要
     * - false/undefined: 此消息是普通用户消息
     *
     * 使用场景：
     * - 当对话过长时，用户可以触发上下文总结
     * - 系统会将旧对话压缩为总结消息
     * - 后续调用 AI 时，从最后一个总结消息开始获取历史
     *
     * 前端显示：
     * - 以特殊样式显示，表明这是总结内容
     * - 可以展开查看完整总结
     */
    isSummary?: boolean;
    
    /**
     * 总结消息覆盖的消息数量
     *
     * 仅当 isSummary=true 时有意义
     * 记录此总结替代了多少条原始消息
     */
    summarizedMessageCount?: number;
    
    /**
     * 消息创建时间戳（毫秒）
     *
     * 用于前端显示消息发送时间
     * 如果未设置，前端会使用加载时的时间
     */
    timestamp?: number;
    
    /**
     * 该消息按渠道分类的 token 数（仅用户消息和函数响应消息）
     *
     * 由于不同渠道（Gemini、OpenAI、Anthropic）对同一消息的 token 计算方式不同，
     * 按渠道类型分别存储，在裁剪上下文时根据当前使用的渠道获取对应值。
     *
     * 计算方式（优先级从高到低）：
     * 1. 调用渠道的 token 计数 API 获取精确值
     * 2. 如果 API 调用失败，使用相邻轮次 promptTokenCount 差值计算
     * 3. 如果没有 promptTokenCount，使用字符数估算
     *
     * 用于：
     * - 估算完整历史的 token 数
     * - 判断是否需要裁剪上下文
     * - 避免上下文振荡问题
     *
     * 示例：
     * {
     *   gemini: 1500,
     *   openai: 1520,
     *   anthropic: 1480
     * }
     */
    tokenCountByChannel?: ChannelTokenCounts;
    
    /**
     * @deprecated 使用 tokenCountByChannel 代替
     * 保留用于向后兼容，新代码应使用 tokenCountByChannel
     */
    estimatedTokenCount?: number;
    
    /**
     * @deprecated 使用 usageMetadata.thoughtsTokenCount 代替
     */
    thoughtsTokenCount?: number;
    
    /**
     * @deprecated 使用 usageMetadata.candidatesTokenCount 代替
     */
    candidatesTokenCount?: number;
}

/**
 * 对话历史（Gemini 格式）
 * 
 * 这是存储的核心格式:
 * - 直接兼容 Gemini API
 * - 包含所有高级特性(函数调用、思考签名、思考内容等)
 * - 可以直接发送给 Gemini API
 * 
 * 存储方式:
 * - 文件名: {conversationId}.json
 * - 内容: JSON.stringify(ConversationHistory)
 * 
 * 思考内容存储:
 * - 思考摘要会被标记为 thought: true
 * - 思考签名会自动保存在 thoughtSignatures 字段
 * - 可选择是否在 UI 中显示思考内容
 */
export type ConversationHistory = Content[];

/**
 * 检查点记录
 *
 * 与对话消息索引关联的代码库快照记录
 */
export interface CheckpointRecord {
    /** 检查点唯一 ID */
    id: string;
    
    /**
     * 关联的消息索引
     *
     * 表示此检查点是在处理该索引消息时创建的
     * 对于 before 阶段：在执行工具前创建，关联工具调用消息
     * 对于 after 阶段：在执行工具后创建，关联工具响应消息
     */
    messageIndex: number;
    
    /** 触发备份的工具名称 */
    toolName: string;
    
    /**
     * 备份阶段
     * - before: 工具执行前
     * - after: 工具执行后
     */
    phase: 'before' | 'after';
    
    /** 创建时间戳 */
    timestamp: number;
    
    /** 描述信息 */
    description?: string;
    
    /** 统计信息 */
    stats: {
        /** 文件数量 */
        fileCount: number;
        /** 总大小（字节） */
        totalSize: number;
    };
}

/**
 * 对话元数据
 *
 * 存储对话的额外信息(不是 Gemini 格式的一部分)
 */
export interface ConversationMetadata {
    /** 对话 ID */
    id: string;
    /** 对话标题 */
    title?: string;
    /** 创建时间 */
    createdAt: number;
    /** 最后更新时间 */
    updatedAt: number;
    
    /**
     * 工作区 URI
     *
     * 创建对话时的工作区路径，用于筛选显示
     * 例如: "file:///c%3A/Users/xxx/projects/my-project"
     */
    workspaceUri?: string;
    
    /**
     * 检查点列表
     *
     * 与消息索引关联的代码库快照记录
     */
    checkpoints?: CheckpointRecord[];
    
    /** 自定义元数据 */
    custom?: Record<string, unknown>;
}

/**
 * 完整的对话数据(包含历史和元数据)
 */
export interface ConversationData {
    /** 对话元数据 */
    metadata: ConversationMetadata;
    /** 对话历史(Gemini 格式) */
    history: ConversationHistory;
}

/**
 * 消息位置定位
 */
export interface MessagePosition {
    /** 消息索引 */
    index: number;
    /** 角色 */
    role: 'user' | 'model' | 'system';
}

/**
 * 消息过滤器
 */
export interface MessageFilter {
    /** 按角色过滤 */
    role?: 'user' | 'model' | 'system';
    /** 按是否包含函数调用过滤 */
    hasFunctionCall?: boolean;
    /** 按是否包含文本过滤 */
    hasText?: boolean;
    /** 按是否为思考内容过滤 */
    isThought?: boolean;
    /** 按索引范围过滤 */
    indexRange?: {
        start: number;
        end: number;
    };
}

/**
 * 历史快照
 * 
 * 用于保存对话的某个时间点状态
 */
export interface HistorySnapshot {
    /** 快照 ID */
    id: string;
    /** 对话 ID */
    conversationId: string;
    /** 快照名称 */
    name?: string;
    /** 快照描述 */
    description?: string;
    /** 快照时间戳 */
    timestamp: number;
    /** 历史记录(Gemini 格式) */
    history: ConversationHistory;
}

/**
 * 对话统计信息
 */
export interface ConversationStats {
    /** 总消息数 */
    totalMessages: number;
    /** 用户消息数 */
    userMessages: number;
    /** 模型消息数 */
    modelMessages: number;
    /** 函数调用次数 */
    functionCalls: number;
    /** 是否包含思考签名 */
    hasThoughtSignatures: boolean;
    /** 是否包含思考内容 */
    hasThoughts: boolean;
    /** 是否包含文件数据 */
    hasFileData: boolean;
    /** 是否包含内嵌多模态数据 */
    hasInlineData: boolean;
    /** 内嵌数据总大小（字节） */
    inlineDataSize: number;
    /** 多模态内容统计 */
    multimedia: {
        images: number;
        audio: number;
        video: number;
        documents: number;
    };
    /** Token 统计 */
    tokens: {
        /** 总思考 token 数 */
        totalThoughtsTokens: number;
        /** 总候选输出 token 数 */
        totalCandidatesTokens: number;
        /** 总 token 数（思考 + 输出） */
        totalTokens: number;
        /** 有思考 token 记录的消息数 */
        messagesWithThoughtsTokens: number;
        /** 有候选 token 记录的消息数 */
        messagesWithCandidatesTokens: number;
    };
}

/**
 * 消息编辑操作
 */
export interface MessageEdit {
    /** 消息索引 */
    index: number;
    /** 新的文本内容 */
    newText: string;
}

/**
 * 消息插入操作
 */
export interface MessageInsert {
    /** 插入位置（在此索引之前插入） */
    beforeIndex: number;
    /** 要插入的消息 */
    content: Content;
}