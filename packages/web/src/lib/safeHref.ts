// SPDX-License-Identifier: MIT WITH Commons-Clause

const DANGEROUS_PROTOCOLS = /^\s*(javascript|data|vbscript|file):/i;

/**
 * Returns a safe href for a wikilink target. If the target looks like a
 * dangerous URL protocol (javascript:, data:, etc.), returns '#' so the
 * browser doesn't try to evaluate it on middle-click / drag-to-address.
 *
 * The SPA click handler intercepts left-clicks regardless of href, so
 * normal navigation continues to work.
 */
export function safeHref(target: string): string {
  if (DANGEROUS_PROTOCOLS.test(target)) {
    return '#';
  }
  return target;
}
