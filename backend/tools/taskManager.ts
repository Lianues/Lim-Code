/**
 * 工具任务管理模块
 *
 * 提供统一的任务生命周期管理，用于：
 * - 追踪活跃的工具任务（如终端命令、图像生成等）
 * - 支持任务取消
 * - 事件通知
 *
 * 使用方式：
 * 1. 工具开始执行时调用 registerTask() 注册任务
 * 2. 任务完成或取消时调用 unregisterTask() 注销任务
 * 3. 外部可以通过 cancelTask() 取消任务
 * 4. 通过 onTaskEvent() 订阅任务事件
 */

import { EventEmitter } from 'events';
import { t } from '../i18n';

/**
 * 任务类型
 */
export type TaskType = 'terminal' | 'image_generation' | string;

/**
 * 任务状态
 */
export type TaskStatus = 'running' | 'completed' | 'cancelled' | 'error';

/**
 * 任务信息
 */
export interface TaskInfo {
    /** 任务 ID（唯一标识） */
    id: string;
    /** 任务类型 */
    type: TaskType;
    /** 任务开始时间 */
    startTime: number;
    /** 取消控制器 */
    abortController: AbortController;
    /** 任务元数据（如命令、提示词等） */
    metadata?: Record<string, unknown>;
}

/**
 * 任务事件类型
 */
export type TaskEventType = 'start' | 'progress' | 'complete' | 'cancelled' | 'error';

/**
 * 任务事件
 */
export interface TaskEvent {
    /** 事件创建时间戳 */
    createdAt?: number;
    /** 任务 ID */
    taskId: string;
    /** 任务类型 */
    taskType: TaskType;
    /** 事件类型 */
    type: TaskEventType;
    /** 事件数据 */
    data?: Record<string, unknown>;
    /** 错误信息 */
    error?: string;
}

/**
 * 取消结果
 */
export interface CancelResult {
    success: boolean;
    error?: string;
}

/**
 * 工具任务管理器
 *
 * 单例模式，提供全局任务管理
 */
class TaskManagerClass {
    /** 活跃任务 Map */
    private activeTasks: Map<string, TaskInfo> = new Map();
    
    /** 事件发射器 */
    private eventEmitter: EventEmitter = new EventEmitter();
    
    /**
     * 生成唯一任务 ID
     */
    generateTaskId(prefix: string = 'task'): string {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * 注册任务
     *
     * @param id 任务 ID
     * @param type 任务类型
     * @param abortController 取消控制器
     * @param metadata 任务元数据
     */
    registerTask(
        id: string,
        type: TaskType,
        abortController: AbortController,
        metadata?: Record<string, unknown>
    ): void {
        const taskInfo: TaskInfo = {
            id,
            type,
            startTime: Date.now(),
            abortController,
            metadata
        };
        
        this.activeTasks.set(id, taskInfo);
        
        // 发送开始事件
        this.emitEvent({
            taskId: id,
            taskType: type,
            type: 'start',
            data: metadata
        });
    }
    
    /**
     * 注销任务
     *
     * @param id 任务 ID
     * @param status 最终状态
     * @param data 结束数据
     */
    unregisterTask(
        id: string,
        status: 'completed' | 'cancelled' | 'error' = 'completed',
        data?: Record<string, unknown>
    ): void {
        const task = this.activeTasks.get(id);
        if (!task) return;
        
        this.activeTasks.delete(id);
        
        // 发送结束事件
        const eventType: TaskEventType = status === 'completed' ? 'complete' 
            : status === 'cancelled' ? 'cancelled' 
            : 'error';
        
        this.emitEvent({
            taskId: id,
            taskType: task.type,
            type: eventType,
            data
        });
    }
    
    /**
     * 取消任务
     *
     * @param id 任务 ID
     * @returns 取消结果
     */
    cancelTask(id: string): CancelResult {
        const task = this.activeTasks.get(id);
        
        if (!task) {
            return {
                success: false,
                error: t('tools.common.taskNotFound', { id })
            };
        }
        
        try {
            // 触发取消
            task.abortController.abort();
            
            // 从活跃任务中移除
            this.activeTasks.delete(id);
            
            // 发送取消事件
            this.emitEvent({
                taskId: id,
                taskType: task.type,
                type: 'cancelled'
            });
            
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: t('tools.common.cancelTaskFailed', { error: error instanceof Error ? error.message : String(error) })
            };
        }
    }
    
    /**
     * 取消指定类型的所有任务
     *
     * @param type 任务类型
     * @returns 取消的任务数量
     */
    cancelTasksByType(type: TaskType): number {
        let count = 0;
        for (const [id, task] of this.activeTasks) {
            if (task.type === type) {
                this.cancelTask(id);
                count++;
            }
        }
        return count;
    }
    
    /**
     * 取消所有任务
     *
     * @returns 取消的任务数量
     */
    cancelAllTasks(): number {
        const count = this.activeTasks.size;
        for (const id of [...this.activeTasks.keys()]) {
            this.cancelTask(id);
        }
        return count;
    }
    
    /**
     * 获取任务信息
     *
     * @param id 任务 ID
     * @returns 任务信息，不存在则返回 undefined
     */
    getTask(id: string): TaskInfo | undefined {
        return this.activeTasks.get(id);
    }
    
    /**
     * 检查任务是否存在
     *
     * @param id 任务 ID
     * @returns 是否存在
     */
    hasTask(id: string): boolean {
        return this.activeTasks.has(id);
    }
    
    /**
     * 获取指定类型的所有活跃任务
     *
     * @param type 任务类型
     * @returns 任务列表
     */
    getTasksByType(type: TaskType): TaskInfo[] {
        const tasks: TaskInfo[] = [];
        for (const task of this.activeTasks.values()) {
            if (task.type === type) {
                tasks.push(task);
            }
        }
        return tasks;
    }
    
    /**
     * 获取所有活跃任务
     *
     * @returns 任务列表
     */
    getAllTasks(): TaskInfo[] {
        return [...this.activeTasks.values()];
    }
    
    /**
     * 获取活跃任务数量
     *
     * @param type 可选的任务类型过滤
     * @returns 任务数量
     */
    getTaskCount(type?: TaskType): number {
        if (!type) {
            return this.activeTasks.size;
        }
        let count = 0;
        for (const task of this.activeTasks.values()) {
            if (task.type === type) {
                count++;
            }
        }
        return count;
    }
    
    /**
     * 发送任务事件
     */
    emitEvent(event: TaskEvent): void {
        const normalizedEvent: TaskEvent = {
            ...event,
            createdAt: typeof event.createdAt === 'number' && Number.isFinite(event.createdAt) ? event.createdAt : Date.now()
        };

        this.eventEmitter.emit('taskEvent', normalizedEvent);
        // 也发送特定类型的事件
        this.eventEmitter.emit(`taskEvent:${normalizedEvent.taskType}`, normalizedEvent);
    }
    
    /**
     * 发送进度事件
     *
     * @param id 任务 ID
     * @param data 进度数据
     */
    emitProgress(id: string, data: Record<string, unknown>): void {
        const task = this.activeTasks.get(id);
        if (!task) return;
        
        this.emitEvent({
            taskId: id,
            taskType: task.type,
            type: 'progress',
            data
        });
    }
    
    /**
     * 订阅所有任务事件
     *
     * @param listener 监听器
     * @returns 取消订阅函数
     */
    onTaskEvent(listener: (event: TaskEvent) => void): () => void {
        this.eventEmitter.on('taskEvent', listener);
        return () => this.eventEmitter.off('taskEvent', listener);
    }
    
    /**
     * 订阅特定类型的任务事件
     *
     * @param type 任务类型
     * @param listener 监听器
     * @returns 取消订阅函数
     */
    onTaskEventByType(type: TaskType, listener: (event: TaskEvent) => void): () => void {
        const eventName = `taskEvent:${type}`;
        this.eventEmitter.on(eventName, listener);
        return () => this.eventEmitter.off(eventName, listener);
    }
    
    /**
     * 清理已完成的任务（通常不需要，因为 unregisterTask 会自动清理）
     * 这个方法主要用于清理可能因异常而未正常清理的任务
     */
    cleanup(): void {
        // 当前实现中，任务在完成时会自动清理
        // 这个方法保留以备将来扩展
    }
}

/**
 * 全局任务管理器实例
 */
export const TaskManager = new TaskManagerClass();

/**
 * 导出类型和函数
 */
export {
    TaskManagerClass
};