import { StreamChunkProcessor } from '../../../webview/stream/StreamChunkProcessor';

function createThenable<T>(value: T): Thenable<T> {
  return {
    then: (onfulfilled?: ((value: T) => any) | null, _onrejected?: ((reason: any) => any) | null) => {
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value) as any;
    }
  };
}

function createProcessor() {
  const messages: any[] = [];
  const view = {
    webview: {
      postMessage: jest.fn((message: any) => {
        messages.push(message);
        return createThenable(true);
      })
    }
  };

  return {
    messages,
    postMessage: view.webview.postMessage,
    processor: new StreamChunkProcessor(view as any, 'conversation-1', 'stream-1')
  };
}

describe('StreamChunkProcessor throttling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps high-frequency chunk messages buffered until the throttle window expires', () => {
    const { processor, messages, postMessage } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'A' }] } });
    processor.processChunk({ chunk: { delta: [{ text: 'B' }] } });

    // 修改原因：此前 enqueue 内部的 setTimeout(0) 会抢先 flush，使 CHUNK_THROTTLE_MS 形同虚设。
    // 修改方式：测试在 50ms 节流窗口结束前没有任何 postMessage，窗口结束后一次性发送 batch。
    // 修改目的：锁定 trace 中 webview.postMessage 反序列化长任务的核心回归防线。
    expect(postMessage).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);

    jest.advanceTimersByTime(49);
    expect(postMessage).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'streamChunkBatch',
      data: [
        { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' },
        { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' }
      ]
    });
  });

  it('still flushes terminal events immediately after any buffered chunks', () => {
    const { processor, messages } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'A' }] } });
    processor.processChunk({ content: { role: 'model', parts: [{ text: 'final' }] } });

    // 修改原因：关闭 chunk 的 0ms 兜底后，complete 等终结事件仍必须立即把已有内容一起送到前端。
    // 修改方式：complete 分支继续调用 flush，因此 pending chunk 与 complete 会合并为同一个 batch。
    // 修改目的：降低消息频率的同时，保持前端完成态不延迟、不丢内容。
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'streamChunkBatch',
      data: [
        { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' },
        { type: 'complete', conversationId: 'conversation-1', streamId: 'stream-1' }
      ]
    });
  });
});
