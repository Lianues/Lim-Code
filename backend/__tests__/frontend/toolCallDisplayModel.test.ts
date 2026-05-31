import { buildToolCardDisplayModel, deriveToolCallState } from '../../../frontend/src/utils/toolCallDisplayModel';
import type { ToolConfig } from '../../../frontend/src/utils/toolRegistry';
import type { ToolUsage } from '../../../frontend/src/types';

const readFileConfig: ToolConfig = {
  name: 'read_file',
  label: '读取文件',
  icon: 'codicon-file-text',
  descriptionFormatter(args) {
    return String(args.path || '?');
  }
};

describe('ToolCallState and ToolCardDisplayModel', () => {
  it('shows terminal success instead of an argument warning when execution succeeded before args were normalized', () => {
    // 修改原因：Bug 2 的直接症状是 read_file formatter 在空 args 下返回 ?，但执行态 success 不代表输入参数已完成。
    // 修改方式：DisplayModel 不调用工具私有 formatter，同时让终态 success 优先于参数校准提示。
    // 修改目的：主窗口和 Monitor 都不再把成功工具误显示成黄色参数告警。
    const tool: ToolUsage = { id: 'call_read_file_unknown', name: 'read_file', args: {}, status: 'success' };
    const model = buildToolCardDisplayModel(tool, readFileConfig);

    expect(model.inputState).toBe('input_unknown');
    expect(model.displayState).toBe('success');
    expect(model.statusIcon).toBe('check');
    expect(model.description).not.toBe('?');
    expect(model.description).toContain('执行成功');
  });

  it('does not let stale unparseable partial args override terminal success', () => {
    const tool: ToolUsage = {
      id: 'call_write_file_done',
      name: 'write_file',
      args: {},
      partialArgs: '{"path"',
      status: 'success',
      result: { success: true, path: 'notes.md' }
    };
    const model = buildToolCardDisplayModel(tool, {
      name: 'write_file',
      label: '写入文件',
      icon: 'codicon-save',
      descriptionFormatter(args) {
        return String(args.path || '无文件');
      }
    });

    expect(model.inputState).toBe('input_incomplete');
    expect(model.displayState).toBe('success');
    expect(model.statusIcon).toBe('check');
    expect(model.description).toContain('执行成功');
    expect(model.description).not.toContain('参数片段未能解析');
  });

  it('promotes parseable partial args into display args so apply_diff no longer stays in generating text', () => {
    // 修改原因：Bug 5 中 apply_diff 参数 JSON 已经完整可见，但 ToolUsage.status 仍停在 streaming，旧 UI 只能显示“正在生成参数”。
    // 修改方式：状态派生把可解析 partialArgs 作为 parsed_partial input_available，执行态仍保持 not_started/queued 分离。
    // 修改目的：参数可见性与执行态分开表达，避免用户看到自相矛盾的卡片。
    const args = { path: 'frontend/src/components/settings/PromptsSettings.vue', hunks: [{ oldContent: 'a', newContent: 'b' }] };
    const tool: ToolUsage = {
      id: 'call_apply_diff_parseable',
      name: 'apply_diff',
      args: {},
      partialArgs: JSON.stringify(args),
      status: 'streaming'
    };

    const state = deriveToolCallState(tool);
    const model = buildToolCardDisplayModel(tool, {
      name: 'apply_diff',
      label: '应用差异',
      icon: 'codicon-diff',
      descriptionFormatter(input) {
        return String(input.path || '?');
      }
    });

    expect(state.input.status).toBe('input_available');
    expect(model.inputState).toBe('input_available');
    expect(model.displayArgs).toEqual(args);
    expect(model.description).toBe(args.path);
    expect(model.description).not.toContain('正在生成参数');
  });

  it('uses itemId or index as a stable key before the final call id arrives', () => {
    // 修改原因：Bug 7 的 spinner 不动和 hover 闪烁通常来自参数流式阶段 key 在临时 id 和最终 id 间变化。
    // 修改方式：DisplayModel stableKey 优先使用 itemId/index，而不是最终 call_id。
    // 修改目的：保证同一逻辑工具的卡片壳、spinner 和 hover target 不因 call_id 迟到而 remount。
    const first = buildToolCardDisplayModel({ id: 'temporary', name: 'read_file', itemId: 'item_1', args: {}, partialArgs: '{"path"', status: 'streaming' }, readFileConfig);
    const second = buildToolCardDisplayModel({ id: 'call_final', name: 'read_file', itemId: 'item_1', args: { path: 'README.md' }, status: 'queued' }, readFileConfig);

    expect(first.stableKey).toBe(second.stableKey);
    expect(first.partialArgsPreview?.stableContainerKey).toContain(first.stableKey);
  });
});
