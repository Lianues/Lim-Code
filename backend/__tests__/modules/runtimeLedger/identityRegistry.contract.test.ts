import { RuntimeIdentityRegistry } from '../../../modules/runtimeLedger';

describe('RuntimeIdentityRegistry contracts', () => {
  it('generates backend-owned ids with kind prefixes and optional scope', () => {
    const registry = new RuntimeIdentityRegistry({
      now: () => 42,
      random: () => 'fixed'
    });

    expect(registry.create('event', 'monitor')).toBe('rtevt_monitor_42_fixed');
    expect(registry.create('message', 'run:1')).toBe('msg_run_1_42_fixed');
    expect(registry.create('toolInvocation')).toBe('tool_42_fixed');
  });

  it('rejects duplicate registered ids', () => {
    const registry = new RuntimeIdentityRegistry();
    registry.register('event', 'rtevt:external');

    expect(() => registry.register('event', 'rtevt:external')).toThrow('Duplicate runtime event id');
  });

  it('rejects ids with the wrong authority prefix', () => {
    const registry = new RuntimeIdentityRegistry();

    expect(() => registry.validate('message', 'frontend-local-1')).toThrow('Runtime message id must start with msg');
    expect(() => registry.register('toolInvocation', 'fc_123')).toThrow('Runtime toolInvocation id must start with tool');
  });
});
