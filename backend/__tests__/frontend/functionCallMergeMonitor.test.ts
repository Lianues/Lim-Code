import {
  type StreamFunctionCall,
  mergeFunctionCall,
  mergeFunctionCallIdentity,
  tryParseArgs,
  hasNonEmptyArgs,
  normalizeNonEmptyString,
  getFunctionCallMergeReason
} from '../../../frontend/src/utils/functionCallMerge';

/**
 * WP15 条件 2：Monitor args "替换 → spread 合并" 语义测试。
 *
 * 为什么需要这些测试：Monitor 旧 delta reducer 曾经是 target.args = incoming.args（直接替换），
 * 统一模块改为 { ...(target.args || {}), ...incoming.args }（spread 合并）。
 * 旧 key 不应丢失，且 finalArgs 少字段时不丢失之前通过 partialArgs 解析出的字段。
 *
 * 测试覆盖：
 * 1. spread 合并保留旧 key
 * 2. final args 少字段时不丢失已解析字段
 * 3. 身份字段合并（mergeFunctionCallIdentity）正确性
 * 4. Monitor 默认策略（不传 shouldParseArgs）只在 finalArgs=true 时解析
 */
describe('functionCallMerge Monitor args spread semantics', () => {
  it('preserves old keys when incoming args have fewer fields (spread merge)', () => {
    // 为什么：旧 Monitor 行为 target.args = incoming.args 会丢掉先通过 partialArgs 解析出的 key。
    // 怎么改：统一模块用 { ...target.args, ...incoming.args } 保留已有键。
    // 目的：流式过程中 partialArgs 先解析出部分字段，后续 finalArgs 只补剩余字段时不丢数据。
    const target: StreamFunctionCall = {
      name: 'search_in_files',
      args: { path: 'frontend/src', query: 'merge', maxResults: 10 }
    };
    const incoming: StreamFunctionCall = {
      name: 'search_in_files',
      args: { path: 'frontend/tests' }
    };

    mergeFunctionCall(target, incoming);

    // incoming.args 只有 path，但 target 原有的 query 和 maxResults 应保留
    expect(target.args).toEqual({
      path: 'frontend/tests',   // incoming 覆盖
      query: 'merge',            // 旧 key 保留
      maxResults: 10             // 旧 key 保留
    });
  });

  it('preserves old keys when partialArgs parsed before args arrive', () => {
    // 为什么：Monitor 流式场景中，partialArgs 可能先解析出部分字段，后续 incoming.args 再补字段。
    // 怎么改：target.args 已在 finalArgs 路径解析出 { command: 'npm install' }，
    //   后续收到 incoming.args = { cwd: '.' }，spread 合并保留 command。
    // 目的：确保完整工具调用参数不丢失。
    const target: StreamFunctionCall = {
      name: 'execute_command',
      args: { command: 'npm install' },
      partialArgs: '{"command":"npm install"}',
      finalArgs: true
    };

    // 模拟 finalArgs 路径：先通过 tryParseArgs 解析
    const parsed = tryParseArgs(target.partialArgs);
    if (parsed) target.args = parsed;

    const incoming: StreamFunctionCall = {
      name: 'execute_command',
      args: { cwd: '/project' }
    };

    mergeFunctionCall(target, incoming);

    expect(target.args).toEqual({
      command: 'npm install',   // 旧 key 保留
      cwd: '/project'            // 新 key 合并
    });
  });

  it('Monitor default strategy only parses on finalArgs=true', () => {
    // 为什么：Monitor 不传 shouldParseArgs，统一模块默认只在 finalArgs=true 时解析。
    // 怎么改：不传 options 参数走默认行为。
    // 目的：Monitor 不在每个 delta 上做不必要的 JSON.parse。
    const target: StreamFunctionCall = {
      name: 'search_in_files',
      args: {}
    };

    // 非 finalArgs 的 partialArgs：不应解析
    mergeFunctionCall(target, {
      name: 'search_in_files',
      partialArgs: '{"path":"frontend/src",'
    });

    // 没有 finalArgs=true，args 应保持为空
    expect(target.args).toEqual({});
    // partialArgs 累积（非 finalArgs 是追加模式）
    expect(target.partialArgs).toBe('{"path":"frontend/src",');

    // finalArgs=true 的 partialArgs：传完整 JSON，应解析
    mergeFunctionCall(target, {
      name: 'search_in_files',
      partialArgs: '{"path":"frontend/src","maxResults":10}',
      finalArgs: true
    });

    // finalArgs=true 用完整 arguments 替换已累积片段后触发解析
    expect(target.args).toEqual({ path: 'frontend/src', maxResults: 10 });
    // finalArgs 后清理 partialArgs
    expect(target.partialArgs).toBeUndefined();
  });

  it('mergeFunctionCallIdentity fills missing fields without overwriting existing', () => {
    // 为什么：身份合并函数被 parsers.ts 和 mergeFunctionCall 共享。
    // 怎么改：单独测试 mergeFunctionCallIdentity 确保语义正确。
    // 目的：验证 target 已有值不会被 incoming 覆盖。
    const target: StreamFunctionCall = {
      name: 'existing_name',
      id: 'existing_id',
      itemId: 'existing_item',
      index: 5
    };
    const incoming: StreamFunctionCall = {
      name: 'new_name',
      id: 'new_id',
      itemId: 'new_item',
      index: 10
    };

    mergeFunctionCallIdentity(target, incoming);

    // target 已有值不应被覆盖
    expect(target.name).toBe('existing_name');
    // id 的合并规则是"incoming 有值就覆盖"（区别于 name/itemId/index 的"只在 target 缺失时填充"）
    expect(target.id).toBe('new_id');
    expect(target.itemId).toBe('existing_item');
    expect(target.index).toBe(5);
  });

  it('mergeFunctionCallIdentity fills truly missing fields', () => {
    // 为什么：验证 identity merge 的填充行为。
    // 目的：确保缺失字段被正确填充。
    const target: StreamFunctionCall = {};
    const incoming: StreamFunctionCall = {
      name: 'apply_diff',
      id: 'call_diff_1',
      itemId: 'fc_item_1',
      index: 0
    };

    mergeFunctionCallIdentity(target, incoming);

    expect(target.name).toBe('apply_diff');
    expect(target.id).toBe('call_diff_1');
    expect(target.itemId).toBe('fc_item_1');
    expect(target.index).toBe(0);
  });

  it('getFunctionCallMergeReason identifies sameItemId merge', () => {
    // 验证合并键优先级
    const reason = getFunctionCallMergeReason(
      { itemId: 'fc_1', name: 'search' },
      { itemId: 'fc_1', name: 'search', args: {} },
      true
    );
    expect(reason).toBe('sameItemId');
  });

  it('getFunctionCallMergeReason identifies sameIndex merge (including index=0)', () => {
    // 验证 index=0 的合并（不能用 truthy 判断）
    const reason = getFunctionCallMergeReason(
      { index: 0, name: 'search' },
      { index: 0, name: 'search', args: {} },
      true
    );
    expect(reason).toBe('sameIndex');
  });

  it('getFunctionCallMergeReason identifies freshPlaceholder merge', () => {
    // 最后一个仍是空占位，incoming 是无定位字段的参数片段
    const reason = getFunctionCallMergeReason(
      { partialArgs: '{"path":' },
      { name: 'search', args: {} },
      true // isLastFunctionCall
    );
    expect(reason).toBe('freshPlaceholder');
  });

  it('getFunctionCallMergeReason returns null for non-matching calls', () => {
    // 不同的 itemId，不同的 index，不同的 id，也不是最后一个空占位
    const reason = getFunctionCallMergeReason(
      { itemId: 'fc_1', name: 'search', partialArgs: '{"path":' },
      { itemId: 'fc_2', name: 'apply_diff', args: { path: 'README.md' } },
      false // not last function call
    );
    expect(reason).toBeNull();
  });

  it('normalizeNonEmptyString handles various input types', () => {
    expect(normalizeNonEmptyString(undefined)).toBe('');
    expect(normalizeNonEmptyString(null)).toBe('');
    expect(normalizeNonEmptyString('')).toBe('');
    expect(normalizeNonEmptyString('  ')).toBe('');
    expect(normalizeNonEmptyString('hello')).toBe('hello');
    expect(normalizeNonEmptyString('  hello  ')).toBe('hello');
    expect(normalizeNonEmptyString(123 as any)).toBe('');
  });

  it('hasNonEmptyArgs distinguishes empty vs non-empty objects', () => {
    expect(hasNonEmptyArgs(null)).toBe(false);
    expect(hasNonEmptyArgs(undefined)).toBe(false);
    expect(hasNonEmptyArgs({})).toBe(false);
    expect(hasNonEmptyArgs({ path: 'README.md' })).toBe(true);
    expect(hasNonEmptyArgs('string' as any)).toBe(false);
  });

  it('tryParseArgs safely parses JSON strings', () => {
    expect(tryParseArgs(undefined)).toBeNull();
    expect(tryParseArgs('')).toBeNull();
    expect(tryParseArgs('  ')).toBeNull();
    expect(tryParseArgs('not json')).toBeNull();
    expect(tryParseArgs('"just a string"')).toBeNull(); // not an object
    expect(tryParseArgs('{"path":"README.md"}')).toEqual({ path: 'README.md' });
    expect(tryParseArgs('{"path":"src","maxResults":5}')).toEqual({ path: 'src', maxResults: 5 });
  });
});
