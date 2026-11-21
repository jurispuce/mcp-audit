// Writes the standalone guide (#84) from the same content the app uses.
//   node scripts/build-guide.mjs <out.html> [--fragment] [--web-fonts] [--mcp https://host/mcp]
// --fragment leaves out the document skeleton, for hosts that add their own.
import { writeFileSync } from 'node:fs';
import { guideDocument, guideFragment } from '../src/lib/guide/standalone.ts';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--mcp');
if (!out) {
	console.error(
		'Usage: node scripts/build-guide.mjs <out.html> [--fragment] [--web-fonts] [--mcp <address>]'
	);
	process.exit(1);
}
const mcp = args.includes('--mcp') ? args[args.indexOf('--mcp') + 1] : '';
const opts = { mcpUrl: mcp, webFonts: args.includes('--web-fonts') };
writeFileSync(out, args.includes('--fragment') ? guideFragment(opts) : guideDocument(opts));
console.log(`Guide written to ${out}`);
