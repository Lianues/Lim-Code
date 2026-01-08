/**
 * LimCode - 检查点服务
 *
 * 封装与 CheckpointManager / SettingsManager 相关的通用检查点逻辑，
 * 统一管理：
 * - 用户消息前/后的检查点
 * - 模型消息前/后的检查点
 * - 工具执行前/后的检查点
 * - 按索引删除检查点
 */

import type { CheckpointManager, CheckpointRecord } from '../../../checkpoint';
import type { SettingsManager } from '../../../settings/SettingsManager';
import type { ConversationManager } from '../../../conversation/ConversationManager';

export class CheckpointService {
    private checkpointManager?: CheckpointManager;
    private settingsManager?: SettingsManager;

    constructor(
        private conversationManager: ConversationManager,
        checkpointManager?: CheckpointManager,
        settingsManager?: SettingsManager
    ) {
        this.checkpointManager = checkpointManager;
        this.settingsManager = settingsManager;
    }

    /**
     * 设置检查点管理器
     */
    setCheckpointManager(checkpointManager: CheckpointManager): void {
        this.checkpointManager = checkpointManager;
    }

    /**
     * 设置设置管理器
     */
    setSettingsManager(settingsManager: SettingsManager): void {
        this.settingsManager = settingsManager;
    }

    /**
     * 为用户消息创建检查点
     *
     * @param conversationId 对话 ID
     * @param position       位置：'before' | 'after'
     * @param messageIndex   可选，指定消息索引（编辑场景）；
     *                       未指定时：
     *                       - before: 使用当前历史长度
     *                       - after:  使用最后一条消息索引
     */
    async createUserMessageCheckpoint(
        conversationId: string,
        position: 'before' | 'after',
        messageIndex?: number
    ): Promise<CheckpointRecord | null> {
        if (!this.checkpointManager || !this.settingsManager) {
            return null;
        }

        if (position === 'before') {
            if (!this.settingsManager.shouldCreateBeforeUserMessageCheckpoint()) {
                return null;
            }

            let index = messageIndex;
            if (index === undefined) {
                const history = await this.conversationManager.getHistoryRef(conversationId);
                index = history.length; // 新用户消息将插入的位置
            }

            return await this.checkpointManager.createCheckpoint(
                conversationId,
                index,
                'user_message',
                'before'
            );
        }

        // position === 'after'
        if (!this.settingsManager.shouldCreateAfterUserMessageCheckpoint()) {
            return null;
        }

        let index = messageIndex;
        if (index === undefined) {
            const history = await this.conversationManager.getHistoryRef(conversationId);
            if (history.length === 0) {
                return null;
            }
            index = history.length - 1; // 刚刚添加的用户消息
        }

        return await this.checkpointManager.createCheckpoint(
            conversationId,
            index,
            'user_message',
            'after'
        );
    }

    /**
     * 为模型消息创建检查点
     *
     * @param conversationId 对话 ID
     * @param position       位置：'before' | 'after'
     * @param iteration      当前迭代次数，仅在 position === 'before' 时使用
     */
    async createModelMessageCheckpoint(
        conversationId: string,
        position: 'before' | 'after',
        iteration?: number
    ): Promise<CheckpointRecord | null> {
        if (!this.checkpointManager || !this.settingsManager) {
            return null;
        }

        if (position === 'before') {
            if (!this.settingsManager.shouldCreateBeforeModelMessageCheckpoint()) {
                return null;
            }

            // 根据 modelOuterLayerOnly 设置决定是否在每次迭代都创建
            const outerLayerOnly = this.settingsManager.isModelOuterLayerOnly();
            if (outerLayerOnly && iteration !== 1) {
                // 仅在最外层模式下、第一次迭代创建
                return null;
            }

            const history = await this.conversationManager.getHistoryRef(conversationId);
            const index = history.length; // 模型消息将要插入的位置

            return await this.checkpointManager.createCheckpoint(
                conversationId,
                index,
                'model_message',
                'before'
            );
        }

        // position === 'after'
        if (!this.settingsManager.shouldCreateAfterModelMessageCheckpoint()) {
            return null;
        }

        const history = await this.conversationManager.getHistoryRef(conversationId);
        if (history.length === 0) {
            return null;
        }
        const index = history.length - 1; // 刚刚添加的模型消息

        return await this.checkpointManager.createCheckpoint(
            conversationId,
            index,
            'model_message',
            'after'
        );
    }

    /**
     * 为工具执行创建检查点
     *
     * 这里不额外做开关判断，直接委托给 CheckpointManager，由其根据配置决定是否实际创建。
     */
    async createToolExecutionCheckpoint(
        conversationId: string,
        messageIndex: number,
        toolName: string,
        phase: 'before' | 'after'
    ): Promise<CheckpointRecord | null> {
        if (!this.checkpointManager) {
            return null;
        }
        return await this.checkpointManager.createCheckpoint(
            conversationId,
            messageIndex,
            toolName,
            phase
        );
    }

    /**
     * 删除指定索引及之后的所有检查点
     */
    async deleteCheckpointsFromIndex(
        conversationId: string,
        startIndex: number
    ): Promise<void> {
        if (!this.checkpointManager) {
            return;
        }
        await this.checkpointManager.deleteCheckpointsFromIndex(conversationId, startIndex);
    }
}
