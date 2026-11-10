#!/usr/bin/env bash
# Publish monorepo branch to github.com/criptogus/keepmind-corp (main).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REF="${1:-cursor/corp-roadmap-v02-e37c}"
REMOTE="${KEEPMIND_CORP_REMOTE:-keepmind-corp}"
URL="${KEEPMIND_CORP_URL:-https://github.com/criptogus/keepmind-corp.git}"

if ! git remote get-url "$REMOTE" &>/dev/null; then
  git remote add "$REMOTE" "$URL"
else
  git remote set-url "$REMOTE" "$URL"
fi

if ! gh repo view criptogus/keepmind-corp &>/dev/null; then
  echo "Repository criptogus/keepmind-corp does not exist yet."
  echo "Create it on GitHub (empty repo, no README), then re-run:"
  echo "  $0 $REF"
  exit 1
fi

if ! git push -u "$REMOTE" "${REF}:main" 2>&1; then
  echo ""
  echo "Push failed (often: cursor[bot] has no write access to keepmind-corp)."
  echo "Fix one of:"
  echo "  • GitHub → Settings → Applications → Cursor → Repository access → add keepmind-corp"
  echo "  • Or push from your machine: git push -u $URL ${REF}:main"
  echo "  • Or: keepmind-corp → Import → https://github.com/criptogus/keepmind (branch ${REF})"
  exit 1
fi
echo "Pushed ${REF} -> keepmind-corp:main"
