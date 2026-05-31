import * as vscode from "vscode";

const OPEN_VIEW_COMMAND = "vscode-panel-agent-shadow.openView";
const SHADOW_VIEW_ID = "vscode-panel-agent-shadow.view";

export function activate(context: vscode.ExtensionContext): void {
  // 为什么要改：影子实现需要从编辑器标签页式 Webview Panel 收敛到 LimCode 主窗口更接近的侧边栏 Webview View。
  // 怎么改：注册唯一的 WebviewViewProvider，让 VS Code 在用户打开 Activity Bar 视图时通过 resolveWebviewView 创建 Webview。
  // 目的是什么：建立后续 Agent Panel 的真实主干入口，避免继续沿用 createWebviewPanel 形成和目标形态不一致的平行路径。
  const viewProviderDisposable = vscode.window.registerWebviewViewProvider(
    SHADOW_VIEW_ID,
    new PanelAgentShadowViewProvider(),
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );

  // 为什么要改：原来的 openPanel 命令会创建一个独立 WebviewPanel，现在入口已经迁移到 Webview View。
  // 怎么改：把命令改成只聚焦已贡献的侧边栏视图，不再创建新的 Panel。
  // 目的是什么：保留一个可手动触发的开发入口，同时确保用户看到的是唯一 canonical Webview View 路径。
  const openViewDisposable = vscode.commands.registerCommand(OPEN_VIEW_COMMAND, async () => {
    await vscode.commands.executeCommand(`${SHADOW_VIEW_ID}.focus`);
  });

  context.subscriptions.push(viewProviderDisposable, openViewDisposable);
}

export function deactivate(): void {
  // 为什么要改：VSCode 扩展入口需要显式导出 deactivate，即使当前最小实现没有释放资源。
  // 怎么改：保留空实现，不在这里添加状态清理或额外生命周期逻辑。
  // 目的是什么：让扩展生命周期完整，同时避免在 Stage 1 之前提前引入不必要的状态 owner。
}

class PanelAgentShadowViewProvider implements vscode.WebviewViewProvider {
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    // 为什么要改：Webview View 由 VS Code 生命周期按需解析，不能再通过 createWebviewPanel 主动创建。
    // 怎么改：在 resolveWebviewView 中配置当前 Webview，并写入最小静态 HTML。
    // 目的是什么：让“打开视图 -> Extension Host 提供 HTML -> Webview 渲染”的主干先跑通。
    webviewView.webview.options = {
      enableScripts: false
    };

    // 为什么要改：本 slice 只验证侧边栏 Webview View 和静态渲染，不应该提前引入脚本、通信或状态。
    // 怎么改：直接返回一段显示 Helloween 的静态 HTML。
    // 目的是什么：保持迁移到 Webview View 的步长足够小，下一步再在同一主干上加入 WebviewCommand。
    webviewView.webview.html = getHelloweenHtml();
  }
}

function getHelloweenHtml(): string {
  // 为什么要改：HTML 生成集中在一个函数里，避免后续 Webview 内容散落在 provider 生命周期代码中。
  // 怎么改：返回最小静态文档，并且不启用脚本。
  // 目的是什么：当前目标只验证 Webview View 显示 Helloween，避免在通信协议出现前制造并行路径。
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Helloween</title>
</head>
<body>
  <main>
    <h1>Helloween</h1>
    <p>The shadow Agent view is now hosted as a VS Code Webview View.</p>
  </main>
</body>
</html>`;
}
