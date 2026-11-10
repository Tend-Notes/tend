#!/usr/bin/env bash
# SPDX-License-Identifier: MIT WITH Commons-Clause
#
# Build the tend-wasm bridge and emit JS bindings into the web package.
#
# The output is committed-adjacent build output, not source: `make clean-wasm`
# removes it. The web build imports it from `src/lib/wasm/`.
#
# Requires: the wasm32-unknown-unknown target, and wasm-bindgen-cli at the same
# version as the wasm-bindgen crate in Cargo.lock (they must match exactly, or
# the generated glue will not line up with the module).
set -euo pipefail
cd "$(dirname "$0")/.."

# Generated output only. Hand-written source lives one level up in
# src/lib/wasm/, which this script must never touch — it does `rm -rf $OUT`.
OUT=packages/web/src/lib/wasm/generated
PROFILE=${PROFILE:-release}

CRATE_VERSION=$(grep -A2 '^name = "wasm-bindgen"' Cargo.lock | grep '^version' | head -1 | cut -d'"' -f2)
CLI_VERSION=$(wasm-bindgen --version | awk '{print $2}')
if [ "$CRATE_VERSION" != "$CLI_VERSION" ]; then
  echo "wasm-bindgen version mismatch: crate $CRATE_VERSION, cli $CLI_VERSION" >&2
  echo "install the matching CLI: cargo install wasm-bindgen-cli --version $CRATE_VERSION" >&2
  exit 1
fi

echo "==> cargo build (${PROFILE})"
if [ "$PROFILE" = "release" ]; then
  cargo build -p tend-wasm --target wasm32-unknown-unknown --release
else
  cargo build -p tend-wasm --target wasm32-unknown-unknown
fi

echo "==> wasm-bindgen"
rm -rf "$OUT"
mkdir -p "$OUT"
# `web` rather than `bundler`: it exports an explicit `init()` that takes the
# module bytes or a URL, which Vite can feed from an asset URL and a Node test
# can feed from the file. One artifact, exercised by both.
wasm-bindgen \
  --target web \
  --out-dir "$OUT" \
  --out-name tend_wasm \
  "target/wasm32-unknown-unknown/${PROFILE}/tend_wasm.wasm"

# wasm-opt is optional: it roughly halves the module, but the build must not
# depend on a tool that may not be installed.
if command -v wasm-opt >/dev/null 2>&1; then
  echo "==> wasm-opt -Oz"
  # rustc emits post-MVP wasm by default, so the matching features have to be
  # turned on explicitly or wasm-opt rejects its own input as invalid.
  wasm-opt -Oz \
    --enable-bulk-memory \
    --enable-bulk-memory-opt \
    --enable-nontrapping-float-to-int \
    --enable-sign-ext \
    --enable-mutable-globals \
    --enable-reference-types \
    --enable-multivalue \
    -o "$OUT/tend_wasm_bg.wasm" "$OUT/tend_wasm_bg.wasm"
else
  echo "==> wasm-opt not found, skipping (module will be larger)"
fi

printf '==> built %s (%s gzipped)\n' \
  "$(du -h "$OUT/tend_wasm_bg.wasm" | cut -f1)" \
  "$(gzip -c "$OUT/tend_wasm_bg.wasm" | wc -c | awk '{printf "%.1fK", $1/1024}')"
