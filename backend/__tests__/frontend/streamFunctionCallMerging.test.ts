import { handleFunctionCallPart } from '../../../frontend/src/stores/chat/streamHelpers';
import { contentToMessageEnhanced } from '../../../frontend/src/stores/chat/parsers';
import { buildFunctionCallToolRenderEntry, upsertToolRenderEntry } from '../../../frontend/src/utils/toolRenderEntries';
import type { Content, Message, ToolUsage } from '../../../frontend/src/types';

function createAssistantMessage(): Message {
  return {
    id: 'message-under-test',
    role: 'assistant',
    content: '',
    timestamp: 0,
    parts: []
  };
}

function functionCallPart(functionCall: Record<string, unknown>) {
  return { functionCall };
}

describe('frontend streaming function call merging', () => {
  it('merges Responses-style MCP placeholder, deltas, done and final item into one visible tool', () => {
    // 为什么要模拟 MCP 名称：MCP 工具在前端只是 mcp__server__tool 形式的原生 function_call，问题不在 MCP handler，而在通用流式工具投影。
    // 怎么改：用 itemId/index/call_id 的完整事件顺序驱动 handleFunctionCallPart，覆盖“先占位、后参数、最后修正 id”的真实路径。
    // 目的：防止 UI 临时显示“参数 0”的幽灵工具，并确保最终只剩一张带真实参数的工具卡。
    const message = createAssistantMessage();
    const finalArgs = JSON.stringify({ query: 'limcode mcp search duplicate tool', numResults: 5 });

    handleFunctionCallPart(functionCallPart({
      name: 'mcp__exa__web_search_exa',
      args: {},
      partialArgs: '',
      itemId: 'fc_item_search_1',
      index: 0
    }), message);

    handleFunctionCallPart(functionCallPart({
      partialArgs: finalArgs.slice(0, 20),
      itemId: 'fc_item_search_1',
      index: 0
    }), message);

    handleFunctionCallPart(functionCallPart({
      partialArgs: finalArgs.slice(20),
      itemId: 'fc_item_search_1',
      index: 0
    }), message);

    handleFunctionCallPart(functionCallPart({
      name: 'mcp__exa__web_search_exa',
      args: {},
      partialArgs: finalArgs,
      id: 'call_real_search_1',
      itemId: 'fc_item_search_1',
      index: 0,
      finalArgs: true
    }), message);

    handleFunctionCallPart(functionCallPart({
      name: 'mcp__exa__web_search_exa',
      args: {},
      partialArgs: finalArgs,
      id: 'call_real_search_1',
      itemId: 'fc_item_search_1',
      index: 0,
      finalArgs: true
    }), message);

    const functionCalls = message.parts?.filter(part => part.functionCall).map(part => part.functionCall as any) || [];

    expect(functionCalls).toHaveLength(1);
    expect(message.tools).toHaveLength(1);
    expect(functionCalls[0].id).toBe('call_real_search_1');
    expect(message.tools?.[0].id).toBe('call_real_search_1');
    expect(functionCalls[0].args).toEqual(JSON.parse(finalArgs));
    expect(message.tools?.[0].args).toEqual(JSON.parse(finalArgs));
    expect(functionCalls[0].partialArgs).toBeUndefined();
    expect(message.tools?.[0].partialArgs).toBeUndefined();
    expect(message.tools?.[0].status).toBe('queued');
  });

  it('deduplicates pending render entries when a temporary placeholder id is followed by the final tool id', () => {
    // 为什么直接测试渲染条目：用户看到的重复发生在 MessageItem 把 parts 投影成 ToolMessage block 时，
    // 而不是一定发生在 message.tools 数据本身；旧逻辑遇到临时 id 会跳过序位回退，渲染出“占位工具 + 最终工具”。
    // 怎么改：模拟一条占位 part 仍带 temporary id、message.tools 已经合并为 final call_id 的 pending 状态。
    // 目的：保证 pending/awaiting 阶段最后一个工具只渲染一张卡，并保留最终工具的执行状态。
    const finalArgs = { path: 'README.md', hunks: [] };
    const messageTools: ToolUsage[] = [{
      id: 'call_final_apply_diff',
      name: 'apply_diff',
      args: finalArgs,
      status: 'awaiting_apply'
    }];
    const renderBlock: ToolUsage[] = [];

    upsertToolRenderEntry(renderBlock, buildFunctionCallToolRenderEntry({
      messageId: 'pending-message',
      functionCall: {
        name: 'apply_diff',
        args: {},
        id: 'temporary_placeholder_id'
      },
      messageTools,
      functionCallOrdinal: 0
    }));

    upsertToolRenderEntry(renderBlock, buildFunctionCallToolRenderEntry({
      messageId: 'pending-message',
      functionCall: {
        name: 'apply_diff',
        args: finalArgs,
        id: 'call_final_apply_diff'
      },
      messageTools,
      functionCallOrdinal: 1
    }));

    expect(renderBlock).toHaveLength(1);
    expect(renderBlock[0].id).toBe('call_final_apply_diff');
    expect(renderBlock[0].args).toEqual(finalArgs);
    expect(renderBlock[0].status).toBe('awaiting_apply');
  });

  it('maps a late placeholder after the final call back to the last rendered tool without downgrading args', () => {
    // 为什么要覆盖 final 后又来 placeholder：用户复现的是 pending/execute 等待期间“最后一个工具”重复，
    // 真实事件顺序可能是最终 call_id 已经进入 message.tools，随后又有一个同名临时占位 part 迟到。
    // 怎么改：当 functionCallOrdinal 已经超过 message.tools 长度时，只把空参数或等价参数的同名 part 回收到最后一个工具。
    // 目的：最后一个工具不会因为迟到占位 id 不同而显示第二张卡，也不会把已解析参数覆盖为空。
    const finalArgs = { query: 'late placeholder duplicate', numResults: 5 };
    const messageTools: ToolUsage[] = [
      { id: 'call_first', name: 'execute_command', args: { command: 'npm run compile' }, status: 'success' },
      { id: 'call_final_search', name: 'mcp__exa__web_search_exa', args: finalArgs, status: 'executing' }
    ];
    const renderBlock: ToolUsage[] = [];

    upsertToolRenderEntry(renderBlock, buildFunctionCallToolRenderEntry({
      messageId: 'pending-message',
      functionCall: {
        name: 'mcp__exa__web_search_exa',
        args: finalArgs,
        id: 'call_final_search'
      },
      messageTools,
      functionCallOrdinal: 1
    }));

    upsertToolRenderEntry(renderBlock, buildFunctionCallToolRenderEntry({
      messageId: 'pending-message',
      functionCall: {
        name: 'mcp__exa__web_search_exa',
        args: {},
        id: 'temporary_late_placeholder'
      },
      messageTools,
      functionCallOrdinal: 2
    }));

    expect(renderBlock).toHaveLength(1);
    expect(renderBlock[0].id).toBe('call_final_search');
    expect(renderBlock[0].args).toEqual(finalArgs);
    expect(renderBlock[0].status).toBe('executing');
  });

  it('normalizes duplicate functionCall parts in content snapshots before ToolMessage rendering', () => {
    // 为什么要测试 contentSnapshot：批处理或终结事件会用后端快照覆盖本地流式状态，旧 mergeToolsPreferExisting 会把未匹配的占位工具追加回来。
    // 怎么改：contentToMessageEnhanced 先按 itemId/index/id 归一化 parts，再派生 message.tools。
    // 目的：保证快照路径和增量路径都不会把同一个逻辑工具渲染成两张 MCP 工具卡。
    const finalArgs = JSON.stringify({ query: 'snapshot duplicate check', numResults: 3 });
    const content: Content = {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'mcp__exa__web_search_exa',
            args: {},
            id: 'temporary_placeholder_id',
            partialArgs: '',
            itemId: 'fc_item_snapshot_1',
            index: 0
          } as any
        },
        {
          functionCall: {
            name: 'mcp__exa__web_search_exa',
            args: {},
            id: 'call_snapshot_real_1',
            partialArgs: finalArgs,
            itemId: 'fc_item_snapshot_1',
            index: 0,
            finalArgs: true
          } as any
        }
      ]
    };

    const message = contentToMessageEnhanced(content, 'snapshot-message');
    const functionCalls = message.parts?.filter(part => part.functionCall).map(part => part.functionCall as any) || [];

    expect(functionCalls).toHaveLength(1);
    expect(message.tools).toHaveLength(1);
    expect(functionCalls[0].id).toBe('call_snapshot_real_1');
    expect(message.tools?.[0].id).toBe('call_snapshot_real_1');
    expect(functionCalls[0].args).toEqual(JSON.parse(finalArgs));
    expect(message.tools?.[0].args).toEqual(JSON.parse(finalArgs));
    expect(functionCalls[0].partialArgs).toBeUndefined();
    expect(message.tools?.[0].partialArgs).toBeUndefined();
  });
});
