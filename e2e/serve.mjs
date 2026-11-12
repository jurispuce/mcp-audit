// Start the production build with a fresh data directory for end-to-end tests.
//   node e2e/serve.mjs <name>     data in .e2e/<name>, wiped first
import { rmSync } from 'node:fs';
import path from 'node:path';

const name = process.argv[2] ?? 'main';
const dir = path.resolve('.e2e', name);
rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;
process.env.MIGRATIONS_DIR ??= path.resolve('drizzle');
await import(path.resolve('server.js'));
