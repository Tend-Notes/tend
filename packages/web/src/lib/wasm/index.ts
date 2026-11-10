// SPDX-License-Identifier: MIT WITH Commons-Clause
//
// Loader for the tend-wasm bridge.
//
// The bridge is the server's own format and encryption code compiled to wasm
// (see crates/tend-wasm), which is what makes a local-folder garden
// byte-identical to one the server wrote. It is ~400K gzipped, so nothing
// imports it eagerly: `loadWasm()` runs the first time a local garden is
// opened, and the module is cached for the session.
//
// `generated/` is build output from scripts/build-wasm.sh (`make wasm`) and is
// not in git; `make clean-wasm` removes it.

import init, * as bridge from './generated/tend_wasm.js'
// Vite resolves this to an asset URL the browser fetches on first use.
import wasmUrl from './generated/tend_wasm_bg.wasm?url'

export type TendWasm = typeof bridge

let loaded: Promise<TendWasm> | null = null

/**
 * Initialize the bridge, once per session. Concurrent callers share the same
 * in-flight initialization.
 *
 * `source` is an escape hatch for tests, which hand over the module bytes
 * directly rather than going through a URL.
 */
export function loadWasm(source?: BufferSource | string): Promise<TendWasm> {
  if (!loaded) {
    loaded = init({ module_or_path: source ?? wasmUrl })
      .then(() => bridge)
      .catch((e) => {
        // Don't cache a failure: a transient fetch error should not disable
        // local gardens for the rest of the session.
        loaded = null
        throw e
      })
  }
  return loaded
}

/** Drop the cached module. Tests only. */
export function resetWasmForTests(): void {
  loaded = null
}
