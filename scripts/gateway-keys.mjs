// A tenant's key at the shared AI gateway (#95): made with a budget when the tenant is created,
// changed, switched off and on, read, and revoked when the tenant is deleted. The gateway is LiteLLM
// with key management; this talks to its admin API with the master key.
//
//   node scripts/gateway-keys.mjs create <tenant> --budget 20 [--period 30d] [--models a,b]
//       prints the new key, and nothing else, on standard output
//   node scripts/gateway-keys.mjs budget <amount>
//   node scripts/gateway-keys.mjs off | on | revoke | info
//
// Every command but create acts on the key in TENANT_AI_KEY: a key travels in the environment, never
// on a command line. Needs AI_GATEWAY_ADMIN_URL (or AI_GATEWAY_URL) and AI_GATEWAY_MASTER_KEY.
//
// On the tenant host it runs in the app's image, which has Node:
//   docker run --rm -e AI_GATEWAY_URL -e AI_GATEWAY_MASTER_KEY -e TENANT_AI_KEY ghcr.io/jurispuce/mcp-audit:main node scripts/gateway-keys.mjs info
/**
 * @typedef {{ url: string, masterKey: string, fetch?: typeof fetch }} GatewayConfig
 * @typedef {{ spend: number, budget: number | null, period: string | null, resetsAt: string | null, blocked: boolean, models: string[] }} KeyInfo
 */

/** @param {Record<string, string | undefined>} env @returns {GatewayConfig} */
export function configFromEnv(env = process.env) {
	const url = (env.AI_GATEWAY_ADMIN_URL ?? '').trim() || (env.AI_GATEWAY_URL ?? '').trim();
	const masterKey = (env.AI_GATEWAY_MASTER_KEY ?? '').trim();
	const missing = [];
	if (!url) missing.push('AI_GATEWAY_URL');
	if (!masterKey) missing.push('AI_GATEWAY_MASTER_KEY');
	if (missing.length) throw new Error(`Set ${missing.join(' and ')} (host.env).`);
	if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`"${url}" is not an http or https address.`);
	return { url: url.replace(/\/+$/, '').replace(/\/v1$/, ''), masterKey };
}

/** @param {string | number | undefined} value */
export function amount(value) {
	const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
	if (!Number.isFinite(n) || n < 0 || String(value ?? '').trim() === '')
		throw new Error(`"${value}" is not a budget. Give an amount in US dollars, for example 20.`);
	return n;
}

/** @param {GatewayConfig} cfg @param {string} path @param {{ method?: string, body?: unknown }} [init] */
async function api(cfg, path, init = {}) {
	const doFetch = cfg.fetch ?? fetch;
	let res;
	try {
		res = await doFetch(`${cfg.url}${path}`, {
			method: init.method ?? 'POST',
			headers: { authorization: `Bearer ${cfg.masterKey}`, 'content-type': 'application/json' },
			...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
		});
	} catch (e) {
		throw new Error(`Could not reach the AI gateway at ${cfg.url}: ${e instanceof Error ? e.message : e}`, {
			cause: e
		});
	}
	/** @type {{ error?: { message?: string } | string, [k: string]: unknown }} */
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const said = typeof body.error === 'string' ? body.error : (body.error?.message ?? `HTTP ${res.status}`);
		// Neither the master key nor a tenant's key is ever part of a message.
		throw new Error(`The AI gateway refused: ${String(said).replace(/sk-[\w-]+/g, 'sk-…')}`);
	}
	return body;
}

/**
 * Make a key for a tenant, with a budget that starts again each period and, where given, the only
 * models it may use.
 * @param {GatewayConfig} cfg
 * @param {{ tenant: string, budget: number, period?: string, models?: string[] }} input
 * @returns {Promise<string>} the key
 */
export async function createKey(cfg, input) {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(input.tenant))
		throw new Error(`"${input.tenant}" is not a tenant's name.`);
	const body = await api(cfg, '/key/generate', {
		body: {
			key_alias: `mcp-audit-tenant-${input.tenant}`,
			max_budget: amount(input.budget),
			budget_duration: input.period || '30d',
			...(input.models?.length ? { models: input.models } : {}),
			metadata: { tenant: input.tenant, made_by: 'mcp-audit tenant command' }
		}
	});
	if (typeof body.key !== 'string' || !body.key) throw new Error('The AI gateway answered without a key.');
	return body.key;
}

/** @param {GatewayConfig} cfg @param {string} key @param {number} budget */
export async function setBudget(cfg, key, budget) {
	await api(cfg, '/key/update', { body: { key, max_budget: amount(budget) } });
}

/** Switch a key off (true) or on again (false). @param {GatewayConfig} cfg @param {string} key @param {boolean} off */
export async function setBlocked(cfg, key, off) {
	await api(cfg, off ? '/key/block' : '/key/unblock', { body: { key } });
}

/** Revoke a key for good. A key the gateway no longer knows counts as revoked. @param {GatewayConfig} cfg @param {string} key */
export async function revokeKey(cfg, key) {
	await api(cfg, '/key/delete', { body: { keys: [key] } });
}

/** @param {GatewayConfig} cfg @param {string} key @returns {Promise<KeyInfo>} */
export async function keyInfo(cfg, key) {
	const body = await api(cfg, `/key/info?key=${encodeURIComponent(key)}`, { method: 'GET' });
	const info = /** @type {Record<string, unknown>} */ (body.info ?? {});
	return {
		spend: typeof info.spend === 'number' ? info.spend : 0,
		budget: typeof info.max_budget === 'number' ? info.max_budget : null,
		period: typeof info.budget_duration === 'string' ? info.budget_duration : null,
		resetsAt: typeof info.budget_reset_at === 'string' ? info.budget_reset_at : null,
		blocked: info.blocked === true,
		models: Array.isArray(info.models) ? info.models.map(String) : []
	};
}

/** One line for the operator: what is used, what is left, when it starts again. @param {KeyInfo} i */
export function describe(i) {
	const money = (/** @type {number} */ n) => `$${n.toFixed(2)}`;
	const parts = [
		i.budget === null
			? `${money(i.spend)} used, no limit`
			: `${money(i.spend)} of ${money(i.budget)} used, ${money(Math.max(0, i.budget - i.spend))} left`
	];
	if (i.resetsAt) parts.push(`resets ${i.resetsAt.slice(0, 10)}`);
	if (i.blocked) parts.push('SWITCHED OFF');
	else if (i.budget !== null && i.spend >= i.budget) parts.push('USED UP');
	return parts.join(', ');
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} [doFetch]
 * @returns {Promise<string>} what to print
 */
export async function main(argv, env = process.env, doFetch) {
	const [command = '', ...rest] = argv;
	const cfg = { ...configFromEnv(env), ...(doFetch ? { fetch: doFetch } : {}) };
	/** @param {string} name */
	const option = (name) => {
		const i = rest.indexOf(name);
		return i > -1 ? rest[i + 1] : undefined;
	};
	if (command === 'create') {
		const tenant = rest[0] ?? '';
		return createKey(cfg, {
			tenant,
			budget: amount(option('--budget')),
			period: option('--period'),
			models: (option('--models') ?? '')
				.split(',')
				.map((m) => m.trim())
				.filter(Boolean)
		});
	}
	const key = (env.TENANT_AI_KEY ?? '').trim();
	if (!['budget', 'off', 'on', 'revoke', 'info'].includes(command))
		throw new Error(
			'Usage: gateway-keys.mjs create <tenant> --budget N | budget N | off | on | revoke | info'
		);
	if (!key) throw new Error('Give the key in TENANT_AI_KEY.');
	if (command === 'budget') {
		await setBudget(cfg, key, amount(rest[0]));
		return describe(await keyInfo(cfg, key));
	}
	if (command === 'off' || command === 'on') {
		await setBlocked(cfg, key, command === 'off');
		return describe(await keyInfo(cfg, key));
	}
	if (command === 'revoke') {
		await revokeKey(cfg, key);
		return 'revoked';
	}
	return describe(await keyInfo(cfg, key));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2))
		.then((line) => console.log(line))
		.catch((e) => {
			console.error(e instanceof Error ? e.message : e);
			process.exit(1);
		});
}
