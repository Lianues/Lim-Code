import { WebviewClientRegistry } from '../../../../webview/runtime/WebviewClientRegistry';

// WP23 cleanup: keep test-only registry construction in one helper so production ownership stays easy to audit.
export function createTestRegistry(): WebviewClientRegistry {
  return new WebviewClientRegistry();
}
