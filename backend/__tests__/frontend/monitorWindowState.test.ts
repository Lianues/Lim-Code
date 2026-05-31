import {
  capRunContentWindow,
  createLatestRunWindowRequestOptions,
  createPreviousRunWindowRequestOptions,
  createRefreshRunWindowRequestOptions,
  createTailRunWindowRequestOptions,
  isRunWindowTailAuthoritative,
  prependRunContentWindow,
  shouldApplyRunContentWindow
} from '../../../frontend/src/components/subagents/monitorWindowState';
import type { Content } from '../../../frontend/src/types';

function createContent(index: number, text: string): Content {
  return {
    role: 'model',
    index,
    parts: [{ text }],
    timestamp: 1000 + index
  } as Content;
}

describe('SubAgent Monitor window state helpers', () => {
  it('creates an older-window request using current startIndex as endIndex', () => {
    const current = {
      runId: 'window-state-request',
      contents: [createContent(20, '尾部')],
      startIndex: 20,
      endIndex: 40,
      totalCount: 40,
      hasMoreBefore: true,
      hasMoreAfter: false
    };

    // 修改原因：UI 加载更早必须请求当前窗口之前的一页，协议字段是 endIndex 而不是 startIndex。
    // 修改方式：纯函数返回 { limit, endIndex: current.startIndex }，组件直接使用该对象调用 getRunWindow。
    // 修改目的：防止 UI 后续改动破坏分页锚点，导致 prepend 合并错位。
    expect(createPreviousRunWindowRequestOptions(current, 20)).toEqual({ limit: 20, endIndex: 20 });
  });

  it('creates an explicit tail request only for initial/importer window loads', () => {
    expect(createTailRunWindowRequestOptions(20)).toEqual({ limit: 20, fromTail: true });
  });

  it('creates an explicit latest request for capped historical windows', () => {
    const historical = {
      runId: 'window-state-latest',
      contents: Array.from({ length: 120 }, (_, index) => createContent(index, `history ${index}`)),
      startIndex: 0,
      endIndex: 120,
      totalCount: 200,
      hasMoreBefore: false,
      hasMoreAfter: true
    };

    const tail = capRunContentWindow({
      runId: historical.runId,
      contents: Array.from({ length: 140 }, (_, index) => createContent(60 + index, `tail ${60 + index}`)),
      startIndex: 60,
      endIndex: 200,
      totalCount: 200,
      hasMoreBefore: true,
      hasMoreAfter: false
    }, 120, 'tail');

    // 修改原因：历史窗口 cap 会设置 hasMoreAfter，刷新应保留历史阅读范围，但用户点击“跳到最新”必须显式回到 tail。
    // 修改方式：latest request 始终使用 fromTail，不携带 start/end range；tail 响应再用 tail anchor 裁剪。
    // 修改目的：防止 Monitor 在长历史里变成只能继续向前、不能回到最新输出的单向窗口。
    expect(historical.hasMoreAfter).toBe(true);
    expect(createLatestRunWindowRequestOptions(20)).toEqual({ limit: 20, fromTail: true });
    expect(tail).toMatchObject({
      startIndex: 80,
      endIndex: 200,
      hasMoreBefore: true,
      hasMoreAfter: false
    });
    expect(tail?.contents[0].index).toBe(80);
    expect(tail?.contents[119].index).toBe(199);
  });

  it('creates a refresh request that preserves the currently loaded range', () => {
    const current = {
      runId: 'window-state-refresh',
      contents: [createContent(10, 'older'), createContent(29, 'tail')],
      startIndex: 10,
      endIndex: 30,
      totalCount: 30,
      hasMoreBefore: true,
      hasMoreAfter: false
    };

    expect(createRefreshRunWindowRequestOptions(current, 20, { contentCount: 31 })).toEqual({
      startIndex: 10,
      endIndex: 31,
      limit: 21,
      fromTail: false
    });
  });

  it('prepends an older window before current startIndex and preserves existing tail object references', () => {
    const tail2 = createContent(2, '尾部 2');
    const tail3 = createContent(3, '尾部 3');
    const older0 = createContent(0, '更早 0');
    const older1 = createContent(1, '更早 1');

    const merged = prependRunContentWindow({
      runId: 'window-state-run',
      contents: [tail2, tail3],
      startIndex: 2,
      endIndex: 4,
      totalCount: 4,
      hasMoreBefore: true,
      hasMoreAfter: false
    }, {
      runId: 'window-state-run',
      contents: [older0, older1],
      startIndex: 0,
      endIndex: 2,
      totalCount: 4,
      hasMoreBefore: false,
      hasMoreAfter: true
    });

    // 修改原因：加载更早内容只应扩展窗口头部，不应替换用户已看到的尾部 Content 对象。
    // 修改方式：测试锁定 prepend 后 tail2/tail3 仍为同一引用，且 index 仍是后端真实索引。
    // 修改目的：防止后续把可见数组下标当 backendIndex 或无谓重渲染尾部大 Markdown。
    expect(merged?.contents).toEqual([older0, older1, tail2, tail3]);
    expect(merged?.contents[2]).toBe(tail2);
    expect(merged?.contents[3]).toBe(tail3);
    expect(merged).toMatchObject({
      runId: 'window-state-run',
      startIndex: 0,
      endIndex: 4,
      totalCount: 4,
      hasMoreBefore: false,
      hasMoreAfter: true
    });
    expect(merged?.contents.map(content => content.index)).toEqual([0, 1, 2, 3]);
  });

  it('drops overlapping older contents so repeated clicks do not duplicate visible messages', () => {
    const current1 = createContent(1, '当前 1');
    const current2 = createContent(2, '当前 2');
    const older0 = createContent(0, '更早 0');
    const overlapping1 = createContent(1, '重复 1');

    const merged = prependRunContentWindow({
      runId: 'window-state-run-overlap',
      contents: [current1, current2],
      startIndex: 1,
      endIndex: 3,
      totalCount: 3,
      hasMoreBefore: true,
      hasMoreAfter: false
    }, {
      runId: 'window-state-run-overlap',
      contents: [older0, overlapping1],
      startIndex: 0,
      endIndex: 2,
      totalCount: 3,
      hasMoreBefore: false,
      hasMoreAfter: true
    });

    // 修改原因：窗口请求在网络重试或边界变化时可能与当前窗口重叠，简单 concat 会导致重复楼层。
    // 修改方式：纯函数按真实 backendIndex 过滤 current.startIndex 之后的 older 内容。
    // 修改目的：保持 MessageItem key/backendIndex 唯一，删除/重试仍定位准确。
    expect(merged?.contents).toEqual([older0, current1, current2]);
    expect(merged?.contents[1]).toBe(current1);
  });

  it('caps repeated older windows while preserving the explicit historical range anchor', () => {
    const contents = Array.from({ length: 140 }, (_, index) => createContent(index, `content ${index}`));

    const capped = capRunContentWindow({
      runId: 'capped-history-run',
      contents,
      startIndex: 0,
      endIndex: 140,
      totalCount: 200,
      hasMoreBefore: false,
      hasMoreAfter: true
    }, 120, 'start');

    expect(capped?.contents).toHaveLength(120);
    expect(capped?.contents[0].index).toBe(0);
    expect(capped?.contents[119].index).toBe(119);
    expect(capped).toMatchObject({
      startIndex: 0,
      endIndex: 120,
      hasMoreAfter: true
    });
  });

  it('caps tail windows while preserving the live tail anchor', () => {
    const contents = Array.from({ length: 140 }, (_, index) => createContent(index, `content ${index}`));

    const capped = capRunContentWindow({
      runId: 'capped-tail-run',
      contents,
      startIndex: 0,
      endIndex: 140,
      totalCount: 140,
      hasMoreBefore: false,
      hasMoreAfter: false
    }, 120, 'tail');

    expect(capped?.contents).toHaveLength(120);
    expect(capped?.contents[0].index).toBe(20);
    expect(capped?.contents[119].index).toBe(139);
    expect(capped).toMatchObject({
      startIndex: 20,
      endIndex: 140,
      hasMoreBefore: true,
      hasMoreAfter: false
    });
  });

  it('rejects stale replacement windows by contentRevision and eventSequence', () => {
    const current = {
      runId: 'freshness-run',
      contents: [createContent(1, '新窗口')],
      startIndex: 1,
      endIndex: 2,
      totalCount: 2,
      contentRevision: 3,
      eventSequence: 8,
      hasMoreBefore: true,
      hasMoreAfter: false
    };
    const stale = {
      ...current,
      contents: [createContent(1, '旧窗口')],
      contentRevision: 2,
      eventSequence: 9
    };
    const sameRevisionOlderEvent = {
      ...current,
      contents: [createContent(1, '同 revision 旧事件')],
      contentRevision: 3,
      eventSequence: 7
    };
    const newer = {
      ...current,
      contents: [createContent(1, '更新窗口')],
      contentRevision: 4,
      eventSequence: 1
    };

    // 修改原因：getRunWindow 响应可能乱序返回，不能让旧 revision 或旧 sequence 覆盖最新窗口。
    // 修改方式：shouldApplyRunContentWindow 先比 contentRevision，再比 eventSequence。
    // 修改目的：锁定 stale response 防护，避免窗口回滚后继续接收错误 delta。
    expect(shouldApplyRunContentWindow(current, stale)).toBe(false);
    expect(shouldApplyRunContentWindow(current, sameRevisionOlderEvent)).toBe(false);
    expect(shouldApplyRunContentWindow(current, newer)).toBe(true);
  });

  it('only allows live delta on a fresh tail-authoritative window', () => {
    const tail = {
      runId: 'tail-run',
      contents: [createContent(1, '尾部')],
      startIndex: 1,
      endIndex: 2,
      totalCount: 2,
      contentRevision: 5,
      eventSequence: 10,
      hasMoreBefore: true,
      hasMoreAfter: false
    };

    // 修改原因：没有 content identity 的 live delta 只能应用到最新尾部窗口，否则会把新回复接到旧楼层。
    // 修改方式：isRunWindowTailAuthoritative 同时检查尾部覆盖、contentCount 和 contentRevision。
    // 修改目的：把“旧窗口只刷新不追加”固化为纯函数契约。
    expect(isRunWindowTailAuthoritative(tail, { contentCount: 2, contentRevision: 5 })).toBe(true);
    expect(isRunWindowTailAuthoritative({ ...tail, hasMoreAfter: true }, { contentCount: 2, contentRevision: 5 })).toBe(false);
    expect(isRunWindowTailAuthoritative(tail, { contentCount: 3, contentRevision: 5 })).toBe(false);
    expect(isRunWindowTailAuthoritative(tail, { contentCount: 2, contentRevision: 6 })).toBe(false);
  });
});
