import {
  WEBVIEW_CLIENT_IDS,
  WebviewClientRegistry
} from '../../../webview/runtime/WebviewClientRegistry';

function createClient(clientId = WEBVIEW_CLIENT_IDS.mainChat) {
  const messages: any[] = [];
  return {
    messages,
    registration: {
      clientId,
      postMessage: jest.fn((message: Record<string, unknown>) => {
        messages.push(message);
        return true;
      })
    }
  };
}

describe('WebviewClientRegistry visibility state', () => {
  it('defaults registered clients to visible and tracks visibility changes', () => {
    const registry = new WebviewClientRegistry();
    const client = createClient();

    registry.register(client.registration);

    expect(registry.isVisible(WEBVIEW_CLIENT_IDS.mainChat)).toBe(true);
    expect(registry.getVisibility(WEBVIEW_CLIENT_IDS.mainChat)).toEqual(expect.objectContaining({
      visible: true,
      source: 'register'
    }));

    expect(registry.setVisibility(WEBVIEW_CLIENT_IDS.mainChat, false, 'frontend', 'hidden')).toBe(true);
    expect(registry.isVisible(WEBVIEW_CLIENT_IDS.mainChat)).toBe(false);

    const hidden = registry.getVisibility(WEBVIEW_CLIENT_IDS.mainChat)!;
    expect(hidden).toEqual(expect.objectContaining({
      visible: false,
      source: 'frontend',
      reason: 'hidden'
    }));

    expect(registry.setVisibility(WEBVIEW_CLIENT_IDS.mainChat, true, 'vscode', 'visible')).toBe(true);
    const visible = registry.getVisibility(WEBVIEW_CLIENT_IDS.mainChat)!;
    expect(visible.visible).toBe(true);
    expect(visible.sequence).toBeGreaterThan(hidden.sequence);
  });

  it('returns false when setting visibility for an unknown client', () => {
    const registry = new WebviewClientRegistry();

    expect(registry.setVisibility('missing-client', false, 'frontend')).toBe(false);
    expect(registry.getVisibility('missing-client')).toBeUndefined();
    expect(registry.isVisible('missing-client')).toBe(true);
  });
});

