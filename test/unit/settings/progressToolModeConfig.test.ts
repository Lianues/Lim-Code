import { SettingsManager, type SettingsStorage } from '../../../backend/modules/settings/SettingsManager'
import {
  ASK_PROMPT_MODE,
  CODE_PROMPT_MODE,
  DESIGN_PROMPT_MODE,
  PLAN_PROMPT_MODE,
  REVIEW_PROMPT_MODE,
} from '../../../backend/modules/settings/types'

class MemorySettingsStorage implements SettingsStorage {
  constructor(private readonly loaded: any = null) {}

  async load() {
    return this.loaded
  }

  async save() {
    return undefined
  }
}

const PROGRESS_TOOLS = ['create_progress', 'update_progress', 'record_progress_milestone', 'validate_progress_document']
const PLAN_TOOLS = ['create_plan', 'update_plan']
const DESIGN_TOOLS = ['create_design', 'update_design']
const REVIEW_TOOLS = [
  'create_review',
  'validate_review_document',
  'record_review_milestone',
  'finalize_review',
  'reopen_review',
  'compare_review_documents'
]

describe('progress tool mode config', () => {
  it('keeps progress tools in explicit workflow modes but not default Code or Ask mode', () => {
    // 为什么要改：用户要求 progress 等项目 ledger 工具默认不暴露，但显式 workflow 模式仍要能维护项目状态。
    // 怎么改：同时断言 Code/Ask 不含 progress，Design/Plan/Review 仍含 progress。
    // 目的：防止以后把默认工具面和显式模式能力再次混在一起。
    expect(DESIGN_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PROGRESS_TOOLS))
    expect(PLAN_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PROGRESS_TOOLS))
    expect(REVIEW_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PROGRESS_TOOLS))

    for (const toolName of PROGRESS_TOOLS) {
      expect(CODE_PROMPT_MODE.toolPolicy).not.toContain(toolName)
      expect(ASK_PROMPT_MODE.toolPolicy).not.toContain(toolName)
    }
  })

  it('keeps plan, design, and review document tools out of default Code mode', () => {
    // 为什么要改：Code 模式过去没有 toolPolicy，导致专用文档工具默认开启。
    // 怎么改：验证 Code toolPolicy 显式排除 plan/design/review 工具族。
    // 目的：锁定默认工具面，确保这些旧版默认内置工具只能通过专用模式使用。
    const codePolicy = CODE_PROMPT_MODE.toolPolicy || []
    for (const toolName of [...PLAN_TOOLS, ...DESIGN_TOOLS, ...REVIEW_TOOLS]) {
      expect(codePolicy).not.toContain(toolName)
    }
    expect(PLAN_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PLAN_TOOLS))
    expect(DESIGN_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(DESIGN_TOOLS))
    expect(REVIEW_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(REVIEW_TOOLS.filter(name => name !== 'compare_review_documents')))
  })

  it('SettingsManager synchronizes built-in mode toolPolicy updates for progress tools', async () => {
    const storage = new MemorySettingsStorage({
      toolsConfig: {
        system_prompt: {
          currentModeId: 'code',
          modes: {
            code: {
              ...CODE_PROMPT_MODE,
              template: 'custom code template',
              toolPolicy: ['read_file']
            },
            design: {
              ...DESIGN_PROMPT_MODE,
              toolPolicy: ['read_file']
            },
            plan: {
              ...PLAN_PROMPT_MODE,
              toolPolicy: ['read_file']
            },
            ask: {
              ...ASK_PROMPT_MODE,
              toolPolicy: ['read_file', 'create_progress']
            },
            review: {
              ...REVIEW_PROMPT_MODE,
              toolPolicy: ['read_file']
            }
          }
        }
      }
    })

    const manager = new SettingsManager(storage)
    await manager.initialize()

    const config = manager.getSystemPromptConfig()
    // 为什么要改：Code mode 现在也需要迁移旧 toolPolicy，否则已有 settings 会继续默认暴露专用工具。
    // 怎么改：断言 SettingsManager 与其他内置模式一样同步 Code toolPolicy，但保留用户自定义模板。
    // 目的：验证迁移既收紧默认工具面，又不覆盖用户 prompt 文本。
    expect(config.modes.code.toolPolicy).toEqual(CODE_PROMPT_MODE.toolPolicy)
    expect(config.modes.code.template).toBe('custom code template')
    expect(config.modes.design.toolPolicy).toEqual(DESIGN_PROMPT_MODE.toolPolicy)
    expect(config.modes.plan.toolPolicy).toEqual(PLAN_PROMPT_MODE.toolPolicy)
    expect(config.modes.review.toolPolicy).toEqual(REVIEW_PROMPT_MODE.toolPolicy)
    expect(config.modes.ask.toolPolicy).toEqual(ASK_PROMPT_MODE.toolPolicy)
  })
})
