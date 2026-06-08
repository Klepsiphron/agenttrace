#!/usr/bin/env node
// scripts/sync-version.mjs
// Sync VERSION file to all packages before build
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const version = readFileSync(join(rootDir, 'VERSION'), 'utf-8').trim();

const packages = [
  'packages/sdk',
  'packages/cli',
  'packages/dashboard',
  'packages/middleware-langgraph',
  'packages/middleware-crewai',
  'packages/sdk-python',
];

for (const pkg of packages) {
  const pkgJsonPath = join(rootDir, pkg, 'package.json');
  if (existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    pkgJson.version = version;
    // Replace workspace refs
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkgJson[key]) {
        for (const dep of Object.keys(pkgJson[key])) {
          if (pkgJson[key][dep] === 'workspace:*') {
            pkgJson[key][dep] = version;
          }
        }
      }
    }
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
  }
  // Also handle pyproject.toml for Python packages
  const pyprojectPath = join(rootDir, pkg, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    let content = readFileSync(pyprojectPath, 'utf-8');
    content = content.replace(
      /^version = ".*"/m,
      `version = "${version}"`
    );
    writeFileSync(pyprojectPath, content);
  }
}

console.log(`Synced version ${version} to all packages`);
