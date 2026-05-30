import { loadUnifiedLlmProviderConversionApi } from '../../modules/llmProvider/unifiedLlmProviderAdapter';

describe('unified-llm-provider conversion API adapter', () => {
  it('loads only the approved conversion APIs through the CommonJS-safe dynamic import boundary', async () => {
    // 修改原因：Phase A 必须证明 ESM-only unified-llm-provider 能在当前 Jest/CommonJS 后端测试环境中加载。
    // 修改方式：通过 LimCode adapter 的动态 import 边界加载，并只断言 convertRequest/convertResponse/createStreamConverter 三个允许 API。
    // 修改目的：防止测试误用 provider.chat/chatStream/router/transport，把 PoC 扩大成真实请求接管。
    const api = await loadUnifiedLlmProviderConversionApi();

    expect(typeof api.convertRequest).toBe('function');
    expect(typeof api.convertResponse).toBe('function');
    expect(typeof api.createStreamConverter).toBe('function');
    expect(Object.keys(api).sort()).toEqual(['convertRequest', 'convertResponse', 'createStreamConverter'].sort());
  });
});
