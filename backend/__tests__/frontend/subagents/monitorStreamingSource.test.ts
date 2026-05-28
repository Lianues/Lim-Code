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

    expect(source).toContain('applyStreamChunkToContents(contentWindow.contents || [], event.payload, timestamp, contentWindow.startIndex || 0)');
    // 修改原因：Monitor live delta 现在可能先进入有界缓冲再回放，source guard 需要锁定新时序保护而不是旧的 inline existingWindow 调用。
    // 修改方式：断言组件引入并使用 replayBufferedLiveDeltas，确保窗口到达后会回放之前无法应用的 delta。
    // 修改目的：防止后续重构重新把“无窗口/旧窗口 delta”直接丢弃。
    expect(source).toContain('replayBufferedLiveDeltas(response.window.runId)');
    expect(source).toContain('const isLiveRun = activeRunIds.value.has(run.runId)');
    expect(source).toContain('message.streaming = true');
    expect(source).toContain('contentIndex === Math.max(0, (contentWindow?.totalCount || 0) - 1)');
  });
});
