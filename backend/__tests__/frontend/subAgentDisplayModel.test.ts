import { buildSubAgentRunDisplayModel, summarizeSubAgentTask } from '../../../frontend/src/utils/subAgentDisplayModel';

describe('SubAgentRunDisplayModel', () => {
  it('does not derive the main-card task summary from raw prompt text', () => {
    // 修改原因：Bug 4 的最终复核指出“截取 prompt 第一行”仍是 raw prompt 泄漏，不能只把完整 prompt 换成短 prompt。
    // 修改方式：测试锁定 summarizeSubAgentTask 只暴露输入存在和长度级别，不包含 prompt 中的唯一敏感片段。
    // 修改目的：防止 ToolMessage descriptionFormatter 或 SubAgent subtitle 再次把内部 prompt 放回主卡片。
    const prompt = 'SECRET_INTERNAL_PROMPT_DO_NOT_SHOW\n请详细读取所有上下文并生成报告';
    const summary = summarizeSubAgentTask(prompt);

    expect(summary).toContain('已接收 SubAgent 任务输入');
    expect(summary).not.toContain('SECRET_INTERNAL_PROMPT_DO_NOT_SHOW');
    expect(summary).not.toContain('请详细读取');
  });

  it('keeps raw prompt only in debug fields while main preview stays generic during running state', () => {
    // 修改原因：SubAgent 卡片运行中和完成后要共用 DisplayModel，但主卡片字段不能显示 raw prompt。
    // 修改方式：构造运行中 display model，断言 taskSummary/preview 不含 prompt 内容，而 promptDebug 保留可审计原文。
    // 修改目的：满足“主卡片不泄漏，调试折叠区可审计”的双重要求。
    const prompt = 'RAW_PROMPT_SHOULD_ONLY_BE_DEBUG_SECTION';
    const model = buildSubAgentRunDisplayModel({ args: { agentName: 'worker', prompt } });

    expect(model.taskSummary).not.toContain(prompt);
    expect(model.preview).not.toContain(prompt);
    expect(model.promptDebug).toBe(prompt);
    expect(model.status).toBe('running');
  });
});
