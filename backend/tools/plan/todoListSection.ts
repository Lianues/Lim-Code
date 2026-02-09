/**
 * Plan 文档中的 TODO LIST 章节处理工具
 */

export type PlanTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface PlanTodoItem {
  id: string;
  content: string;
  status: PlanTodoStatus;
}

const TODO_SECTION_TITLE = '## TODO LIST';
const TODO_SECTION_START = '<!-- LIMCODE_TODO_LIST_START -->';
const TODO_SECTION_END = '<!-- LIMCODE_TODO_LIST_END -->';

function normalizeTodoStatus(value: unknown): PlanTodoStatus {
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled') return value;
  return 'pending';
}

function normalizeSingleLineText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sortPlanTodoList(items: PlanTodoItem[]): PlanTodoItem[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
}

export function normalizePlanTodoList(raw: unknown): PlanTodoItem[] {
  if (!Array.isArray(raw)) return [];

  const byId = new Map<string, PlanTodoItem>();
  for (const item of raw) {
    const idRaw = (item as any)?.id;
    const contentRaw = (item as any)?.content;
    if (typeof idRaw !== 'string' || !idRaw.trim()) continue;
    if (typeof contentRaw !== 'string') continue;

    const id = idRaw.trim();
    const content = normalizeSingleLineText(contentRaw);
    const status = normalizeTodoStatus((item as any)?.status);

    byId.set(id, {
      id,
      content: content || id,
      status,
    });
  }

  return sortPlanTodoList(Array.from(byId.values()));
}

function toCheckbox(status: PlanTodoStatus): 'x' | ' ' {
  return status === 'completed' ? 'x' : ' ';
}

export function renderPlanTodoListSection(todosInput: unknown): string {
  const todos = normalizePlanTodoList(todosInput);
  const lines = todos.map((todo) => {
    const checkbox = toCheckbox(todo.status);
    return `- [${checkbox}] [${todo.status}] ${todo.content}  \`#${todo.id}\``;
  });

  const body = lines.length > 0 ? lines.join('\n') : '<!-- no todos -->';

  return [
    TODO_SECTION_TITLE,
    '',
    TODO_SECTION_START,
    body,
    TODO_SECTION_END,
  ].join('\n');
}

function stripExistingGeneratedTodoSection(content: string): string {
  const start = content.indexOf(TODO_SECTION_START);
  const end = start >= 0 ? content.indexOf(TODO_SECTION_END, start + TODO_SECTION_START.length) : -1;
  if (start < 0 || end < 0 || end < start) {
    return content;
  }

  const removeFrom = (() => {
    const headingIndex = content.lastIndexOf(TODO_SECTION_TITLE, start);
    return headingIndex >= 0 ? headingIndex : start;
  })();
  const removeTo = end + TODO_SECTION_END.length;

  const before = content.slice(0, removeFrom).trimEnd();
  const after = content.slice(removeTo).trim();

  if (before && after) return `${before}\n\n${after}`;
  return before || after || '';
}

export function appendPlanTodoListSection(planContent: string, todosInput: unknown): {
  content: string;
  todos: PlanTodoItem[];
} {
  const todos = normalizePlanTodoList(todosInput);
  const normalizedPlan = (planContent || '').replace(/\r\n?/g, '\n').trimEnd();
  const base = stripExistingGeneratedTodoSection(normalizedPlan).trimEnd();
  const todoSection = renderPlanTodoListSection(todos);

  const finalContent = base
    ? `${base}\n\n${todoSection}\n`
    : `${todoSection}\n`;

  return {
    content: finalContent,
    todos,
  };
}

function extractTodoSection(content: string): string {
  const normalized = (content || '').replace(/\r\n?/g, '\n');

  const start = normalized.indexOf(TODO_SECTION_START);
  const end = start >= 0 ? normalized.indexOf(TODO_SECTION_END, start + TODO_SECTION_START.length) : -1;
  if (start >= 0 && end > start) {
    return normalized.slice(start + TODO_SECTION_START.length, end);
  }

  const headingRegex = /^##\s+TODO LIST\s*$/im;
  const headingMatch = headingRegex.exec(normalized);
  if (!headingMatch || typeof headingMatch.index !== 'number') return '';

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const rest = normalized.slice(sectionStart);
  const nextHeadingMatch = /\n#{1,6}\s+/.exec(rest);
  if (!nextHeadingMatch || typeof nextHeadingMatch.index !== 'number') {
    return rest;
  }

  return rest.slice(0, nextHeadingMatch.index);
}

function extractId(text: string): string {
  const inlineCodeMatch = text.match(/`#([^`]+)`/);
  if (inlineCodeMatch && inlineCodeMatch[1]?.trim()) return inlineCodeMatch[1].trim();

  const plainMatch = text.match(/(?:^|\s)#([A-Za-z0-9._:-]+)/);
  if (plainMatch && plainMatch[1]?.trim()) return plainMatch[1].trim();

  return '';
}

function parseStatusFromTail(text: string): PlanTodoStatus | null {
  const m = text.match(/\((pending|in_progress|completed|cancelled|in\s+progress|canceled)\)\s*$/i);
  if (!m || !m[1]) return null;
  const raw = m[1].toLowerCase().replace(/\s+/g, '_');
  if (raw === 'canceled') return 'cancelled';
  if (raw === 'pending' || raw === 'in_progress' || raw === 'completed' || raw === 'cancelled') return raw;
  return null;
}

function cleanupTodoContent(text: string, id: string): string {
  let out = text;

  out = out.replace(/`#([^`]+)`/g, ' ');
  if (id) {
    const idPattern = new RegExp(`(?:^|\\s)#${escapeRegExp(id)}\\b`, 'g');
    out = out.replace(idPattern, ' ');
  }

  out = out.replace(/\((pending|in_progress|completed|cancelled|in\s+progress|canceled)\)\s*$/i, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

export function extractPlanTodoListFromContent(content: string): PlanTodoItem[] {
  const section = extractTodoSection(content);
  if (!section.trim()) return [];

  const byId = new Map<string, PlanTodoItem>();
  const lines = section.split(/\r?\n/);

  for (const line of lines) {
    const checkboxMatch = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s*(?:\[(pending|in_progress|completed|cancelled)\]\s*)?(.*)$/i);
    if (checkboxMatch) {
      const checked = (checkboxMatch[1] || '').toLowerCase() === 'x';
      const explicitStatusRaw = (checkboxMatch[2] || '').toLowerCase();
      const rawText = (checkboxMatch[3] || '').trim();
      const id = extractId(rawText);
      if (!id) continue;

      const explicitStatus = explicitStatusRaw === 'pending' ||
        explicitStatusRaw === 'in_progress' ||
        explicitStatusRaw === 'completed' ||
        explicitStatusRaw === 'cancelled'
        ? (explicitStatusRaw as PlanTodoStatus)
        : null;

      const status = explicitStatus || parseStatusFromTail(rawText) || (checked ? 'completed' : 'pending');
      const cleanedContent = cleanupTodoContent(rawText, id);

      byId.set(id, {
        id,
        content: cleanedContent || id,
        status,
      });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (!bulletMatch) continue;

    const rawText = (bulletMatch[1] || '').trim();
    if (!rawText || rawText.startsWith('<!--')) continue;

    const id = extractId(rawText);
    if (!id) continue;

    const status = parseStatusFromTail(rawText) || 'pending';
    const cleanedContent = cleanupTodoContent(rawText, id);

    byId.set(id, {
      id,
      content: cleanedContent || id,
      status,
    });
  }

  return sortPlanTodoList(Array.from(byId.values()));
}

export const PLAN_TODO_SECTION_TITLE = TODO_SECTION_TITLE;
export const PLAN_TODO_SECTION_START = TODO_SECTION_START;
export const PLAN_TODO_SECTION_END = TODO_SECTION_END;
