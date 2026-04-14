export interface ChatVisibilityLike {
  isFunctionResponse?: boolean | null
}

export function isVisibleChatMessage<T extends ChatVisibilityLike>(message: T): boolean {
  return message?.isFunctionResponse !== true
}

export function filterVisibleChatMessages<T extends ChatVisibilityLike>(messages: T[]): T[] {
  if (!Array.isArray(messages) || messages.length === 0) return []
  return messages.filter(isVisibleChatMessage)
}

export function countVisibleChatMessages<T extends ChatVisibilityLike>(messages: T[]): number {
  return filterVisibleChatMessages(messages).length
}
