import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	AFTER,
	CLIENTS,
	PREPARE,
	STEPS,
	VIDEO,
	chapterOf,
	clock,
	connectorReady,
	whereInStep,
	desktopConfig,
	fill,
	rich,
	stepByKey,
	stepProgress
} from './content.ts';
import { ADDRESS_PLACEHOLDER, GUIDE_TITLE, guideDocument, guideFragment, guidePolicy } from './standalone.ts';

const ROUTES = path.resolve(import.meta.dirname, '../../routes/(app)');
const routeExists = (href: string) =>
	existsSync(path.join(ROUTES, href.replace(/^\//, ''), '+page.svelte')) ||
	existsSync(path.join(ROUTES, href.replace(/^\//, ''), '+page.server.ts'));

describe('guide content (#84)', () => {
	it('is five steps that cover the eight phases once each, and every screen is a real route', () => {
		expect(STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
		expect(STEPS.flatMap((s) => s.phases).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		for (const s of STEPS) {
			expect(s.you.length, s.key).toBeGreaterThan(0);
			expect(s.ai.length, s.key).toBeGreaterThan(0);
			for (const screen of s.screens) expect(routeExists(`/e/[e]${screen.path}`), screen.path).toBe(true);
		}
		for (const link of [...PREPARE.items, ...AFTER].flatMap((x) => (x.link ? [x.link.href] : [])))
			expect(routeExists(link), link).toBe(true);
	});

	it('names the buttons as the app does', async () => {
		// Each **bold** span that names an AI action must be that action's label.
		const { AI_ACTIONS } = await import('#lib/domain/ai-settings.ts');
		const labels = new Set(Object.values(AI_ACTIONS).map((a) => a.label as string));
		const named = STEPS.flatMap((s) => s.ai)
			.flatMap((line) => rich(line))
			.filter((p) => p.bold)
			.map((p) => p.text);
		expect(named.length).toBeGreaterThan(5);
		for (const n of named) expect(labels.has(n) || n === 'Propose findings', n).toBe(true);
	});

	it("takes each step's state from the phases: done, then the first open one, then to do", () => {
		const phases = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
			number: n,
			title: `P${n}`,
			fact: '',
			done: n <= 5
		}));
		const p = stepProgress(phases);
		expect(STEPS.map((s) => p.get(s.key)!.state)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
		expect(p.get('setup')!.facts.map((f) => f.title)).toEqual(['P1', 'P2', 'P3', 'P4']);
		// One phase of a step open: the step is not done.
		phases[2]!.done = false;
		expect(stepProgress(phases).get('setup')!.state).toBe('current');
		expect(stepProgress(phases).get('rules')!.state).toBe('done');
	});

	it('fills the address into commands; the desktop bridge allows http only for an http address', () => {
		const code = CLIENTS.find((c) => c.key === 'claude-code')!.steps[1]!.code!;
		expect(fill(code, 'https://audit.example.com/mcp')).toBe(
			'claude mcp add --transport http mcp-audit https://audit.example.com/mcp --header "Authorization: Bearer mcpa_yourtoken"'
		);
		expect(desktopConfig('http://audit.lan:3000/mcp')).toContain('--allow-http');
		expect(desktopConfig('https://audit.example.com/mcp')).not.toContain('--allow-http');
		expect(connectorReady('https://audit.example.com/mcp')).toBe(true);
		expect(connectorReady('http://audit.lan:3000/mcp')).toBe(false);
	});

	it('marks the ChatGPT steps as not verified, and only those', () => {
		expect(CLIENTS.map((c) => c.key)).toEqual(['claude', 'chatgpt', 'claude-code', 'claude-desktop']);
		expect(CLIENTS.filter((c) => c.unverified).map((c) => c.key)).toEqual(['chatgpt']);
		expect(CLIENTS.find((c) => c.key === 'chatgpt')!.unverified).toContain('Not yet verified with ChatGPT');
	});
});

describe('standalone guide (#84)', () => {
	const html = guideDocument({ mcpUrl: 'https://audit.example.com/mcp', version: '1.2.3' });

	it('is one self-contained file with every step and assistant, and the instance address', () => {
		expect(html.startsWith('<!doctype html>')).toBe(true);
		expect(html).toContain(`<title>${GUIDE_TITLE}</title>`);
		for (const s of STEPS) expect(html).toContain(`id="step-${s.key}"`);
		for (const c of CLIENTS) expect(html).toContain(`id="client-${c.key}"`);
		expect(html).toContain('value="https://audit.example.com/mcp"');
		expect(html).toContain('claude mcp add --transport http mcp-audit https://audit.example.com/mcp');
		expect(html).toContain('Not yet verified with ChatGPT');
		expect(html).toContain('Made from mcp-audit 1.2.3.');
		// Nothing is loaded from the network.
		expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/);
		expect(html).not.toContain('**');
	});

	it('without an address shows a placeholder, and as a fragment has no document skeleton', () => {
		const f = guideFragment({ webFonts: true });
		expect(f).not.toContain('<!doctype');
		expect(f).not.toContain('<body');
		expect(f.startsWith(`<title>${GUIDE_TITLE}</title>`)).toBe(true);
		expect(f).toContain(ADDRESS_PLACEHOLDER);
		expect(f).toContain('fonts.googleapis.com');
		expect(f).toContain('id="mcp-note" role="status" hidden');
		// A private http address: the note about connectors is shown.
		expect(guideDocument({ mcpUrl: 'http://audit.lan:3000/mcp' })).toContain('id="mcp-note" role="status">');
	});

	it('escapes what it is given', () => {
		const x = guideDocument({ mcpUrl: 'https://x.example/mcp"><script>alert(1)</script>' });
		expect(x).not.toContain('<script>alert(1)');
	});

	it('carries a script that parses', () => {
		const js = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
		expect(() => new Function(js)).not.toThrow();
	});
});

describe('the guide as a public page (#100)', () => {
	it('comes with a policy that lets its own script run, by its hash, and nothing else', () => {
		const html = guideDocument({
			mcpUrl: 'https://mcpaudit-acme.example.test/mcp',
			instanceName: 'Acme Audit'
		});
		const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
		expect(scripts).toHaveLength(1);
		const hash = createHash('sha256').update(scripts[0]!).digest('base64');
		const policy = guidePolicy();
		expect(policy).toContain(`script-src 'sha256-${hash}'`);
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).not.toContain("script-src 'unsafe-inline'");
		// The page asks for nothing from anywhere else.
		expect(html).not.toMatch(/<link |<img |src="http|url\(http/);
		// A name with markup in it stays text, so the one script is still the only one.
		const hostile = guideDocument({ instanceName: '<script>alert(1)</script>' });
		expect([...hostile.matchAll(/<script>/g)]).toHaveLength(1);
	});
});

describe('the guide as a path to follow (#106)', () => {
	const STATIC = path.resolve(import.meta.dirname, '../../../static');

	it('ties every action to a screen of its step, and every screen is a real route', () => {
		for (const s of STEPS) {
			const paths = s.screens.map((x) => x.path);
			expect(s.you.length, s.key).toBeGreaterThan(1);
			for (const a of s.you) {
				expect(a.screen, a.text).toBeDefined();
				expect(paths, `${s.key}: ${a.text}`).toContain(a.screen);
				expect(routeExists(`/e/[e]${a.screen}`), a.screen).toBe(true);
			}
		}
	});

	it('tells, on each screen, what to do there and where the next action is', () => {
		const plan = stepByKey('plan')!;
		const onEvents = whereInStep(plan, '/plan/events');
		expect(onEvents.here.map((a) => a.text)).toEqual([plan.you[0]!.text, plan.you[1]!.text]);
		expect(onEvents.next?.screen).toBe('/plan/coverage');
		expect(whereInStep(plan, '/plan/coverage').next?.screen).toBe('/plan/document');
		// The last screen of a step has no next action.
		expect(whereInStep(plan, '/plan/document')).toMatchObject({ next: null });
		// A screen of another step: nothing here; the next action is the step's first.
		expect(whereInStep(plan, '/findings/matrix')).toEqual({ here: [], next: plan.you[0] });
		// A screen covers the pages below it: an event's own page is Run, All events.
		const run = stepByKey('run')!;
		expect(whereInStep(run, '/run/events/abc-123').here.map((a) => a.screen)).toEqual([
			'/run/events',
			'/run/events',
			'/run/events'
		]);
		expect(whereInStep(run, '/run/events/abc-123').next?.screen).toBe('/run/inbox');
		// Home is the empty path, and only Home.
		const setup = stepByKey('setup')!;
		expect(whereInStep(setup, '').here.map((a) => a.screen)).toEqual(['']);
		expect(whereInStep(setup, '/setup/risks').here.map((a) => a.screen)).toEqual(['/setup/risks']);
		expect(stepByKey('nonsense')).toBeNull();
	});

	it('has a video whose chapters cover it in order, one per step among them', () => {
		const c = VIDEO.chapters;
		expect(c[0]!.start).toBe(0);
		expect(c.at(-1)!.end).toBe(VIDEO.duration);
		for (let i = 1; i < c.length; i++) expect(c[i]!.start, c[i]!.key).toBe(c[i - 1]!.end);
		for (const x of c) expect(x.end, x.key).toBeGreaterThan(x.start);
		// The steps' chapters come in the steps' order.
		const steps = c.filter((x) => STEPS.some((s) => s.key === x.key)).map((x) => x.key);
		expect(steps).toEqual(STEPS.map((s) => s.key));
		expect(chapterOf('plan')).toMatchObject({ start: 102.2, end: 117.2 });
		expect(clock(102.2)).toBe('1:42');
		expect(clock(VIDEO.duration)).toBe('2:57');
		// At most three minutes.
		expect(VIDEO.duration).toBeLessThanOrEqual(180);
	});

	it('ships the video, its poster and valid captions in the app', () => {
		for (const f of [VIDEO.src, VIDEO.poster, VIDEO.captions])
			expect(existsSync(path.join(STATIC, f)), f).toBe(true);
		const vtt = readFileSync(path.join(STATIC, VIDEO.captions), 'utf8');
		expect(vtt.startsWith('WEBVTT\n')).toBe(true);
		const seconds = (t: string) => {
			const [h, m, s] = t.split(':');
			return Number(h) * 3600 + Number(m) * 60 + Number(s);
		};
		const cues = [...vtt.matchAll(/^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})$/gm)].map((m) => [
			seconds(m[1]!),
			seconds(m[2]!)
		]);
		expect(cues.length).toBeGreaterThan(30);
		let last = 0;
		for (const [a, b] of cues) {
			expect(a).toBeGreaterThanOrEqual(last - 0.001);
			expect(b).toBeGreaterThan(a!);
			last = b!;
		}
		expect(last).toBeLessThanOrEqual(VIDEO.duration);
		// Two lines at most per cue, short enough to read on a phone.
		for (const block of vtt.split('\n\n').slice(2)) {
			const text = block.split('\n').slice(2).filter(Boolean);
			expect(text.length, block).toBeLessThanOrEqual(2);
			for (const line of text) expect(line.length, line).toBeLessThanOrEqual(42);
		}
	});

	it('shows the video in the public page and links to it from the downloaded file', () => {
		const shown = guideDocument({ mcpUrl: 'https://audit.example.com/mcp', video: { mode: 'embed' } });
		expect(shown).toContain(
			'<video controls preload="metadata" playsinline poster="/media/explainer-poster.jpg" src="/media/explainer.mp4"'
		);
		expect(shown).toContain(
			'<track kind="captions" srclang="en" label="English" src="/media/explainer.en.vtt" default>'
		);
		expect(guidePolicy()).toContain("media-src 'self'");
		const linked = guideDocument({ video: { mode: 'link', origin: 'https://audit.example.com/' } });
		expect(linked).not.toContain('<video');
		expect(linked).toContain('<a href="https://audit.example.com/media/explainer.mp4">');
		expect(guideDocument({})).not.toContain('explainer');
	});
});
