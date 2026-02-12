/**
 * 流式请求管理器
 * 
 * 管理流式请求的取消控制器
 */

import type * as vscode from 'vscode';

/**
 * 流式请求管理器
 */
export class StreamAbortManager {
  private controllers: Map<string, AbortController> = new Map();
  /** 总结请求专用取消器（仅取消总结 API，不中断主对话流） */
  private summaryControllers: Map<string, AbortController> = new Map();

  /**
   * 创建并存储新的 AbortController
   */
  create(conversationId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(conversationId, controller);
    return controller;
  }

  /**
   * 获取指定对话的 AbortController
   */
  get(conversationId: string): AbortController | undefined {
    return this.controllers.get(conversationId);
  }

  /**
   * 取消指定对话的流式请求
   */
  cancel(conversationId: string): boolean {
    const controller = this.controllers.get(conversationId);
    const summaryController = this.summaryControllers.get(conversationId);
    let cancelled = false;

    if (controller) {
      controller.abort();
      this.controllers.delete(conversationId);
      cancelled = true;
    }

    // 取消主请求时，也一并取消总结请求
    if (summaryController) {
      summaryController.abort();
      this.summaryControllers.delete(conversationId);
      cancelled = true;
    }

    return cancelled;
  }

  /**
   * 删除指定对话的 AbortController
   */
  delete(conversationId: string): void {
    this.controllers.delete(conversationId);
  }

  /**
   * 创建并存储总结请求的 AbortController
   */
  createSummary(conversationId: string): AbortController {
    // 若存在旧的总结请求控制器，先中断再替换
    const existing = this.summaryControllers.get(conversationId);
    if (existing) {
      existing.abort();
    }
    const controller = new AbortController();
    this.summaryControllers.set(conversationId, controller);
    return controller;
  }

  /** 获取总结请求的 AbortController */
  getSummary(conversationId: string): AbortController | undefined {
    return this.summaryControllers.get(conversationId);
  }

  /** 取消总结请求（不影响主对话流） */
  cancelSummary(conversationId: string): boolean {
    const controller = this.summaryControllers.get(conversationId);
    if (!controller) return false;
    controller.abort();
    this.summaryControllers.delete(conversationId);
    return true;
  }

  /** 删除总结请求控制器 */
  deleteSummary(conversationId: string): void {
    this.summaryControllers.delete(conversationId);
  }

  /**
   * 取消所有活跃的流式请求
   */
  cancelAll(view?: vscode.WebviewView): void {
    for (const [conversationId, controller] of this.controllers) {
      controller.abort();
      try {
        view?.webview.postMessage({
          type: 'streamChunk',
          data: {
            conversationId,
            type: 'cancelled'
          }
        });
      } catch {
        // 忽略发送失败
      }
    }
    this.controllers.clear();

    for (const [, controller] of this.summaryControllers) {
      controller.abort();
    }
    this.summaryControllers.clear();
  }

  /**
   * 获取活跃的流式请求数量
   */
  get size(): number {
    return this.controllers.size;
  }
}
