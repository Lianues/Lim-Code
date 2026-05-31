import { computeVirtualRows } from '../../../frontend/src/components/message/messageListUtils';

describe('message list virtualization helpers', () => {
  it('bounds mounted rows for long lists using viewport and overscan', () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ id: index }));

    const result = computeVirtualRows(rows, {
      threshold: 100,
      estimatedRowHeight: 100,
      overscan: 5,
      viewportHeight: 600,
      scrollTop: 12_000
    });

    expect(result.virtualized).toBe(true);
    expect(result.rows.length).toBeLessThanOrEqual(16);
    expect(result.startIndex).toBeGreaterThan(0);
    expect(result.endIndex).toBeLessThan(rows.length);
    expect(result.topPadding).toBeGreaterThan(0);
    expect(result.bottomPadding).toBeGreaterThan(0);
  });
});
