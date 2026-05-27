import { getMultimodalCapability } from '../../tools/utils';

describe('getMultimodalCapability', () => {
    it('用户未启用多模态工具时保持全部关闭', () => {
        expect(getMultimodalCapability('openai-responses', 'function_call', false)).toEqual({
            supportsImages: false,
            supportsDocuments: false,
            supportsHistoryMultimodal: false
        });
    });

    it('OpenAI Responses 启用多模态工具后支持图片、文档和历史多模态', () => {
        expect(getMultimodalCapability('openai-responses', 'function_call', true)).toEqual({
            supportsImages: true,
            supportsDocuments: true,
            supportsHistoryMultimodal: true
        });
    });

    it('OpenAI function_call 模式启用多模态工具后仍按渠道能力禁用工具多模态', () => {
        expect(getMultimodalCapability('openai', 'function_call', true)).toEqual({
            supportsImages: false,
            supportsDocuments: false,
            supportsHistoryMultimodal: false
        });
    });

    it('OpenAI XML/JSON 模式启用多模态工具后支持图片但不支持文档', () => {
        expect(getMultimodalCapability('openai', 'xml', true)).toEqual({
            supportsImages: true,
            supportsDocuments: false,
            supportsHistoryMultimodal: true
        });
    });
});
