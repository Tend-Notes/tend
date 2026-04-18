#!/usr/bin/env bash
# SPDX-License-Identifier: MIT WITH Commons-Clause
# Security scan: runs all SAST tools and reports findings
# Usage: ./scripts/security-scan.sh
#   or:  nix-shell -p cargo-audit semgrep --run ./scripts/security-scan.sh

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

ISSUES=0

header() { echo -e "\n${BOLD}=== $1 ===${NC}\n"; }
warn() { echo -e "${YELLOW}WARNING:${NC} $1"; }
fail() { echo -e "${RED}FAIL:${NC} $1"; ISSUES=$((ISSUES + 1)); }
pass() { echo -e "${GREEN}PASS:${NC} $1"; }

# --- Rust dependency vulnerabilities ---
header "cargo audit (Rust dependency vulnerabilities)"
if command -v cargo-audit &>/dev/null; then
  if cargo audit 2>&1; then
    pass "No known vulnerabilities in Rust dependencies"
  else
    fail "Rust dependency vulnerabilities found (see above)"
  fi
else
  warn "cargo-audit not installed -- skipping (nix-shell -p cargo-audit)"
fi

# --- Rust lints ---
header "cargo clippy (Rust static analysis)"
if cargo clippy --all-targets -- -D warnings 2>&1; then
  pass "No clippy warnings"
else
  fail "Clippy warnings found (see above)"
fi

# --- JS dependency vulnerabilities ---
header "pnpm audit (JS dependency vulnerabilities)"
if command -v pnpm &>/dev/null; then
  cd packages/web
  if pnpm audit --audit-level moderate 2>&1; then
    pass "No known vulnerabilities in JS dependencies"
  else
    fail "JS dependency vulnerabilities found (see above)"
  fi
  cd ../..
else
  warn "pnpm not installed -- skipping (nix-shell -p pnpm)"
fi

# --- Semgrep ---
header "semgrep (cross-language pattern analysis)"
if command -v semgrep &>/dev/null; then
  if semgrep --config auto --error --quiet \
    --exclude='node_modules' --exclude='target' --exclude='*.lock' \
    crates/ packages/web/src/ 2>&1; then
    pass "No semgrep findings"
  else
    fail "Semgrep findings (see above)"
  fi
else
  warn "semgrep not installed -- skipping (nix-shell -p semgrep)"
fi

# --- Summary ---
header "Summary"
if [ "$ISSUES" -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
  exit 0
else
  echo -e "${RED}${ISSUES} check(s) failed.${NC}"
  exit 1
fi
