// Generates fake "thinking" / parse-log lines (rendered with streaming in the webview).

function fmtKB(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  return Math.round(bytes / 1024) + 'KB';
}

export function initThinkingLog(byteSize: number, encoding: string, chapters: number): string[] {
  return [
    `reading file… ${fmtKB(byteSize)}`,
    `detecting encoding: ${encoding.toUpperCase()}`,
    `splitting chapters: ${chapters} found`,
    'building index…',
  ];
}

const READ_LOGS = [
  'parsing token stream…',
  'resolving symbol table…',
  'analyzing control flow…',
  'checking type constraints…',
  'walking the AST…',
  'evaluating call graph…',
  'inlining trivial accessors…',
  'collecting references…',
];

export function readingThinkingLog(): string[] {
  const n = 1 + Math.floor(Math.random() * 2);
  const out: string[] = [];
  const pool = [...READ_LOGS];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
