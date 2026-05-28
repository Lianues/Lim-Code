/**
 * RunController 兼容重导出 shim。
 *
 * 修改原因：WP21 共享契约已迁移到 backend/core/RunController.ts，避免 backend 反向依赖 webview。
 * 修改方式：保留旧路径作为纯 type re-export。
 * 修改目的：沿用项目既有的重导出兼容风格（如 WP13 pathUtils），避免并行分支或旧引用立即失效。
 */

export type {
  ConversationRunScope,
  SubAgentRunScope,
  RunScope,
  RunControllerStatus,
  RunControllerCapabilities,
  RunControllerSnapshot,
  IRunController,
} from '../../backend/core/RunController';
