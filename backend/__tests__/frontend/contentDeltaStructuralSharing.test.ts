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
