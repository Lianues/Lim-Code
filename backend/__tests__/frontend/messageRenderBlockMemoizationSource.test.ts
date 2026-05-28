import fs from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('WP31 messageRenderBlock memoization source guards', () => {
  it('MessageItem.vue no longer has v-memo nested inside template v-for', () => {
    // 修改原因：WP31 怀疑论者复核指出 MessageItem.vue 中 v-memo 错位在 <template v-for> 内部子节点上，
    // 违反 Vue 官方"v-memo must be on same element as v-for"的硬性要求。
    // 修改方式：用正则断言旧反模式不存在，同时断言新 MessageRenderBlock 组件被正确引入。
    // 修改目的：防止后续维护误把 v-memo 重新放进 v-for 内部子节点。
    const source = readWorkspaceFile('frontend/src/components/message/MessageItem.vue');

    // 反模式：<template v-for ...> ... v-memo 跨多层嵌套（v-memo 在 template 内部子节点上）
    // 注意：Vue 模板编译后 template 标签会被消除，所以这里的"template v-for 内"指的是
    // <template v-for> 的下一级子节点上挂 v-memo，而不是同在 template 标签上。
    const nestedVMemoinVFor = /<template[^>]*v-for[^>]*>[\s\S]*?v-memo/;
    expect(nestedVMemoinVFor.test(source)).toBe(false);

    // 确认 MessageRenderBlock 被正确引入且 v-memo 通过 getRenderBlockMemoDeps 使用
    expect(source).toContain("import MessageRenderBlock from './MessageRenderBlock.vue'");
    expect(source).toContain('getRenderBlockKey');
    expect(source).toContain('getRenderBlockMemoDeps');

    // 确认 MessageRenderBlock 上 v-memo 与 v-for 在同一组件元素
    // （v-for 和 v-memo 可能在多行属性声明中分行，但它们都在同一个 MessageRenderBlock 组件元素上）
    expect(source).toContain('<MessageRenderBlock');
    expect(source).toContain('v-for="block in contentRenderBlocks"');
    // v-memo 在 MessageRenderBlock 上使用 getRenderBlockMemoDeps，并包含 thought 展开/计时状态，避免 memo 跳过必要 UI 更新。
    expect(source).toContain('v-memo="getRenderBlockMemoDeps(block, isStreaming, isUser, isThoughtExpanded, isThinking, thinkingTimeDisplay)"');
  });

  it('MessageRenderBlock.vue has no v-memo inside (memo belongs on parent component element)', () => {
    // 修改原因：v-memo 边界由父组件 MessageItem.vue 在 MessageRenderBlock 组件元素上统一控制。
    // MessageRenderBlock 内部禁止出现 v-memo，否则会形成双层嵌套缓存，破坏语义。
    // 修改方式：静态断言 MessageRenderBlock.vue 源码中不包含 v-memo。
    // 修改目的：防止后续维护把 v-memo 误加进展示组件内部。
    const source = readWorkspaceFile('frontend/src/components/message/MessageRenderBlock.vue');

    // 排除注释行后不应出现 v-memo
    const nonCommentLines = source
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('<!--');
      });

    const vMemoLines = nonCommentLines.filter(line => line.includes('v-memo'));
    expect(vMemoLines.length).toBe(0);
  });

  it('renderBlocks.ts exports expected functions and type', () => {
    // 修改原因：renderBlocks.ts 是 WP31 方案 2 的共享类型与纯函数文件，
    // 必须导出 RenderBlock、getRenderBlockKey、getRenderBlockMemoDeps。
    // 修改方式：源码级别断言关键导出存在。
    // 修改目的：确保类型外提完成，MessageItem 和 MessageRenderBlock 可共享同一接口。
    const source = readWorkspaceFile('frontend/src/components/message/renderBlocks.ts');

    expect(source).toContain('export interface RenderBlock');
    expect(source).toContain('export function getRenderBlockKey');
    expect(source).toContain('export function getRenderBlockMemoDeps');
  });
});
