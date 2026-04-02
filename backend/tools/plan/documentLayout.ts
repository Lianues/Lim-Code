/**
 * Plan 文档布局辅助函数
 */

import { normalizeLineEndingsToLF } from '../utils';
import { normalizePlanTodoList, renderPlanTodoListSection, stripPlanTodoListSection, type PlanTodoItem } from './todoListSection';
import { stripPlanSourceArtifactSection } from './sourceArtifactSection';

export function extractPlanBodyContent(content: string): string {
  const normalized = normalizeLineEndingsToLF(content || '');
  const withoutSource = stripPlanSourceArtifactSection(normalized);
  const withoutTodos = stripPlanTodoListSection(withoutSource);
  return withoutTodos.trim();
}

export function buildPlanDocument(
  planContent: string,
  todosInput: unknown,
  sourceSection?: string | null
): {
  content: string;
  todos: PlanTodoItem[];
} {
  const todos = normalizePlanTodoList(todosInput);
  const todoSection = renderPlanTodoListSection(todos);
  const body = extractPlanBodyContent(planContent);
  const normalizedSourceSection = typeof sourceSection === 'string' ? sourceSection.trim() : '';

  const parts: string[] = [];
  if (normalizedSourceSection) parts.push(normalizedSourceSection);
  parts.push(todoSection);
  if (body) parts.push(body);

  return {
    content: `${parts.join('\n\n')}\n`,
    todos
  };
}
