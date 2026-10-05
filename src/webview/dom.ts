import { DiffHunk, DiffLine, FakeStep, PageMeta, SearchResult } from '../types';
import { typeInto, revealLines, pause, epochNow } from './streaming';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Minimal markdown: fenced code blocks, **bold**, `inline`, newlines. */
function renderMarkdown(container: HTMLElement, md: string) {
  const parts = md.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const pre = el('pre', 'code-block');
      pre.textContent = part.replace(/^\n/, '').replace(/\n$/, '');
      container.appendChild(pre);
    } else {
      renderInline(container, part);
    }
  });
}

function renderInline(container: HTMLElement, text: string) {
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (idx > 0) container.appendChild(document.createElement('br'));
    const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const tk of tokens) {
      if (!tk) continue;
      if (tk.startsWith('**') && tk.endsWith('**')) {
        container.appendChild(el('strong', undefined, tk.slice(2, -2)));
      } else if (tk.startsWith('`') && tk.endsWith('`')) {
        container.appendChild(el('code', 'inline-code', tk.slice(1, -1)));
      } else {
        container.appendChild(document.createTextNode(tk));
      }
    }
  });
}

function icon(d: string, className?: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

/** Claude-Code-style tool call header ("Edit reader.ts +2 -2"); only the claude theme shows it. */
interface ToolSpec {
  name: string;
  target?: string;
  /** Render the target like a clickable file path. */
  link?: boolean;
  stats?: { add: number; del: number };
}

interface TurnOptions {
  tool?: ToolSpec;
  /** Timeline dot colour in the claude theme: ok = green (finished tool call), fail = red. */
  tone?: 'ok' | 'fail';
  /** Continuation of the previous turn: no "● assistant" head in the CLI themes. */
  cont?: boolean;
}

function toolHead(spec: ToolSpec): HTMLElement {
  const head = el('div', 'tool-head');
  head.appendChild(el('span', 'tool-name', spec.name));
  if (spec.target) head.appendChild(el('span', 'tool-target' + (spec.link ? ' is-link' : ''), spec.target));
  if (spec.stats) {
    const stats = el('span', 'tool-stats');
    if (spec.stats.add) stats.appendChild(el('span', 'tool-ins', `+${spec.stats.add}`));
    if (spec.stats.del) stats.appendChild(el('span', 'tool-del', `-${spec.stats.del}`));
    head.appendChild(stats);
  }
  return head;
}

function diffStats(hunk: DiffHunk): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const l of hunk.lines) {
    if (l.type === 'add') add++;
    else if (l.type === 'del') del++;
  }
  return { add, del };
}

/** Old/new start line from a "@@ -184,2 +184,2 @@" header, for the diff gutter. */
function hunkStart(header: string): [number, number] {
  const m = /-(\d+)(?:,\d+)?\s+\+(\d+)/.exec(header);
  return m ? [Number(m[1]), Number(m[2])] : [1, 1];
}

export type CommandSink = (raw: string) => void;

export class UI {
  private brandName: HTMLElement;
  private brandIcon: HTMLElement;
  private brandSub: HTMLElement;
  private sessionTitle: HTMLElement | null; // missing from the 0.1.4 HTML (see main.ts)
  private fileChip: HTMLElement;
  private boss = false;

  constructor(
    private log: HTMLElement,
    private sink: CommandSink
  ) {
    this.brandName = document.getElementById('brand-name')!;
    this.brandIcon = document.getElementById('brand-icon')!;
    this.brandSub = document.getElementById('brand-sub')!;
    this.sessionTitle = document.getElementById('session-title');
    this.fileChip = document.getElementById('file-chip')!;
  }

  scroll() {
    this.log.scrollTop = this.log.scrollHeight;
  }

  clear() {
    this.log.textContent = '';
  }

  system(text: string) {
    const turn = el('div', 'turn system-turn');
    turn.appendChild(el('span', 'prefix system-prefix', 'system'));
    turn.appendChild(el('span', 'system-text', text));
    this.log.appendChild(turn);
    this.scroll();
  }

  // ---- user line ----
  user(text: string) {
    const turn = el('div', 'turn user-turn');
    const prefix = el('span', 'prefix user-prefix', '> user');
    const body = el('span', 'user-text', text);
    turn.appendChild(prefix);
    turn.appendChild(body);
    this.log.appendChild(turn);
    this.scroll();
  }

  // ---- thinking block ----
  async thinking(lines: string[]) {
    const turn = el('div', 'turn tl thinking-turn');
    const head = el('div', 'thinking-head');
    head.appendChild(el('span', 'thinking-dot', '●'));
    head.appendChild(el('span', 'thinking-label', 'thinking...'));
    // Claude Code's collapsible "Thinking ›" summary (claude theme only).
    const title = el('span', 'thinking-title', 'Thinking');
    title.appendChild(icon('M4.5 6.5 8 10l3.5-3.5', 'thinking-chev'));
    title.addEventListener('click', () => turn.classList.toggle('collapsed'));
    head.appendChild(title);
    turn.appendChild(head);
    const logBox = el('div', 'thinking-log');
    turn.appendChild(logBox);
    this.log.appendChild(turn);

    await revealLines(
      lines,
      (line) => logBox.appendChild(el('div', 'thinking-line', line)),
      () => this.scroll()
    );
  }

  /**
   * Begin an assistant turn; returns the text body element for streaming.
   * Every assistant turn is a timeline item (`.tl`) in the claude theme; `opts` adds the
   * Claude Code tool-call header / dot colour without changing the CLI themes.
   */
  beginAssistant(label?: string, opts: TurnOptions = {}): { turn: HTMLElement; body: HTMLElement } {
    const cls = ['turn', 'tl'];
    if (opts.tone) cls.push(`tl-${opts.tone}`);
    if (opts.cont) cls.push('turn-cont');
    const turn = el('div', cls.join(' '));
    if (!opts.cont) {
      const head = el('div', 'assistant-head');
      head.appendChild(el('span', 'prefix assistant-prefix', '● assistant'));
      if (label) head.appendChild(el('span', 'assistant-label muted', label));
      turn.appendChild(head);
    }
    if (opts.tool) turn.appendChild(toolHead(opts.tool));
    const body = el('div', 'assistant-body');
    turn.appendChild(body);
    this.log.appendChild(turn);
    return { turn, body };
  }

  /**
   * Claude Code's copy / bookmark row under the last text message of a reply (claude theme only).
   * Copy takes that message's text; bookmark is `/书签 add` for the current chapter.
   */
  endReply() {
    const last = this.log.lastElementChild as HTMLElement | null;
    if (!last?.classList.contains('tl') || last.querySelector('.tool-head, .msg-actions')) return;
    const bar = el('div', 'msg-actions');
    const copy = el('button', 'icon-btn');
    copy.title = 'Copy';
    copy.appendChild(icon('M5.5 5.5h7v7h-7zM3.5 10.5v-7h7'));
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(last.querySelector('.assistant-body')?.textContent ?? '');
    });
    const mark = el('button', 'icon-btn');
    mark.title = 'Bookmark';
    mark.appendChild(icon('M4.5 2.5h7v11L8 11l-3.5 2.5z'));
    mark.addEventListener('click', () => this.sink('/书签 add'));
    bar.append(copy, mark);
    last.appendChild(bar);
  }

  /**
   * Stream prose char by char. With `markdown`, line breaks are kept while streaming and
   * the finished text is re-rendered with bold / inline code / fenced blocks.
   */
  async streamText(label: string | undefined, text: string, markdown = false) {
    const { turn, body } = this.beginAssistant(label);
    turn.classList.add('tl-progress');
    const cursor = el('span', 'cursor');
    body.appendChild(cursor);
    const textSpan = el('span', markdown ? 'stream-md' : undefined);
    body.insertBefore(textSpan, cursor);
    await typeInto(textSpan, text, () => this.scroll());
    cursor.remove();
    turn.classList.remove('tl-progress');
    if (markdown && textSpan.textContent === text) {
      body.textContent = '';
      renderMarkdown(body, text);
      this.scroll();
    }
  }

  /** Render assistant text that may contain markdown (no char streaming). */
  staticText(label: string | undefined, md: string, markdown: boolean) {
    const { body } = this.beginAssistant(label, label === 'error' ? { tone: 'fail' } : {});
    if (markdown) renderMarkdown(body, md);
    else renderInline(body, md);
    this.scroll();
  }

  // ---- paragraph (novel content) — rendered instantly, no streaming ----
  paragraph(text: string, meta: PageMeta, diffs: DiffHunk[]) {
    const { turn, body } = this.beginAssistant(
      undefined,
      meta.atChapterStart ? { tool: { name: 'Read', target: meta.chapterTitle }, tone: 'ok' } : {}
    );

    if (meta.atChapterStart) {
      body.appendChild(el('div', 'chapter-enter', `已进入: ${meta.chapterTitle}`));
    } else {
      const textSpan = el('div', 'novel-text');
      textSpan.textContent = text;
      body.appendChild(textSpan);
    }

    for (const d of diffs) this.diff(turn, d, true);
  }

  /**
   * Play one generated step of a fake assistant turn. `animate` honours the step's
   * pre-rolled pauses and streams the content; otherwise everything lands at once
   * (reading-mode disguise, where the page is pinned to its top anyway).
   */
  async playStep(step: FakeStep, animate: boolean): Promise<void> {
    if (animate && !(await pause(step.delayMs))) return;
    switch (step.kind) {
      case 'thinking':
        if (animate) await this.thinking(step.lines);
        else this.thinkingInstant(step.lines);
        return;
      case 'text':
        if (animate) await this.streamText(undefined, step.text, true);
        else this.staticText(undefined, step.text, true);
        return;
      case 'edit':
        await this.editTurn(step.diff, animate, animate ? step.runMs : 0);
        return;
      case 'tool':
        await this.toolTurn(step, animate);
        return;
    }
  }

  /** Several steps back to back, instantly (reading-mode disguise between paragraphs). */
  playStepsInstant(steps: FakeStep[]) {
    for (const s of steps) void this.playStep(s, false);
  }

  private thinkingInstant(lines: string[]) {
    const turn = el('div', 'turn tl thinking-turn');
    const head = el('div', 'thinking-head');
    head.appendChild(el('span', 'thinking-dot', '●'));
    head.appendChild(el('span', 'thinking-label', 'thinking...'));
    const title = el('span', 'thinking-title', 'Thinking');
    title.appendChild(icon('M4.5 6.5 8 10l3.5-3.5', 'thinking-chev'));
    title.addEventListener('click', () => turn.classList.toggle('collapsed'));
    head.appendChild(title);
    turn.appendChild(head);
    const logBox = el('div', 'thinking-log');
    for (const line of lines) logBox.appendChild(el('div', 'thinking-line', line));
    turn.appendChild(logBox);
    this.log.appendChild(turn);
  }

  /** An "Edit <file>" tool call carrying a diff; `animate` reveals it line by line after `runMs`. */
  async editTurn(hunk: DiffHunk, animate = false, runMs = 0) {
    const { turn } = this.beginAssistant(`edited ${hunk.fileName}`, {
      tool: { name: 'Edit', target: hunk.fileName, link: true, stats: diffStats(hunk) },
      tone: 'ok',
    });
    if (animate) {
      turn.classList.add('tl-progress');
      if (!(await pause(runMs))) return;
    }
    await this.diff(turn, hunk, !animate);
    turn.classList.remove('tl-progress');
  }

  /**
   * A non-edit tool call (Read / Grep / Glob / Bash / Write / TodoWrite): Claude Code header,
   * optional muted summary, and a monospace output box that can fold long output.
   */
  async toolTurn(step: Extract<FakeStep, { kind: 'tool' }>, animate: boolean) {
    const isBash = step.tool === 'Bash';
    const isTodo = step.tool === 'TodoWrite';
    const label = isTodo ? 'todo' : isBash ? `$ ${step.target}` : `${step.tool.toLowerCase()} ${step.target}`;
    const linkish = step.tool === 'Read' || step.tool === 'Write';
    const { turn, body } = this.beginAssistant(label, {
      tool: {
        name: isTodo ? 'Update Todos' : step.tool,
        target: step.target || undefined,
        link: linkish,
      },
      tone: step.failed ? 'fail' : 'ok',
    });
    turn.classList.add('tool-turn', `tool-kind-${step.tool.toLowerCase()}`);
    if (step.failed) turn.classList.add('tool-failed');

    if (animate) {
      turn.classList.add('tl-progress');
      const myEpoch = epochNow();
      const ok = await pause(step.runMs);
      if (!ok || myEpoch !== epochNow()) return;
    }

    if (step.summary) body.appendChild(el('div', 'tool-summary muted', step.summary));

    if (step.output.length) {
      const box = el('div', isTodo ? 'tool-output todo-list' : 'tool-output');
      body.appendChild(box);
      const limit = step.collapseAfter && step.output.length > step.collapseAfter + 1 ? step.collapseAfter : step.output.length;
      const visible = step.output.slice(0, limit);
      const hidden = step.output.slice(limit);
      const renderLine = (line: string) => {
        const row = el('div', 'tool-line', line === '' ? ' ' : line);
        if (isTodo) {
          if (line.startsWith('☒')) row.classList.add('todo-done');
          else if (line.startsWith('◐')) row.classList.add('todo-active');
        }
        box.appendChild(row);
      };
      if (animate) await revealLines(visible, renderLine, () => this.scroll());
      else visible.forEach(renderLine);
      if (hidden.length) {
        const more = el('div', 'tool-more', `… +${hidden.length} lines`);
        more.addEventListener('click', () => {
          more.remove();
          hidden.forEach(renderLine);
          this.scroll();
        });
        box.appendChild(more);
      }
    }
    turn.classList.remove('tl-progress');
    this.scroll();
  }

  // ---- diff block ----
  async diff(parent: HTMLElement, hunk: DiffHunk, instant = false) {
    const block = el('div', 'diff-block');
    const head = el('div', 'diff-head');
    head.appendChild(el('span', 'diff-file', hunk.fileName));
    head.appendChild(el('span', 'diff-meta muted', hunk.header));
    block.appendChild(head);
    const bodyEl = el('div', 'diff-body');
    block.appendChild(bodyEl);
    parent.appendChild(block);

    let [oldNo, newNo] = hunkStart(hunk.header);
    const appendLine = (line: DiffLine) => {
      const row = el('div', `diff-line diff-${line.type}`);
      let no: number;
      if (line.type === 'del') no = oldNo++;
      else if (line.type === 'add') no = newNo++;
      else {
        oldNo++;
        no = newNo++;
      }
      row.appendChild(el('span', 'diff-ln', String(no)));
      const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
      row.appendChild(el('span', 'diff-sign', sign));
      row.appendChild(el('span', 'diff-code', line.text));
      bodyEl.appendChild(row);
    };

    if (instant) {
      hunk.lines.forEach(appendLine);
    } else {
      await revealLines(hunk.lines, appendLine, () => this.scroll());
    }
  }

  // ---- toc ----
  // Returns the rendered items + the array position of the current chapter,
  // so the caller can wire keyboard navigation / selection highlight.
  toc(
    chapters: { index: number; title: string }[],
    current: number
  ): { items: HTMLElement[]; current: number } {
    const { body } = this.beginAssistant('目录', {
      tool: { name: 'Read', target: `目录 · ${chapters.length} 章` },
      tone: 'ok',
    });
    const list = el('div', 'toc-list');
    const items: HTMLElement[] = [];
    let currentPos = -1;
    chapters.forEach((c, pos) => {
      const isCurrent = c.index === current;
      const item = el('div', 'toc-item' + (isCurrent ? ' toc-current' : ''));
      item.dataset.idx = String(c.index); // 0-based chapter index, for /跳转
      item.textContent = `${c.index + 1}. ${c.title}`;
      if (isCurrent) {
        item.appendChild(el('span', 'toc-current-tag', '当前'));
        currentPos = pos;
      }
      item.addEventListener('click', () => this.sink(`/跳转 ${c.index + 1}`));
      list.appendChild(item);
      items.push(item);
    });
    body.appendChild(list);
    // Locate the current chapter so it's visible even in a long book.
    if (currentPos >= 0) items[currentPos].scrollIntoView({ block: 'center' });
    else this.scroll();
    return { items, current: currentPos >= 0 ? currentPos : 0 };
  }

  // ---- search ----
  search(query: string, results: SearchResult[]) {
    const { body } = this.beginAssistant(`search "${query}"`, {
      tool: { name: 'Grep', target: query },
      tone: 'ok',
    });
    if (!results.length) {
      body.appendChild(el('div', undefined, `没有找到 "${query}"`));
      this.scroll();
      return;
    }
    body.appendChild(el('div', 'muted', `${results.length} 处匹配:`));
    const list = el('div', 'search-list');
    results.forEach((r) => {
      const item = el('div', 'search-item');
      item.appendChild(el('span', 'search-chap muted', `[${r.chapterTitle}] `));
      item.appendChild(el('span', undefined, r.snippet));
      item.addEventListener('click', () => this.sink(`/跳转 ${r.chapterIndex + 1}`));
      list.appendChild(item);
    });
    body.appendChild(list);
    this.scroll();
  }

  // ---- chrome ----
  private bookTitle = '';

  /**
   * Always present as "Claude". The book name shows only outside boss mode; in boss mode the
   * claude theme's session title becomes the fake prompt, like a real Claude Code session.
   */
  setBrand(boss: boolean, sessionTitle?: string) {
    this.boss = boss;
    this.brandName.textContent = 'Claude';
    this.brandIcon.textContent = '✳';
    this.brandSub.textContent = boss ? '' : this.bookTitle ? `· ${this.bookTitle}` : '';
    if (this.sessionTitle) this.sessionTitle.textContent = (boss ? sessionTitle : this.bookTitle) || 'Claude Code';
  }

  setBookTitle(title: string) {
    this.bookTitle = title || '';
    this.brandSub.textContent = this.bookTitle ? `· ${this.bookTitle}` : '';
    if (!this.boss && this.sessionTitle) this.sessionTitle.textContent = this.bookTitle || 'Claude Code';
  }

  setActiveFile(name: string) {
    this.fileChip.textContent = name || '';
  }
}
