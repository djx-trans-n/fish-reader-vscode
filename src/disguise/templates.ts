// Text pools for the fake Claude Code conversation (boss mode + reading disguise).
//
// Everything here is a template; `{placeholders}` are filled by boss-mode.ts from the
// active tab / workspace scan. Pools are grouped by *scenario* so a prompt about tests
// gets a test-shaped reply, a prompt about perf gets a perf-shaped reply, and so on.

export type Scenario = 'explain' | 'fix' | 'feature' | 'refactor' | 'perf' | 'review' | 'test' | 'chore';

export const SCENARIO_WEIGHTS: [Scenario, number][] = [
  ['fix', 22],
  ['refactor', 18],
  ['feature', 16],
  ['explain', 14],
  ['test', 10],
  ['perf', 8],
  ['review', 7],
  ['chore', 5],
];

// ---------------------------------------------------------------------------
// User prompts. Deliberately uneven in tone/length: lowercase one-liners, full
// sentences, a few with a trailing context note — like real chat history.
// ---------------------------------------------------------------------------
export const PROMPTS: Record<Scenario, string[]> = {
  explain: [
    'analyze {fileName} in current tab',
    'walk me through how {functionName} works',
    'what does {className} actually do? the name is misleading',
    'explain the data flow between {fileName} and {otherFile}',
    'is there any dead code in {fileName}?',
    'where is {functionName} called from?',
    'why does {fileName} import {importA}? looks unused',
    'give me a quick overview of {fileName}, I did not write this',
    'how does {functionName} handle the empty case',
    'what happens if {functionName} gets called twice in a row',
  ],
  fix: [
    '{functionName} throws on empty input, fix it',
    'tests are failing in {fileName} after my last change',
    "there's a null deref somewhere in {functionName}, can you find it",
    'fix the off-by-one in {functionName}',
    'why does {functionName} return undefined sometimes',
    '{fileName} crashes when {something} is empty — track it down',
    'this {functionName} returns inconsistent types, fix it',
    'getting "cannot read properties of undefined" from {fileName}:{ln}',
    'the fallback branch in {functionName} never runs. bug?',
    '{functionName} works locally but fails in CI, something with ordering',
    'fix: {className} keeps stale state between calls',
  ],
  feature: [
    'add error handling to {functionName}',
    'add a retry with backoff to {functionName}',
    'add types to {fileName}',
    'add a unit test for {functionName}',
    'support an optional timeout param in {functionName}',
    'log a warning when {functionName} falls back to the default',
    'make {functionName} accept an array as well as a single value',
    'add a {className}.dispose() that cleans up listeners',
    'expose {functionName} from the public index',
    'wire {functionName} into {otherFile} so it runs on startup',
  ],
  refactor: [
    'extract {className} into its own module',
    "refactor {functionName}, it's doing too much",
    'dedupe the logic between {functionName} and {functionB}',
    'rename {functionName} to something clearer and update callers',
    "split {fileName} — it's {n}00 lines",
    'replace the manual loop in {functionName} with map/filter',
    'move the constants at the top of {fileName} into {otherFile}',
    'can you simplify {functionName}? too many nested ifs',
    'convert {className} to a plain function, we never instantiate it twice',
    'inline {functionB}, it is only used once',
  ],
  perf: [
    'why is {fileName} so slow on large inputs?',
    "profile {functionName}, it's the hot path",
    'can we cache the result of {functionName}?',
    '{functionName} gets called {n}00 times per render, that cannot be right',
    'the {topic} step takes {n}s on the big fixture. ideas?',
    'memoize {functionName}',
  ],
  review: [
    'review the {functionName} logic — feels off',
    'review my changes in {fileName} before I push',
    'any security issues in {fileName}?',
    'does {functionName} handle unicode correctly',
    'sanity check {className} for race conditions',
    'quick review of {fileName} pls',
  ],
  test: [
    "run the tests and fix whatever's broken",
    'write tests for {className}',
    'why is the {functionName} test flaky',
    'add a regression test for the {something} bug',
    'tests pass? run them',
    'cover the error branch of {functionName} with a test',
  ],
  chore: [
    'what did I change since the last commit?',
    'clean up the imports in {fileName}',
    'typecheck passes? run it',
    'check if anything still references {functionB}',
    'remove the TODOs in {fileName} that are already done',
    'bump the lint config and fix what it flags in {fileName}',
  ],
};

// ---------------------------------------------------------------------------
// Thinking blocks: 1–3 natural-language lines, like Claude Code's collapsible
// "Thinking" summary. Openers set the goal; follow-ups plan the next step.
// ---------------------------------------------------------------------------
export const THINKING_OPEN: Record<Scenario, string[]> = {
  explain: [
    'The user wants an overview of {fileName}. Let me read it first and then trace the main entry points.',
    'I should read {fileName} before explaining anything — I do not want to guess at what {functionName} does.',
    'To explain the data flow I need both {fileName} and its callers. Let me start with the file itself.',
  ],
  fix: [
    'The user is seeing a failure in {functionName}. Let me look at the implementation and then find where it is called.',
    'Two likely causes: {something} is never initialized, or {functionName} runs before setup. The call sites will tell me which.',
    'Before changing anything I want to reproduce this with the existing tests.',
    'Let me read {fileName} around {functionName} first — the error message points at a missing guard.',
  ],
  feature: [
    'The user wants {functionName} extended. I should check how it is called today so the new parameter stays backward compatible.',
    'Let me look at {fileName} and the existing patterns in {otherFile} so the addition matches the codebase style.',
    'First I need to see the current signature of {functionName} and whether anything in {otherFile} depends on its return type.',
  ],
  refactor: [
    'This is a refactor, so behavior must not change. Let me read {functionName} and find every caller before touching it.',
    'I should check whether {functionB} and {functionName} really overlap, or only look similar.',
    'Let me see how big {fileName} actually is and where the natural seams are.',
  ],
  perf: [
    'Slow on large inputs usually means something quadratic. Let me read {functionName} and look for nested iteration over the same collection.',
    'I should check whether {functionName} is recomputing {something} on every call.',
    'Let me find the hot loop first, then measure instead of guessing.',
  ],
  review: [
    'The user wants a review of {functionName}. I will read it carefully and check the edge cases: empty input, concurrent calls, error paths.',
    'Let me look at the diff against the last commit and then read the surrounding code for context.',
  ],
  test: [
    'Let me run the test suite first to see what is actually failing before reading code.',
    'I need to see the existing tests for {className} so new ones follow the same setup.',
    'A flaky test is usually ordering or shared state. Let me read the test and the code under test.',
  ],
  chore: [
    'Let me check git to see what changed.',
    'Let me search for remaining references before removing anything.',
    'I will run the typecheck and go from there.',
  ],
};

export const THINKING_MORE = [
  'The file is about {n}00 lines, so I will focus on {functionName} and its direct callers.',
  'I will keep the change small and contained to {fileName}.',
  '{otherFile} also touches this, so I should check it too.',
  'Once I understand the flow I can make the edit and run the tests to confirm.',
  'There might be an existing helper for this in {otherFile}; worth a quick grep.',
  'Let me verify with the tests after the change rather than assuming.',
  'I should not change the public signature if I can avoid it.',
];

// ---------------------------------------------------------------------------
// Assistant prose. Openers come before the first tool call, findings land after
// reading/grepping, transitions sit between tools, closers end the turn.
// ---------------------------------------------------------------------------
export const TEXT_OPEN = [
  'Let me take a look at {fileName} first.',
  "I'll start by checking how {functionName} is used elsewhere.",
  'Let me look at the implementation and its callers.',
  "I'll read the file and then trace the call sites.",
  'Let me run the tests to see the current state.',
  'Let me check what the current code does before changing it.',
  'Looking into it.',
  "I'll check the callers first so the change stays safe.",
];

export const TEXT_FINDING: Record<Scenario, string[]> = {
  explain: [
    '{fileName} handles {topic}. The entry point is {functionName}, which normalizes the input and hands it to {functionB}. {className} holds the state between calls.',
    'The module is small: {functionName} does the actual work, {functionB} is a thin wrapper used by {otherFile}. The {importA} import is only used for one type.',
    'Data enters through {functionName}, gets transformed in {functionB}, and {className} caches the result keyed by the normalized input.',
  ],
  fix: [
    'Found it — {functionName} assumes {something} is non-empty, but {otherFile} can pass an empty array on the first call.',
    'The bug is in {functionName}: the boundary check is inclusive, so the last element is processed twice.',
    "The fallback branch is unreachable because the earlier `return` already covers that case. That's why {something} is never set.",
    'The issue is ordering: {functionB} is called before {className} is initialized when the file comes from {otherFile}.',
    "{functionName} returns a string on the happy path and `undefined` on the error path. Callers in {otherFile} don't check for it.",
    'There is a stale reference: {className} keeps the previous {something} and never clears it between calls.',
  ],
  feature: [
    '{functionName} has {n} call sites, all in {otherFile}. I can add the parameter with a default so none of them need to change.',
    'The existing pattern in {otherFile} wraps calls in a try/catch and logs with a prefix — I will follow that.',
    'There is no retry helper in the codebase yet, so I will add a small one next to {functionName}.',
  ],
  refactor: [
    '{functionName} and {functionB} share the same normalization step; only the final mapping differs. I can extract the shared part.',
    'The class is only instantiated once, from {otherFile}. Converting it to a module-level function is safe.',
    '{fileName} has three concerns mixed together: {topic}, validation, and formatting. The validation piece can move out cleanly.',
    'The nested conditionals in {functionName} collapse to an early return plus a lookup table.',
  ],
  perf: [
    'The bottleneck is in {functionName} — it calls {builtinFn} on the full input inside the loop, which makes it O(n²).',
    '{functionName} recomputes {something} on every call. The input does not change between calls, so this can be memoized.',
    'Nothing quadratic, but {functionB} allocates a new array per element. Reusing one buffer should help.',
  ],
  review: [
    'The logic is mostly fine. Two things: {functionName} mutates its argument, and the error path swallows the original exception.',
    "Looks good overall. One edge case: {functionName} splits on `,` without trimming, so `\"a, b\"` yields `\" b\"`.",
    'No security issues that I can see. The input is validated before reaching {functionName}, and nothing is interpolated into a query.',
    'One concern: {className} shares {something} across calls without a lock. If two callers overlap you will get a torn read.',
  ],
  test: [
    'The failures are all in the same describe block — they expect {functionName} to return an empty array, but it now returns `null`.',
    'The flaky test depends on iteration order of a Set. Sorting the result before asserting fixes it.',
    'The existing tests cover the happy path only. I will add cases for empty input and the error branch.',
  ],
  chore: [
    "Three files changed since the last commit; the only functional change is in {fileName}, the rest is formatting.",
    '{functionB} is still referenced from {otherFile}. I will update that import and then remove it.',
    'Typecheck is clean. The lint warnings are all unused imports in {fileName}.',
  ],
};

export const TEXT_TRANSITION = [
  'Let me check the callers.',
  'Now let me make the change.',
  "Let me see where else that's used.",
  'Let me confirm with the tests.',
  'Checking {otherFile} too.',
  'Let me look at the tests for this.',
  'One more thing to verify.',
  "Let me make sure nothing else depends on this.",
  'Now the fix.',
];

export const TEXT_CLOSE: Record<Scenario, string[]> = {
  explain: [
    "That's the full picture. The one surprising part is that {functionB} is also called from {otherFile}, so changing its return type would affect both.",
    'In short: {functionName} is the entry point, {className} is the state holder, and {importA} is only there for a type. Nothing here is dead code.',
    'Summary:\n- `{functionName}` — parses and validates the input\n- `{functionB}` — does the {topic} step\n- `{className}` — caches results between calls\n\nThe only unused import is `{importB}`; safe to remove.',
  ],
  fix: [
    'Fixed. The root cause was the missing guard in {functionName}; the test now covers the empty-input case.',
    "Done — {functionName} now returns `[]` instead of `undefined` on the error path, and the {n} callers in {otherFile} no longer need their own check.",
    'Fixed the off-by-one and added a regression test for it. Tests are green.',
    "That resolves it. Summary:\n- Guarded the empty case in `{functionName}`\n- Cleared stale state in `{className}` between calls\n- Added a test for both paths",
  ],
  feature: [
    'Done. `{functionName}` now accepts the optional parameter with the same default as before, so existing callers are unaffected.',
    'Added the handler and a test for the failure path. The change is contained to {fileName}.',
    "Implemented:\n- New `{functionName}` option in {fileName}\n- Wired into {otherFile}\n- Test covering the new branch\n\nTypecheck and tests pass.",
  ],
  refactor: [
    'Refactor complete, no behavior change. {functionName} is now {n} lines shorter and the shared step lives in one place.',
    'Extracted {className} into its own module and updated the {n} imports. Tests pass.',
    "Done. The nested conditionals are gone; `{functionName}` is a lookup plus an early return now.",
    'Summary of the refactor:\n- Moved `{className}` to its own file\n- Deduped `{functionName}` / `{functionB}`\n- No public API changes\n\nTests pass.',
  ],
  perf: [
    'Memoized {functionName}. On the large fixture it goes from ~{n}00ms to under {n}0ms.',
    'Hoisted the {builtinFn} call out of the loop. That removes the quadratic step; the rest of {fileName} is linear.',
    'Done — the result of `{functionName}` is cached per input. I kept the cache bounded so memory does not grow unbounded on long sessions.',
  ],
  review: [
    'Overall this is fine to merge. I fixed the two small issues ({functionName} mutating its input and the swallowed error) and left a comment on the unicode case.',
    "Review summary:\n- ✅ Logic in `{functionName}` is correct\n- ⚠️ `{functionB}` swallows errors — fixed\n- ℹ️ Consider trimming after split in `{functionName}`\n\nNo blocking issues.",
    'No security concerns. I tightened one check in {functionName} so the empty-string case is explicit.',
  ],
  test: [
    'All tests pass now. The fix was to sort before asserting; the code under test was correct.',
    'Added tests for {className}: construction, the happy path, and the error branch. All green.',
    'Tests pass. The failing block expected the old return type; updated the expectations to match the current behavior.',
  ],
  chore: [
    'Cleaned up. Removed the {n} unused imports and the two TODOs that were already addressed.',
    "Typecheck and lint both pass now. Nothing else references `{functionB}`, so I removed it.",
    "Since the last commit you changed {fileName} (the real change) plus formatting in {otherFile}. Nothing unexpected.",
  ],
};

// Vocabulary used to fill the less specific placeholders.
export const TOPICS = ['parsing', 'state management', 'request routing', 'data transformation', 'caching', 'serialization', 'validation', 'event dispatch'];
export const BUILTINS = ['JSON.parse', 'Array.prototype.sort', 'map.get', 'regex.exec', 'Object.keys', 'Array.prototype.includes', 'String.prototype.split'];
export const SOMETHINGS = ['the index', 'the lookup table', 'the derived view', 'the sort order', 'the config object', 'the cache key', 'the file list'];

// Todo list items, used by the TodoWrite steps.
export const TODO_ITEMS: Record<Scenario, string[]> = {
  explain: ['Read {fileName}', 'Trace callers of {functionName}', 'Summarize the data flow'],
  fix: ['Reproduce the failure', 'Read {functionName} in {fileName}', 'Fix the guard', 'Add a regression test', 'Run the test suite'],
  feature: ['Read current {functionName} signature', 'Add the new option', 'Update {otherFile}', 'Add tests', 'Run typecheck'],
  refactor: ['Find all callers of {functionName}', 'Extract the shared helper', 'Update imports', 'Run tests'],
  perf: ['Locate the hot loop in {fileName}', 'Add memoization', 'Measure on the large fixture'],
  review: ['Read {fileName}', 'Check edge cases in {functionName}', 'Write up findings'],
  test: ['Run existing tests', 'Read {className}', 'Add missing cases', 'Verify green'],
  chore: ['Check git status', 'Grep for {functionB}', 'Clean up and re-run lint'],
};
