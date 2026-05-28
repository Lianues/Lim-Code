import fs from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('WP31 markdown memoization source guards', () => {
  it('keeps MarkdownRenderer plugin order intact while adding completed-message memoization', () => {
    // 修改原因：WP31 只允许做渲染边界优化，不允许改 markdown-it 插件顺序或替换现有渲染能力。
    // 修改方式：直接从源码断言插件顺序和 memoized render 入口同时存在。
    // 修改目的：防止后续维护误把性能优化演变成渲染能力变更。
    const source = readWorkspaceFile('frontend/src/components/common/MarkdownRenderer.vue');

    const footnoteIndex = source.indexOf('md.use(footnote)');
    const deflistIndex = source.indexOf('md.use(deflist)');
    const taskListsIndex = source.indexOf('md.use(taskLists');
    const katexIndex = source.indexOf('md.use(markdownItKatex)');
    const workspaceLinkIndex = source.indexOf('md.use(markdownItWorkspaceFileLinks)');

    expect(footnoteIndex).toBeGreaterThanOrEqual(0);
    expect(deflistIndex).toBeGreaterThan(footnoteIndex);
    expect(taskListsIndex).toBeGreaterThan(deflistIndex);
    expect(katexIndex).toBeGreaterThan(taskListsIndex);
    expect(workspaceLinkIndex).toBeGreaterThan(katexIndex);

    expect(source).toContain('const completedRenderCache = new Map<string, string>()');
    expect(source).toContain('function getMemoizedCompletedRender(');
    expect(source).toContain('function renderCurrentContent(): boolean');
  });

  it('memoizes MarkdownRenderer call sites in MessageItem without changing the component tree shape', () => {
    // 修改原因：当前仓库没有 Vue SFC 单测运行时；需要一个结构守卫确认 MessageItem 挂上了 v-memo。
    // 修改方式：校验 MarkdownRenderer 调用点保留原有组件标签，仅新增 v-memo 依赖表达式。
    // 修改目的：确保优化落在渲染边界，而不是通过改 DOM 结构规避问题。
    //
    // WP31 修复版更新：原来 4 处 v-memo="getMarkdownMemoDeps(...)" 已重构为：
    // - summary 块 / fallback MarkdownRenderer 直接使用内联 v-memo="[...]" 数组（2 处）
    // - v-for 内的 block 通过 MessageRenderBlock 组件 + v-memo="getRenderBlockMemoDeps(...)" 统一控制
    const source = readWorkspaceFile('frontend/src/components/message/MessageItem.vue');

    // MarkdownRenderer 上内联 v-memo 数组（summary + fallback）
    const inlineMemoMatches = source.match(/<MarkdownRenderer\s+[\s\S]*?v-memo="\[/g) || [];
    expect(inlineMemoMatches.length).toBeGreaterThanOrEqual(2);

    // MessageRenderBlock 上 v-memo（替代原来的 v-for 内部两处）
    expect(source).toContain('v-memo="getRenderBlockMemoDeps(block, isStreaming, isUser, isThoughtExpanded, isThinking, thinkingTimeDisplay)"');
    expect(source).toContain('import MessageRenderBlock');

    expect(source).toContain('class="summary-text"');
    expect(source).toContain('class="content-text"');
    // thought-text 现在在 MessageRenderBlock.vue 中（组件提取后移至子组件）
    const rbSource = readWorkspaceFile('frontend/src/components/message/MessageRenderBlock.vue');
    expect(rbSource).toContain('class="thought-text"');
  });
});
