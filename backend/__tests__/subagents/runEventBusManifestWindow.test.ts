import { subAgentRunEventBus } from '../../tools/subagents/runEventBus';
import type { Content } from '../../modules/conversation/types';

function createContent(index: number, text: string, role: 'user' | 'model' = 'model'): Content {
  return {
    role,
    index,
    parts: [{ text }],
    timestamp: 1000 + index
  } as Content;
}

describe('SubAgentRunEventBus manifest/window accessors', () => {
  const runIds: string[] = [];

  function createRun(runId: string, contents: Content[]) {
    runIds.push(runId);
    subAgentRunEventBus.createRun(runId, 'Agent ' + runId, undefined, {
      conversationId: 'conversation-' + runId,
      initialContents: contents
    });
  }

  afterEach(() => {
    // 修改原因：subAgentRunEventBus 是进程级单例，测试创建的 run 会污染后续用例。
    // 修改方式：用公开 replaceContents 清空内容，再直接删除测试 run 的内部 Map 条目。
    // 修改目的：不新增生产清理 API，也保证定向测试之间互不影响。
    const snapshots = (subAgentRunEventBus as any).snapshots as Map<string, unknown> | undefined;
    const stores = (subAgentRunEventBus as any).stores as Map<string, unknown> | undefined;
    for (const runId of runIds.splice(0)) {
      snapshots?.delete(runId);
      stores?.delete(runId);
    }
  });

  it('getManifests omits contents and exposes preview/contentCount derived from the snapshot', () => {
    createRun('manifest-run-1', [
      createContent(0, '用户问题', 'user'),
      createContent(1, '这是一个很长的模型回答，用于生成 manifest preview')
    ]);

    const manifest = subAgentRunEventBus.getManifests().find(item => item.runId === 'manifest-run-1') as any;

    expect(manifest).toMatchObject({
      runId: 'manifest-run-1',
      agentName: 'Agent manifest-run-1',
      status: 'running',
      conversationId: 'conversation-manifest-run-1',
      contentCount: 2,
      preview: '这是一个很长的模型回答，用于生成 manifest preview',
      lastMessageRole: 'model'
    });
    expect(Object.prototype.hasOwnProperty.call(manifest, 'contents')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(manifest, 'events')).toBe(false);
  });

  it('getContentWindow returns a tail window with indexes and hasMoreBefore metadata', () => {
    createRun('window-run-1', Array.from({ length: 5 }, (_, index) => createContent(index, `消息 ${index}`)));

    const contentWindow = subAgentRunEventBus.getContentWindow('window-run-1', { limit: 2, fromTail: true });

    expect(contentWindow).toEqual({
      runId: 'window-run-1',
      contents: [createContent(3, '消息 3'), createContent(4, '消息 4')],
      startIndex: 3,
      endIndex: 5,
      totalCount: 5,
      hasMoreBefore: true,
      hasMoreAfter: false
    });
  });

  it('getContentWindow uses endIndex as an exclusive anchor when loading older messages', () => {
    createRun('window-run-older', Array.from({ length: 6 }, (_, index) => createContent(index, `消息 ${index}`)));

    const contentWindow = subAgentRunEventBus.getContentWindow('window-run-older', { limit: 2, endIndex: 4 });

    // 修改原因：前端加载更早消息只知道当前 window.startIndex，需要后端从该 endIndex 往前取一页。
    // 修改方式：测试锁定 endIndex-only 请求返回 [endIndex-limit, endIndex) 半开区间。
    // 修改目的：避免回归到从 0 开始取 limit，导致 prepend 后历史顺序和 hasMoreBefore 错误。
    expect(contentWindow).toEqual({
      runId: 'window-run-older',
      contents: [createContent(2, '消息 2'), createContent(3, '消息 3')],
      startIndex: 2,
      endIndex: 4,
      totalCount: 6,
      hasMoreBefore: true,
      hasMoreAfter: true
    });
  });
});
