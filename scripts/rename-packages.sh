#!/bin/bash
#
# Package rename script: @agenttrace/* -> @agenttrace-io/*
# for npm publishing to avoid name collision.
#
# Usage: ./scripts/rename-packages.sh
#
# - Creates a timestamped backup first
# - Updates package.json name fields and internal workspace deps
# - Updates imports and package name strings in source .ts files (excl. dist/, node_modules/)
# - Updates publish.yml workflow names
#
set -euo pipefail

echo "=== AgentTrace package rename: @agenttrace/* -> @agenttrace-io/* ==="

# 1. Create backup
BACKUP_TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=".rename-backup-${BACKUP_TS}"
echo "Creating backup at ${BACKUP_DIR}..."
mkdir -p "${BACKUP_DIR}"

# Backup the packages dir (source of truth for names/deps) and the workflow file
cp -r packages "${BACKUP_DIR}/packages"
cp .github/workflows/publish.yml "${BACKUP_DIR}/publish.yml" 2>/dev/null || true

# Also backup pnpm-lock if present (will be invalidated)
if [ -f pnpm-lock.yaml ]; then
  cp pnpm-lock.yaml "${BACKUP_DIR}/pnpm-lock.yaml"
fi

echo "Backup created."

# Helper to do safe sed replace only for the scoped name
replace_agenttrace() {
  local file="$1"
  # Replace @agenttrace/ with @agenttrace-io/ (the / ensures we target scoped pkgs only)
  sed -i 's|@agenttrace/|@agenttrace-io/|g' "$file"
}

# 2. Update all package.json under packages/ (names + internal deps)
echo "Updating package.json name fields and internal dependencies..."
find packages -name package.json -type f ! -path '*/node_modules/*' | while IFS= read -r pkgjson; do
  echo "  - ${pkgjson}"
  replace_agenttrace "${pkgjson}"
done

# 3. Update imports and references in source code (.ts files under packages/, excluding generated)
echo "Updating imports and PACKAGE_NAME references in source code..."
find packages -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' \
  ! -path '*/dist/*' \
  ! -path '*/__pycache__/*' \
  | while IFS= read -r srcfile; do
  if grep -q '@agenttrace/' "${srcfile}" 2>/dev/null; then
    echo "  - ${srcfile}"
    replace_agenttrace "${srcfile}"
  fi
done

# 4. Update the publish.yml workflow
echo "Updating .github/workflows/publish.yml..."
if [ -f .github/workflows/publish.yml ]; then
  replace_agenttrace ".github/workflows/publish.yml"
  # Also update the step names explicitly (they contain the old @agenttrace/ strings)
  sed -i 's|Publish @agenttrace-io/|Publish @agenttrace-io/|g' .github/workflows/publish.yml  # no-op after above, but documents intent
fi

echo ""
echo "=== Rename complete ==="
echo "Backup: ${BACKUP_DIR}"
echo ""
echo "Next steps (not performed by this script):"
echo "  pnpm install        # update lockfile + node_modules links for new scope"
echo "  pnpm build"
echo "  pnpm test"
echo "  pnpm lint"
echo ""
echo "The following will still reference old names (docs, examples, changelogs, etc.):"
echo "  - README.md, docs/, examples/, CHANGELOG.md, etc. (update separately if needed for publishing)"
echo ""
