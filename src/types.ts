// Shared data contracts between extension host and webview.

export interface BookMeta {
  id: string;
  path: string;
  title: string;
  totalChapters: number;
  totalChars: number;
}

export interface Chapter {
  index: number; // 0-based
  title: string;
  startOffset: number;
  endOffset: number;
}

export interface PageMeta {
  chapterIndex: number;
  chapterTitle: string;
  pageInChapter: number;
  pagesInChapter: number;
  charOffset: number;
  atChapterStart: boolean;
}

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  fileName: string;
  lang: string;
  header: string; // e.g. "@@ -10,6 +10,8 @@"
  category: string;
  lines: DiffLine[];
}

/** Tools the fake assistant can appear to call (Claude Code's tool names). */
export type FakeToolName = 'Read' | 'Grep' | 'Glob' | 'Bash' | 'Write' | 'TodoWrite' | 'WebFetch';

/**
 * One step of a fake assistant turn. `delayMs` is the "model is thinking" pause before the
 * step appears; `runMs` (tools only) is how long the call shows as in-progress before its
 * output lands. Both are pre-rolled by the generator so every turn paces differently.
 */
export type FakeStep =
  | { kind: 'thinking'; lines: string[]; delayMs: number }
  | { kind: 'text'; text: string; delayMs: number }
  | { kind: 'edit'; diff: DiffHunk; delayMs: number; runMs: number }
  | {
      kind: 'tool';
      tool: FakeToolName;
      /** What follows the tool name in the header: a path, a pattern, a shell command. */
      target: string;
      /** Monospace output lines (may be empty). */
      output: string[];
      /** Muted one-liner under the header, e.g. "Read 142 lines" / "Found 7 matches". */
      summary?: string;
      /** Red dot + error styling (a failing test run, a missing file). */
      failed?: boolean;
      /** Only show the first N output lines; the rest hide behind "… +K lines". */
      collapseAfter?: number;
      delayMs: number;
      runMs: number;
    };

export interface FakeTurn {
  prompt: string;
  steps: FakeStep[];
}

export interface StatusData {
  tokens: number;
  contextPct: number;
  filesChanged: number;
}

export interface CommandSpec {
  name: string; // canonical, e.g. "/下一页"
  aliases: string[]; // e.g. ["/n", "/next"]
  description: string;
  paramHint?: string; // e.g. "<章节号>"
  display?: string; // short command shown in the slash menu, e.g. "/next"
}

export interface SearchResult {
  chapterIndex: number;
  chapterTitle: string;
  offset: number;
  snippet: string;
}

// ---- messages: extension -> webview ----
export type ToWebview =
  | { type: 'config'; commands: CommandSpec[]; speed: string }
  | { type: 'book-loaded'; book: BookMeta; position: number }
  | { type: 'user-echo'; text: string }
  | { type: 'thinking'; lines: string[] }
  | { type: 'paragraph'; text: string; meta: PageMeta; diffs: DiffHunk[]; done?: boolean }
  | { type: 'disguise'; steps: FakeStep[] }
  | { type: 'page-begin' }
  | { type: 'page-end' }
  | { type: 'assistant-text'; text: string; label?: string; markdown?: boolean }
  | { type: 'toc'; chapters: { index: number; title: string }[]; current: number }
  | { type: 'search-results'; query: string; results: SearchResult[] }
  | { type: 'status'; status: StatusData }
  | { type: 'active-file'; name: string }
  | { type: 'clear' }
  | { type: 'boss-enter'; turns: FakeTurn[] }
  | { type: 'boss-exit' }
  | { type: 'error'; message: string }
  | { type: 'set-input'; text: string };

// ---- messages: webview -> extension ----
export type FromWebview =
  | { type: 'ready' }
  | { type: 'command'; raw: string }
  | { type: 'pick-file' }
  | { type: 'request-next' }
  | { type: 'request-prev' }
  | { type: 'toggle-boss' }
  | { type: 'mouse-leave' }
  | { type: 'mouse-enter' }
  | { type: 'boss-fake-turn' }; // user pressed enter while in boss mode

// ---- library (sidebar) ----
export interface LibBook {
  id: string;
  title: string;
  progressPct: number;
  totalChapters: number;
  lastReadAt: number;
}

export type ToLibrary =
  | { type: 'books'; books: LibBook[] }
  | { type: 'stars'; count: number };

export type FromLibrary =
  | { type: 'lib-ready' }
  | { type: 'lib-open'; id: string }
  | { type: 'lib-new' }
  | { type: 'lib-delete'; id: string }
  | { type: 'lib-star' };
