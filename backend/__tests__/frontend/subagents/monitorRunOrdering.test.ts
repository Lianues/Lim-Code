import { compareMonitorRunsByStableCreationOrder } from '../../../../frontend/src/components/subagents/monitorRunOrdering';

describe('SubAgent Monitor run ordering', () => {
  it('keeps run tab order stable when updatedAt changes during streaming', () => {
    // 修改原因：Monitor 过去按 updatedAt 排序，高频 llm_delta 会让并发 run 的 tab 来回抢位。
    // 修改方式：排序策略只看 createdAt 和 runId，因此 updatedAt 不参与比较。
    // 修改目的：锁定“流式输出不会造成 Runs 按钮跑马灯”的交互语义。
    const initial = [
      { runId: 'run-a', createdAt: 100, updatedAt: 1000 },
      { runId: 'run-b', createdAt: 200, updatedAt: 300 }
    ];
    const afterStreamingUpdate = [
      { runId: 'run-a', createdAt: 100, updatedAt: 5000 },
      { runId: 'run-b', createdAt: 200, updatedAt: 300 }
    ];

    expect([...initial].sort(compareMonitorRunsByStableCreationOrder).map(run => run.runId)).toEqual(['run-b', 'run-a']);
    expect([...afterStreamingUpdate].sort(compareMonitorRunsByStableCreationOrder).map(run => run.runId)).toEqual(['run-b', 'run-a']);
  });
});
