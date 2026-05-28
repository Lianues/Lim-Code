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
    /** 是否需要触发自动总结（仅当 autoSummarizeEnabled 开启且 token 超过阈值时为 true） */
    needsAutoSummarize?: boolean;
    /**
     * 修改原因：上下文管理此前只有 trimStartIndex，无法解释本轮到底是关闭、裁剪还是自动总结。
     * 修改方式：返回一个轻量决策记录，供日志和测试确认策略来源与动作；不改变既有调用方必填契约。
     * 修改目的：让“关闭时完整发送、开启时才裁剪/总结”的新机制可观测、可回归验证。
     */
    contextManagementDecision?: {
        enabled: boolean;
        mode: 'off' | 'trim' | 'summarize';
        source: 'explicit' | 'legacy';
        action: 'disabled' | 'not_needed' | 'saved_state_reused' | 'trim_applied' | 'auto_summarize_needed';
    };
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
    /**
     * 工具执行时使用的完整参数快照。
     *
     * 修改原因：流式提前执行会先发送 toolStatus，再等最终 content/toolIteration 落地；如果状态事件不带 args，前端只能依赖未必已解析完成的 partialArgs。
     * 修改方式：在通用 ToolExecutionResult 上保留 args，后续 createChatToolStatusUpdate 可把它透传给前端。
     * 修改目的：让执行中、成功、失败三类状态事件都能补齐工具卡片描述，不再为 SubAgent 或单个工具写特例。
     */
    args?: Record<string, unknown>;
    /** 执行结果 */
    result: Record<string, unknown>;
}
