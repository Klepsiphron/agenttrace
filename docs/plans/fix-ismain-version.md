# Plan: Fix AgentTrace CLI isMain Guard and Version Issues

## Context
File: `/home/ryano/projects/agenttrace/packages/cli/src/index.ts` (2424 lines)

### Root Cause
When the CLI is installed via npm and run through the bin symlink (e.g., `npx agenttrace-io version`), `process.argv[1]` is the symlink path like `/path/to/node_modules/.bin/agenttrace-io`. The current `isMain` guard checks if this path includes `@agenttrace-io/cli`, which it does NOT because the symlink name is `agenttrace-io`, not the package directory path. Result: `main()` never runs, ALL commands silently do nothing (exit 0, no output).

### Fix 1: Test the isMain guard with symlink resolution
Add `fs.realpathSync()` to resolve symlinks before checking. Also add fallbacks for bin names `agenttrace-io` and `agenttrace`, plus an `import.meta.url` comparison fallback.

Replace the `isMain` block at the end of the file (around line 2381-2412 after previous patches) with this logic:

```typescript
const isMain = (() => {
  try {
    const invoked = process.argv[1];
    if (!invoked) return false;
    // Resolve symlinks (npm bin symlinks point to dist/index.js)
    let resolved: string;
    try {
      resolved = require('node:fs').realpathSync(invoked);
    } catch {
      resolved = invoked;
    }
    // Check resolved path and raw path for all known entry points
    const targets = [resolved, invoked];
    for (const t of targets) {
      if (
        t.endsWith('dist/index.js') ||
        t.includes('@agenttrace-io/cli') ||
        t.includes('agenttrace-io/cli') ||
        t.endsWith('/agenttrace-io') ||
        t.endsWith('/agenttrace')
      ) {
        return true;
      }
    }
    // Fallback: check if this module is the entry point via import.meta.url
    const thisFile = fileURLToPath(import.meta.url);
    if (resolved === thisFile || invoked === thisFile) return true;
    return false;
  } catch (_) {
    return false;
  }
})();
```

Note: `readFileSync`, `fileURLToPath` are already imported at the top of the file. Add `realpathSync` to the `node:fs` import.

### Fix 2: Add realpathSync to fs imports
Line 25 currently imports: `{ existsSync, writeFileSync, readFileSync, mkdirSync }`
Add `realpathSync` to this import.

### Verification Steps
1. Run `cd /home/ryano/projects/agenttrace && pnpm build` - must succeed
2. Run `cd /tmp && rm -rf test-fix && mkdir test-fix && cd test-fix && npm init -y`
3. Run `npm install @agenttrace-io/cli`
4. Run `npx agenttrace-io version` - MUST print version string (e.g., "@agenttrace-io/cli 0.4.15")
5. Run `node node_modules/.bin/agenttrace-io version` - MUST print version string
6. Run `./node_modules/.bin/agenttrace-io version` - MUST print version string

Do NOT push or publish. Just verify locally and report results.
