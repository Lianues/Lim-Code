import { shouldShowToolArgumentPreview } from '../../../frontend/src/components/message/toolPreviewPolicy';
import type { ToolUsage } from '../../../frontend/src/types';

function tool(status: ToolUsage['status'], partialArgs?: string): ToolUsage {
  return {
    id: `tool-${status}`,
    name: 'read_file',
    args: {},
    status,
    partialArgs
  };
}

describe('tool preview policy', () => {
  it('keeps argument preview visible while an early-started tool is executing', () => {
    // 修改原因：流式提前执行会把工具状态从 streaming 推进到 executing，但前端仍可能只有 partialArgs 可展示。
    // 修改方式：断言 executing + partialArgs 仍显示预览。
    // 修改目的：防止工具开始执行后参数预览区域突然消失。
    expect(shouldShowToolArgumentPreview(tool('executing', '{"path":"README.md"}'))).toBe(true);
  });

  it('hides argument preview after a terminal status', () => {
    // 修改原因：执行完成后的工具应展示结果和格式化参数，不应继续保留流式原文预览。
    // 修改方式：终态 status 即使仍残留 partialArgs，也不显示流式预览。
    // 修改目的：避免成功或失败卡片继续显示过期的流式输入态。
    expect(shouldShowToolArgumentPreview(tool('success', '{"path":"README.md"}'))).toBe(false);
    expect(shouldShowToolArgumentPreview(tool('error', '{"path":"README.md"}'))).toBe(false);
  });
});
