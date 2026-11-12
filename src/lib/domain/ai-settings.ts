import type { AppDatabase } from '#lib/db/client.ts';
import { checkToolCalling, listGatewayModels, type FetchLike, type Gateway } from '#lib/ai/llm.ts';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { requireAdmin } from './users';
import type { Actor } from './write';

/**
 * In-app AI settings: the LiteLLM gateway, the models it offers, and which model runs each action.
 * Instance settings, not audit data, so they live in `app_setting` and are not versioned. Admins edit
 * them; the gateway key is write-only and never leaves the server.
 */

export const AI_ACTIONS = {
	derive_roles: {
		label: 'Derive roles from documents',
		skill: 'audit-role-discovery',
		scope: 'engagement'
	},
	extract_internal: {
		label: 'Extract requirements',
		skill: 'audit-document-analysis',
		scope: 'engagement'
	},
	draft_plan: { label: 'Draft plan', skill: 'audit-plan-builder', scope: 'engagement' },
	process_event: {
		label: 'Process event materials',
		skill: 'audit-event-debrief',
		scope: 'engagement'
	},
	propose_findings: {
		label: 'Propose finding(s)',
		skill: 'audit-assurance-review',
		scope: 'engagement'
	},
	library_extract: {
		label: 'Extract requirements from a library document',
		skill: 'audit-library-curator',
		scope: 'library'
	},
	library_mapping: { label: 'Propose mapping', skill: 'audit-library-curator', scope: 'library' }
} as const;

export type AiAction = keyof typeof AI_ACTIONS;
export const AI_ACTION_KEYS = Object.keys(AI_ACTIONS) as AiAction[];

export function isAiAction(value: unknown): value is AiAction {
	return typeof value === 'string' && value in AI_ACTIONS;
}

export interface ModelCheck {
	ok: boolean;
	message: string;
	at: string;
}

export interface AiModel {
	id: string;
	check: ModelCheck | null;
}

export interface AiSettings {
	baseUrl: string;
	/** Where the base URL comes from: saved in the app, or the LITELLM_BASE_URL environment default. */
	baseUrlFrom: 'settings' | 'environment' | 'none';
	hasKey: boolean;
	keyFrom: 'settings' | 'environment' | 'none';
	models: AiModel[];
	/** Model per action; `default` runs any action without its own model. */
	assignments: Partial<Record<AiAction | 'default', string>>;
	configured: boolean;
}

const KEYS = { gateway: 'ai.gateway', models: 'ai.models', assignments: 'ai.assignments' } as const;

type Env = Record<string, string | undefined>;

function readSetting<T>(app: AppDatabase, key: string, fallback: T): T {
	const row = app.sqlite.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as
		{ value: string } | undefined;
	if (!row) return fallback;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return fallback;
	}
}

function saveSetting(app: AppDatabase, key: string, value: unknown): void {
	app.sqlite
		.prepare(
			`INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
		)
		.run(key, JSON.stringify(value), Date.now());
}

interface StoredGateway {
	baseUrl?: string | null;
	apiKey?: string | null;
}

/** The gateway to call: saved settings first, then the environment defaults. Server-side only. */
export function gatewayOf(app: AppDatabase, env: Env = process.env): Gateway | null {
	const saved = readSetting<StoredGateway>(app, KEYS.gateway, {});
	const baseUrl = saved.baseUrl?.trim() || env.LITELLM_BASE_URL?.trim() || '';
	if (!baseUrl) return null;
	return { baseUrl, apiKey: saved.apiKey?.trim() || env.LITELLM_API_KEY?.trim() || null };
}

function modelsOf(app: AppDatabase): AiModel[] {
	return readSetting<AiModel[]>(app, KEYS.models, []);
}

function assignmentsOf(app: AppDatabase): AiSettings['assignments'] {
	return readSetting<AiSettings['assignments']>(app, KEYS.assignments, {});
}

/** What the settings screen shows. Never includes the key itself. */
export function getAiSettings(app: AppDatabase, env: Env = process.env): AiSettings {
	const saved = readSetting<StoredGateway>(app, KEYS.gateway, {});
	const savedUrl = saved.baseUrl?.trim();
	const envUrl = env.LITELLM_BASE_URL?.trim();
	const savedKey = saved.apiKey?.trim();
	const envKey = env.LITELLM_API_KEY?.trim();
	return {
		baseUrl: savedUrl || envUrl || '',
		baseUrlFrom: savedUrl ? 'settings' : envUrl ? 'environment' : 'none',
		hasKey: !!(savedKey || envKey),
		keyFrom: savedKey ? 'settings' : envKey ? 'environment' : 'none',
		models: modelsOf(app),
		assignments: assignmentsOf(app),
		configured: !!(savedUrl || envUrl)
	};
}

/** Models that passed the tool-calling check: the only ones that may run an action. */
export function usableModels(app: AppDatabase): string[] {
	return modelsOf(app)
		.filter((m) => m.check?.ok)
		.map((m) => m.id);
}

function validUrl(value: string): string {
	const url = value.trim();
	if (!url) return '';
	try {
		const u = new URL(url);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
	} catch {
		throw new ValidationError('Enter the gateway address as an http or https URL.', {
			base_url: 'Enter an http or https URL, for example http://litellm:4000.'
		});
	}
	return url.replace(/\/+$/, '');
}

/**
 * Save the gateway address and, when given, a new key. An empty key keeps the saved one; `clearKey`
 * removes it (the environment default then applies, if any).
 */
export function saveGateway(
	app: AppDatabase,
	actor: Actor,
	input: { baseUrl: string; apiKey?: string | null; clearKey?: boolean }
): void {
	requireAdmin(app, actor);
	const saved = readSetting<StoredGateway>(app, KEYS.gateway, {});
	const next: StoredGateway = { baseUrl: validUrl(input.baseUrl) || null, apiKey: saved.apiKey ?? null };
	if (input.clearKey) next.apiKey = null;
	else if (input.apiKey?.trim()) next.apiKey = input.apiKey.trim();
	saveSetting(app, KEYS.gateway, next);
}

/** The gateway's model list, to pick from. */
export async function gatewayModels(
	app: AppDatabase,
	actor: Actor,
	opts: { fetch?: FetchLike; env?: Env } = {}
): Promise<string[]> {
	requireAdmin(app, actor);
	const gw = gatewayOf(app, opts.env);
	if (!gw) throw new ValidationError('Set the gateway address first.');
	return listGatewayModels(gw, opts);
}

/**
 * Add a model (or re-check one) and run the tool-calling check. The result is stored with the model;
 * a model that fails stays listed with the reason, but cannot be assigned or run.
 */
export async function checkModel(
	app: AppDatabase,
	actor: Actor,
	model: string,
	opts: { fetch?: FetchLike; env?: Env; now?: Date } = {}
): Promise<AiModel> {
	requireAdmin(app, actor);
	const id = model.trim();
	if (!id)
		throw new ValidationError('Enter a model name.', { model: 'Enter the model name the gateway uses.' });
	if (id.length > 200) throw new ValidationError('That model name is too long.', { model: 'Too long.' });
	const gw = gatewayOf(app, opts.env);
	if (!gw) throw new ValidationError('Set the gateway address first.');
	const result = await checkToolCalling(gw, id, opts);
	const entry: AiModel = {
		id,
		check: { ok: result.ok, message: result.message, at: (opts.now ?? new Date()).toISOString() }
	};
	const models = modelsOf(app).filter((m) => m.id !== id);
	models.push(entry);
	models.sort((a, b) => a.id.localeCompare(b.id));
	saveSetting(app, KEYS.models, models);
	if (!result.ok) {
		// A model that stops passing is taken off every action it was assigned to.
		const assignments = assignmentsOf(app);
		for (const [k, v] of Object.entries(assignments)) if (v === id) delete assignments[k as AiAction];
		saveSetting(app, KEYS.assignments, assignments);
	}
	return entry;
}

export function removeModel(app: AppDatabase, actor: Actor, model: string): void {
	requireAdmin(app, actor);
	saveSetting(
		app,
		KEYS.models,
		modelsOf(app).filter((m) => m.id !== model)
	);
	const assignments = assignmentsOf(app);
	for (const [k, v] of Object.entries(assignments)) if (v === model) delete assignments[k as AiAction];
	saveSetting(app, KEYS.assignments, assignments);
}

/** Choose the model for each action (and the default). Only checked models can be assigned. */
export function assignModels(
	app: AppDatabase,
	actor: Actor,
	input: Partial<Record<AiAction | 'default', string | null>>
): void {
	requireAdmin(app, actor);
	const usable = new Set(usableModels(app));
	const next = assignmentsOf(app);
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		if (key !== 'default' && !isAiAction(key)) continue;
		const k = key as AiAction | 'default';
		if (!value) {
			delete next[k];
			continue;
		}
		if (!usable.has(value)) {
			fields[k] = `${value} has not passed the tool-calling check.`;
			continue;
		}
		next[k] = value;
	}
	if (Object.keys(fields).length) {
		throw new ValidationError('Only a model that passed the tool-calling check can run an action.', fields);
	}
	saveSetting(app, KEYS.assignments, next);
}

/**
 * The model that runs an action. An engagement's llm_profile limits it to that one model; otherwise the
 * action's own model, else the default. The model must have passed the tool-calling check.
 */
export function resolveModel(
	app: AppDatabase,
	action: AiAction,
	engagement: { llmProfile: string | null } | null,
	env: Env = process.env
): { gateway: Gateway; model: string } {
	const gateway = gatewayOf(app, env);
	if (!gateway) {
		throw new ForbiddenError('In-app AI is not set up. An admin sets the AI gateway in Settings, AI.');
	}
	const usable = new Set(usableModels(app));
	const profile = engagement?.llmProfile?.trim();
	if (profile) {
		if (!usable.has(profile)) {
			throw new ForbiddenError(
				`This engagement is limited to the model ${profile}, which has not passed the tool-calling check. An admin can check it in Settings, AI.`
			);
		}
		return { gateway, model: profile };
	}
	const assignments = assignmentsOf(app);
	const model = assignments[action] ?? assignments.default;
	if (!model) {
		throw new NotFoundError(
			`No model is set for "${AI_ACTIONS[action].label}". An admin chooses one in Settings, AI.`
		);
	}
	if (!usable.has(model)) {
		throw new ForbiddenError(`The model ${model} has not passed the tool-calling check.`);
	}
	return { gateway, model };
}

/** Whether in-app AI can run at all, for showing or disabling the buttons. */
export function aiAvailable(app: AppDatabase, env: Env = process.env): boolean {
	return !!gatewayOf(app, env) && usableModels(app).length > 0;
}

/** Validate an engagement's llm_profile against the checked models; empty means no limit. */
export function assertProfileUsable(app: AppDatabase, profile: string | null | undefined): void {
	if (!profile) return;
	if (!usableModels(app).includes(profile)) {
		throw new ValidationError('Choose a model that passed the tool-calling check.', {
			llm_profile: `${profile} has not passed the tool-calling check.`
		});
	}
}
