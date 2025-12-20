/**
 * LimCode - 检查点模块
 *
 * 提供工作区备份和恢复功能
 *
 * 增量备份策略：
 * - 第一个检查点：完整备份所有文件
 * - 后续检查点：始终使用增量备份，只存储与上一个检查点相比有变化的文件
 * - 无变化时：创建空的增量备份（不复制任何文件，只记录文件哈希）
 * - 恢复时：从增量链中查找每个文件的最新版本
 */

export { CheckpointManager } from './CheckpointManager';
export type { CheckpointRecord, FileChange } from './CheckpointManager';