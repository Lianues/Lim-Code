/**
 * LimCode - Chat 模块工具函数
 *
 * 提供 ChatHandler 及其服务类使用的通用工具函数和接口定义
 */

import type { Content } from '../../conversation/types';

/**
 * 对话回合信息
 *
 * 一个回合从非函数响应的用户消息开始，到下一个非函数响应的用户消息之前结束
 */
export interface ConversationRound {
    /** 回合起始消息索引 */
    startIndex: number;
    /** 回合结束消息索引（不包含） */
    endIndex: number;
    /** 该回合内助手消息的累计 token 数（取最后一个有 totalTokenCount 的助手消息） */
    tokenCount?: number;
}

/**
 * 上下文裁剪信息
 */
export interface ContextTrimInfo {
    /** 裁剪后的历史（用于发送给 API） */
    history: Content[];
    /** 裁剪起始索引（在完整历史中的索引，0 表示没有裁剪） */
    trimStartIndex: number;
}

/**
 * 生成唯一的工具调用 ID
 *
 * 格式: fc_{timestamp}_{random}
 * 例如: fc_1704628800000_a1b2c3d
 *
 * @returns 唯一的工具调用 ID
 */
export function generateToolCallId(): string {
    return `fc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 函数调用信息
 */
export interface FunctionCallInfo {
    /** 函数名称 */
    name: string;
    /** 函数参数 */
    args: Record<string, unknown>;
    /** 调用 ID */
    id: string;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
    /** 工具调用 ID */
    id: string;
    /** 工具名称 */
    name: string;
    /** 执行结果 */
    result: Record<string, unknown>;
}
