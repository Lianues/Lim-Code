/**
 * toggle_skills 工具注册
 */

import { registerTool } from '../../toolRegistry'
import ToggleSkillsComponent from '../../../components/tools/skills/toggle_skills.vue'

// 注册 toggle_skills 工具
registerTool('toggle_skills', {
  name: 'toggle_skills',
  label: 'Toggle Skills',
  icon: 'codicon-lightbulb',
  
  // 描述生成器 - 显示操作的 skills
  descriptionFormatter: (args) => {
    const entries = Object.entries(args).filter(([_, v]) => typeof v === 'boolean')
    const enabling = entries.filter(([_, v]) => v === true).map(([k]) => k)
    const disabling = entries.filter(([_, v]) => v === false).map(([k]) => k)
    
    const parts: string[] = []
    if (enabling.length > 0) {
      parts.push(`Enable: ${enabling.join(', ')}`)
    }
    if (disabling.length > 0) {
      parts.push(`Disable: ${disabling.join(', ')}`)
    }
    
    return parts.length > 0 ? parts.join(' | ') : 'Toggle skills'
  },
  
  // 使用自定义组件显示内容
  contentComponent: ToggleSkillsComponent
})
