import { deleteRunMessage, retryRunFromMessage } from '../../../webview/handlers/SubAgentsHandlers';
import { subAgentRunEventBus } from '../../tools/subagents/runEventBus';
import type { Content } from '../../modules/conversation/types';
import { getRuntimeLedgerContentWindow } from '../../../frontend/src/components/subagents/monitorRuntimeLedgerProjection';

function createUser(index: number, text: string): Content {
  return { role: 'user', index, parts: [{ text }], timestamp: 1000 + index } as Content;
}

function createModelWithTool(index: number, id: string): Content {
  return {
    role: 'model',
    index,
    parts: [{ functionCall: { id, name: 'read_file', args: { path: 'README.md' } } }],
    timestamp: 1000 + index
  } as Content;
}

function createFunctionResponse(index: number, id: string): Content {
  return {
    role: 'user',
    index,
    isFunctionResponse: true,
    parts: [{ functionResponse: { id, name: 'read_file', response: { success: true } } }],
    timestamp: 1000 + index
  } as Content;
}

describe('SubAgent Monitor message mutations use true contentIndex', () => {
  const runIds: string[] = [];

  afterEach(() => {
    const snapshots = (subAgentRunEventBus as any).snapshots as Map<string, unknown> | undefined;
    const stores = (subAgentRunEventBus as any).stores as Map<string, unknown> | undefined;
    for (const runId of runIds.splice(0)) {
      snapshots?.delete(runId);
      stores?.delete(runId);
    }
  });

  function createRun(runId: string, contents: Content[]) {
    runIds.push(runId);
    subAgentRunEventBus.createRun(runId, 'Index Agent', undefined, { initialContents: contents });
  }

  function createCtx() {
    return {
      conversationManager: {} as any,
      sendResponse: jest.fn(),
      sendError: jest.fn()
    } as any;
  }

  it('deleteRunMessage deletes the target content and paired functionResponse, not adjacent visible messages', async () => {
    createRun('mutation-run-delete', [
      createUser(0, '保留 0'),
      createModelWithTool(1, 'call-1'),
      createFunctionResponse(2, 'call-1'),
      createUser(3, '保留 3')
    ]);
    const ctx = createCtx();

    // 修改原因：窗口渲染时隐藏 functionResponse，可见楼层序号会错位；前端必须传真实 contentIndex=1。
    // 修改方式：handler 直接把 contentIndex 交给 TranscriptMutation，不做可见 offset 推断。
    // 修改目的：删除工具调用消息时不误删相邻 user 消息，并同步删除配对 functionResponse。
    await deleteRunMessage({ runId: 'mutation-run-delete', contentIndex: 1 }, 'delete-1', ctx);

    expect(ctx.sendError).not.toHaveBeenCalled();
    const response = ctx.sendResponse.mock.calls[0][1];
    // 修改原因：mutation handler 不应再返回完整 snapshot 或 source window，否则用户操作大 run 时仍会全量传输 contents。
    // 修改方式：测试锁定响应只包含 manifest + Runtime Ledger window projection，且语义仍体现配对 functionResponse 已删除。
    // 修改目的：保护 Runtime Ledger projection 设计不被删除/重试路径绕开。
    expect(response.snapshot).toBeUndefined();
    expect(response.window).toBeUndefined();
    expect(response.manifest).toMatchObject({ runId: 'mutation-run-delete', contentCount: 2 });
    const ledgerWindow = getRuntimeLedgerContentWindow(response.runtimeLedger, 'mutation-run-delete');
    expect(ledgerWindow?.contents.map((content: Content) => content.parts[0].text || content.parts[0].functionCall?.id || content.parts[0].functionResponse?.id)).toEqual([
      '保留 0',
      '保留 3'
    ]);
    expect(ledgerWindow?.contents.map((content: Content) => content.index)).toEqual([0, 1]);
  });

  it('retryRunFromMessage truncates from the real contentIndex even when a tail window would start later', async () => {
    createRun('mutation-run-retry', [
      createUser(0, '保留 0'),
      createUser(1, '保留 1'),
      createUser(2, '重试起点'),
      createUser(3, '应删除 3'),
      createUser(4, '应删除 4')
    ]);
    const ctx = createCtx();

    await retryRunFromMessage({ runId: 'mutation-run-retry', contentIndex: 2 }, 'retry-1', ctx);

    expect(ctx.sendError).not.toHaveBeenCalled();
    const response = ctx.sendResponse.mock.calls[0][1];
    // 修改原因：重试截断后也必须返回 Runtime Ledger 窗口投影，不能把完整子 transcript 作为 snapshot/source window 回传。
    // 修改方式：断言 snapshot/window 缺席，并从 Runtime Ledger contentWindow 校验真实 contentIndex 截断语义。
    // 修改目的：确保 retryRunFromMessage 和 deleteRunMessage 遵守同一轻量响应协议。
    expect(response.snapshot).toBeUndefined();
    expect(response.window).toBeUndefined();
    expect(response.manifest).toMatchObject({ runId: 'mutation-run-retry', contentCount: 2 });
    const ledgerWindow = getRuntimeLedgerContentWindow(response.runtimeLedger, 'mutation-run-retry');
    expect(ledgerWindow?.contents.map((content: Content) => content.parts[0].text)).toEqual(['保留 0', '保留 1']);
    expect(ledgerWindow?.contents.map((content: Content) => content.index)).toEqual([0, 1]);
  });
});
