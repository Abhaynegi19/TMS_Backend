// Runs every *.test.js file with the built-in Node test runner. Usage: node test/run.js [unit|integration]
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const dirs = only ? [only] : ['unit', 'integration'];
const files = dirs.flatMap((d) => readdirSync(path.join(root, d)).filter((f) => f.endsWith('.test.js')).map((f) => path.join(root, d, f)));
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
process.exit(r.status ?? 1);
