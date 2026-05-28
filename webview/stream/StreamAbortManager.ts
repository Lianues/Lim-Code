/**
 * 流式请求管理器
 * 
 * 管理流式请求的取消控制器
 */

import type * as vscode from 'vscode';
import type { ConversationRunScope, IRunController, RunControllerSnapshot } from '../../backend/core/RunController';

/**
 * 流式请求管理器
 *
 * 修改原因：WP21 需要把 conversation run 的最小控制能力提升为共享契约，供后续 RunController / TurnSession 演进复用。
 * 修改方式：保持现有 create/get/cancel/delete 等方法不变，只额外声明实现 IRunController 并提供轻量只读适配方法。
 * 修改目的：统一主聊天与 SubAgent 控制器的类型语言，同时不改变任何 cancel / retry / edit / delete 相关用户语义。
 */
export class StreamAbortManager implements IRunController<ConversationRunScope> {
  readonly scopeType = 'conversation' as const;
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
   * 获取当前仍有活跃主流请求的对话 ID 列表
   */
  listConversationIds(): string[] {
    return Array.from(this.controllers.keys());
  }

  /**
   * 修改原因：WP21 共享接口需要显式暴露 controller 所属 scope 类型。
   * 修改方式：返回固定的 conversation 字面量，不引入任何运行时分支。
   * 修改目的：让上层共享代码可直接根据接口识别“这是 conversation scope controller”。
   */
  getScopeType(): 'conversation' {
    return this.scopeType;
  }

  /**
   * 修改原因：统一接口不能继续把 conversationId 当成匿名字符串四处传递。
   * 修改方式：把现有 conversationId 包装为显式 RunScope 数据。
   * 修改目的：后续共享运行时可以在不写 source/view 特判的情况下识别作用域。
   */
  getScope(conversationId: string): ConversationRunScope {
    return {
      type: 'conversation',
      conversationId
    };
  }

  /**
   * 修改原因：IRunController 需要统一的活跃 ID 读取入口。
   * 修改方式：复用既有 listConversationIds 结果，不改变“只统计主流请求”的现有语义。
   * 修改目的：共享调用方不必知道 conversation controller 的历史命名。
   */
  listActiveIds(): string[] {
    return this.listConversationIds();
  }

  /**
   * 修改原因：共享抽象需要判断某个 conversation scope 当前是否仍处于活跃运行态。
   * 修改方式：复用既有 controllers Map，而不是引入新的状态源。
   * 修改目的：保证适配层只读观察现有状态，不改变取消时机或控制流。
   */
  isActive(conversationId: string): boolean {
    return this.controllers.has(conversationId);
  }

  /**
   * 修改原因：统一接口要求用同一方法读取运行时 AbortSignal。
   * 修改方式：直接委托给既有 get()。
   * 修改目的：后续共享运行时可以透过接口拿到 signal，而不依赖具体 controller 名称。
   */
  getAbortSignal(conversationId: string): AbortSignal | undefined {
    return this.get(conversationId)?.signal;
  }

  /**
   * 修改原因：WP21 需要一个最小只读快照来描述 conversation run 的活跃状态。
   * 修改方式：仅当主流请求存在时返回 running 快照；summary controller 仍是内部细节，不额外提升为独立 run。
   * 修改目的：给共享契约提供稳定读取面，同时保持当前“主请求取消时顺带取消总结”的既有语义。
   */
  getSnapshot(conversationId: string): RunControllerSnapshot<ConversationRunScope> | undefined {
    const controller = this.get(conversationId);
    if (!controller) {
      return undefined;
    }

    return {
      scope: this.getScope(conversationId),
      active: true,
      status: 'running',
      abortSignal: controller.signal,
      capabilities: {
        pause: false,
        resume: false,
        exit: false
      }
    };
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
            createdAt: Date.now(),
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
