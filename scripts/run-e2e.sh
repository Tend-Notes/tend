#!/usr/bin/env bash
# SPDX-License-Identifier: MIT WITH Commons-Clause
#
# Headless end-to-end checks for the web app. Requires the dev servers running:
#   nix develop -c bash -c 'TEND_AUTH_REQUIRED=false TEND_AUTH_DEFAULT_USER=dev cargo run -p tend-server'
#   nix develop -c pnpm --filter web dev
#
# Playwright's bundled Chromium does not run on NixOS, so we use a nix-built
# Chromium and pass it to Playwright via TEND_E2E_CHROMIUM.
set -euo pipefail
cd "$(dirname "$0")/.."

nix shell nixpkgs#chromium -c bash -c '
  export TEND_E2E_CHROMIUM="$(command -v chromium)"
  cd packages/web
  for test in e2e/*.mjs; do
    [ "$(basename "$test")" = "lib.mjs" ] && continue
    echo "=== $test ==="
    node "$test"
  done
'
