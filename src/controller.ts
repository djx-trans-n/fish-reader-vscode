import * as vscode from 'vscode';
import * as fs from 'fs';
import { ToWebview, FromWebview, StatusData } from './types';
import { ReaderEngine } from './engine/reader';
import { decodeBuffer } from './engine/encoding';
import { parseEpub } from './engine/formats/epub';
import { parseFb2 } from './engine/formats/fb2';
import { chaptersToText } from './engine/formats/structured';
import { StateStore, bookId, BookRecord } from './engine/state';
import { COMMANDS, parseInput } from './commands/registry';
import { WorkspaceScanner } from './disguise/workspace-scanner';
import { Segment } from './engine/paginator';
import { generateBossConversation, generateReadingDisguise } from './disguise/boss-mode';
import { initThinkingLog } from './disguise/thinking-animator';

type Poster = (msg: ToWebview) => void;
export type BossTrigger = 'hotkey' | 'button' | 'mouseLeave' | 'blur' | 'editorFocus' | 'command';

export class Controller {
  private engine?: ReaderEngine;
  private status: StatusData = { tokens: 12400, contextPct: 84, filesChanged: 0 };
  private bossActive = false;
  private bossTrigger?: BossTrigger;
  private bossSavedPosition = 0;
  private mouseLeaveTimer?: ReturnType<typeof setTimeout>;

  /** What this webview should show once it signals ready. */
  pendingIntent?: { bookId?: string; newSession?: boolean };
  /** Notified whenever the book list / progress changes (sidebar refresh). */
  onBooksChanged?: () => void;
  /** Update the host editor-tab title (disguise). */
  onTitleChange?: (title: string) => void;

  constructor(
    private post: Poster,
    private state: StateStore,
    private scanner: WorkspaceScanner
  ) {}

  // ---------- config ----------
  private cfg() {
    return vscode.workspace.getConfiguration('fishReader');
  }

  get isBoss() {
    return this.bossActive;
  }

  // ---------- lifecycle ----------
  onReady() {
    this.post({
      type: 'config',
      commands: COMMANDS,
      speed: this.cfg().get<string>('fakeThinkingSpeed', 'normal'),
    });
    this.post({ type: 'status', status: this.status });
    this.sendActiveFile();
    void this.applyIntent(this.pendingIntent ?? {});
    this.pendingIntent = undefined;
  }

  /** Apply an open-intent: a specific book, a fresh session, or restore the last. */
  async applyIntent(intent: { bookId?: string; newSession?: boolean }) {
    // Opening from the sidebar is an explicit read action — never land in boss.
    this.enterReadingMode();
    this.post({ type: 'clear' });
    if (intent.newSession) {
      this.engine = undefined;
      this.showWelcome();
    } else if (intent.bookId) {
      await this.openBookById(intent.bookId);
    } else {
      await this.restoreLast();
    }
  }

  private showWelcome() {
    this.post({
      type: 'assistant-text',
      markdown: true,
      text:
        '欢迎使用 **CLI Reader**。\n\n输入 `/init <文件路径>` 关联一本本地小说(支持 txt / epub / fb2),或点击输入框左下角的 `+` 选择文件。\n输入 `/help` 查看全部命令。',
    });
  }

  /** Open a known book by id (from the sidebar list). */
  async openBookById(id: string) {
    const rec = this.state.getBook(id);
    if (!rec) {
      this.showWelcome();
      return;
    }
    await this.switchBook(rec);
  }

  /** Push the current active editor's file name to the composer chip (CC look). */
  sendActiveFile() {
    const ed = vscode.window.activeTextEditor;
    const name =
      ed && ed.document.uri.scheme === 'file'
        ? ed.document.fileName.split(/[\\/]/).pop() ?? ''
        : '';
    this.post({ type: 'active-file', name });
  }

  private async restoreLast() {
    const rec = this.state.getLastBook();
    if (!rec) {
      this.showWelcome();
      return;
    }
    try {
      await this.loadBook(rec.path, rec.position);
      this.post({
        type: 'assistant-text',
        markdown: false,
        text: `已恢复《${rec.title}》上次阅读位置`,
      });
      this.cmdNext();
    } catch {
      this.post({
        type: 'assistant-text',
        text: `无法打开上次的书:${rec.path}(文件可能已移动)。用 /init 重新关联。`,
      });
    }
  }

  // ---------- message dispatch ----------
  async handle(msg: FromWebview) {
    switch (msg.type) {
      case 'ready':
        this.onReady();
        break;
      case 'command':
        await this.handleInput(msg.raw);
        break;
      case 'pick-file':
        await this.cmdPickFile();
        break;
      case 'request-next':
        this.cmdNext();
        break;
      case 'request-prev':
        this.cmdPrev();
        break;
      case 'toggle-boss':
        this.toggleBoss('button');
        break;
      case 'boss-fake-turn':
        if (this.bossActive) this.emitBossTurns(1);
        break;
      case 'mouse-leave':
        this.onMouseLeave();
        break;
      case 'mouse-enter':
        this.onMouseEnter();
        break;
    }
  }

  private async handleInput(raw: string) {
    const text = raw.trim();
    if (!text) return;

    // In boss mode, never respond to reading commands; just emit another fake turn.
    if (this.bossActive) {
      const p = parseInput(text);
      if (p.cmd === '/恢复' || p.cmd === '/boss') {
        this.exitBoss();
        return;
      }
      this.emitBossTurns(1);
      return;
    }

    this.post({ type: 'user-echo', text });
    const p = parseInput(text);

    if (!text.startsWith('/')) {
      this.post({ type: 'assistant-text', text: '未识别的输入。输入 / 查看命令,或 /help。' });
      return;
    }

    switch (p.cmd) {
      case '/init':
        await this.cmdInit(p.args);
        break;
      case '/目录':
        this.cmdToc();
        break;
      case '/下一页':
        this.cmdNext();
        break;
      case '/上一页':
        this.cmdPrev();
        break;
      case '/跳转':
        this.cmdJump(p.args);
        break;
      case '/搜索':
        this.cmdSearch(p.args);
        break;
      case '/书签':
        this.cmdBookmark(p.args);
        break;
      case '/历史':
        this.cmdHistory(p.args);
        break;
      case '/设置':
        this.cmdSettings();
        break;
      case '/boss':
        this.toggleBoss('command');
        break;
      case '/恢复':
        if (this.bossActive) this.exitBoss();
        else this.post({ type: 'assistant-text', text: '当前已是摸鱼态。' });
        break;
      case '/help':
        this.cmdHelp();
        break;
      default:
        this.post({ type: 'assistant-text', text: `未知命令:${p.cmd}。输入 /help 查看全部。` });
    }
  }

  // ---------- /init ----------
  private async loadBook(filePath: string, position = 0) {
    // Loading a book always means "read now" — drop any boss state/timer.
    this.enterReadingMode();
    const buf = fs.readFileSync(filePath);
    const baseName = filePath.split(/[\\/]/).pop() ?? 'book.txt';
    return this.loadBookFromBuffer(buf, baseName, filePath, position);
  }

  /** Core loader. `idKey` is the stable key for progress storage (a real path, or the file name for dropped bytes). */
  private async loadBookFromBuffer(buf: Buffer, baseName: string, idKey: string, position = 0) {
    const ext = baseName.toLowerCase().split('.').pop() ?? '';
    const baseOpts = {
      charsPerPage: this.cfg().get<number>('charsPerPage', 300),
      chapterRegex: this.cfg().get<string>('chapterRegex', '^\\s*(第[\\d一二三四五六七八九十百千零两]+[章节卷回篇]|[Cc]hapter\\s+\\d+|楔子|序章|番外).*$'),
      maxChapterChars: this.cfg().get<number>('maxChapterChars', 3000),
      mergeTarget: this.cfg().get<boolean>('mergeParagraphs', true)
        ? this.cfg().get<number>('paragraphTargetChars', 120)
        : 50,
    };

    let usedEnc: string;

    if (ext === 'epub' || ext === 'fb2') {
      const bytes = new Uint8Array(buf);
      const parsed = ext === 'epub' ? parseEpub(bytes) : parseFb2(bytes);
      const built = chaptersToText(parsed.chapters);
      usedEnc = ext.toUpperCase();
      this.engine = new ReaderEngine(idKey, baseName, built.text, {
        ...baseOpts,
        prebuiltChapters: built.chapters,
        bookTitle: parsed.title,
      });
    } else {
      const decoded = decodeBuffer(buf, this.cfg().get<string>('encoding', 'auto'));
      usedEnc = decoded.encoding;
      this.engine = new ReaderEngine(idKey, baseName, decoded.text, baseOpts);
    }
    this.engine.restorePosition(position);

    const rec: BookRecord = {
      id: this.engine.meta.id,
      path: idKey,
      title: this.engine.meta.title,
      totalChapters: this.engine.meta.totalChapters,
      totalChars: this.engine.meta.totalChars,
      position,
      lastReadAt: Date.now(),
      bookmarks: this.state.getBook(this.engine.meta.id)?.bookmarks ?? [],
    };
    this.state.upsertBook(rec);
    this.onBooksChanged?.();

    this.post({ type: 'book-loaded', book: this.engine.meta, position });
    return { usedEnc, byteSize: buf.length };
  }

  /** Open a native file picker and load the chosen book (wired to the `+` button). */
  private async cmdPickFile() {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: '打开',
      title: '选择小说文件',
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      filters: { '小说文件': ['txt', 'epub', 'fb2'], '所有文件': ['*'] },
    });
    const file = picks?.[0];
    if (file) await this.cmdInit(file.fsPath);
  }

  private async cmdInit(rawPath: string) {
    let p = rawPath.trim().replace(/^["']|["']$/g, '');
    if (!p) {
      this.post({ type: 'assistant-text', text: '用法:/init <文件路径>(支持 txt / epub / fb2)' });
      return;
    }
    // Resolve relative to workspace root.
    if (!fs.existsSync(p) && vscode.workspace.workspaceFolders?.length) {
      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const joined = require('path').resolve(root, p);
      if (fs.existsSync(joined)) p = joined;
    }
    if (!fs.existsSync(p)) {
      this.post({ type: 'error', message: `找不到文件:${p}` });
      return;
    }

    try {
      const { usedEnc, byteSize } = await this.loadBook(p, 0);
      this.announceLoaded(usedEnc, byteSize);
    } catch (e: any) {
      this.post({ type: 'error', message: `解析失败:${e?.message ?? e}` });
    }
  }

  /** Shared "book loaded" message + auto-render of the first chapter. */
  private announceLoaded(usedEnc: string, byteSize: number) {
    const eng = this.engine!;
    this.post({ type: 'thinking', lines: initThinkingLog(byteSize, usedEnc, eng.meta.totalChapters) });
    this.post({
      type: 'assistant-text',
      markdown: true,
      text:
        `书名: **${eng.meta.title}**\n` +
        `章节: ${eng.meta.totalChapters} 章 · 字数: ${eng.meta.totalChars.toLocaleString()}\n` +
        `解析完成 ✓\n\n` +
        '```\n/目录       查看章节列表\n/下一页     下一章(整章输出)\n/上一页     上一章\n/跳转 N     跳到第 N 章\n/搜索 X     全文搜索\n```',
    });
    // Directly dump the first chapter so reading isn't a paragraph-by-paragraph grind.
    this.cmdNext();
  }

  // ---------- reading ----------
  private requireBook(): ReaderEngine | undefined {
    if (!this.engine) {
      this.post({ type: 'assistant-text', text: '还没有打开的书。先用 /init <路径> 关联一本。' });
      return undefined;
    }
    return this.engine;
  }

  private cmdNext() {
    const eng = this.requireBook();
    if (!eng) return;
    const res = eng.nextChapter();
    if (res.done) {
      this.post({ type: 'assistant-text', text: '已经到全书末尾了 ✓' });
      return;
    }
    this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
    this.emitChapter(res.segments);
  }

  private cmdPrev() {
    const eng = this.requireBook();
    if (!eng) return;
    const res = eng.prevChapter();
    if (res.done) {
      this.post({ type: 'assistant-text', text: '已经是开头了。' });
      return;
    }
    this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
    this.emitChapter(res.segments);
  }

  /**
   * Emit a whole chapter at once: paragraphs rendered instantly with disguise
   * turns woven between them. The webview pins the scrollbar to the page start.
   */
  private emitChapter(segments: Segment[]) {
    const diffEnabled = this.cfg().get<boolean>('fakeDiff.enabled', true);
    const freq = this.cfg().get<number>('fakeDiff.frequency', 0.7);
    this.post({ type: 'page-begin' });
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      this.post({ type: 'paragraph', text: seg.text, meta: seg.meta, diffs: [] });

      const isLast = i === segments.length - 1;
      if (diffEnabled && !seg.meta.atChapterStart && !isLast && Math.random() < freq) {
        const steps = generateReadingDisguise({
          cache: this.scanner.get(),
          diffSource: this.cfg().get<'workspace' | 'builtin'>('fakeDiff.snippetSource', 'workspace'),
          lang: this.cfg().get<string>('fakeDiff.language', 'auto'),
        });
        this.post({ type: 'disguise', steps });
        this.bumpStatus(steps.filter((s) => s.kind === 'edit').length || 1);
      }
    }
    this.post({ type: 'page-end' });
    this.onBooksChanged?.();
  }

  private bumpStatus(diffCount: number) {
    for (let i = 0; i < diffCount; i++) {
      this.status.tokens += 2000 + Math.floor(Math.random() * 2000);
      this.status.filesChanged += 1;
      this.status.contextPct += 1 + Math.floor(Math.random() * 3);
      if (this.status.contextPct >= 95) this.status.contextPct = 30;
    }
    this.post({ type: 'status', status: { ...this.status } });
  }

  // ---------- /目录 ----------
  private cmdToc() {
    const eng = this.requireBook();
    if (!eng) return;
    this.post({
      type: 'toc',
      chapters: eng.chapters.map((c) => ({ index: c.index, title: c.title })),
      current: eng.currentChapterIndex(),
    });
  }

  // ---------- /跳转 ----------
  private cmdJump(args: string) {
    const eng = this.requireBook();
    if (!eng) return;
    const n = parseInt(args.trim(), 10);
    if (isNaN(n)) {
      this.post({ type: 'assistant-text', text: '用法:/跳转 <章节号>,例如 /跳转 3' });
      return;
    }
    const res = eng.jumpToChapter(n);
    if (res.done || !res.segments.length) {
      this.post({ type: 'assistant-text', text: '该章节为空或不存在。' });
      return;
    }
    this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
    this.emitChapter(res.segments);
  }

  // ---------- /搜索 ----------
  private cmdSearch(args: string) {
    const eng = this.requireBook();
    if (!eng) return;
    const q = args.trim();
    if (!q) {
      this.post({ type: 'assistant-text', text: '用法:/搜索 <关键词>' });
      return;
    }
    const results = eng.search(q);
    this.post({ type: 'search-results', query: q, results });
  }

  // ---------- /书签 ----------
  private cmdBookmark(args: string) {
    const eng = this.requireBook();
    if (!eng) return;
    const [sub, ...rest] = args.trim().split(/\s+/);
    const restText = rest.join(' ').trim();
    const rec = this.state.getBook(eng.meta.id);
    const bms = rec?.bookmarks ?? [];

    if (sub === 'add' || sub === '' || sub === undefined) {
      // Label = custom name if given, else the current chapter title.
      const ch = eng.currentChapter();
      const label = restText || (ch ? ch.title : `位置 ${eng.position}`);
      const offset = ch ? ch.startOffset : eng.position; // bookmark the chapter start
      this.state.addBookmark(eng.meta.id, { offset, label, createdAt: Date.now() });
      this.post({ type: 'assistant-text', text: `已添加书签:${label}` });
    } else if (sub === 'list') {
      if (!bms.length) {
        this.post({ type: 'assistant-text', text: '暂无书签。用 /书签 add [名称] 添加。' });
        return;
      }
      const lines = bms.map((b, i) => `${i + 1}. ${b.label}`).join('\n');
      this.post({
        type: 'assistant-text',
        markdown: true,
        text: '书签列表:\n```\n' + lines + '\n```\n用 /书签 jump <序号或名称> 跳转。',
      });
    } else if (sub === 'jump') {
      if (!bms.length) {
        this.post({ type: 'assistant-text', text: '暂无书签。用 /书签 add 添加。' });
        return;
      }
      // Accept either a 1-based index or a bookmark name.
      const n = parseInt(restText, 10);
      let bm = !isNaN(n) && n >= 1 && n <= bms.length ? bms[n - 1] : undefined;
      if (!bm) bm = bms.find((b) => b.label === restText);
      if (!bm) {
        this.post({ type: 'assistant-text', text: `没找到书签「${restText}」。用 /书签 list 查看。` });
        return;
      }
      const res = eng.jumpToOffset(bm.offset);
      if (res.segments.length) {
        this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
        this.post({ type: 'assistant-text', text: `↩ 跳到书签:${bm.label}` });
        this.emitChapter(res.segments);
      }
    } else {
      this.post({ type: 'assistant-text', text: '用法:/书签 [add 名称 | list | jump 序号/名称]' });
    }
  }

  // ---------- /历史 ----------
  private cmdHistory(args: string) {
    const books = this.state.getBooks().slice().sort((a, b) => b.lastReadAt - a.lastReadAt);
    if (!books.length) {
      this.post({ type: 'assistant-text', text: '还没有阅读记录。' });
      return;
    }
    const n = parseInt(args.trim(), 10);
    if (!isNaN(n)) {
      const target = books[n - 1];
      if (!target) {
        this.post({ type: 'assistant-text', text: '无效的编号。' });
        return;
      }
      void this.switchBook(target);
      return;
    }
    const lines = books
      .map((b, i) => `${i + 1}. ${b.title}  (${b.totalChapters}章 · 上次 offset ${b.position})`)
      .join('\n');
    this.post({
      type: 'assistant-text',
      markdown: true,
      text: '最近阅读:\n```\n' + lines + '\n```\n用 /历史 N 切换。',
    });
  }

  private async switchBook(rec: BookRecord) {
    try {
      await this.loadBook(rec.path, rec.position);
      this.post({ type: 'assistant-text', text: `已切换到《${rec.title}》` });
      this.cmdNext();
    } catch {
      this.post({ type: 'error', message: `无法打开:${rec.path}` });
    }
  }

  // ---------- /设置 ----------
  private cmdSettings() {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'fishReader');
    this.post({ type: 'assistant-text', text: '已打开 CLI Reader 设置面板。' });
  }

  // ---------- /help ----------
  private cmdHelp() {
    const lines = COMMANDS.map((c) => {
      const names = [c.name, ...c.aliases].join(' / ');
      const hint = c.paramHint ? ' ' + c.paramHint : '';
      return `${names}${hint}\n    ${c.description}`;
    }).join('\n');
    this.post({ type: 'assistant-text', markdown: true, text: '可用命令:\n```\n' + lines + '\n```' });
  }

  // ---------- boss mode ----------
  /**
   * Force reading mode: opening/loading a book is an explicit "I want to read"
   * action, so cancel any armed mouse-leave timer and leave boss mode if active.
   * (The cursor briefly leaving the panel to click the list or the file dialog
   * shouldn't strand the user in boss mode.)
   */
  private enterReadingMode() {
    if (this.mouseLeaveTimer) {
      clearTimeout(this.mouseLeaveTimer);
      this.mouseLeaveTimer = undefined;
    }
    if (this.bossActive) this.exitBoss();
  }

  toggleBoss(trigger: BossTrigger) {
    if (this.bossActive) this.exitBoss();
    else this.enterBoss(trigger);
  }

  enterBoss(trigger: BossTrigger) {
    if (this.bossActive) return;
    if (this.mouseLeaveTimer) {
      clearTimeout(this.mouseLeaveTimer);
      this.mouseLeaveTimer = undefined;
    }
    this.bossActive = true;
    this.bossTrigger = trigger;
    this.bossSavedPosition = this.engine?.position ?? 0;

    const count = vscode.workspace.getConfiguration('fishReader').get<number>('bossMode.fakeConversationCount', 3);
    const turns = generateBossConversation({
      turnCount: Math.max(1, count),
      cache: this.scanner.get(),
      diffSource: this.cfg().get<'workspace' | 'builtin'>('fakeDiff.snippetSource', 'workspace'),
    });
    // Status jumps to look like a continued long session.
    this.status.tokens = Math.max(this.status.tokens, 40000 + Math.floor(Math.random() * 20000));
    this.status.contextPct = 60 + Math.floor(Math.random() * 25);
    this.post({ type: 'boss-enter', turns });
    this.post({ type: 'status', status: { ...this.status } });
    // Rename the editor tab to look like a real Claude Code conversation.
    const tabTitle = turns[0]?.prompt ? turns[0].prompt.slice(0, 42) : 'Claude';
    this.onTitleChange?.(tabTitle);
  }

  private emitBossTurns(n: number) {
    const turns = generateBossConversation({
      turnCount: n,
      cache: this.scanner.get(),
      diffSource: this.cfg().get<'workspace' | 'builtin'>('fakeDiff.snippetSource', 'workspace'),
    });
    this.post({ type: 'boss-enter', turns });
  }

  exitBoss() {
    if (!this.bossActive) return;
    this.bossActive = false;
    this.bossTrigger = undefined;
    // Reset chrome / clear the boss conversation in the webview.
    this.post({ type: 'boss-exit' });
    this.post({ type: 'status', status: { ...this.status } });
    this.onTitleChange?.('Claude');
    // Re-render the chapter the user was actually reading.
    if (this.engine) {
      const segments = this.engine.lastChapterSegments();
      if (segments.length) {
        this.post({ type: 'assistant-text', text: '— 已恢复阅读 —' });
        this.emitChapter(segments);
      } else {
        this.post({ type: 'assistant-text', text: '已恢复摸鱼态 · 输入 /next 继续' });
      }
    }
  }

  // ---------- auto (passive) triggers ----------
  /** Which passive triggers the user has enabled. */
  private triggerEnabled(name: 'blur' | 'mouseLeave' | 'editorFocus'): boolean {
    return this.cfg().get<string[]>('bossMode.triggers', ['blur', 'mouseLeave']).includes(name);
  }

  /** Once active, boss mode only auto-exits if the user opted in. Default: manual only. */
  private get autoExit(): boolean {
    return this.cfg().get<boolean>('bossMode.autoExit', false);
  }

  onMouseLeave() {
    if (this.bossActive || !this.triggerEnabled('mouseLeave')) return;
    const delay = Math.max(0, this.cfg().get<number>('bossMode.mouseLeaveDelay', 1000));
    if (this.mouseLeaveTimer) clearTimeout(this.mouseLeaveTimer);
    this.mouseLeaveTimer = setTimeout(() => {
      this.mouseLeaveTimer = undefined;
      if (!this.bossActive) this.enterBoss('mouseLeave');
    }, delay);
  }

  onMouseEnter() {
    if (this.mouseLeaveTimer) {
      clearTimeout(this.mouseLeaveTimer);
      this.mouseLeaveTimer = undefined;
    }
    if (this.autoExit && this.bossActive && this.bossTrigger === 'mouseLeave') {
      this.exitBoss();
    }
  }

  onWindowBlur() {
    if (this.bossActive || !this.triggerEnabled('blur')) return;
    this.enterBoss('blur');
  }

  onWindowFocus() {
    if (this.autoExit && this.bossActive && this.bossTrigger === 'blur') {
      this.exitBoss();
    }
  }

  /** User switched to a code editor tab (e.g. clicked a .ts file). */
  onEditorFocus() {
    if (this.bossActive || !this.triggerEnabled('editorFocus')) return;
    this.enterBoss('editorFocus');
  }
}
