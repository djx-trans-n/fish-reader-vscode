import * as vscode from 'vscode';

export function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

/** Sidebar library list (Claude-Code-style: new / search / conversation list). */
export function getLibraryHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'library.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'styles.css'));
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>FishReader</title>
</head>
<body>
  <div id="lib">
    <button id="lib-new" class="lib-new">＋ 新建会话</button>
    <div class="lib-search">
      <input id="lib-search" type="text" placeholder="搜索小说…" />
    </div>
    <div id="lib-list" class="lib-list"></div>
    <div id="lib-empty" class="lib-empty hidden">还没有阅读记录。<br/>点「新建会话」打开一本小说(txt / epub / fb2)。</div>
    <div class="lib-promo" id="lib-promo">
      <div class="promo-actions">
        <button class="promo-link promo-link-wide" id="promo-github" title="在 GitHub 上查看本项目">
          <svg class="promo-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
          <span>GitHub</span>
        </button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** Shared HTML for the editor-tab reading panel (and legacy view). */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'styles.css'));
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>FishReader</title>
</head>
<body>
  <div id="app">
    <header id="titlebar">
      <span id="brand-icon">✳</span>
      <span id="brand-name">Claude</span>
      <span id="brand-sub" class="muted"></span>
      <span id="session-title">Claude Code</span>
      <span class="titlebar-spacer"></span>
      <div class="titlebar-actions">
        <button class="icon-btn" title="Bookmark session" tabindex="-1">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7v11L8 11l-3.5 2.5z"/></svg>
        </button>
        <button class="icon-btn" title="Past conversations" tabindex="-1">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.4"/></svg>
        </button>
        <button class="icon-btn" title="New session" tabindex="-1">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 1-4.6 8.5L2.5 13.5l.6-2.9A5.5 5.5 0 0 1 8 2.5z"/><path d="M8 5.8v4.4M5.8 8h4.4"/></svg>
        </button>
      </div>
    </header>
    <main id="log" tabindex="0"></main>
    <footer id="composer">
      <div id="slash-menu" class="hidden"></div>
      <div class="composer-box is-empty" id="composer-box" data-mode="default">
        <textarea id="input" rows="1" placeholder="输入消息…  / 唤起命令"></textarea>
        <div class="composer-toolbar">
          <div class="tb-left">
            <button class="tb-btn" id="plus-btn" title="Add context">+</button>
            <button class="tb-btn tb-slash" id="slash-btn" title="Slash commands"><span class="tb-slash-glyph">/</span></button>
            <button class="tb-btn" id="boss-btn" title="Boss mode ⌘B">&lt;/&gt;</button>
            <button class="tb-btn tb-fs" id="fs-dec" title="减小字号 (Ctrl/Cmd -)">A-</button>
            <button class="tb-btn tb-fs" id="fs-inc" title="增大字号 (Ctrl/Cmd +)">A+</button>
            <span class="file-chip" id="file-chip"></span>
          </div>
          <div class="tb-right">
            <span class="tb-model">Opus 5.5</span>
            <span class="tb-hint" id="tb-hint">Ask before edits</span>
            <button class="send-btn" id="send-btn" title="Send (Enter)"><span class="send-glyph">↑</span><svg class="send-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9"/></svg></button>
          </div>
        </div>
      </div>
    </footer>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
