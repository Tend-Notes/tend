// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Lightweight code-fence detection, split out of codeHighlight.ts so callers
// that only need to know whether a line IS a fenced code block (e.g.
// decorations.ts, on the hot per-line path) don't pull in lowlight/highlight.js.
// The actual syntax highlighting lives in codeHighlight.ts and is lazy-loaded.

// A block whose content is a single fenced code block: ```lang\n code \n```
export const FENCE = /^```([\w+#-]*)\r?\n([\s\S]*?)\r?\n```$/

export function isCodeFenceText(text: string): boolean {
  return FENCE.test(text)
}
