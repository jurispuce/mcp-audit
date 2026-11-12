#!/usr/bin/env node
// Seed test data into a running mcp-audit (only works when it runs with TEST_SEED_ENABLED=true).
//   node scripts/seed.mjs [base-url]      default http://127.0.0.1:${PORT:-3000}
//   docker compose exec app node scripts/seed.mjs
const base = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const res = await fetch(new URL('/api/test/seed', base), {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: '{}'
});
if (!res.ok) {
	console.error(`Seeding failed (${res.status}). Is the app running with TEST_SEED_ENABLED=true?`);
	process.exit(1);
}
const body = await res.json();
for (const u of body.users) console.log(`${u.role.padEnd(8)} ${u.email}`);
console.log(`password ${body.password}`);
