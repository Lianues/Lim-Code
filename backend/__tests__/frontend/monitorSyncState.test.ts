import { deriveMonitorSyncState } from '../../../frontend/src/components/subagents/monitorSyncState';

describe('MonitorSyncState display projection', () => {
  it('does not report Live when heartbeat is fresh but focused content has no window yet', () => {
    // 修改原因：Bug 3 的用户可见误导来自 heartbeat 新鲜但内容窗口为空时仍显示 Live。
    // 修改方式：deriveMonitorSyncState 同时检查 transportHealth 和 contentHealth。
    // 修改目的：Monitor 顶部只在内容同步健康时显示 Live，否则显示 Syncing content。
    const state = deriveMonitorSyncState({
      hasFocusedRun: true,
      hasWindow: false,
      isLoadingWindow: true,
      isResyncing: false,
      hasRenderableMessages: false,
      hasGap: false,
      lastHeartbeatAt: 1000,
      now: 1500
    });

    expect(state.transportHealth).toBe('live');
    expect(state.contentHealth).toBe('loading');
    expect(state.headerState).toBe('syncing');
    expect(state.label).toBe('Syncing content');
  });

  it('keeps manual reset visible as resyncing instead of blank shell semantics', () => {
    // 修改原因：原地重置应该是 resync transaction，而不是先删除窗口造成空白。
    // 修改方式：resyncingRunIds 派生为 contentHealth=resyncing，并返回可渲染等待文案。
    // 修改目的：旧内容可保留，新窗口成功后再原子替换；失败前用户不会看到空白。
    const state = deriveMonitorSyncState({
      hasFocusedRun: true,
      hasWindow: true,
      isLoadingWindow: true,
      isResyncing: true,
      hasRenderableMessages: true,
      hasGap: false,
      lastHeartbeatAt: 1000,
      now: 1200
    });

    expect(state.contentHealth).toBe('resyncing');
    expect(state.headerState).toBe('syncing');
    expect(state.waitingMessage).toContain('旧内容会保留');
  });

  it('reports degraded when resync request fails while heartbeat remains fresh', () => {
    // 修改原因：reset/getRunWindow 失败不能静默留空，也不能继续显示 Live。
    // 修改方式：显式 error 派生 contentHealth=degraded。
    // 修改目的：用户能看到可重试的同步失败状态。
    const state = deriveMonitorSyncState({
      hasFocusedRun: true,
      hasWindow: true,
      isLoadingWindow: false,
      isResyncing: false,
      hasRenderableMessages: true,
      hasGap: false,
      error: '窗口同步失败',
      lastHeartbeatAt: 1000,
      now: 1200
    });

    expect(state.transportHealth).toBe('live');
    expect(state.contentHealth).toBe('degraded');
    expect(state.headerState).toBe('degraded');
    expect(state.label).toBe('Degraded');
  });
});
