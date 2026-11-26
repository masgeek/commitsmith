#!/usr/bin/env node
// Recursively syntax-checks every .mjs file in the project (commitsmith.mjs + src/**),
// so `npm test` catches a broken module without relying on shell globbing
// (which differs between POSIX shells and Windows).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function collectMjsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'node_modules') continue;
      files.push(...collectMjsFiles(fullPath));
    } else if (entry.endsWith('.mjs')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = [path.join(rootDir, 'commitsmith.mjs'), ...collectMjsFiles(path.join(rootDir, 'src'))];

let failed = false;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
}

if (failed) {
  console.error('\nSyntax check failed.');
  process.exit(1);
}

console.log(`Syntax OK — checked ${files.length} file(s).`);
