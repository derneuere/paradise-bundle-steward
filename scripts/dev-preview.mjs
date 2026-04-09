// Wrapper that starts Vite with cwd set to the steward/ repo root, so
// Tailwind's relative content globs and Vite's root detection both work
// regardless of where Node was spawned from.
//
// Used by the .claude/launch.json "dev" configuration in the parent workspace
// (C:/Users/Niaz/burnout-pr/.claude/launch.json). Safe to run directly too:
//   node steward/scripts/dev-preview.mjs

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const stewardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(stewardRoot);

// Let Vite read its own CLI. We rewrite argv so Vite sees `vite` in argv[1]
// (its own module path) and nothing more — it'll pick up vite.config.ts from
// cwd and default to the port declared there (8080 in our config).
process.argv = [process.argv[0], resolve(stewardRoot, 'node_modules/vite/bin/vite.js')];

await import(new URL('node_modules/vite/bin/vite.js', `file://${stewardRoot.replace(/\\/g, '/')}/`).href);
