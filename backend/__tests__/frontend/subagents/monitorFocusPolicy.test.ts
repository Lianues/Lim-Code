import { shouldApplyEventFocus } from '../../../../frontend/src/components/subagents/monitorFocusPolicy';

describe('SubAgent Monitor focus policy', () => {
  it('does not let live run events override a user-selected run', () => {
    // 修改原因：并发 SubAgent 的实时事件会持续携带旧 focusRunId，导致用户点击其他 run 后立刻被拉回。
    // 修改方式：断言用户手动选择后，event focus 不再生效。
    // 修改目的：锁定 Monitor tab 可以自由切换的交互语义。
    expect(shouldApplyEventFocus({
      currentFocusRunId: 'run-b',
      incomingFocusRunId: 'run-a',
      hasUserSelectedRun: true
    })).toBe(false);
  });

  it('allows initial live focus before the user selects a run', () => {
    // 修改原因：禁止实时事件覆盖不能破坏从主窗口打开详情时的默认定位。
    // 修改方式：用户尚未手动选择时，允许有效 incomingFocusRunId 生效。
    // 修改目的：同时保留自动定位和手动切换两种行为。
    expect(shouldApplyEventFocus({
      currentFocusRunId: undefined,
      incomingFocusRunId: 'run-a',
      hasUserSelectedRun: false
    })).toBe(true);
  });
});
