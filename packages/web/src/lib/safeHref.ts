// SPDX-License-Identifier: MIT WITH Commons-Clause

const DANGEROUS_PROTOCOLS = /^\s*(javascript|data|vbscript|file):/i;

/**
 * Neutralize a URL that would otherwise be navigated to or opened. If it uses a
 * dangerous protocol (javascript:, data:, vbscript:, file:), returns '#' so the
 * browser never evaluates it. Used before window.open on external link tokens
 * (outline2/decorations.ts); a caller can also treat a returned '#' as "refuse".
 */
export function safeHref(target: string): string {
  if (DANGEROUS_PROTOCOLS.test(target)) {
    return '#';
  }
  return target;
}
