import { StreamAccumulator } from '../../modules/channel/StreamAccumulator';

describe('StreamAccumulator duration metadata', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses request start to last chunk as streamDuration for token-rate timing', () => {
    // 修改原因：旧 streamDuration 只统计首块到末块，上游攒包后会让 token 速度分母异常变小。
    // 修改方式：用可控 Date.now 模拟 requestStart、firstChunk、lastChunk，锁定 streamDuration 的新完整请求耗时语义。
    // 修改目的：防止后续重构重新把 token-rate duration 退回首块到末块窗口。
    const now = jest.spyOn(Date, 'now');
    const accumulator = new StreamAccumulator();

    accumulator.setRequestStartTime(1000);

    now.mockReturnValue(1500);
    accumulator.add({ delta: [{ text: 'hello' }], done: false });

    now.mockReturnValue(2100);
    accumulator.add({ delta: [{ text: ' world' }], done: true });

    const content = accumulator.getFinalContent();

    expect(content.firstChunkTime).toBe(1500);
    expect(content.responseDuration).toBe(1100);
    expect(content.streamDuration).toBe(1100);
    expect(content.streamDuration).not.toBe(600);
  });

  it('uses one sampled fallback duration for responseDuration and streamDuration before any chunk arrives', () => {
    // 修改原因：取消或早期快照可能在没有 lastChunkTime 时构造 Content，两个完整耗时字段不能因两次 Date.now 采样产生抖动。
    // 修改方式：断言 fallback 分支只取一次当前时间，并同时写入 responseDuration 与 streamDuration。
    // 修改目的：让详情页的重复时长隐藏逻辑建立在稳定同源的数据上。
    const now = jest.spyOn(Date, 'now').mockReturnValue(1750);
    const accumulator = new StreamAccumulator();

    accumulator.setRequestStartTime(1000);
    const content = accumulator.getFinalContent();

    expect(content.responseDuration).toBe(750);
    expect(content.streamDuration).toBe(750);
    expect(now).toHaveBeenCalledTimes(1);
  });
});
