import {
	AFTER,
	CLIENTS,
	GUIDE_INTRO,
	NOT_PUBLIC_NOTE,
	PREPARE,
	RULES,
	STEPS,
	connectorReady,
	desktopConfig,
	fill,
	rich,
	signInNote
} from './content.ts';

/**
 * The guide as one self-contained page (#84), for people who have no account yet: the same steps
 * and connection instructions as /guide, with no network needed. Downloaded from the app it carries
 * the instance's MCP address; the reader can change it and the instructions follow.
 *
 * `guideDocument` is a whole HTML file. `guideFragment` is the same page without the document
 * skeleton, for hosts that add their own.
 */

export interface StandaloneOptions {
	/** The instance's MCP address; empty for a copy that belongs to no instance. */
	mcpUrl?: string;
	/** How people sign in on the instance, for the note on the sign-in window; unset for no instance. */
	signIn?: 'password' | 'passkey';
	/** What the instance is called (#91), so a person with two instances can tell their guides apart. */
	instanceName?: string;
	version?: string;
	/** Link the app's typefaces from Google Fonts. Off for the download, which must work offline. */
	webFonts?: boolean;
}

export const GUIDE_TITLE = 'mcp-audit Guide';
export const ADDRESS_PLACEHOLDER = 'https://your-mcp-audit-address/mcp';

const esc = (s: string) =>
	s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const text = (s: string) =>
	rich(s)
		.map((p) => (p.bold ? `<strong>${esc(p.text)}</strong>` : esc(p.text)))
		.join('');

// Layout: a route of five stops across the top, one step's page below it; then the connection
// instructions around a single editable address. The app's own tokens, light and dark.
const CSS = `
:root {
  --bg: #f6f7f8; --surface: #ffffff; --sunken: #eceef1; --border: #d5d9df; --border-strong: #8a929e;
  --ink: #14181d; --muted: #4f5966; --accent: #1f5fbf; --accent-ink: #ffffff; --accent-soft: #e6effb;
  --ok: #17663a; --ok-soft: #e3f4ea; --warn: #8a4b00; --warn-soft: #fdf0dc; --ai: #6a3fa0; --ai-soft: #f1eafa;
  --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111417; --surface: #1a1e23; --sunken: #0c0e11; --border: #333a43; --border-strong: #6b7684;
  --ink: #eef1f4; --muted: #a7b0bb; --accent: #7fb0ff; --accent-ink: #0b1626; --accent-soft: #1b2b45;
  --ok: #6fd39a; --ok-soft: #143424; --warn: #f2b35e; --warn-soft: #3a2a10; --ai: #c9a9f5; --ai-soft: #2c2140;
  color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #111417; --surface: #1a1e23; --sunken: #0c0e11; --border: #333a43; --border-strong: #6b7684;
  --ink: #eef1f4; --muted: #a7b0bb; --accent: #7fb0ff; --accent-ink: #0b1626; --accent-soft: #1b2b45;
  --ok: #6fd39a; --ok-soft: #143424; --warn: #f2b35e; --warn-soft: #3a2a10; --ai: #c9a9f5; --ai-soft: #2c2140;
  color-scheme: dark }
*, *::before, *::after { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.55 var(--sans); }
[hidden] { display: none !important }
.wrap { max-width: 60rem; margin: 0 auto; padding-block: 2rem 4rem;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; flex-direction: column; gap: 2.5rem; }
h1, h2, h3, h4, p, ol, ul, dl, dd, pre { margin: 0 }
h1 { font: 600 clamp(1.75rem, 4.5vw, 2.5rem)/1.15 var(--sans); letter-spacing: -.02em; text-wrap: balance }
h2 { font: 600 1.5rem/1.25 var(--sans); letter-spacing: -.01em; text-wrap: balance }
h3 { font: 600 1.25rem/1.3 var(--sans) }
h4, .label { font: 600 .75rem/1.5 var(--sans); letter-spacing: .07em; text-transform: uppercase; color: var(--accent) }
a { color: var(--accent) }
.eyebrow { font: 500 .8125rem/1.5 var(--mono); color: var(--muted) }
.lede { font-size: 1.125rem; max-width: 62ch; color: var(--muted) }
.top, section { display: flex; flex-direction: column; gap: 1rem; min-width: 0 }
.rules, .cards { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .75rem }
.rules li, .cards li { display: flex; flex-direction: column; gap: .25rem; padding: .75rem 1rem; background: var(--surface); border-left: 3px solid var(--accent); border-radius: 4px; min-width: 0 }
.rules span, .cards span { color: var(--muted); font-size: .9375rem }
details.prepare { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 0 1rem }
details.prepare summary { cursor: pointer; min-height: 44px; display: flex; flex-wrap: wrap; align-items: center; gap: .25rem .5rem; padding-block: .5rem; font-weight: 600 }
details.prepare ul { padding: 0 0 1rem 1.25rem; display: flex; flex-direction: column; gap: .5rem }
.badge { display: inline-block; padding: 0 .5rem; border-radius: 999px; font: 600 .75rem/1.5rem var(--sans); background: var(--sunken); color: var(--muted) }
.badge.warn { background: var(--warn-soft); color: var(--warn) }
.badge.info { background: var(--accent-soft); color: var(--accent) }
.route { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .5rem; position: relative }
.route li { display: flex }
.route button { width: 100%; min-height: 44px; display: flex; flex-direction: column; align-items: flex-start; gap: .375rem; padding: .625rem .75rem;
  background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 12px; font: 600 .9375rem/1.3 var(--sans); text-align: left; cursor: pointer }
.route button[aria-selected="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-soft) }
.route button.done .num { background: var(--ok) }
.num { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font: 600 .875rem/1 var(--sans); flex: none }
.panel { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; min-width: 0 }
.panel + .panel { margin-top: 1rem }
.panel > header { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem }
.panel > header p { flex-basis: 100%; color: var(--muted) }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1.25rem }
.cols > div { display: flex; flex-direction: column; gap: .5rem; min-width: 0 }
.cols .ai h4 { color: var(--ai) }
.cols ol, .cols ul, .steps, .notes { padding-left: 1.25rem; display: flex; flex-direction: column; gap: .5rem }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: .375rem 1rem }
.facts dt { padding-top: .2rem }
.tip, .where, .notes, footer { color: var(--muted); font-size: .9375rem }
.foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; padding-top: .75rem; border-top: 1px solid var(--border) }
.tick { display: inline-flex; align-items: center; gap: .5rem; min-height: 44px; cursor: pointer }
.tick input { width: 1.375rem; height: 1.375rem; accent-color: var(--accent) }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 1rem; border-radius: 8px; border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--ink); font: 600 .9375rem/1 var(--sans); cursor: pointer }
.btn.primary, .btn[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink) }
.btn[disabled] { opacity: .45; cursor: not-allowed }
.row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center }
button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.field { display: flex; flex-direction: column; gap: .375rem }
.field label { font-weight: 600 }
.field input { min-height: 44px; padding: 0 .75rem; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--ink); font: 400 .9375rem/1 var(--mono); width: 100%; max-width: 36rem }
.note { padding: .75rem 1rem; border-radius: 12px; background: var(--warn-soft); color: var(--warn); border: 1px solid var(--warn) }
.code { display: flex; align-items: flex-start; gap: .5rem; margin-top: .5rem; padding: .5rem .75rem; background: var(--sunken); border: 1px solid var(--border); border-radius: 8px; min-width: 0 }
.code pre { flex: 1; min-width: 0; align-self: center; white-space: pre-wrap; overflow-wrap: anywhere; font: 400 .8125rem/1.5 var(--mono) }
.code .btn { min-height: 36px; padding: 0 .75rem; font-size: .8125rem }
.steps li { min-width: 0 }
@media (max-width: 40rem) {
  .route { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .25rem }
  .route button { align-items: center; padding: .5rem .25rem }
  .route .name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%) }
  .facts { grid-template-columns: 1fr }
  .code .btn { min-height: 44px }
}
@media (prefers-reduced-motion: no-preference) { .route button { transition: background-color .15s, border-color .15s } }
`;

function stepPanel(s: (typeof STEPS)[number]): string {
	const prev = STEPS[s.number - 2];
	const next = STEPS[s.number];
	return `<article class="panel" id="step-${s.key}" data-step="${s.key}" role="tabpanel" aria-labelledby="tab-${s.key}">
<header><span class="num">${s.number}</span><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p></header>
<div class="cols">
<div><h4>You do</h4><ol>${s.you.map((l) => `<li>${text(l)}</li>`).join('')}</ol></div>
<div class="ai"><h4>AI can</h4><ul>${s.ai.map((l) => `<li>${text(l)}</li>`).join('')}</ul></div>
</div>
<dl class="facts"><dt class="label">You decide</dt><dd>${esc(s.decide)}</dd><dt class="label">Done when</dt><dd>${esc(s.done)}</dd></dl>
${s.tip ? `<p class="tip">${text(s.tip)}</p>` : ''}
<p class="where">In the app: ${s.screens.map((x) => esc(x.label)).join(' · ')}</p>
<div class="foot"><label class="tick" for="done-${s.key}"><input type="checkbox" id="done-${s.key}" data-done="${s.key}"> I have done this step</label>
<span class="row"><button class="btn" type="button" data-go="${prev?.key ?? ''}"${prev ? '' : ' disabled'}>Previous step</button><button class="btn primary" type="button" data-go="${next?.key ?? ''}"${next ? '' : ' disabled'}>Next step</button></span></div>
</article>`;
}

function clientPanel(c: (typeof CLIENTS)[number], mcp: string, signIn?: 'password' | 'passkey'): string {
	return `<article class="panel" id="client-${c.key}" data-client="${c.key}" role="tabpanel" aria-labelledby="ctab-${c.key}">
<header><h3>${esc(c.label)}</h3><span class="badge ${c.needs === 'public' ? 'info' : ''}">${c.needs === 'public' ? 'Needs a public https address' : 'Uses an access token'}</span><p>${esc(c.summary)}</p></header>
${c.unverified ? `<p class="note" role="note">${esc(c.unverified)}</p>` : ''}
<ol class="steps">${c.steps
		.map(
			(st) =>
				`<li>${text(st.text)}${st.code ? `<div class="code"><pre data-tpl="${esc(st.code)}">${esc(fill(st.code, mcp))}</pre><button class="btn" type="button" data-copy>Copy</button></div>` : ''}</li>`
		)
		.join('')}</ol>
${c.needs === 'public' ? `<p class="sign-in">${text(signInNote(signIn))}</p>` : ''}
<ul class="notes">${c.notes.map((n) => `<li>${text(n)}</li>`).join('')}</ul>
</article>`;
}

/** The page's behaviour. Without it every step and every assistant is simply shown in full. */
function script(): string {
	return `(function () {
  var desktopConfig = (${desktopConfig.toString()});
  var connectorReady = (${connectorReady.toString()});
  var PLACEHOLDER = ${JSON.stringify(ADDRESS_PLACEHOLDER)};
  var store = {
    get: function (k) { try { return localStorage.getItem(k) } catch (e) { return null } },
    set: function (k, v) { try { localStorage.setItem(k, v) } catch (e) { /* private window: nothing kept */ } }
  };
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)) }

  // Steps: one at a time, chosen from the route or with Previous and Next.
  var done = {};
  try { done = JSON.parse(store.get('mcpa-guide-done') || '{}') || {} } catch (e) { done = {} }
  function showStep(key, focus) {
    all('[data-step]').forEach(function (p) { p.hidden = p.getAttribute('data-step') !== key });
    all('[data-step-tab]').forEach(function (b) {
      var on = b.getAttribute('data-step-tab') === key;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    store.set('mcpa-guide-step', key);
  }
  function paintDone() {
    all('[data-step-tab]').forEach(function (b) { b.classList.toggle('done', !!done[b.getAttribute('data-step-tab')]) });
    all('[data-done]').forEach(function (c) { c.checked = !!done[c.getAttribute('data-done')] });
  }
  var keys = all('[data-step]').map(function (p) { return p.getAttribute('data-step') });
  all('[data-step-tab]').forEach(function (b) {
    b.addEventListener('click', function () { showStep(b.getAttribute('data-step-tab')) });
    b.addEventListener('keydown', function (ev) {
      var i = keys.indexOf(b.getAttribute('data-step-tab'));
      if (ev.key === 'ArrowRight' && i < keys.length - 1) showStep(keys[i + 1], true);
      if (ev.key === 'ArrowLeft' && i > 0) showStep(keys[i - 1], true);
    });
  });
  all('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-go');
      if (!k) return;
      showStep(k);
      var route = document.getElementById('steps');
      if (route && route.scrollIntoView) route.scrollIntoView({ block: 'start' });
    });
  });
  all('[data-done]').forEach(function (c) {
    c.addEventListener('change', function () {
      done[c.getAttribute('data-done')] = c.checked;
      store.set('mcpa-guide-done', JSON.stringify(done));
      paintDone();
    });
  });
  var saved = store.get('mcpa-guide-step');
  showStep(keys.indexOf(saved) >= 0 ? saved : keys[0]);
  paintDone();

  // The address: every command and configuration follows it.
  var input = document.getElementById('mcp-input');
  var note = document.getElementById('mcp-note');
  function address() { return (input && input.value.trim()) || PLACEHOLDER }
  function paintAddress() {
    var mcp = address();
    all('pre[data-tpl]').forEach(function (pre) {
      pre.textContent = pre.getAttribute('data-tpl').split('{desktop-config}').join(desktopConfig(mcp)).split('{mcp}').join(mcp);
    });
    if (note) note.hidden = !input || !input.value.trim() || connectorReady(mcp);
  }
  if (input) {
    var kept = store.get('mcpa-guide-address');
    if (!input.value && kept) input.value = kept;
    input.addEventListener('input', function () { store.set('mcpa-guide-address', input.value.trim()); paintAddress() });
  }
  paintAddress();

  // Assistants: one at a time.
  function showClient(key) {
    all('[data-client]').forEach(function (p) { p.hidden = p.getAttribute('data-client') !== key });
    all('[data-client-tab]').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-client-tab') === key ? 'true' : 'false') });
  }
  all('[data-client-tab]').forEach(function (b) { b.addEventListener('click', function () { showClient(b.getAttribute('data-client-tab')) }) });
  var first = document.querySelector('[data-client]');
  if (first) showClient(input && input.value.trim() && !connectorReady(address()) ? 'claude-code' : first.getAttribute('data-client'));

  // Copy, or select the text where the clipboard is not available.
  all('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var pre = b.parentNode.querySelector('pre');
      var ok = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy' }, 2500) };
      var select = function () {
        var r = document.createRange(); r.selectNodeContents(pre);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pre.textContent).then(ok, select);
      else select();
    });
  });
})();`;
}

export function guideParts(opts: StandaloneOptions = {}): { head: string; body: string } {
	const mcp = (opts.mcpUrl ?? '').trim();
	const shown = mcp || ADDRESS_PLACEHOLDER;
	const name = (opts.instanceName ?? '').trim() || 'mcp-audit';
	const head = `<title>${name === 'mcp-audit' ? GUIDE_TITLE : `${esc(name)} Guide`}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${opts.webFonts ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n' : ''}<style>${CSS}</style>`;
	const body = `<div class="wrap">
<header class="top">
<p class="eyebrow">${esc(name)} · audit planning and running, with AI that proposes and an auditor who decides</p>
<h1>Run an audit in five steps</h1>
<p class="lede">${esc(GUIDE_INTRO)}</p>
<ul class="rules">${RULES.map((r) => `<li><strong>${esc(r.title)}</strong><span>${esc(r.text)}</span></li>`).join('')}</ul>
</header>

<details class="prepare"><summary>${esc(PREPARE.title)} <span class="badge">${esc(PREPARE.summary)}</span></summary>
<ul>${PREPARE.items.map((i) => `<li>${esc(i.text)} ${i.admin ? '<span class="badge">Admin</span> ' : ''}${i.link ? `<span class="where">In the app: ${esc(i.link.label)}</span>` : ''}</li>`).join('')}</ul></details>

<section id="steps" aria-labelledby="steps-h">
<h2 id="steps-h">The five steps</h2>
<ol class="route" role="tablist" aria-label="Steps">${STEPS.map(
		(s) =>
			`<li role="presentation"><button type="button" role="tab" id="tab-${s.key}" data-step-tab="${s.key}" aria-controls="step-${s.key}" aria-selected="false" aria-label="Step ${s.number}: ${esc(s.title)}"><span class="num">${s.number}</span><span class="name">${esc(s.title)}</span></button></li>`
	).join('')}</ol>
<div>${STEPS.map(stepPanel).join('\n')}</div>
</section>

<section id="connect" aria-labelledby="connect-h">
<h2 id="connect-h">Connect your AI</h2>
<p class="lede">Your own assistant can work on the same records through the MCP connector, under the same rules.</p>
<div class="field"><label for="mcp-input">Your mcp-audit MCP address</label>
<input id="mcp-input" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${esc(ADDRESS_PLACEHOLDER)}" value="${esc(mcp)}">
<span class="where">The app's address followed by /mcp. In the app it is shown under Guide, Connect your AI. The steps below follow what you enter.</span></div>
<p class="note" id="mcp-note" role="status"${mcp && !connectorReady(mcp) ? '' : ' hidden'}>${esc(NOT_PUBLIC_NOTE)}</p>
<div class="row" role="tablist" aria-label="Assistant">${CLIENTS.map(
		(c) =>
			`<button class="btn" type="button" role="tab" id="ctab-${c.key}" data-client-tab="${c.key}" aria-controls="client-${c.key}" aria-selected="false">${esc(c.label)}</button>`
	).join('')}</div>
<div>${CLIENTS.map((c) => clientPanel(c, shown, opts.signIn)).join('\n')}</div>
</section>

<section id="after" aria-labelledby="after-h">
<h2 id="after-h">After connecting</h2>
<ul class="cards">${AFTER.map((a) => `<li><strong>${esc(a.title)}</strong><span>${esc(a.text)}</span>${a.link ? `<span>In the app: ${esc(a.link.label)}</span>` : ''}</li>`).join('')}</ul>
</section>

<footer>In the app, the same guide is under Guide, where each step shows your engagement's progress and opens the right screen.${opts.version ? ` Made from mcp-audit ${esc(opts.version)}.` : ''}</footer>
</div>
<script>${script()}</script>`;
	return { head, body };
}

/** The page without a document skeleton. */
export function guideFragment(opts: StandaloneOptions = {}): string {
	const { head, body } = guideParts(opts);
	return `${head}\n${body}\n`;
}

/** A whole HTML file, as the app's Download guide returns it. */
export function guideDocument(opts: StandaloneOptions = {}): string {
	const { head, body } = guideParts(opts);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${body}
</body>
</html>
`;
}
