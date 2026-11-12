// Point git at .githooks so the pre-commit hook runs. Does nothing outside a git checkout (Docker, CI).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.git') && !process.env.CI) {
	try {
		execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
	} catch {
		// git not installed: skip quietly
	}
}
