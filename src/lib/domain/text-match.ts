/**
 * Plain-text matching for rechecking internal requirements against a new version of their document
 * (#76). Deterministic, no AI: a quote is found when its characters appear in the text in order,
 * ignoring whitespace, case and typographic quote and dash variants; "…" in a quote skips text.
 */

const FOLD: Record<string, string> = {
	'‘': "'",
	'’': "'",
	'‚': "'",
	'“': '"',
	'”': '"',
	'„': '"',
	'«': '"',
	'»': '"',
	'–': '-',
	'—': '-',
	'‐': '-',
	'‑': '-',
	'­': ''
};

/**
 * A recheck runs every requirement of a document against the same new text: remember the last text's
 * derived forms so a long document is prepared once, not once per requirement.
 */
function once<T>(f: (text: string) => T): (text: string) => T {
	let last: { text: string; value: T } | null = null;
	return (text) => {
		if (last?.text !== text) last = { text, value: f(text) };
		return last.value;
	};
}

/** The text without whitespace, lower case, with each kept character's offset in the original. */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
	let norm = '';
	const map: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (/\s/u.test(ch)) continue;
		const folded = (FOLD[ch] ?? ch).toLowerCase();
		for (const c of folded) {
			norm += c;
			map.push(i);
		}
	}
	return { norm, map };
}

const normalized = once(normalizeWithMap);

/** Where the quote is in the text, or null. Parts of a quote separated by "…" or "..." match in order. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
	const parts = quote
		.split(/…|\.\.\./u)
		.map((p) => normalizeWithMap(p).norm)
		.filter((p) => p.length > 0);
	if (!parts.length) return null;
	const { norm, map } = normalized(text);
	let from = 0;
	let start = -1;
	let end = -1;
	for (const p of parts) {
		const at = norm.indexOf(p, from);
		if (at < 0) return null;
		if (start < 0) start = at;
		end = at + p.length;
		from = end;
	}
	return { start: map[start]!, end: map[end - 1]! + 1 };
}

const WORD = /[\p{L}\p{N}]+/gu;

const wordsOf = once((text: string) =>
	[...text.matchAll(WORD)].map((m) => ({
		w: m[0].toLowerCase(),
		start: m.index!,
		end: m.index! + m[0].length
	}))
);

/**
 * The passage of the text that shares the most words with the needle, about as long as the needle:
 * what to show next to a quote that was not found. Null when nothing is reasonably close.
 */
export function closestPassage(text: string, needle: string): { passage: string; score: number } | null {
	const want = [...needle.matchAll(WORD)].map((m) => m[0].toLowerCase());
	if (!want.length) return null;
	const words = wordsOf(text);
	if (!words.length) return null;
	const wanted = new Map<string, number>();
	for (const w of want) wanted.set(w, (wanted.get(w) ?? 0) + 1);
	const base = Math.max(want.length, 5);
	const sizes = [
		...new Set(
			[base, Math.ceil(base * 1.25), Math.ceil(base * 1.5)].map((n) => Math.min(n, 160, words.length))
		)
	];
	// Slide each window size over the text once, counting shared words as words enter and leave.
	let best = { at: 0, size: sizes[0]!, score: -1 };
	for (const size of sizes) {
		const have = new Map<string, number>();
		let common = 0;
		const add = (w: string) => {
			const n = have.get(w) ?? 0;
			if (n < (wanted.get(w) ?? 0)) common++;
			have.set(w, n + 1);
		};
		const drop = (w: string) => {
			const n = have.get(w)! - 1;
			have.set(w, n);
			if (n < (wanted.get(w) ?? 0)) common--;
		};
		for (let k = 0; k < size; k++) add(words[k]!.w);
		for (let at = 0; ; at++) {
			const score = (2 * common) / (want.length + size);
			if (score > best.score) best = { at, size, score };
			if (at + size >= words.length) break;
			drop(words[at]!.w);
			add(words[at + size]!.w);
		}
	}
	if (best.score < 0.25) return null;
	// Show the window from its first to its last shared word.
	let first = best.at;
	let last = best.at + best.size - 1;
	while (first < last && !wanted.has(words[first]!.w)) first++;
	while (last > first && !wanted.has(words[last]!.w)) last--;
	return {
		passage: text.slice(words[first]!.start, words[last]!.end).replace(/\s+/gu, ' ').trim().slice(0, 800),
		score: Math.round(best.score * 100) / 100
	};
}

export interface Heading {
	number: string;
	title: string;
	offset: number;
}

const HEADING = /^[ \t]*((?:\d{1,3}\.)*\d{1,3})\.?[ \t]+(\S[^\n]{0,110})$/gmu;

/** Numbered lines that look like section headings ("4.2 Access review"), in text order. */
export const headings = once(readHeadings);

function readHeadings(text: string): Heading[] {
	const out: Heading[] = [];
	const seen = new Set<string>();
	for (const m of text.matchAll(HEADING)) {
		const title = m[2]!.trim();
		// A numbered sentence in a list ends with a full stop or runs on; a heading usually does not.
		if (/[.;,:]$/u.test(title) && title.length > 60) continue;
		if (seen.has(m[1]!)) continue;
		seen.add(m[1]!);
		out.push({ number: m[1]!, title: title.slice(0, 80), offset: m.index! });
	}
	return out;
}

/** The number of the last heading before an offset, or null. */
export function sectionAt(text: string, offset: number): string | null {
	let found: string | null = null;
	for (const h of headings(text)) {
		if (h.offset > offset) break;
		found = h.number;
	}
	return found;
}

const LEAD = /^(?:\d+\.)*\d+/u;

/**
 * The section to record after the quote was found under `heading`: the old section with its leading
 * number replaced ("3.2(1)-(3)" under 4.2 becomes "4.2(1)-(3)"). Null when nothing should change.
 */
export function movedSection(old: string | null, heading: string | null): string | null {
	if (!heading) return null;
	if (!old) return heading;
	const lead = old.match(LEAD)?.[0];
	if (!lead || lead === heading) return null;
	// The quote may sit in a subsection of the recorded section, or the reverse: both still match.
	if (heading.startsWith(`${lead}.`) || lead.startsWith(`${heading}.`)) return null;
	return heading + old.slice(lead.length);
}

/** Headings that no recorded section falls under: where extraction should look again. */
export function uncoveredSections(all: Heading[], sections: (string | null)[]): Heading[] {
	const leads = sections.map((s) => s?.match(LEAD)?.[0]).filter((s): s is string => !!s);
	return all.filter((h) => !leads.some((l) => l === h.number || l.startsWith(`${h.number}.`)));
}
