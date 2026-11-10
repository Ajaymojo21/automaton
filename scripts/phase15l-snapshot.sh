#!/bin/bash
# Phase 15L: snapshot the pre-edit copies of the files being repaired, with a SHA-256 manifest.
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y%m%d-%H%M%S)
DEST="backups/phase15L-pre-$STAMP"
mkdir -p "$DEST"
FILES=(
  src/__tests__/command-injection.test.ts
  src/__tests__/skills-hardening.test.ts
  src/__tests__/path-protection.test.ts
  src/__tests__/orchestration/local-worker-harness.test.ts
  src/__tests__/context-hardening.test.ts
)
: > "$DEST/MANIFEST.sha256"
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    mkdir -p "$DEST/$(dirname "$f")"
    cp -p "$f" "$DEST/$f"
    sha256sum "$DEST/$f" >> "$DEST/MANIFEST.sha256"
  else
    echo "MISSING $f" >> "$DEST/MANIFEST.sha256"
  fi
done
echo "snapshot: $DEST"
ls -R "$DEST" | head -20
cat "$DEST/MANIFEST.sha256"
