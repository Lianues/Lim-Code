import {
  applyMonitorToolOverlay,
  reduceMonitorToolStatusOverlay
} from '../../../frontend/src/components/subagents/monitorToolStatusOverlay';
import type { ToolUsage } from '../../../frontend/src/types';

describe('SubAgent Monitor tool status overlay', () => {
  it('advances tool status from runtime events before functionResponse arrives', () => {
    const queuedTool: ToolUsage = {
      id: 'tool-1',
      name: 'read_file',
      args: { path: 'README.md' },
      status: 'queued'
    };

    const executingOverlay = reduceMonitorToolStatusOverlay({}, {
      runId: 'run-1',
      type: 'tool_started',
      toolId: 'tool-1',
      toolName: 'read_file',
      payload: { args: { path: 'README.md' } }
    });

    // 修改原因：Monitor 不能只等 functionResponse 才更新工具卡，否则窗口刷新丢失会让状态停在 queued。
    // 修改方式：tool_started 先写入 overlay，渲染时 overlay 覆盖运行态字段。
    // 修改目的：工具执行中状态实时可见，并且不改变 functionCall 解析出的参数真源。
    expect(applyMonitorToolOverlay(queuedTool, executingOverlay)).toMatchObject({
      id: 'tool-1',
      name: 'read_file',
      args: { path: 'README.md' },
      status: 'executing'
    });

    const successOverlay = reduceMonitorToolStatusOverlay(executingOverlay, {
      runId: 'run-1',
      type: 'tool_completed',
      toolId: 'tool-1',
      toolName: 'read_file',
      payload: { duration: 42 }
    });

    expect(applyMonitorToolOverlay(queuedTool, successOverlay)).toMatchObject({
      status: 'success',
      duration: 42
    });
  });

  it('fills missing realtime args from overlay snapshots without waiting for monitor reopen', () => {
    const liveToolWithoutArgs: ToolUsage = {
      id: 'tool-1',
      name: 'read_file',
      args: {},
      partialArgs: '{"path":"README.md"',
      status: 'streaming'
    };

    const overlay = reduceMonitorToolStatusOverlay({}, {
      runId: 'run-1',
      type: 'tool_started',
      toolId: 'tool-1',
      toolName: 'read_file',
      payload: { args: { path: 'README.md' } }
    });

    const rendered = applyMonitorToolOverlay(liveToolWithoutArgs, overlay);

    // 修改原因：Monitor 实时态曾经因为 overlay 不补 args，read_file 描述 formatter 只能显示 "?"；重开后 window 中最终 args 才正常。
    // 修改方式：当 functionCall 投影尚无完整 args 时，用 tool_started/tool_completed 的 args 快照补齐。
    // 修改目的：实时流式显示与重开后的权威 window 显示一致。
    expect(rendered).toMatchObject({
      id: 'tool-1',
      name: 'read_file',
      args: { path: 'README.md' },
      status: 'executing'
    });
    expect(rendered.partialArgs).toBeUndefined();
  });

  it('maps failed tool events to error without overwriting parsed args', () => {
    const parsedTool: ToolUsage = {
      id: 'tool-2',
      name: 'search_in_files',
      args: { query: 'monitor' },
      partialArgs: '{"query":"monitor"}',
      status: 'streaming'
    };

    const overlay = reduceMonitorToolStatusOverlay({}, {
      runId: 'run-1',
      type: 'tool_failed',
      toolId: 'tool-2',
      toolName: 'search_in_files',
      payload: { error: 'boom', args: { stale: true } }
    });

    const rendered = applyMonitorToolOverlay(parsedTool, overlay);

    // 修改原因：后端工具事件 payload 经过瘦身，不应替代前端从 functionCall 解析出的完整 args/partialArgs。
    // 修改方式：overlay 只覆盖 status/error/duration/result 等运行态字段。
    // 修改目的：错误状态可实时显示，同时保留用户看到的工具参数预览。
    expect(rendered).toMatchObject({
      id: 'tool-2',
      name: 'search_in_files',
      args: { query: 'monitor' },
      partialArgs: '{"query":"monitor"}',
      status: 'error',
      error: 'boom'
    });
  });
});
