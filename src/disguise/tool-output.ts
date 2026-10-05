// Fake tool-call outputs for the Claude Code disguise: shell runs, greps, file reads…
// Everything is language-aware (ts / js / python / go / java / rust) and randomized.

import { FakeStep, FakeToolName } from '../types';
import { getSnippet, normalizeLang } from './snippet-pool';

// ---------------------------------------------------------------------------
// Randomness helpers
// ---------------------------------------------------------------------------
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick<T>(arr: readonly T[], fallback: T): T {
  if (!arr || arr.length === 0) return fallback;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

/**
 * Skewed random duration: most values sit near `min`, a long tail reaches `max`.
 * `skew` > 1 pushes the mass toward `min` (real tool calls are usually quick, sometimes slow).
 */
export function skewed(min: number, max: number, skew = 1.8): number {
  return Math.round(min + (max - min) * Math.pow(Math.random(), skew));
}

/** "Model is thinking" pause before a step: usually sub-second, occasionally a real stall. */
export function thinkDelay(): number {
  if (chance(0.12)) return skewed(1800, 4500, 1.3);
  return skewed(250, 1600);
}

/** How long a tool shows as in-progress before its output lands. */
export function toolRunTime(tool: FakeToolName | 'Edit', target = ''): number {
  switch (tool) {
    case 'Read':
      return skewed(120, 800);
    case 'Grep':
      return skewed(200, 1500);
    case 'Glob':
      return skewed(150, 900);
    case 'Edit':
      return skewed(250, 1200);
    case 'Write':
      return skewed(250, 1000);
    case 'TodoWrite':
      return skewed(80, 350);
    case 'WebFetch':
      return skewed(900, 4000, 1.2);
    case 'Bash': {
      const t = target;
      if (/test|pytest|vitest|jest|cargo test|gradlew|mvn/.test(t)) return skewed(1400, 9000, 1.4);
      if (/tsc|mypy|cargo check|go vet|go build|build|clippy/.test(t)) return skewed(1000, 6000, 1.5);
      if (/lint|eslint|ruff/.test(t)) return skewed(600, 3500);
      if (/npm (install|ci)|pip install|cargo fetch/.test(t)) return skewed(2500, 12000, 1.3);
      return skewed(120, 700); // git / ls / wc / rg
    }
  }
}

// ---------------------------------------------------------------------------
// Context passed in by the generator
// ---------------------------------------------------------------------------
export interface ToolContext {
  lang: string; // normalized language
  fileName: string; // the file this turn is "about"
  files: string[]; // other file names (workspace or builtin)
  functions: string[];
  classes: string[];
  /** Real lines from the active tab / a workspace snippet, if any. */
  sampledLines?: string[];
  lineCount?: number;
}

const SRC_DIRS: Record<string, string[]> = {
  typescript: ['src', 'src/utils', 'src/core', 'src/services', 'lib', 'packages/core/src'],
  javascript: ['src', 'lib', 'src/utils', 'scripts'],
  python: ['src', 'app', 'app/core', 'services', 'lib'],
  go: ['internal', 'pkg', 'cmd/server', 'internal/handler'],
  java: ['src/main/java/com/app', 'src/main/java/com/app/service', 'src/main/java/com/app/util'],
  rust: ['src', 'src/parser', 'crates/core/src'],
};

const TEST_DIRS: Record<string, string> = {
  typescript: 'src/__tests__',
  javascript: 'test',
  python: 'tests',
  go: 'internal',
  java: 'src/test/java/com/app',
  rust: 'tests',
};

// A file keeps the same fake directory for the whole session, so a Read, a Grep hit and
// a git status line about the same file all agree.
const DIR_OF = new Map<string, string>();
function srcPath(lang: string, file: string): string {
  if (file.includes('/')) return file;
  let dir = DIR_OF.get(file);
  if (!dir) {
    dir = pick(SRC_DIRS[lang] ?? SRC_DIRS.typescript, 'src');
    DIR_OF.set(file, dir);
  }
  return `${dir}/${file}`;
}

export function testFileFor(lang: string, file: string): string {
  const base = file.replace(/\.[^.]+$/, '');
  switch (lang) {
    case 'python':
      return `${TEST_DIRS.python}/test_${base}.py`;
    case 'go':
      return `${TEST_DIRS.go}/${base}_test.go`;
    case 'java':
      return `${TEST_DIRS.java}/${base}Test.java`;
    case 'rust':
      return `${TEST_DIRS.rust}/${base}.rs`;
    case 'javascript':
      return `${TEST_DIRS.javascript}/${base}.test.js`;
    default:
      return `${TEST_DIRS.typescript}/${base}.test.ts`;
  }
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export function readStep(ctx: ToolContext, file = ctx.fileName, opts: { delayMs?: number } = {}): FakeStep {
  const total = ctx.lineCount && file === ctx.fileName ? ctx.lineCount : randInt(40, 420);
  const target = srcPath(ctx.lang, file);
  // Claude Code renders Read as a collapsed "Read N lines"; sometimes we show a peek.
  let output: string[] = [];
  const sample = file === ctx.fileName && ctx.sampledLines?.length ? ctx.sampledLines : getSnippet(ctx.lang).snippet.lines.map((l) => l.text);
  if (chance(0.45)) {
    const start = randInt(1, Math.max(1, total - sample.length));
    output = sample.slice(0, randInt(4, 8)).map((l, i) => `${String(start + i).padStart(5)}→${l}`);
  }
  return {
    kind: 'tool',
    tool: 'Read',
    target,
    output,
    summary: `Read ${total} lines`,
    collapseAfter: output.length ? 4 : undefined,
    delayMs: opts.delayMs ?? thinkDelay(),
    runMs: toolRunTime('Read'),
  };
}

// ---------------------------------------------------------------------------
// Grep
// ---------------------------------------------------------------------------
// Call-site shapes for files that *use* the symbol…
const GREP_LINE_SHAPES: Record<string, string[]> = {
  typescript: [
    '  const result = {sym}(input);',
    "import { {sym} } from './{base}';",
    '    return {sym}(value, options);',
    '  {sym}: (x) => {sym}(x),',
    '  await {sym}(ctx);',
    '    if (!{sym}(item)) continue;',
  ],
  javascript: ['  const out = {sym}(data);', "const { {sym} } = require('./{base}');", '    {sym}(cb);', '  return {sym}(value);'],
  python: ['    result = {sym}(value)', 'from .{base} import {sym}', '        return {sym}(item)', '    if not {sym}(row):'],
  go: ['\tres, err := {sym}(ctx)', '\tif err := {sym}(); err != nil {', '\t\treturn {sym}(v)', '\tout := {sym}(in)'],
  java: ['        return {sym}(input);', '        {sym}(request);', 'import com.app.util.{sym};', '        var out = {sym}(items);'],
  rust: ['    let out = {sym}(&input)?;', 'use crate::{base}::{sym};', '        {sym}(v)', '    if {sym}(&item) {'],
};
// …and the single definition line in the file that owns it.
const GREP_DEF_SHAPE: Record<string, string> = {
  typescript: 'export function {sym}(',
  javascript: 'function {sym}(',
  python: 'def {sym}(',
  go: 'func {sym}(',
  java: '    public static Result {sym}(',
  rust: 'pub fn {sym}(',
};

export function grepStep(ctx: ToolContext, symbol?: string, opts: { delayMs?: number } = {}): FakeStep {
  const lang = ctx.lang;
  const sym = symbol ?? pick(ctx.functions, 'handle');
  const base = ctx.fileName.replace(/\.[^.]+$/, '');
  const files = ctx.files.filter((f) => f !== ctx.fileName);
  const nFiles = Math.min(randInt(1, 4), Math.max(1, files.length));
  const shapes = GREP_LINE_SHAPES[lang] ?? GREP_LINE_SHAPES.typescript;
  const out: string[] = [];
  let matches = 0;
  if (chance(0.7)) {
    // The definition in the file being worked on comes first.
    out.push(`${srcPath(lang, ctx.fileName)}:${randInt(3, 80)}:${(GREP_DEF_SHAPE[lang] ?? GREP_DEF_SHAPE.typescript).replace(/\{sym\}/g, sym)}`);
    matches++;
  }
  for (let i = 0; i < nFiles; i++) {
    const f = pick(files, 'index.ts');
    const path = srcPath(lang, f);
    const per = randInt(1, 3);
    let ln = randInt(3, 60);
    for (let k = 0; k < per; k++) {
      out.push(`${path}:${ln}:${pick(shapes, shapes[0]).replace(/\{sym\}/g, sym).replace(/\{base\}/g, base)}`);
      ln += randInt(8, 90);
      matches++;
    }
  }
  if (chance(0.1)) {
    // Nothing found — a real session hits this all the time.
    return {
      kind: 'tool',
      tool: 'Grep',
      target: sym,
      output: [],
      summary: 'No matches found',
      delayMs: opts.delayMs ?? thinkDelay(),
      runMs: toolRunTime('Grep'),
    };
  }
  const pattern = chance(0.3) ? `${sym}\\(` : sym;
  const nFilesTotal = new Set(out.map((l) => l.split(':')[0])).size;
  return {
    kind: 'tool',
    tool: 'Grep',
    target: pattern,
    output: out,
    summary: `Found ${matches} match${matches === 1 ? '' : 'es'} in ${nFilesTotal} file${nFilesTotal === 1 ? '' : 's'}`,
    collapseAfter: out.length > 6 ? 5 : undefined,
    delayMs: opts.delayMs ?? thinkDelay(),
    runMs: toolRunTime('Grep'),
  };
}

// ---------------------------------------------------------------------------
// Glob
// ---------------------------------------------------------------------------
const EXT: Record<string, string> = { typescript: 'ts', javascript: 'js', python: 'py', go: 'go', java: 'java', rust: 'rs' };

export function globStep(ctx: ToolContext, opts: { delayMs?: number } = {}): FakeStep {
  const ext = EXT[ctx.lang] ?? 'ts';
  const base = ctx.fileName.replace(/\.[^.]+$/, '');
  const patterns = [`**/*.${ext}`, `src/**/*.${ext}`, `**/*${base}*`, `**/*.test.${ext}`, `**/${base}.*`];
  const pattern = pick(patterns, patterns[0]);
  const n = randInt(2, 9);
  const pool = ctx.files.length ? ctx.files : [ctx.fileName];
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < n * 2 && out.length < n; i++) {
    const f = pick(pool, ctx.fileName);
    const p = pattern.includes('test') ? testFileFor(ctx.lang, f) : srcPath(ctx.lang, f);
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  out.sort();
  return {
    kind: 'tool',
    tool: 'Glob',
    target: pattern,
    output: out,
    summary: `Found ${out.length} file${out.length === 1 ? '' : 's'}`,
    collapseAfter: out.length > 6 ? 5 : undefined,
    delayMs: opts.delayMs ?? thinkDelay(),
    runMs: toolRunTime('Glob'),
  };
}

// ---------------------------------------------------------------------------
// Bash
// ---------------------------------------------------------------------------
export type BashKind = 'test' | 'typecheck' | 'lint' | 'build' | 'git-status' | 'git-diff' | 'git-log' | 'ls' | 'wc' | 'rg';

export interface BashOptions {
  /** Force the command to fail (red dot, non-zero exit). */
  fail?: boolean;
  /** Pass on retry after a fix: fewer failures, all green. */
  delayMs?: number;
}

function testCommand(lang: string, file?: string): string {
  const base = file?.replace(/\.[^.]+$/, '');
  switch (lang) {
    case 'python':
      return pick([`pytest -q`, `python -m pytest ${base ? `tests/test_${base}.py ` : ''}-q`, `pytest tests/ -x -q`], 'pytest -q');
    case 'go':
      return pick(['go test ./...', 'go test ./internal/... -run Test -count=1', `go test ./... -race`], 'go test ./...');
    case 'rust':
      return pick(['cargo test', `cargo test ${base ?? ''}`.trim(), 'cargo test -- --nocapture'], 'cargo test');
    case 'java':
      return pick(['./gradlew test --quiet', 'mvn -q test', `./gradlew test --tests '*${base ?? 'Service'}Test'`], 'mvn -q test');
    case 'javascript':
      return pick(['npm test', `npx jest ${base ? `test/${base}.test.js` : ''}`.trim(), 'npm test -- --silent'], 'npm test');
    default:
      return pick(['npm test', `npx vitest run ${base ? `src/__tests__/${base}.test.ts` : ''}`.trim(), 'npx vitest run', 'npm test -- --run'], 'npm test');
  }
}

/** Distinct test-file paths for a fake run (never the same file listed twice). */
function uniqueTestFiles(lang: string, ctx: ToolContext, n: number): string[] {
  const pool = [ctx.fileName, ...ctx.files];
  const seen = new Set<string>();
  for (let i = 0; i < n * 3 && seen.size < n; i++) seen.add(testFileFor(lang, pick(pool, ctx.fileName)));
  return [...seen];
}

function testOutput(lang: string, ctx: ToolContext, fail: boolean): string[] {
  const files = randInt(3, 14);
  const tests = files * randInt(3, 9) + randInt(0, 7);
  const failed = fail ? randInt(1, 3) : 0;
  const dur = randInt(900, 7800);
  const fn = pick(ctx.functions, 'handle');
  const tfile = testFileFor(lang, ctx.fileName);
  switch (lang) {
    case 'python': {
      const dots = '.'.repeat(Math.min(tests, 48)).split('');
      if (fail) for (let i = 0; i < failed; i++) dots[randInt(0, dots.length - 1)] = 'F';
      const out = [dots.join('') + `   [100%]`];
      if (fail) {
        out.push('', '=================================== FAILURES ===================================', `_____________________________ test_${fn}_empty_input _____________________________`, '', `    def test_${fn}_empty_input():`, `>       assert ${fn}([]) == []`, `E       TypeError: 'NoneType' object is not iterable`, '', `${tfile}:${randInt(10, 90)}: TypeError`);
        out.push(`${'='.repeat(20)} ${failed} failed, ${tests - failed} passed in ${(dur / 1000).toFixed(2)}s ${'='.repeat(20)}`);
      } else {
        out.push(`${tests} passed in ${(dur / 1000).toFixed(2)}s`);
      }
      return out;
    }
    case 'go': {
      const pkgs = ['internal/handler', 'internal/store', 'pkg/util', 'cmd/server', 'internal/parser'].slice(0, randInt(2, 5));
      const out = pkgs.map((p) => (fail && p === pkgs[0] ? `--- FAIL: Test${cap(fn)} (0.0${randInt(1, 9)}s)\n    ${ctx.fileName.replace(/\.go$/, '')}_test.go:${randInt(20, 80)}: expected 3 items, got 0\nFAIL\nFAIL\tapp/${p}\t0.${randInt(100, 999)}s` : `ok  \tapp/${p}\t${(randInt(50, 2400) / 1000).toFixed(3)}s`));
      if (fail) out.push('FAIL');
      return out.join('\n').split('\n');
    }
    case 'rust': {
      const out = [`   Compiling app v0.1.0 (${pick(['/Users/dev/app', '/home/dev/app'], '/home/dev/app')})`, `    Finished test [unoptimized + debuginfo] target(s) in ${(dur / 1000).toFixed(2)}s`, `     Running unittests src/lib.rs`, '', `running ${tests} tests`];
      if (fail) {
        out.push(`test ${fn}::tests::handles_empty ... FAILED`, '', 'failures:', '', `---- ${fn}::tests::handles_empty stdout ----`, `thread '${fn}::tests::handles_empty' panicked at 'called \`Option::unwrap()\` on a \`None\` value', ${srcPath(lang, ctx.fileName)}:${randInt(20, 200)}:${randInt(5, 40)}`, '', `test result: FAILED. ${tests - failed} passed; ${failed} failed; 0 ignored; 0 measured`);
      } else {
        out.push(`test result: ok. ${tests} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in ${(dur / 1000).toFixed(2)}s`);
      }
      return out;
    }
    case 'java': {
      const out = fail
        ? [`${cap(fn)}Test > handlesEmptyInput() FAILED`, `    java.lang.NullPointerException at ${cap(fn)}Test.java:${randInt(20, 90)}`, '', `${tests} tests completed, ${failed} failed`, '', 'FAILURE: Build failed with an exception.']
        : ['BUILD SUCCESSFUL in ' + randInt(4, 48) + 's', `${randInt(3, 9)} actionable tasks: ${randInt(1, 4)} executed, ${randInt(1, 5)} up-to-date`];
      return out;
    }
    default: {
      // vitest / jest
      const vitest = chance(0.6);
      const out: string[] = [];
      if (vitest) {
        out.push(` RUN  v${randInt(1, 2)}.${randInt(0, 6)}.${randInt(0, 12)} ${pick(['/Users/dev/app', '/home/dev/app', '/workspace/app'], '/home/dev/app')}`, '');
        const shownFiles = uniqueTestFiles(lang, ctx, Math.min(files, 6));
        shownFiles.forEach((f, i) => {
          const isFail = fail && i === 0;
          out.push(` ${isFail ? '❯' : '✓'} ${f} (${randInt(2, 14)} tests${isFail ? ` | ${failed} failed` : ''}) ${randInt(3, 480)}ms`);
        });
        if (fail) out.push('', `   × ${fn} > handles empty input`, `     → expected [] to deeply equal undefined`, '', ` ❯ ${tfile}:${randInt(10, 80)}:${randInt(5, 30)}`);
        out.push('', ` Test Files  ${fail ? `1 failed | ${files - 1} passed` : `${files} passed`} (${files})`, `      Tests  ${fail ? `${failed} failed | ${tests - failed} passed` : `${tests} passed`} (${tests})`, `   Start at  ${new Date().toTimeString().slice(0, 8)}`, `   Duration  ${fmtMs(dur)}`);
      } else {
        const shownFiles = uniqueTestFiles(lang, ctx, Math.min(files, 6));
        shownFiles.forEach((f, i) => {
          const isFail = fail && i === 0;
          out.push(`${isFail ? 'FAIL' : 'PASS'} ${f}${isFail ? '' : ` (${(randInt(100, 3200) / 1000).toFixed(3)} s)`}`);
        });
        if (fail) out.push(`  ● ${fn} › handles empty input`, '', `    expect(received).toEqual(expected)`, '', `    Expected: []`, `    Received: undefined`, '', `      at Object.<anonymous> (${tfile}:${randInt(10, 80)}:${randInt(5, 30)})`, '');
        out.push(`Test Suites: ${fail ? `1 failed, ${files - 1} passed` : `${files} passed`}, ${files} total`, `Tests:       ${fail ? `${failed} failed, ${tests - failed} passed` : `${tests} passed`}, ${tests} total`, `Snapshots:   0 total`, `Time:        ${(dur / 1000).toFixed(3)} s`);
      }
      return out;
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typecheckCommand(lang: string): string {
  switch (lang) {
    case 'python':
      return pick(['mypy src/', 'mypy . --strict', 'pyright'], 'mypy src/');
    case 'go':
      return pick(['go vet ./...', 'go build ./...'], 'go build ./...');
    case 'rust':
      return pick(['cargo check', 'cargo clippy -- -D warnings'], 'cargo check');
    case 'java':
      return pick(['./gradlew compileJava --quiet', 'mvn -q compile'], 'mvn -q compile');
    default:
      return pick(['npx tsc --noEmit', 'npm run typecheck', 'npx tsc --noEmit -p tsconfig.json'], 'npx tsc --noEmit');
  }
}

function typecheckOutput(lang: string, ctx: ToolContext, fail: boolean): string[] {
  const path = srcPath(lang, ctx.fileName);
  const fn = pick(ctx.functions, 'handle');
  if (!fail) {
    switch (lang) {
      case 'python':
        return ['Success: no issues found in ' + randInt(12, 90) + ' source files'];
      case 'rust':
        return [`    Checking app v0.1.0`, `    Finished dev [unoptimized + debuginfo] target(s) in ${randInt(1, 14)}.${randInt(10, 99)}s`];
      default:
        return [];
    }
  }
  switch (lang) {
    case 'python':
      return [`${path}:${randInt(10, 200)}: error: Argument 1 to "${fn}" has incompatible type "None"; expected "str"  [arg-type]`, 'Found 1 error in 1 file (checked ' + randInt(12, 90) + ' source files)'];
    case 'go':
      return [`# app/${path.split('/').slice(0, -1).join('/')}`, `${path}:${randInt(10, 200)}:${randInt(2, 30)}: cannot use nil as string value in return statement`];
    case 'rust':
      return [`error[E0308]: mismatched types`, `  --> ${path}:${randInt(10, 200)}:${randInt(5, 30)}`, `   |`, `   |     ${fn}(value)`, `   |          ^^^^^ expected \`&str\`, found \`Option<&str>\``, '', `error: could not compile \`app\` due to previous error`];
    case 'java':
      return [`${path}:[${randInt(10, 200)},${randInt(5, 40)}] incompatible types: String cannot be converted to Optional<String>`, '1 error'];
    default:
      return [`${path}(${randInt(10, 200)},${randInt(3, 40)}): error TS2322: Type 'string | undefined' is not assignable to type 'string'.`, `  Type 'undefined' is not assignable to type 'string'.`, '', 'Found 1 error in ' + path];
  }
}

function lintCommand(lang: string): string {
  switch (lang) {
    case 'python':
      return pick(['ruff check .', 'ruff check src/ --fix', 'flake8 src/'], 'ruff check .');
    case 'go':
      return 'golangci-lint run';
    case 'rust':
      return 'cargo clippy';
    case 'java':
      return './gradlew checkstyleMain --quiet';
    default:
      return pick(['npm run lint', 'npx eslint src/ --max-warnings 0', `npx eslint src/${'{file}'}`], 'npm run lint');
  }
}

function lintOutput(lang: string, ctx: ToolContext, fail: boolean): string[] {
  const path = srcPath(lang, ctx.fileName);
  if (!fail) {
    if (lang === 'python') return ['All checks passed!'];
    return [];
  }
  switch (lang) {
    case 'python':
      return [`${path}:${randInt(1, 20)}:1: F401 [*] \`os\` imported but unused`, `${path}:${randInt(30, 200)}:5: E722 Do not use bare \`except\``, 'Found 2 errors.', '[*] 1 fixable with the `--fix` option.'];
    case 'go':
      return [`${path}:${randInt(10, 200)}:2: ineffectual assignment to err (ineffassign)`];
    default:
      return ['', `${path}`, `  ${randInt(1, 20)}:10  warning  '${pick(ctx.classes, 'Options')}' is defined but never used  @typescript-eslint/no-unused-vars`, `  ${randInt(30, 200)}:7   error    Unexpected any. Specify a different type         @typescript-eslint/no-explicit-any`, '', '✖ 2 problems (1 error, 1 warning)'];
  }
}

function buildCommand(lang: string): string {
  switch (lang) {
    case 'python':
      return 'python -m build';
    case 'go':
      return 'go build -o bin/server ./cmd/server';
    case 'rust':
      return 'cargo build --release';
    case 'java':
      return './gradlew build -x test --quiet';
    default:
      return pick(['npm run build', 'npx esbuild src/index.ts --bundle --outfile=dist/index.js', 'npx vite build'], 'npm run build');
  }
}

function buildOutput(lang: string): string[] {
  switch (lang) {
    case 'rust':
      return [`   Compiling app v0.1.0`, `    Finished release [optimized] target(s) in ${randInt(8, 95)}.${randInt(10, 99)}s`];
    case 'go':
    case 'java':
    case 'python':
      return [];
    default:
      if (chance(0.5)) {
        return ['', `  dist/index.js  ${randInt(40, 900)}.${randInt(0, 9)}kb`, '', `⚡ Done in ${randInt(30, 900)}ms`];
      }
      return [`vite v5.${randInt(0, 4)}.${randInt(0, 12)} building for production...`, `✓ ${randInt(40, 400)} modules transformed.`, `dist/index.html                  ${randInt(0, 4)}.${randInt(10, 99)} kB │ gzip:  0.${randInt(30, 99)} kB`, `dist/assets/index-${hex(8)}.js   ${randInt(80, 700)}.${randInt(10, 99)} kB │ gzip: ${randInt(20, 200)}.${randInt(10, 99)} kB`, `✓ built in ${(randInt(800, 9000) / 1000).toFixed(2)}s`];
  }
}

function hex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += '0123456789abcdef'[randInt(0, 15)];
  return s;
}

function gitStatusOutput(ctx: ToolContext): string[] {
  const n = randInt(1, 4);
  const out = [` M ${srcPath(ctx.lang, ctx.fileName)}`];
  const marks = [' M', ' M', '??', 'A '];
  for (let i = 1; i < n; i++) out.push(`${pick(marks, ' M')} ${srcPath(ctx.lang, pick(ctx.files, 'index.ts'))}`);
  if (chance(0.3)) out.push(`?? ${testFileFor(ctx.lang, ctx.fileName)}`);
  return out;
}

function gitDiffStatOutput(ctx: ToolContext): string[] {
  const n = randInt(1, 4);
  const out: string[] = [];
  let ins = 0;
  let del = 0;
  const rows = [ctx.fileName, ...Array.from({ length: n - 1 }, () => pick(ctx.files, 'index.ts'))];
  for (const f of rows) {
    const a = randInt(1, 40);
    const d = randInt(0, 25);
    ins += a;
    del += d;
    const path = srcPath(ctx.lang, f);
    out.push(` ${path.padEnd(34)} | ${String(a + d).padStart(3)} ${'+'.repeat(Math.min(a, 20))}${'-'.repeat(Math.min(d, 12))}`);
  }
  out.push(` ${rows.length} file${rows.length === 1 ? '' : 's'} changed, ${ins} insertion${ins === 1 ? '' : 's'}(+), ${del} deletion${del === 1 ? '' : 's'}(-)`);
  return out;
}

const COMMIT_SUBJECTS = ['fix: guard empty input in {fn}', 'refactor: extract {cls} helpers', 'chore: bump deps', 'feat: add retry to {fn}', 'test: cover error path of {fn}', 'fix typo in error message', 'perf: memoize {fn}', 'docs: update README', 'ci: cache node_modules', 'refactor: simplify {fn} branching'];

function gitLogOutput(ctx: ToolContext): string[] {
  const n = randInt(4, 8);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${hex(7)} ${pick(COMMIT_SUBJECTS, COMMIT_SUBJECTS[0]).replace('{fn}', pick(ctx.functions, 'handle')).replace('{cls}', pick(ctx.classes, 'Service'))}`);
  }
  return out;
}

function lsOutput(ctx: ToolContext): string[] {
  const pool = ctx.files.length ? ctx.files : [ctx.fileName];
  const n = Math.min(pool.length, randInt(4, 12));
  const seen = new Set<string>();
  while (seen.size < n) seen.add(pick(pool, ctx.fileName));
  return [...seen].sort();
}

function wcOutput(ctx: ToolContext): string[] {
  const files = [ctx.fileName, ...Array.from({ length: randInt(0, 3) }, () => pick(ctx.files, 'index.ts'))];
  const rows = files.map((f) => [randInt(30, 900), srcPath(ctx.lang, f)] as const);
  const out = rows.map(([n, p]) => `${String(n).padStart(8)} ${p}`);
  if (rows.length > 1) out.push(`${String(rows.reduce((s, [n]) => s + n, 0)).padStart(8)} total`);
  return out;
}

export function bashStep(ctx: ToolContext, kind: BashKind, opts: BashOptions = {}): FakeStep {
  const lang = ctx.lang;
  const fail = !!opts.fail;
  let target: string;
  let output: string[];
  let summary: string | undefined;
  switch (kind) {
    case 'test':
      target = testCommand(lang, chance(0.4) ? ctx.fileName : undefined);
      output = testOutput(lang, ctx, fail);
      break;
    case 'typecheck':
      target = typecheckCommand(lang);
      output = typecheckOutput(lang, ctx, fail);
      break;
    case 'lint':
      target = lintCommand(lang).replace('{file}', ctx.fileName);
      output = lintOutput(lang, ctx, fail);
      break;
    case 'build':
      target = buildCommand(lang);
      output = buildOutput(lang);
      break;
    case 'git-status':
      target = pick(['git status --short', 'git status', 'git status -s'], 'git status --short');
      output = gitStatusOutput(ctx);
      break;
    case 'git-diff':
      target = pick(['git diff --stat', 'git diff --stat HEAD', 'git diff --stat HEAD~1'], 'git diff --stat');
      output = gitDiffStatOutput(ctx);
      break;
    case 'git-log':
      target = pick(['git log --oneline -5', 'git log --oneline -8', 'git log --oneline --no-decorate -6'], 'git log --oneline -5');
      output = gitLogOutput(ctx);
      break;
    case 'ls':
      target = `ls ${pick(SRC_DIRS[lang] ?? SRC_DIRS.typescript, 'src')}/`;
      output = lsOutput(ctx);
      break;
    case 'wc':
      target = `wc -l ${srcPath(lang, ctx.fileName)}${chance(0.4) ? ` ${srcPath(lang, pick(ctx.files, 'index.ts'))}` : ''}`;
      output = wcOutput(ctx);
      break;
    case 'rg':
    default: {
      const sym = pick(ctx.functions, 'handle');
      target = `rg -n "${sym}" ${pick(SRC_DIRS[lang] ?? SRC_DIRS.typescript, 'src')}/`;
      const g = grepStep(ctx, sym);
      output = g.kind === 'tool' ? g.output.map((l) => l.replace(/^[^:]+\/([^/:]+):/, '$1:')) : [];
      break;
    }
  }
  if (!output.length) summary = fail ? `Exit code ${randInt(1, 2)}` : '(No output)';
  else if (fail) summary = `Exit code ${kind === 'test' ? 1 : randInt(1, 2)}`;
  return {
    kind: 'tool',
    tool: 'Bash',
    target,
    output,
    summary,
    failed: fail,
    collapseAfter: output.length > 10 ? 8 : undefined,
    delayMs: opts.delayMs ?? thinkDelay(),
    runMs: toolRunTime('Bash', target),
  };
}

// ---------------------------------------------------------------------------
// Write (new file)
// ---------------------------------------------------------------------------
const NEW_FILE_NAMES: Record<string, string[]> = {
  typescript: ['retry.ts', 'cache.ts', 'guards.ts', 'normalize.ts', 'types.ts', 'constants.ts'],
  javascript: ['retry.js', 'cache.js', 'guards.js', 'normalize.js'],
  python: ['retry.py', 'cache.py', 'guards.py', 'normalize.py', 'constants.py'],
  go: ['retry.go', 'cache.go', 'guards.go', 'normalize.go'],
  java: ['Retry.java', 'Cache.java', 'Guards.java', 'Normalizer.java'],
  rust: ['retry.rs', 'cache.rs', 'guards.rs', 'normalize.rs'],
};

export function writeStep(ctx: ToolContext, opts: { test?: boolean; delayMs?: number } = {}): FakeStep {
  const lang = ctx.lang;
  const file = opts.test ? testFileFor(lang, ctx.fileName) : srcPath(lang, pick(NEW_FILE_NAMES[lang] ?? NEW_FILE_NAMES.typescript, 'helpers.ts'));
  let lines: string[];
  if (opts.test) {
    lines = testFileLines(lang, ctx);
  } else {
    // Prefer a "feature" snippet (all additions) so the new file reads as a fresh helper.
    let snip = getSnippet(lang).snippet;
    for (let i = 0; i < 4 && snip.category !== 'feature'; i++) snip = getSnippet(lang).snippet;
    lines = snip.lines.filter((l) => l.type !== 'del').map((l) => l.text);
  }
  return {
    kind: 'tool',
    tool: 'Write',
    target: file,
    output: lines,
    summary: `Wrote ${lines.length} lines to ${file.split('/').pop()}`,
    collapseAfter: lines.length > 8 ? 6 : undefined,
    delayMs: opts.delayMs ?? thinkDelay(),
    runMs: toolRunTime('Write'),
  };
}

function testFileLines(lang: string, ctx: ToolContext): string[] {
  const fn = pick(ctx.functions, 'handle');
  const base = ctx.fileName.replace(/\.[^.]+$/, '');
  switch (lang) {
    case 'python':
      return [`from ${base} import ${fn}`, '', '', `def test_${fn}_empty_input():`, `    assert ${fn}([]) == []`, '', '', `def test_${fn}_single_item():`, `    assert ${fn}(["a"]) == ["a"]`];
    case 'go':
      return ['package ' + base.replace(/[^a-z0-9]/gi, ''), '', 'import "testing"', '', `func Test${cap(fn)}Empty(t *testing.T) {`, `\tgot := ${fn}(nil)`, '\tif len(got) != 0 {', `\t\tt.Fatalf("expected empty, got %v", got)`, '\t}', '}'];
    case 'rust':
      return ['#[cfg(test)]', 'mod tests {', '    use super::*;', '', '    #[test]', `    fn ${fn}_handles_empty() {`, `        assert!(${fn}(&[]).is_empty());`, '    }', '}'];
    case 'java':
      return ['import org.junit.jupiter.api.Test;', 'import static org.junit.jupiter.api.Assertions.*;', '', `class ${cap(base)}Test {`, '    @Test', `    void ${fn}HandlesEmptyInput() {`, `        assertTrue(${cap(base)}.${fn}(List.of()).isEmpty());`, '    }', '}'];
    case 'javascript':
      return [`const { ${fn} } = require('../src/${base}');`, '', `describe('${fn}', () => {`, `  it('handles empty input', () => {`, `    expect(${fn}([])).toEqual([]);`, '  });', '});'];
    default:
      return [`import { describe, it, expect } from 'vitest';`, `import { ${fn} } from '../${base}';`, '', `describe('${fn}', () => {`, `  it('handles empty input', () => {`, `    expect(${fn}([])).toEqual([]);`, '  });', '', `  it('preserves a single item', () => {`, `    expect(${fn}(['a'])).toEqual(['a']);`, '  });', '});'];
  }
}

// ---------------------------------------------------------------------------
// TodoWrite
// ---------------------------------------------------------------------------
export function todoStep(items: string[], doneUpTo: number, inProgress: number, opts: { delayMs?: number } = {}): FakeStep {
  const output = items.map((t, i) => {
    const mark = i < doneUpTo ? '☒' : i === inProgress ? '◐' : '☐';
    return `${mark} ${t}`;
  });
  return {
    kind: 'tool',
    tool: 'TodoWrite',
    target: '',
    output,
    summary: doneUpTo >= items.length ? 'All tasks completed' : `${doneUpTo}/${items.length} completed`,
    delayMs: opts.delayMs ?? skewed(150, 700),
    runMs: toolRunTime('TodoWrite'),
  };
}

export { normalizeLang };
