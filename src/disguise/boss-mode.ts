import * as vscode from 'vscode';
import { DiffHunk, FakeStep, FakeTurn } from '../types';
import { WorkspaceCache, extToLang } from './workspace-scanner';
import { generateActiveTabDiff, generateFakeDiff } from './diff-generator';
import {
  PROMPTS,
  SCENARIO_WEIGHTS,
  Scenario,
  THINKING_OPEN,
  THINKING_MORE,
  TEXT_OPEN,
  TEXT_FINDING,
  TEXT_TRANSITION,
  TEXT_CLOSE,
  TOPICS,
  BUILTINS,
  SOMETHINGS,
  TODO_ITEMS,
} from './templates';
import {
  ToolContext,
  bashStep,
  chance,
  globStep,
  grepStep,
  normalizeLang,
  pick,
  randInt,
  readStep,
  skewed,
  testFileFor,
  thinkDelay,
  todoStep,
  toolRunTime,
  writeStep,
} from './tool-output';

export interface ActiveTabContext {
  fileName: string;
  filePath: string;
  language: string;
  lineCount: number;
  classes: string[];
  functions: string[];
  imports: string[];
  sampledLines: string[];
}

const CLASS_RE = /\b(?:class|interface|struct|enum)\s+([A-Z]\w+)/g;
const FUNC_RE = /(?:function\s+([a-zA-Z_]\w*)|(?:def|func|fn)\s+([a-zA-Z_]\w*)|\b([a-zA-Z_]\w*)\s*(?:=\s*)?\([^)]*\)\s*(?:=>|\{|:))/g;
const IMPORT_RE = /(?:import\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'".][^'"]*)['"]|from\s+([\w.]+)\s+import)/g;

export function readActiveTab(): ActiveTabContext | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const doc = editor.document;
  if (doc.uri.scheme !== 'file') return undefined;

  const text = doc.getText();
  const fileName = doc.fileName.split(/[\\/]/).pop() ?? 'file';
  const classes: string[] = [];
  const functions: string[] = [];
  const imports: string[] = [];

  let m: RegExpExecArray | null;
  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(text)) && classes.length < 30) if (m[1]) classes.push(m[1]);
  FUNC_RE.lastIndex = 0;
  while ((m = FUNC_RE.exec(text)) && functions.length < 50) {
    const n = m[1] || m[2] || m[3];
    if (n && n.length > 1) functions.push(n);
  }
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text)) && imports.length < 30) {
    const lib = m[1] || m[2];
    if (lib) imports.push(lib.split('/')[0]);
  }

  const lines = text.split('\n');
  const mid = Math.floor(lines.length / 2);
  const span = Math.min(10, Math.max(5, Math.floor(lines.length / 6)));
  const sampledLines = lines.slice(mid, mid + span).map((l) => l.replace(/\t/g, '  '));

  return {
    fileName,
    filePath: doc.fileName,
    language: doc.languageId || extToLang(fileName),
    lineCount: doc.lineCount,
    classes,
    functions,
    imports,
    sampledLines,
  };
}

// ---------------------------------------------------------------------------
// Template filling
// ---------------------------------------------------------------------------

/** Names chosen once per turn so the prompt, thinking, prose and tool calls all agree. */
interface TurnVocab {
  fileName: string;
  otherFile: string;
  functionName: string;
  functionB: string;
  className: string;
  importA: string;
  importB: string;
  topic: string;
  builtinFn: string;
  something: string;
  n: number;
  ln: number;
}

function makeVocab(ctx: ActiveTabContext, otherFiles: string[]): TurnVocab {
  const fns = ctx.functions.length ? ctx.functions : ['handle', 'process', 'parse', 'resolve'];
  const functionName = pick(fns, 'handle');
  const functionB = pick(fns.filter((f) => f !== functionName), 'process');
  const imports = ctx.imports.length ? ctx.imports : ['lodash', 'zod'];
  const importA = pick(imports, 'lodash');
  return {
    fileName: ctx.fileName,
    otherFile: pick(otherFiles.filter((f) => f !== ctx.fileName), 'index.ts'),
    functionName,
    functionB,
    className: pick(ctx.classes, 'Handler'),
    importA,
    importB: pick(imports.filter((i) => i !== importA), 'ramda'),
    topic: pick(TOPICS, 'parsing'),
    builtinFn: pick(BUILTINS, 'JSON.parse'),
    something: pick(SOMETHINGS, 'the index'),
    n: randInt(2, 9),
    ln: randInt(12, 240),
  };
}

function fill(template: string, v: TurnVocab): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = (v as unknown as Record<string, string | number>)[key];
    return val === undefined ? `{${key}}` : String(val);
  });
}

function pickScenario(): Scenario {
  const total = SCENARIO_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [sc, w] of SCENARIO_WEIGHTS) {
    if (r < w) return sc;
    r -= w;
  }
  return 'fix';
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

function thinkingStep(sc: Scenario, v: TurnVocab, first: boolean): FakeStep {
  const lines = [fill(pick(THINKING_OPEN[sc], THINKING_OPEN.fix[0]), v)];
  const extra = chance(0.6) ? randInt(1, 2) : 0;
  const pool = [...THINKING_MORE];
  for (let i = 0; i < extra && pool.length; i++) {
    const idx = randInt(0, pool.length - 1);
    lines.push(fill(pool.splice(idx, 1)[0], v));
  }
  return { kind: 'thinking', lines, delayMs: first ? skewed(300, 1400) : thinkDelay() };
}

function textStep(text: string, delayMs = thinkDelay()): FakeStep {
  return { kind: 'text', text, delayMs };
}

function editStep(diff: DiffHunk): FakeStep {
  return { kind: 'edit', diff, delayMs: thinkDelay(), runMs: toolRunTime('Edit') };
}

interface BuildEnv {
  sc: Scenario;
  v: TurnVocab;
  tctx: ToolContext;
  /** Diff for the file the turn is about (real sampled lines when the active tab is known). */
  primaryDiff: () => DiffHunk;
  /** Diff for some other workspace file. */
  otherDiff: () => DiffHunk;
}

/** A Bash "test" run whose kind fits the language; `fail` picks the red variant. */
function testRun(env: BuildEnv, fail: boolean): FakeStep {
  return bashStep(env.tctx, 'test', { fail });
}

/**
 * Compose the steps of one turn. Each scenario has a skeleton with optional
 * branches so two turns of the same scenario rarely look alike.
 */
function buildSteps(env: BuildEnv): FakeStep[] {
  const { sc, v, tctx } = env;
  const steps: FakeStep[] = [];
  const finding = () => textStep(fill(pick(TEXT_FINDING[sc], TEXT_FINDING.fix[0]), v));
  const transition = () => textStep(fill(pick(TEXT_TRANSITION, 'Let me check the callers.'), v), skewed(200, 900));
  const close = () => textStep(fill(pick(TEXT_CLOSE[sc], TEXT_CLOSE.fix[0]), v));
  const opener = () => textStep(fill(pick(TEXT_OPEN, 'Let me take a look.'), v), skewed(250, 1100));

  if (chance(0.75)) steps.push(thinkingStep(sc, v, true));
  if (chance(0.45)) steps.push(opener());

  // Todo list for the bigger scenarios.
  const useTodo = (sc === 'feature' || sc === 'refactor' || sc === 'fix' || sc === 'test') && chance(0.3);
  const todos = useTodo ? TODO_ITEMS[sc].map((t) => fill(t, v)) : [];
  if (useTodo) steps.push(todoStep(todos, 0, 0));

  switch (sc) {
    case 'explain': {
      steps.push(readStep(tctx));
      if (chance(0.6)) steps.push(grepStep(tctx, v.functionName));
      if (chance(0.4)) steps.push(readStep(tctx, v.otherFile));
      steps.push(finding());
      if (chance(0.3)) steps.push(grepStep(tctx, v.functionB));
      steps.push(close());
      break;
    }
    case 'fix': {
      const startWithTests = chance(0.4);
      if (startWithTests) {
        steps.push(testRun(env, true));
        steps.push(textStep(fill(pick(['The suite is red. Let me look at the implementation.', 'Reproduced. The failure is in {functionName}; reading it now.', 'The suite is red — same error in each case. Let me read {fileName}.'], ''), v), skewed(300, 1200)));
      }
      steps.push(readStep(tctx));
      if (chance(0.55)) steps.push(grepStep(tctx, v.functionName));
      if (chance(0.3)) steps.push(readStep(tctx, v.otherFile));
      steps.push(finding());
      if (useTodo) steps.push(todoStep(todos, 2, 2));
      steps.push(editStep(env.primaryDiff()));
      if (chance(0.35)) steps.push(editStep(env.otherDiff()));
      if (chance(0.3)) steps.push(writeStep(tctx, { test: true }));
      if (startWithTests || chance(0.7)) {
        if (chance(0.15)) {
          // First rerun still fails on one case; a second edit fixes it.
          steps.push(testRun(env, true));
          steps.push(textStep(fill(pick(['One more case — the {something} path. Fixing that too.', 'Still one failure, different cause: {functionB} needs the same guard.'], ''), v), skewed(300, 1000)));
          steps.push(editStep(env.otherDiff()));
        }
        steps.push(testRun(env, false));
      }
      if (useTodo) steps.push(todoStep(todos, todos.length, -1));
      steps.push(close());
      break;
    }
    case 'feature': {
      if (chance(0.4)) steps.push(globStep(tctx));
      steps.push(readStep(tctx));
      if (chance(0.5)) steps.push(grepStep(tctx, v.functionName));
      if (chance(0.4)) steps.push(readStep(tctx, v.otherFile));
      steps.push(finding());
      if (useTodo) steps.push(todoStep(todos, 1, 1));
      if (chance(0.35)) steps.push(writeStep(tctx));
      steps.push(editStep(env.primaryDiff()));
      if (chance(0.5)) steps.push(editStep(env.otherDiff()));
      if (chance(0.4)) steps.push(writeStep(tctx, { test: true }));
      if (chance(0.5)) steps.push(transition());
      if (chance(0.6)) steps.push(bashStep(tctx, 'typecheck'));
      if (chance(0.6)) steps.push(testRun(env, false));
      if (useTodo) steps.push(todoStep(todos, todos.length, -1));
      steps.push(close());
      break;
    }
    case 'refactor': {
      steps.push(readStep(tctx));
      steps.push(grepStep(tctx, v.functionName));
      if (chance(0.4)) steps.push(grepStep(tctx, v.functionB));
      if (chance(0.3)) steps.push(bashStep(tctx, 'wc'));
      steps.push(finding());
      if (useTodo) steps.push(todoStep(todos, 1, 1));
      if (chance(0.3)) steps.push(writeStep(tctx));
      steps.push(editStep(env.primaryDiff()));
      const extraEdits = randInt(0, 2);
      for (let i = 0; i < extraEdits; i++) steps.push(editStep(env.otherDiff()));
      if (chance(0.5)) steps.push(transition());
      if (chance(0.5)) steps.push(bashStep(tctx, 'typecheck'));
      if (chance(0.7)) steps.push(testRun(env, false));
      if (useTodo) steps.push(todoStep(todos, todos.length, -1));
      steps.push(close());
      break;
    }
    case 'perf': {
      steps.push(readStep(tctx));
      if (chance(0.5)) steps.push(grepStep(tctx, v.functionName));
      steps.push(finding());
      steps.push(editStep(env.primaryDiff()));
      if (chance(0.4)) steps.push(transition());
      if (chance(0.7)) steps.push(testRun(env, false));
      steps.push(close());
      break;
    }
    case 'review': {
      if (chance(0.5)) steps.push(bashStep(tctx, 'git-diff'));
      steps.push(readStep(tctx));
      if (chance(0.6)) steps.push(grepStep(tctx, v.functionName));
      if (chance(0.4)) steps.push(readStep(tctx, v.otherFile));
      steps.push(finding());
      if (chance(0.5)) {
        steps.push(editStep(env.primaryDiff()));
        if (chance(0.5)) steps.push(testRun(env, false));
      }
      steps.push(close());
      break;
    }
    case 'test': {
      steps.push(testRun(env, chance(0.6)));
      if (chance(0.6)) steps.push(readStep(tctx));
      if (chance(0.5)) steps.push(readStep(tctx, testFileFor(tctx.lang, v.fileName)));
      steps.push(finding());
      if (useTodo) steps.push(todoStep(todos, 2, 2));
      if (chance(0.5)) steps.push(writeStep(tctx, { test: true }));
      else steps.push(editStep(env.primaryDiff()));
      steps.push(testRun(env, false));
      if (useTodo) steps.push(todoStep(todos, todos.length, -1));
      steps.push(close());
      break;
    }
    case 'chore': {
      const kinds: Array<'git-status' | 'git-diff' | 'git-log' | 'typecheck' | 'lint'> = ['git-status', 'git-diff', 'git-log', 'typecheck', 'lint'];
      const first = pick(kinds, 'git-status');
      steps.push(bashStep(tctx, first, { fail: (first === 'lint' || first === 'typecheck') && chance(0.5) }));
      if (first.startsWith('git') && chance(0.5)) steps.push(bashStep(tctx, first === 'git-status' ? 'git-diff' : 'git-status'));
      if (chance(0.5)) steps.push(grepStep(tctx, v.functionB));
      steps.push(finding());
      if (chance(0.6)) steps.push(editStep(env.primaryDiff()));
      if (chance(0.5)) steps.push(bashStep(tctx, first === 'lint' ? 'lint' : 'typecheck'));
      steps.push(close());
      break;
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BossGenOptions {
  turnCount: number;
  cache: WorkspaceCache;
  diffSource: 'workspace' | 'builtin';
}

function fallbackContext(cache: WorkspaceCache, i: number): ActiveTabContext {
  const fileName = cache.files.length ? cache.files[(i + randInt(0, cache.files.length - 1)) % cache.files.length] : 'utils.ts';
  const snip = cache.snippets.find((s) => s.fileName === fileName);
  return {
    fileName,
    filePath: fileName,
    language: cache.primaryLang,
    lineCount: randInt(60, 480),
    classes: cache.classes,
    functions: cache.functions,
    imports: cache.imports,
    sampledLines: snip?.lines ?? [],
  };
}

function makeEnv(ctx: ActiveTabContext, opts: BossGenOptions, sc: Scenario, otherFiles: string[]): BuildEnv {
  const v = makeVocab(ctx, otherFiles);
  const lang = normalizeLang(ctx.language);
  const tctx: ToolContext = {
    lang,
    fileName: ctx.fileName,
    files: otherFiles,
    functions: ctx.functions.length ? ctx.functions : opts.cache.functions,
    classes: ctx.classes.length ? ctx.classes : opts.cache.classes,
    sampledLines: ctx.sampledLines,
    lineCount: ctx.lineCount,
  };
  let usedPrimary = false;
  const primaryDiff = (): DiffHunk => {
    if (!usedPrimary && ctx.sampledLines.length) {
      usedPrimary = true;
      return generateActiveTabDiff(ctx.fileName, ctx.language, ctx.sampledLines);
    }
    const d = generateFakeDiff({ lang: ctx.language, primaryLang: opts.cache.primaryLang, fileNamePool: [ctx.fileName], snippetSource: 'workspace' });
    return { ...d, fileName: ctx.fileName };
  };
  const otherDiff = (): DiffHunk =>
    generateFakeDiff({
      lang: ctx.language,
      primaryLang: opts.cache.primaryLang,
      fileNamePool: otherFiles.filter((f) => f !== ctx.fileName),
      snippetSource: opts.diffSource,
    });
  return { sc, v, tctx, primaryDiff, otherDiff };
}

/**
 * Generate fake "working" conversation turns. Prefers the active tab; falls back
 * to workspace cache, then to generic content.
 */
export function generateBossConversation(opts: BossGenOptions): FakeTurn[] {
  const active = readActiveTab();
  const turns: FakeTurn[] = [];
  const otherFiles = opts.cache.files.length ? opts.cache.files : ['index.ts', 'utils.ts', 'api.ts', 'config.ts'];
  let lastSc: Scenario | undefined;

  for (let i = 0; i < opts.turnCount; i++) {
    let sc = pickScenario();
    if (sc === lastSc) sc = pickScenario(); // avoid two identical shapes back to back
    lastSc = sc;
    // The first turn is about the active tab; later ones wander across the workspace.
    const ctx = active && (i === 0 || chance(0.5)) ? active : fallbackContext(opts.cache, i);
    const env = makeEnv(ctx, opts, sc, otherFiles);
    const prompt = fill(pick(PROMPTS[sc], 'analyze this'), env.v);
    turns.push({ prompt, steps: buildSteps(env) });
  }

  return turns;
}

export interface ReadingDisguiseOptions {
  cache: WorkspaceCache;
  diffSource: 'workspace' | 'builtin';
  lang: string; // 'auto' or specific
}

/**
 * A short burst of fake work woven between novel paragraphs. Rendered instantly, so
 * delays are zeroed; mostly an edit, sometimes a tool call with output, sometimes both.
 */
export function generateReadingDisguise(opts: ReadingDisguiseOptions): FakeStep[] {
  const ctx = fallbackContext(opts.cache, randInt(0, 7));
  const sc = pickScenario();
  const otherFiles = opts.cache.files.length ? opts.cache.files : ['index.ts', 'utils.ts', 'api.ts', 'config.ts'];
  const env = makeEnv(ctx, { turnCount: 1, cache: opts.cache, diffSource: opts.diffSource }, sc, otherFiles);
  if (opts.lang !== 'auto') env.tctx.lang = normalizeLang(opts.lang);
  const steps: FakeStep[] = [];
  const r = Math.random();
  if (r < 0.5) {
    steps.push(textStep(fill(pick(TEXT_FINDING[sc], TEXT_FINDING.fix[0]), env.v)));
    steps.push(editStep(env.primaryDiff()));
  } else if (r < 0.65) {
    steps.push(readStep(env.tctx));
    steps.push(editStep(env.primaryDiff()));
  } else if (r < 0.78) {
    steps.push(grepStep(env.tctx, env.v.functionName));
    steps.push(textStep(fill(pick(TEXT_TRANSITION, 'Now the fix.'), env.v)));
  } else if (r < 0.9) {
    steps.push(bashStep(env.tctx, pick(['test', 'typecheck', 'git-status', 'lint'], 'test'), { fail: chance(0.2) }));
  } else {
    steps.push(editStep(env.primaryDiff()));
    steps.push(bashStep(env.tctx, 'test'));
    steps.push(textStep(fill(pick(TEXT_CLOSE[sc], TEXT_CLOSE.fix[0]), env.v)));
  }
  // Reading mode renders instantly; strip the pre-rolled pacing.
  for (const s of steps) {
    s.delayMs = 0;
    if ('runMs' in s) s.runMs = 0;
  }
  return steps;
}
