/**
 * LimCode - 对话 API 类型定义
 * 
 * 定义对话相关的请求和响应类型
 */

import type { Content } from '../../conversation/types';
import type { StreamChunk } from '../../channel/types';
import type { CheckpointRecord } from '../../checkpoint';

// ==================== 请求数据 ====================

/**
 * 附件数据
 */
export interface AttachmentData {
    /** 附件 ID */
    id: string;
    
    /** 文件名 */
    name: string;
    
    /** 附件类型 */
    type: 'image' | 'video' | 'audio' | 'document' | 'code';
    
    /** 文件大小（字节） */
    size: number;
    
    /** MIME 类型 */
    mimeType: string;
    
    /** Base64 编码的数据 */
    data: string;
    
    /** 缩略图（可选，Base64 编码） */
    thumbnail?: string;
}

/**
 * 对话请求数据
 */
export interface ChatRequestData {
    /** 对话 ID */
    conversationId: string;
    
    /** 配置 ID */
    configId: string;
    
    /** 用户消息（文本） */
    message: string;
    
    /** 附件列表（可选） */
    attachments?: AttachmentData[];
    
    /** 取消信号 */
    abortSignal?: AbortSignal;
}

// ==================== 响应数据 ====================

/**
 * 对话成功响应数据
 */
export interface ChatSuccessData {
    success: true;
    /** AI 回复（完整 Content 格式） */
    content: Content;
}

/**
 * 对话错误响应数据
 */
export interface ChatErrorData {
    success: false;
    error: {
        /** 错误代码 */
        code: string;
        /** 错误消息 */
        message: string;
    };
}

/**
 * 流式响应块数据
 */
export interface ChatStreamChunkData {
    /** 对话 ID */
    conversationId: string;
    /** 流式块 */
    chunk: StreamChunk;
}

/**
 * 流式完成数据
 */
export interface ChatStreamCompleteData {
    /** 对话 ID */
    conversationId: string;
    /** 完整的 AI 回复 */
    content: Content;
}

/**
 * 工具迭代完成数据（工具调用后需要创建新消息）
 */
export interface ChatStreamToolIterationData {
    /** 对话 ID */
    conversationId: string;
    /** 当前迭代的 AI 回复（包含工具调用） */
    content: Content;
    /** 标记这是工具迭代完成，还有后续消息 */
    toolIteration: true;
    /** 工具执行结果 */
    toolResults?: Array<{
        /** 工具调用 ID */
        id?: string;
        /** 工具名称 */
        name: string;
        /** 执行结果 */
        result: Record<string, unknown>;
    }>;
    /** 创建的检查点（如果有） */
    checkpoints?: CheckpointRecord[];
}

/**
 * 流式错误数据
 */
export interface ChatStreamErrorData {
    /** 对话 ID */
    conversationId: string;
    error: {
        /** 错误代码 */
        code: string;
        /** 错误消息 */
        message: string;
    };
}

/**
 * 流式检查点数据（用于立即发送检查点到前端）
 */
export interface ChatStreamCheckpointsData {
    /** 对话 ID */
    conversationId: string;
    /** 检查点列表 */
    checkpoints: CheckpointRecord[];
    /** 标记这是检查点数据 */
    checkpointOnly: true;
}

// ==================== 重试消息 ====================

/**
 * 重试请求数据
 */
export interface RetryRequestData {
    /** 对话 ID */
    conversationId: string;
    
    /** 配置 ID */
    configId: string;
    
    /** 取消信号 */
    abortSignal?: AbortSignal;
}

// ==================== 编辑并重试 ====================

/**
 * 编辑并重试请求数据
 */
export interface EditAndRetryRequestData {
    /** 对话 ID */
    conversationId: string;
    
    /** 要编辑的消息索引（必须是用户消息） */
    messageIndex: number;
    
    /** 新的消息内容 */
    newMessage: string;
    
    /** 附件列表（可选） */
    attachments?: AttachmentData[];
    
    /** 配置 ID */
    configId: string;
    
    /** 取消信号 */
    abortSignal?: AbortSignal;
}

// ==================== 删除消息 ====================

/**
 * 删除到指定消息请求数据
 */
export interface DeleteToMessageRequestData {
    /** 对话 ID */
    conversationId: string;
    
    /** 目标消息索引（删除到这个索引为止，包括该消息） */
    targetIndex: number;
}

/**
 * 删除消息成功响应数据
 */
export interface DeleteToMessageSuccessData {
    success: true;
    /** 删除的消息数量 */
    deletedCount: number;
}

/**
 * 删除消息错误响应数据
 */
export interface DeleteToMessageErrorData {
    success: false;
    error: {
        /** 错误代码 */
        code: string;
        /** 错误消息 */
        message: string;
    };
}

// ==================== 工具确认 ====================

/**
 * 待确认的工具调用信息
 */
export interface PendingToolCall {
    /** 工具调用 ID */
    id: string;
    
    /** 工具名称 */
    name: string;
    
    /** 工具参数 */
    args: Record<string, unknown>;
}

/**
 * 工具确认请求数据（后端发送到前端）
 */
export interface ChatStreamToolConfirmationData {
    /** 对话 ID */
    conversationId: string;
    
    /** 等待确认的工具调用列表 */
    pendingToolCalls: PendingToolCall[];
    
    /** 当前迭代的 AI 回复（包含工具调用） */
    content: Content;
    
    /** 标记需要用户确认 */
    awaitingConfirmation: true;
}

/**
 * 工具开始执行数据（用于在工具执行前先发送计时信息）
 *
 * 这样前端可以在工具执行期间就显示 AI 响应的计时信息（思考时间、响应时间等）
 */
export interface ChatStreamToolsExecutingData {
    /** 对话 ID */
    conversationId: string;
    
    /** 即将执行的工具调用列表 */
    pendingToolCalls: PendingToolCall[];
    
    /** 当前迭代的 AI 回复（包含工具调用和计时信息） */
    content: Content;
    
    /** 标记工具即将开始执行 */
    toolsExecuting: true;
}

/**
 * 工具确认响应请求数据（前端发送到后端）
 */
export interface ToolConfirmationResponseData {
    /** 对话 ID */
    conversationId: string;
    
    /** 配置 ID */
    configId: string;
    
    /** 确认或拒绝的工具调用 */
    toolResponses: Array<{
        /** 工具调用 ID */
        id: string;

        /** 工具名称 */
        name: string;

        /** 是否确认执行 */
        confirmed: boolean;
    }>;

    /** 用户批注（可选，会作为用户消息发送给 AI） */
    annotation?: string;

    /** 取消信号 */
    abortSignal?: AbortSignal;
}

// ==================== 上下文总结 ====================

/**
 * 总结上下文请求数据
 */
export interface SummarizeContextRequestData {
    /** 对话 ID */
    conversationId: string;
    
    /** 配置 ID */
    configId: string;
    
    /** 保留最近 N 轮不参与总结（默认 2） */
    keepRecentRounds?: number;
    
    /** 自定义总结提示词（可选） */
    summarizePrompt?: string;
    
    /** 取消信号 */
    abortSignal?: AbortSignal;
}

/**
 * 总结上下文成功响应数据
 */
export interface SummarizeContextSuccessData {
    success: true;
    /** 总结后的消息内容 */
    summaryContent: Content;
    /** 被总结的消息数量 */
    summarizedMessageCount: number;
    /** 总结前的上下文 token 数（promptTokenCount） */
    beforeTokenCount?: number;
    /** 总结后的内容 token 数（candidatesTokenCount） */
    afterTokenCount?: number;
}

/**
 * 总结上下文错误响应数据
 */
export interface SummarizeContextErrorData {
    success: false;
    error: {
        /** 错误代码 */
        code: string;
        /** 错误消息 */
        message: string;
    };
}