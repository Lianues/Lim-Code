import {
  enqueueMonitorLiveDelta,
  getMonitorLiveDeltaRevision,
  selectReplayableMonitorLiveDeltas
} from '../../../frontend/src/components/subagents/monitorLiveDeltaBuffer';
import { applyStreamChunkToContents } from '../../../frontend/src/stores/agentRun/contentDelta';
import type { Content } from '../../../frontend/src/types';

function createUserContent(index: number, text: string): Content {
  return {
    role: 'user',
    index,
    parts: [{ text }],
    timestamp: 1000 + index
  } as Content;
}

describe('SubAgent Monitor live delta buffer', () => {
  it('keeps renderable llm_delta events ordered, deduplicated and bounded', () => {
    const nonRenderable = {
      runId: 'run-1',
      type: 'llm_delta',
      eventSequence: 1,
      contentRevision: 0,
      payload: { done: false, deltaCount: 0 }
    };
    const second = {
      runId: 'run-1',
      type: 'llm_delta',
      eventSequence: 2,
      contentRevision: 0,
      payload: { delta: [{ text: '二' }] }
    };
    const duplicateSecond = {
      ...second,
      payload: { delta: [{ text: '二-更新' }] }
    };
    const first = {
      runId: 'run-1',
      type: 'llm_delta',
      eventSequence: 1,
      contentRevision: 0,
      payload: { delta: [{ text: '一' }] }
    };

    let buffer = enqueueMonitorLiveDelta(undefined, nonRenderable);
    buffer = enqueueMonitorLiveDelta(buffer, second, 2);
    buffer = enqueueMonitorLiveDelta(buffer, first, 2);
    buffer = enqueueMonitorLiveDelta(buffer, duplicateSecond, 2);

    // 修改原因：Monitor 打开期间可能先收到较新的 delta，再收到较旧窗口响应；缓冲必须用 eventSequence 恢复顺序并去重。
    // 修改方式：测试锁定非正文 delta 不入队、重复 sequence 后到者覆盖、缓冲上限保持有界。
    // 修改目的：避免中途打开 Monitor 时实时文本缺字或同一工具参数片段重复渲染。
    expect(buffer.map(event => event.eventSequence)).toEqual([1, 2]);
    expect(buffer[1].payload.delta[0].text).toBe('二-更新');
  });

  it('replays only deltas matching the loaded window revision and drops superseded deltas', () => {
    const oldDelta = {
      runId: 'run-1',
      type: 'llm_delta',
      eventSequence: 1,
      contentRevision: 0,
      payload: { delta: [{ text: '旧' }] }
    };
    const currentDelta = {
      runId: 'run-1',
      type: 'llm_delta',
      eventSequence: 2,
      contentRevision: 1,
      payload: { delta: [{ text: '当前' }] }
    };
    const futureDelta = {
      runId: 'run-1',
      type: 'llm_delta',
      eventSequence: 3,
      contentRevision: 2,
      payload: { delta: [{ text: '未来' }] }
    };

    const result = selectReplayableMonitorLiveDeltas([oldDelta, currentDelta, futureDelta], { contentRevision: 1 });

    // 修改原因：contentRevision 是 live delta 能否应用到某个 transcript window 的结构边界。
    // 修改方式：低于窗口 revision 的 delta 丢弃，等于窗口 revision 的 delta 回放，高于窗口 revision 的 delta 继续等待新窗口。
    // 修改目的：流结束后的权威窗口不会被旧 delta 回滚，下一轮结构变化后的 delta 也不会接错楼层。
    expect(result.replayable).toEqual([currentDelta]);
    expect(result.remaining).toEqual([futureDelta]);
    expect(getMonitorLiveDeltaRevision(oldDelta)).toBe(0);
  });

  it('recovers text and functionCall deltas that arrived before the initial window', () => {
    const buffered = [
      {
        runId: 'run-1',
        type: 'llm_delta',
        eventSequence: 10,
        contentRevision: 0,
        payload: { delta: [{ text: '实时正文 ' }] }
      },
      {
        runId: 'run-1',
        type: 'llm_delta',
        eventSequence: 11,
        contentRevision: 0,
        payload: {
          delta: [
            {
              functionCall: {
                id: 'tool-1',
                name: 'read_file',
                args: { path: 'README.md' },
                index: 0
              }
            }
          ]
        }
      }
    ];
    const initialWindow = {
      runId: 'run-1',
      contents: [createUserContent(0, 'prompt')],
      startIndex: 0,
      endIndex: 1,
      totalCount: 1,
      contentRevision: 0,
      eventSequence: 9,
      hasMoreBefore: false,
      hasMoreAfter: false
    };

    const selected = selectReplayableMonitorLiveDeltas(buffered, initialWindow);
    let contents = initialWindow.contents;
    for (const event of selected.replayable) {
      contents = applyStreamChunkToContents(contents, event.payload, event.timestamp || 2000, initialWindow.startIndex);
    }

    // 修改原因：用户在流式中途打开 Monitor 时，窗口返回前到达的正文和工具调用 delta 曾经被直接丢弃。
    // 修改方式：测试模拟“先 delta、后 window”的真实竞态，确认回放后能生成同一个 live model 楼层和工具调用卡。
    // 修改目的：锁定实时 Monitor 与关闭重开后的最终 transcript 在结构上收敛。
    expect(contents).toHaveLength(2);
    expect(contents[1]).toMatchObject({ role: 'model', index: 1 });
    expect(contents[1].parts[0].text).toBe('实时正文 ');
    expect(contents[1].parts[1].functionCall).toMatchObject({
      id: 'tool-1',
      name: 'read_file',
      args: { path: 'README.md' },
      index: 0
    });
  });
});
