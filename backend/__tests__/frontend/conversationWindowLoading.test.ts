import {
  buildInitialVisibleMessageWindow,
  INITIAL_MESSAGES_TAIL_SIZE,
  MIN_INITIAL_VISIBLE_MESSAGES,
  OLDER_MESSAGES_PAGE_SIZE
} from '../../../frontend/src/stores/chat/conversationActions';
import type { Content } from '../../../frontend/src/types';

function visibleContent(index: number, text = `message ${index}`): Content {
  return {
    role: index % 2 === 0 ? 'user' : 'model',
    index,
    parts: [{ text }]
  };
}

function functionResponseContent(index: number): Content {
  return {
    role: 'user',
    index,
    isFunctionResponse: true,
    parts: [{
      functionResponse: {
        id: `call-${index}`,
        name: 'read_file',
        response: { success: true }
      }
    }]
  };
}

describe('conversation window loading semantics', () => {
  it('uses a 20-message tail window for importer/initial entry budgets', () => {
    expect(INITIAL_MESSAGES_TAIL_SIZE).toBe(20);
    expect(MIN_INITIAL_VISIBLE_MESSAGES).toBe(20);
    expect(OLDER_MESSAGES_PAGE_SIZE).toBeGreaterThan(INITIAL_MESSAGES_TAIL_SIZE);
  });

  it('does not backfill when the initial tail already contains 20 visible messages', async () => {
    const initialTail = Array.from({ length: INITIAL_MESSAGES_TAIL_SIZE }, (_, offset) => visibleContent(80 + offset));
    const fetchOlder = jest.fn();

    const window = await buildInitialVisibleMessageWindow(initialTail, 100, fetchOlder);

    expect(fetchOlder).not.toHaveBeenCalled();
    expect(window.windowStartIndex).toBe(80);
    expect(window.totalMessages).toBe(100);
    expect(window.messages).toHaveLength(INITIAL_MESSAGES_TAIL_SIZE);
  });

  it('backfills initial hidden functionResponse rows by explicit beforeIndex range, not by reloading tail', async () => {
    const initialTail = [
      ...Array.from({ length: 10 }, (_, offset) => functionResponseContent(80 + offset)),
      ...Array.from({ length: 10 }, (_, offset) => visibleContent(90 + offset))
    ];
    const older = Array.from({ length: 10 }, (_, offset) => visibleContent(70 + offset));
    const fetchOlder = jest.fn().mockResolvedValue({ total: 100, messages: older });

    const window = await buildInitialVisibleMessageWindow(initialTail, 100, fetchOlder);

    expect(fetchOlder).toHaveBeenCalledTimes(1);
    expect(fetchOlder).toHaveBeenCalledWith(80);
    expect(window.windowStartIndex).toBe(70);
    expect(window.messages.map(message => message.backendIndex)).toEqual([
      ...Array.from({ length: 10 }, (_, offset) => 70 + offset),
      ...Array.from({ length: 20 }, (_, offset) => 80 + offset)
    ]);
  });
});
