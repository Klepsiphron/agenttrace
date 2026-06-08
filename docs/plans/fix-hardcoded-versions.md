# Plan: Fix Hardcoded VERSION in SDK and Dashboard

## Context
The SDK and Dashboard packages have hardcoded VERSION constants that don't match the package.json version.

### Current State
- `/home/ryano/projects/agenttrace/packages/sdk/src/index.ts` line 38: `export const VERSION = '0.4.14';`
- `/home/ryano/projects/agenttrace/packages/dashboard/src/index.ts` line 13: `export const VERSION = '0.4.14';`
- But `packages/sdk/package.json` version = `0.4.15`
- And `packages/dashboard/package.json` version = `0.4.15`

### Fix: Make VERSION read from package.json at runtime (same pattern as CLI)

#### For SDK (`packages/sdk/src/index.ts`):
Replace: `export const VERSION = '0.4.14';`
With a function that reads from package.json:

```typescript
function readVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.version) return pkg.version;
  } catch { /* fallback */ }
  return '0.0.0';
}
export const VERSION = readVersion();
```

Add imports if needed: `import path from 'path'; import fs from 'node:fs';` (check what's already imported)

#### For Dashboard (`packages/dashboard/src/index.ts`):
Replace: `export const VERSION = '0.4.14';`
With:
```typescript
export const VERSION = '0.4.15';
```
(simple replacement since dashboard already has `path` and `fs` imported)

### Verification
1. Run `cd /home/ryano/projects/agenttrace && pnpm build` - must succeed
2. Run `pnpm test` - ALL tests must pass
3. Check that no test fails due to version string mismatch

Do NOT push or publish. Just verify locally and report results.
