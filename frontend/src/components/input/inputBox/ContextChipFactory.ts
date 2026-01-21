import type { PromptContextItem } from '../../../types/promptContext'

export interface ChipHandlers {
  onRemove: (id: string) => void
  onMouseEnter: (ctx: PromptContextItem) => void
  onMouseLeave: () => void
  onClick: (ctx: PromptContextItem) => void
}

/**
 * Single entry-point for building a context "chip" DOM node.
 * Keeping this in one place prevents drift between render/insert paths.
 */
export function createContextChipElement(
  ctx: PromptContextItem,
  iconClass: string,
  handlers: ChipHandlers
): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = 'context-chip'
  chip.contentEditable = 'false'
  chip.dataset.contextId = ctx.id

  const icon = document.createElement('i')
  icon.className = iconClass
  chip.appendChild(icon)

  const title = document.createElement('span')
  title.className = 'context-chip__text'
  title.textContent = ctx.title
  chip.appendChild(title)

  const removeBtn = document.createElement('button')
  removeBtn.className = 'context-chip__remove'
  removeBtn.type = 'button'
  removeBtn.innerHTML = '<i class="codicon codicon-close"></i>'
  removeBtn.onclick = (e) => {
    e.stopPropagation()
    handlers.onRemove(ctx.id)
  }
  chip.appendChild(removeBtn)

  chip.onmouseenter = () => handlers.onMouseEnter(ctx)
  chip.onmouseleave = () => handlers.onMouseLeave()
  chip.onclick = (e) => {
    e.stopPropagation()
    handlers.onClick(ctx)
  }

  return chip
}
