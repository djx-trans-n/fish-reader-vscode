import { DiffHunk, DiffLine } from '../types';
import { getSnippet, builtinFileName, normalizeLang } from './snippet-pool';

export interface DiffOptions {
  lang: string; // 'auto' or specific
  primaryLang?: string; // from workspace scan
  fileNamePool?: string[]; // workspace real file names
  snippetSource: 'workspace' | 'builtin';
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeHeader(lines: DiffLine[]): string {
  const adds = lines.filter((l) => l.type !== 'del').length;
  const dels = lines.filter((l) => l.type !== 'add').length;
  const start = randInt(8, 240);
  return `@@ -${start},${dels} +${start},${adds} @@`;
}

export function generateFakeDiff(opts: DiffOptions): DiffHunk {
  const lang = opts.lang === 'auto' ? opts.primaryLang || 'typescript' : opts.lang;
  const { snippet, lang: normLang } = getSnippet(lang);

  let fileName: string;
  if (opts.snippetSource === 'workspace' && opts.fileNamePool && opts.fileNamePool.length > 0) {
    fileName = pick(opts.fileNamePool);
  } else {
    fileName = builtinFileName(normLang);
  }

  return {
    fileName,
    lang: normLang,
    header: makeHeader(snippet.lines),
    category: snippet.category,
    lines: snippet.lines,
  };
}

/** Build a diff specifically targeting an active file, using sampled real lines. */
export function generateActiveTabDiff(
  fileName: string,
  lang: string,
  sampledLines: string[]
): DiffHunk {
  const norm = normalizeLang(lang);
  const lines: DiffLine[] = [];

  const ctxLines = sampledLines.filter((l) => l.trim().length > 0).slice(0, 4);
  if (ctxLines.length >= 2) {
    // Keep some context, "modify" one line, add a couple synthetic lines.
    lines.push({ type: 'ctx', text: ctxLines[0] });
    lines.push({ type: 'del', text: ctxLines[1] });
    lines.push({ type: 'add', text: ctxLines[1].replace(/\s+$/, '') + ' // hoisted' });
    if (ctxLines[2]) lines.push({ type: 'ctx', text: ctxLines[2] });
    lines.push(...syntheticAdds(norm));
  } else {
    lines.push(...syntheticAdds(norm));
  }

  return {
    fileName,
    lang: norm,
    header: makeHeader(lines),
    category: 'refactor',
    lines,
  };
}

function syntheticAdds(lang: string): DiffLine[] {
  switch (lang) {
    case 'python':
      return [
        { type: 'add', text: '    if not value:' },
        { type: 'add', text: '        return default' },
      ];
    case 'go':
      return [
        { type: 'add', text: '\tif err != nil {' },
        { type: 'add', text: '\t\treturn nil, err' },
        { type: 'add', text: '\t}' },
      ];
    default:
      return [
        { type: 'add', text: '  if (!input) return [];' },
        { type: 'add', text: '  const normalized = input.trim();' },
      ];
  }
}

/** Decide whether to emit a diff and how many consecutive ones. */
export function diffPlan(frequency: number): number {
  if (Math.random() > frequency) return 0;
  // Occasionally produce 2-3 in a row ("batch refactor").
  const r = Math.random();
  if (r < 0.12) return randInt(2, 3);
  return 1;
}
