#!/usr/bin/env bash
# Use GH_TOKEN / GITHUB_TOKEN from Cloud Agent secrets for gh + git push as criptogus.
set -euo pipefail
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "[gh-cloud-auth] No GH_TOKEN/GITHUB_TOKEN — using Cursor GitHub App token (limited repo scope)."
  gh auth status -h github.com 2>/dev/null || true
  exit 0
fi
if ! command -v gh >/dev/null; then
  echo "[gh-cloud-auth] gh CLI not installed; skip" >&2
  exit 0
fi
printf '%s\n' "$TOKEN" | gh auth login --hostname github.com --with-token
gh auth setup-git
LOGIN="$(gh api user -q .login 2>/dev/null || echo unknown)"
echo "[gh-cloud-auth] Active GitHub user: $LOGIN"
