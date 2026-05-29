import {
  calculateTokenRate,
  formatTokenRate,
  getTokenRateTokenCount,
  shouldShowStreamDuration
} from '../../../frontend/src/utils/tokenRate';
import type { MessageMetadata, UsageMetadata } from '../../../frontend/src/types';

function metadata(overrides: Partial<MessageMetadata> = {}): MessageMetadata {
  return {
    chunkCount: 2,
    responseDuration: 2000,
    streamDuration: 100,
    usageMetadata: { candidatesTokenCount: 40 },
    ...overrides
  };
}

describe('token rate utilities', () => {
  it('uses responseDuration before streamDuration so buffered SSE bursts do not inflate speed', () => {
    // 修改原因：旧记录和新记录可能同时带有 responseDuration 与旧语义 streamDuration。
    // 修改方式：断言公共函数优先使用完整响应耗时，而不是首块到末块的短窗口。
    // 修改目的：防止上游一次性吐出多个 SSE chunk 时再次出现畸高 token 速度。
    expect(calculateTokenRate(metadata())).toBe(20);
  });

  it('falls back to streamDuration only when responseDuration is missing', () => {
    // 修改原因：部分历史记录可能没有 responseDuration，完全禁用速率会损失已有可展示信息。
    // 修改方式：删除 responseDuration 后允许 streamDuration 作为 best-effort 回退。
    // 修改目的：在无法恢复完整请求耗时时保持向后兼容。
    expect(calculateTokenRate(metadata({ responseDuration: undefined, streamDuration: 4000 }))).toBe(10);
  });

  it('allows response viewer to pass resolved legacy usage without rebuilding metadata', () => {
    // 修改原因：响应详情需要支持旧 metadata 字段，不能让公共函数复制详情面板的历史归一化逻辑。
    // 修改方式：resolvedUsage 参数优先参与分子计算。
    // 修改目的：共享速率公式，同时保留各入口自己的数据归一化边界。
    const legacyUsage: UsageMetadata = { candidatesTokenCount: 30, thoughtsTokenCount: 10 };
    expect(calculateTokenRate(metadata({ usageMetadata: undefined }), legacyUsage)).toBe(20);
  });

  it('adds thought tokens only when the provider reports positive thinking tokens', () => {
    // 修改原因：现有 UI 语义是有思考 token 时展示输出加思考的综合生成速率。
    // 修改方式：锁定 candidates + thoughts 的分子规则，同时保持无思考时只用 candidates。
    // 修改目的：抽公共函数时不改变用户已经看到的 token 口径。
    expect(getTokenRateTokenCount({ candidatesTokenCount: 30, thoughtsTokenCount: 10 })).toBe(40);
    expect(getTokenRateTokenCount({ candidatesTokenCount: 30, thoughtsTokenCount: 0 })).toBe(30);
  });

  it('does not calculate rates for non-streaming or invalid metadata', () => {
    // 修改原因：非流式响应虽然可能有 responseDuration 和 token，但 chunkCount=1 时不应显示流式速度。
    // 修改方式：覆盖 chunk、duration 和 token 三类守卫。
    // 修改目的：避免公共函数引入非流式消息的伪速度。
    expect(calculateTokenRate(metadata({ chunkCount: 1 }))).toBeUndefined();
    expect(calculateTokenRate(metadata({ responseDuration: 0, streamDuration: undefined }))).toBeUndefined();
    expect(calculateTokenRate(metadata({ usageMetadata: { candidatesTokenCount: 0 } }))).toBeUndefined();
  });

  it('formats the numeric rate without coupling the UI unit text', () => {
    // 修改原因：MessageItem 和详情页都需要相同精度，但单位由模板负责。
    // 修改方式：格式化函数只保留一位小数。
    // 修改目的：避免公共工具函数绑定具体 UI 文案。
    expect(formatTokenRate(12.345)).toBe('12.3');
  });

  it('hides duplicate stream duration values within tolerance but keeps distinct legacy values', () => {
    // 修改原因：修复后 streamDuration 与 responseDuration 对新记录同源，详情页不应重复展示两个近似相同的耗时。
    // 修改方式：用 50ms 默认容差隐藏重复值，差异明显时仍显示 streamDuration 供诊断。
    // 修改目的：兼顾新记录的简洁展示和旧记录的可追溯性。
    expect(shouldShowStreamDuration(2000, 2025)).toBe(false);
    expect(shouldShowStreamDuration(2000, 2101)).toBe(true);
    expect(shouldShowStreamDuration(undefined, 2101)).toBe(true);
  });
});
