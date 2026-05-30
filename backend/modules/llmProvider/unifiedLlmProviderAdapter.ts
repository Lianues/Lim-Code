export interface UnifiedLlmProviderConversionApi {
  convertRequest: (...args: any[]) => any
  convertResponse: (...args: any[]) => any
  createStreamConverter: (...args: any[]) => any
}

let cachedApi: Promise<UnifiedLlmProviderConversionApi> | undefined

export async function loadUnifiedLlmProviderConversionApi(): Promise<UnifiedLlmProviderConversionApi> {
  /**
   * 修改原因：`unified-llm-provider` 当前是 ESM 包，而 LimCode extension后端仍以 CommonJS 编译；直接静态 import 会让 VS Code Extension Host/Jest 在 CJS 边界失败。
   * 修改方式：用 `Function('specifier', 'return import(specifier)')` 保留原生动态 import，并只暴露经过 LimCode 校验的 conversion API。
   * 修改目的：Phase A 只验证 convertRequest/convertResponse/createStreamConverter，不让第三方 provider/chat/router/transport 进入生产请求路径。
   */
  if (!cachedApi) {
    cachedApi = (async () => {
      const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>
      const mod = await dynamicImport('unified-llm-provider')
      const api = {
        convertRequest: mod.convertRequest,
        convertResponse: mod.convertResponse,
        createStreamConverter: mod.createStreamConverter
      }
      for (const [name, value] of Object.entries(api)) {
        if (typeof value !== 'function') {
          throw new Error(`unified-llm-provider conversion API is missing ${name}`)
        }
      }
      return api
    })()
  }
  return cachedApi
}
