import fs from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('SubAgent Monitor streaming source guards', () => {
  it('projects active tail model messages as streaming and applies live delta with window base index', () => {
    // 修改原因：docs/pm 要求 SubAgent Monitor 实时显示输出，且主聊天/Monitor 不能只升级一边。
    // 修改方式：源码守卫 Monitor 复用 MessageItem 的 streaming 渲染语义，并把 live delta 写入带绝对 index 的窗口。
    // 修改目的：防止 Monitor 退回“只状态实时、正文完成后刷新”的分叉实现。
    const source = readWorkspaceFile('frontend/src/components/subagents/SubAgentMonitor.vue');

    expect(source).toContain('applyStreamChunkToContents(existingWindow.contents || [], event.payload, timestamp, existingWindow.startIndex || 0)');
    expect(source).toContain('const isLiveRun = activeRunIds.value.has(run.runId)');
    expect(source).toContain('message.streaming = true');
    expect(source).toContain('contentIndex === Math.max(0, (contentWindow?.totalCount || 0) - 1)');
  });
});
