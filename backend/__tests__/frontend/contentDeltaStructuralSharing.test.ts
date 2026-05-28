import { applyStreamChunkToContents } from '../../../frontend/src/stores/agentRun/contentDelta';
import type { Content } from '../../../frontend/src/types';

function createContent(index: number, text: string, role: 'user' | 'model' = 'model'): Content {
  return {
    role,
    index,
    parts: [{ text }],
    timestamp: 1000 + index
  } as Content;
}

describe('applyStreamChunkToContents structural sharing', () => {
  it('keeps untouched old content object references while updating the last model content', () => {
    const first = createContent(0, '用户消息', 'user');
    const model = createContent(1, '旧回答');
    const contents = [first, model];

    const next = applyStreamChunkToContents(contents, { delta: [{ text: ' + 新增' }] }, 2000);

    expect(next).not.toBe(contents);
    // 修改原因：旧实现每个 delta 都 clone 所有 Content，会让长 transcript 更新成本随历史长度增长。
    // 修改方式：测试锁定未被更新的旧楼层保持引用共享，只替换最后一个 model Content。
    // 修改目的：防止后续回归到全量 clone。
    expect(next[0]).toBe(first);
    expect(next[1]).not.toBe(model);
    expect(next[1].parts[0].text).toBe('旧回答 + 新增');
    expect(model.parts[0].text).toBe('旧回答');
  });

  it('creates live model content with window absolute index when delta arrives after a non-model tail', () => {
    const userTail = createContent(20, '窗口尾部用户消息', 'user');

    const next = applyStreamChunkToContents([userTail], { delta: [{ text: '实时回答' }] }, 3000, 20);

    // 修改原因：Monitor 的 transcript window 不一定从 0 开始，实时 delta 新建 model 楼层时不能使用局部数组下标作为 backendIndex。
    // 修改方式：applyStreamChunkToContents 接收 baseIndex，并用 baseIndex + contents.length 生成 live baseline index。
    // 修改目的：SubAgent Monitor 实时输出后，delete/retry 仍指向真实 Content.index。
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(userTail);
    expect(next[1]).toMatchObject({ role: 'model', index: 21 });
    expect(next[1].parts[0].text).toBe('实时回答');
  });

  it('keeps functionCall merge semantics while only replacing the tail model content', () => {
    const first = createContent(0, '用户消息', 'user');
    const model: Content = {
      role: 'model',
      index: 1,
      timestamp: 1001,
      parts: [
        {
          functionCall: {
            name: 'search_in_files',
            args: {},
            itemId: 'item-1',
            index: 0,
            partialArgs: '{"query":"foo"'
          }
        }
      ]
    } as Content;

    const next = applyStreamChunkToContents([first, model], {
      delta: [
        {
          functionCall: {
            name: 'search_in_files',
            args: { path: 'src' },
            itemId: 'item-1',
            index: 0
          }
        }
      ]
    }, 2000);

    expect(next[0]).toBe(first);
    expect(next[1]).not.toBe(model);
    expect(next[1].parts).toHaveLength(1);
    expect(next[1].parts[0].functionCall).toMatchObject({
      name: 'search_in_files',
      itemId: 'item-1',
      index: 0,
      args: { path: 'src' }
    });
  });
});
