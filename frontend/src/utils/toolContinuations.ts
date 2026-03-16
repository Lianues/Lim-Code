function normalizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getPlanExecutionPrompt(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  return normalizePrompt((response as Record<string, unknown>).planExecutionPrompt)
}

export function getPlanGenerationPrompt(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  return normalizePrompt((response as Record<string, unknown>).planGenerationPrompt)
}

export function getToolContinuationPrompt(response: unknown): string {
  return getPlanExecutionPrompt(response) || getPlanGenerationPrompt(response)
}

export function isAwaitingToolUserConfirmation(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false

  const record = response as Record<string, unknown>
  if (record.requiresUserConfirmation !== true) return false

  return getToolContinuationPrompt(record).length === 0
}
