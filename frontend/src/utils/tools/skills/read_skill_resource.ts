/**
 * read_skill_resource 工具注册。
 *
 * 为什么要加：后端已提供安全的 Skill 资源读取工具，但前端没有专用渲染，导致资源内容
 * 只能以通用 JSON 回退显示，既难读也容易掩盖 sha/truncated 等重要元信息。
 * 怎么改：通过现有 toolRegistry 注册 contentComponent，不新增协议、不改 ToolMessage。
 * 目的：让主聊天和 SubAgent Monitor 都能自动复用同一张安全、紧凑的资源读取卡片。
 */
import { registerTool } from '../../toolRegistry'
import ReadSkillResourceComponent from '../../../components/tools/skills/read_skill_resource.vue'

registerTool('read_skill_resource', {
  name: 'read_skill_resource',
  label: 'Read Skill Resource',
  icon: 'codicon-file-text',

  descriptionFormatter: (args) => {
    const name = typeof args?.name === 'string' ? args.name : 'skill'
    const relativePath = typeof args?.relativePath === 'string' ? args.relativePath : 'resource'
    return `${name}: ${relativePath}`
  },

  contentComponent: ReadSkillResourceComponent
})
