/**
 * execute_skill_script 工具注册。
 *
 * 为什么要加：Skill 脚本执行是高风险且高价值的操作，通用 JSON 回退无法清楚展示 runner、
 * exitCode、killed 和输出日志，也不利于用户审计。
 * 怎么改：仅在前端注册专用 contentComponent，确认/拒绝仍由 ToolMessage 的通用
 * awaiting_approval 流程负责。
 * 目的：在不新增协议和不触碰 SubAgent Monitor 的前提下，提供一致的脚本执行审计视图。
 */
import { registerTool } from '../../toolRegistry'
import ExecuteSkillScriptComponent from '../../../components/tools/skills/execute_skill_script.vue'

registerTool('execute_skill_script', {
  name: 'execute_skill_script',
  label: 'Execute Skill Script',
  icon: 'codicon-terminal',

  descriptionFormatter: (args) => {
    const name = typeof args?.name === 'string' ? args.name : 'skill'
    const relativePath = typeof args?.relativePath === 'string' ? args.relativePath : 'script'
    return `${name}: ${relativePath}`
  },

  contentComponent: ExecuteSkillScriptComponent
})
