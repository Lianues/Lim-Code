/**
 * LimCode - 渠道调用模块类型定义
 * 
 * 定义渠道调用相关的类型和接口
 */

import type { Content, ContentPart } from '../conversation/types';

/**
 * 生成请求
 *
 * 用于发起 LLM 生成的请求
 * 所有生成参数（包括 systemInstruction）由配置决定，请求只包含对话内容
 */
export interface GenerateRequest {
    /** 配置 ID（从配置管理模块获取） */
    configId: string;
    
    /** 对话历史（统一的 Content 格式） */
    history: Content[];
    
    /** 取消信号 */
    abortSignal?: AbortSignal;
    
    /**
     * 动态系统提示词（可选）
     *
     * 由 PromptManager 生成的静态提示词，包含操作系统、时区、用户语言、工作区路径等不经常变化的信息。
     * 如果提供，会追加到配置中的 systemInstruction 之后。
     */
    dynamicSystemPrompt?: string;
    
    /**
     * 动态上下文消息（可选）
     *
     * 由 PromptManager.getDynamicContextMessages() 生成的动态上下文。
     * 包含当前时间、文件树、打开标签页、诊断信息等频繁变化的内容。
     * 
     * 这些消息会被插入到连续的最后一组用户输入消息（isUserInput=true）之前，
     * 但不会存储到后端历史记录中。
     * 
     * 插入位置由 formatter 内部通过查找 isUserInput 标记计算。
     */
    dynamicContextMessages?: Content[];
    
    /**
     * 跳过工具注入（可选）
     *
     * 如果为 true，不会将工具声明添加到请求中。
     * 用于总结等不需要工具调用的场景。
     */
    skipTools?: boolean;
    
    /**
     * 模型覆盖（可选）
     *
     * 如果提供，将覆盖配置中的 model 字段。
     * 用于专用总结模型等场景。
     */
    modelOverride?: string;
    
    /**
     * 跳过重试（可选）
     *
     * 如果为 true，请求失败时不会进行重试。
     * 用于总结等一次性操作，避免不必要的重试。
     */
    skipRetry?: boolean;
    
    /**
     * MCP 工具内容（可选）
     *
     * 已格式化的 MCP 工具定义内容。
     * 用于替换系统提示词模板中的 {{$MCP_TOOLS}} 占位符。
     */
    mcpToolsContent?: string;
}

/**
 * 生成响应
 *
 * 标准化的响应格式，直接返回 Content 格式
 * 所有渠道的响应都会转换为这个统一格式
 */
export interface GenerateResponse {
    /** 内容（完整的 Content 格式） */
    content: Content;
    
    /** 结束原因 */
    finishReason?: string;
    
    /** 模型名称 */
    model?: string;
    
    /** 原始响应（用于调试） */
    raw?: any;
}

/**
 * Token 详情条目
 */
export interface TokenDetailsEntry {
    /** 模态类型: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" */
    modality: string;
    /** Token 数量 */
    tokenCount: number;
}

/**
 * Token 使用统计（流式响应）
 */
export interface StreamUsageMetadata {
    /** 输入 prompt 的 token 数量 */
    promptTokenCount?: number;
    
    /** 候选输出内容的 token 数量 */
    candidatesTokenCount?: number;
    
    /** 总 token 数量 */
    totalTokenCount?: number;
    
    /** 思考部分的 token 数量 */
    thoughtsTokenCount?: number;
    
    /** Prompt token 详情（按模态分类） */
    promptTokensDetails?: TokenDetailsEntry[];
    
    /** 候选输出 token 详情（按模态分类，如 IMAGE、TEXT 等） */
    candidatesTokensDetails?: TokenDetailsEntry[];
}

/**
 * 流式响应块
 *
 * 用于流式输出的单个响应块
 */
export interface StreamChunk {
    /** 内容增量 */
    delta: ContentPart[];
    
    /** 是否完成 */
    done: boolean;
    
    /** Token 使用统计（仅最后一个块包含） */
    usage?: StreamUsageMetadata;
    
    /** 结束原因（仅最后一个块包含） */
    finishReason?: string;
    
    /** 模型版本（仅最后一个块包含） */
    modelVersion?: string;
    
    /**
     * 思考开始时间戳（毫秒）
     *
     * 当收到第一个思考内容时设置，用于前端实时显示思考时间
     */
    thinkingStartTime?: number;
}

/**
 * HTTP 请求选项
 */
export interface HttpRequestOptions {
    /** 请求 URL */
    url: string;
    
    /** 请求方法 */
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    
    /** 请求头 */
    headers: Record<string, string>;
    
    /** 请求体 */
    body?: any;
    
    /** 超时时间（毫秒） */
    timeout?: number;
    
    /** 是否流式 */
    stream?: boolean;
}

/**
 * HTTP 响应
 */
export interface HttpResponse {
    /** 状态码 */
    status: number;
    
    /** 响应头 */
    headers: Record<string, string>;
    
    /** 响应体 */
    body: any;
}

/**
 * 错误类型
 */
export enum ErrorType {
    /** 配置错误 */
    CONFIG_ERROR = 'CONFIG_ERROR',
    
    /** 网络错误 */
    NETWORK_ERROR = 'NETWORK_ERROR',
    
    /** API 错误 */
    API_ERROR = 'API_ERROR',
    
    /** 解析错误 */
    PARSE_ERROR = 'PARSE_ERROR',
    
    /** 验证错误 */
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    
    /** 超时错误 */
    TIMEOUT_ERROR = 'TIMEOUT_ERROR',
    
    /** 用户取消错误（不应重试） */
    CANCELLED_ERROR = 'CANCELLED_ERROR'
}

/**
 * 渠道错误
 */
export class ChannelError extends Error {
    constructor(
        public type: ErrorType,
        message: string,
        public details?: any
    ) {
        super(message);
        this.name = 'ChannelError';
    }
}