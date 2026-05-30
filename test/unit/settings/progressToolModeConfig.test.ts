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
  it('keeps progress tools in workflow modes and in the full-capability Code mode, but not Ask mode', () => {
    // 修改原因：2025-07 后 Code 模式被重新定义为全能力模式，旧测试仍按“专用工作流工具默认隐藏”判断，已经和产品决策相反。
    // 修改方式：断言 Code/Design/Plan/Review 均包含 progress 工具，而 Ask 仍保持轻量只读工具面。
    // 目的：让测试锁定当前真实策略，避免后续又把 Code 模式误收窄成半能力模式。
    expect(CODE_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PROGRESS_TOOLS))
    expect(DESIGN_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PROGRESS_TOOLS))
    expect(PLAN_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PROGRESS_TOOLS))
    expect(REVIEW_PROMPT_MODE.toolPolicy).toEqual(expect.arrayContaining(PROGRESS_TOOLS))

    for (const toolName of PROGRESS_TOOLS) {
      expect(ASK_PROMPT_MODE.toolPolicy).not.toContain(toolName)
    }
  })

  it('keeps plan, design, and review document tools available in full Code mode and their explicit workflow modes', () => {
    // 修改原因：当前 Code 模式是全能力默认模式，专用文档工具暴露给 Code 是有意行为，不再是泄漏。
    // 修改方式：验证 Code 包含 workflow 工具族，同时专用模式仍包含自己的核心工具。
    // 目的：防止测试继续惩罚已采纳的全能力 Code 模式策略。
    const codePolicy = CODE_PROMPT_MODE.toolPolicy || []
    for (const toolName of [...PLAN_TOOLS, ...DESIGN_TOOLS, ...REVIEW_TOOLS]) {
      expect(codePolicy).toContain(toolName)
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
    // 修改原因：SettingsManager 当前策略是“补齐缺失内置模式，但不覆盖用户已有 toolPolicy”。旧断言仍要求每次读取都强制同步，和代码注释及用户可配置性相冲突。
    // 修改方式：验证用户保存过的 toolPolicy 保持不变，默认常量仍承担新安装时的完整工具面。
    // 目的：防止读取设置时静默重开用户曾经关闭的工具。
    expect(config.modes.code.toolPolicy).toEqual(['read_file'])
    expect(config.modes.code.template).toBe('custom code template')
    expect(config.modes.design.toolPolicy).toEqual(['read_file'])
    expect(config.modes.plan.toolPolicy).toEqual(['read_file'])
    expect(config.modes.review.toolPolicy).toEqual(['read_file'])
    expect(config.modes.ask.toolPolicy).toEqual(['read_file', 'create_progress'])
  })
})
