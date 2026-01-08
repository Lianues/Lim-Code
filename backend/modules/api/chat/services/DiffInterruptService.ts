/**
 * LimCode - Diff 中断管理服务
 *
 * 对 getDiffManager().markUserInterrupt/resetUserInterrupt 做一层封装，
 * 让 ChatHandler 只依赖此服务，而不直接依赖底层工具模块。
 */

import { getDiffManager } from '../../../../tools/file/diffManager';

export class DiffInterruptService {
  /** 标记用户发起了新请求，中断之前的 diff 等待 */
  markUserInterrupt(): void {
    const diffManager = getDiffManager();
    diffManager.markUserInterrupt();
  }

  /** 重置中断标记，表示当前请求流程结束或进入下一阶段 */
  resetUserInterrupt(): void {
    const diffManager = getDiffManager();
    diffManager.resetUserInterrupt();
  }
}
