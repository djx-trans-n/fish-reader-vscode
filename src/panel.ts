import * as vscode from 'vscode';
import { Controller } from './controller';
import { LibraryController } from './library-controller';
import { StateStore } from './engine/state';
import { WorkspaceScanner } from './disguise/workspace-scanner';
import { FromWebview, ToWebview, FromLibrary, ToLibrary } from './types';
import { getHtml, getLibraryHtml } from './webviewHtml';
import { HostRegistry } from './hosts';

export interface OpenIntent {
  bookId?: string;
  newSession?: boolean;
}

/** Sidebar (activity-bar) webview: the Claude-Code-style library list. */
export class FishReaderViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'fishReader.view';

  private view?: vscode.WebviewView;
  public library?: LibraryController;
  private starCount?: number;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: StateStore,
    private readonly onOpenBook: (id: string) => void,
    private readonly onNewSession: () => void,
    private readonly repoUrl: string
  ) {}

  private openGithub() {
    void vscode.env.openExternal(vscode.Uri.parse(this.repoUrl));
  }

  /** Confirm and delete a book's reading record. Resolves true if removed. */
  private async confirmDelete(id: string): Promise<boolean> {
    const title = this.state.getBook(id)?.title ?? '该记录';
    const pick = await vscode.window.showWarningMessage(
      `删除「${title}」的阅读记录?`,
      { modal: true, detail: '仅删除阅读进度记录,不会删除本地文件。' },
      '删除'
    );
    if (pick !== '删除') return false;
    this.state.deleteBook(id);
    return true;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    const post = (msg: ToLibrary) => this.view?.webview.postMessage(msg);
    const library = new LibraryController(
      post,
      this.state,
      this.onOpenBook,
      this.onNewSession,
      () => this.openGithub(),
      (id) => this.confirmDelete(id)
    );
    this.library = library;

    webviewView.webview.html = getLibraryHtml(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage((msg: FromLibrary) => {
      library.handle(msg);
      if (msg.type === 'lib-ready') void this.postStars(post);
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) library.refresh();
    });
  }

  /** Fetch the repo's GitHub star count (once per session) and push it to the sidebar. */
  private async postStars(post: (msg: ToLibrary) => void) {
    const count = await this.fetchStars();
    if (typeof count === 'number') post({ type: 'stars', count });
  }

  private async fetchStars(): Promise<number | undefined> {
    if (typeof this.starCount === 'number') return this.starCount;
    const m = this.repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!m) return undefined;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, {
        headers: { 'User-Agent': 'fishreader-vscode', Accept: 'application/vnd.github+json' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return undefined;
      const json = (await res.json()) as { stargazers_count?: number };
      if (typeof json.stargazers_count === 'number') {
        this.starCount = json.stargazers_count;
        return this.starCount;
      }
    } catch {
      /* offline / rate-limited — leave the button without a count */
    }
    return undefined;
  }

  refresh() {
    this.library?.refresh();
  }

  reveal() {
    this.view?.show?.(true);
  }
}

/** Editor-area webview tab (Claude-Code-style reading panel). Draggable. */
export class EditorPanelManager {
  private panel?: vscode.WebviewPanel;
  public controller?: Controller;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: StateStore,
    private readonly scanner: WorkspaceScanner,
    private readonly registry: HostRegistry,
    private readonly onBooksChanged: () => void
  ) {}

  open(column: vscode.ViewColumn, intent: OpenIntent = {}) {
    if (this.panel && this.controller) {
      this.panel.reveal(column);
      this.registry.markActive(this.controller);
      void this.controller.applyIntent(intent);
      return;
    }

    const panel = vscode.window.createWebviewPanel('fishReader.editor', 'Claude', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    });
    this.panel = panel;

    const post = (msg: ToWebview) => panel.webview.postMessage(msg);
    const controller = new Controller(post, this.state, this.scanner);
    controller.pendingIntent = intent;
    controller.onBooksChanged = this.onBooksChanged;
    controller.onTitleChange = (title: string) => {
      panel.title = title || 'Claude';
    };
    this.controller = controller;
    this.registry.add(controller);

    panel.webview.html = getHtml(panel.webview, this.extensionUri);

    panel.webview.onDidReceiveMessage((msg: FromWebview) => {
      this.registry.markActive(controller);
      controller.handle(msg);
    });
    panel.onDidChangeViewState(() => {
      if (panel.active) this.registry.markActive(controller);
    });
    panel.onDidDispose(() => {
      this.registry.remove(controller);
      this.controller = undefined;
      this.panel = undefined;
    });
  }
}
