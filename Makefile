# SPDX-License-Identifier: MIT WITH Commons-Clause
#
# Convenience wrapper over the three test runners this repo already has.
# `make test` is what the working loop runs after each increment.

.PHONY: test test-rust test-web test-e2e check-crates wasm clean-wasm

# Everything that can run without a live server.
test: check-crates test-rust test-web

# The Dockerfile names every workspace member by hand, for its dependency-cache
# layer. Cargo loads every member's manifest even when building one package, so
# a crate missing from that list fails the Docker build with "failed to load
# manifest for workspace member" — which is how adding tend-index and tend-wasm
# broke it, with nothing locally to notice. This compares the two lists.
check-crates:
	@members=$$(sed -n '/^members = \[/,/^]/p' Cargo.toml | grep -o 'crates/[a-z-]*' | sort); \
	copied=$$(grep -o 'COPY crates/[a-z-]*/Cargo.toml' Dockerfile | grep -o 'crates/[a-z-]*' | sort); \
	missing=$$(comm -23 <(echo "$$members") <(echo "$$copied")); \
	if [ -n "$$missing" ]; then \
		echo "Dockerfile is missing workspace members:" >&2; \
		echo "$$missing" | sed 's/^/  /' >&2; \
		echo "Add a COPY line, a dummy src, and a touch for each." >&2; \
		exit 1; \
	fi; \
	echo "crates: Dockerfile lists all $$(echo "$$members" | wc -l | tr -d ' ') workspace members"

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
