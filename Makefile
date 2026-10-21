# SPDX-License-Identifier: MIT WITH Commons-Clause
#
# Convenience wrapper over the three test runners this repo already has.
# `make test` is what the working loop runs after each increment.

.PHONY: test test-rust test-web test-e2e wasm clean-wasm

# Everything that can run without a live server.
test: test-rust test-web

test-rust:
	cargo test --workspace

# vitest directly rather than via pnpm: this repo's node_modules are already
# installed, and pnpm is not always on PATH.
test-web:
	cd packages/web && ./node_modules/.bin/vitest run

# Needs the dev servers; see scripts/run-e2e.sh for the environment it expects.
test-e2e:
	scripts/run-e2e.sh

# Build the wasm bridge into packages/web/src/lib/wasm/.
# Requires the wasm32-unknown-unknown target and wasm-bindgen-cli.
wasm:
	scripts/build-wasm.sh

clean-wasm:
	rm -rf packages/web/src/lib/wasm/generated target/wasm32-unknown-unknown
