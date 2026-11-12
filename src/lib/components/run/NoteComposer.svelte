<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';

	/**
	 * Auditor notes during a live conversation. "/" (at the start or after a space) offers commands (requirement, document,
	 * person, promise, issue); "@" offers mentions. Mentions may contain spaces. Enter saves when no menu
	 * is open; arrows, Enter or Tab choose in a menu; Escape closes it. Works by keyboard and by touch.
	 */
	type MentionType = 'requirement' | 'internal_requirement' | 'artifact' | 'person' | 'evidence_item';
	interface Option {
		type: MentionType;
		id: string;
		label: string;
		hint: string;
	}
	interface Props {
		options: Option[];
		error?: string | null;
	}
	let { options, error = null }: Props = $props();

	const COMMANDS = [
		{
			key: 'requirement',
			label: 'Requirement',
			hint: 'Mention a requirement or internal rule',
			types: ['requirement', 'internal_requirement']
		},
		{
			key: 'document',
			label: 'Document',
			hint: 'Mention a document, or name one not received yet',
			types: ['artifact']
		},
		{ key: 'person', label: 'Person', hint: 'Mention a role', types: ['person'] },
		{ key: 'promise', label: 'Promise', hint: 'Something the auditee will send or do' },
		{ key: 'issue', label: 'Issue', hint: 'A suspected issue, for the auditor only' }
	] as const;
	const TYPE_LABEL: Record<MentionType, string> = {
		requirement: 'Requirement',
		internal_requirement: 'Internal rule',
		artifact: 'Document',
		person: 'Role',
		evidence_item: 'Planned evidence'
	};

	let text = $state('');
	let type = $state<'note' | 'promise' | 'issue'>('note');
	let mentions = $state<{ type: MentionType; id: string; label: string }[]>([]);
	let menu = $state<
		| null
		| { kind: 'command'; start: number }
		| { kind: 'mention'; start: number; types: readonly string[] | null }
	>(null);
	let active = $state(0);
	let field = $state<HTMLTextAreaElement | null>(null);
	let form = $state<HTMLFormElement | null>(null);
	let cursor = $state(0);
	const listId = `note-menu-${Math.random().toString(36).slice(2, 7)}`;

	const query = $derived(
		menu
			? menu.kind === 'command'
				? text.slice(menu.start + 1, cursor).toLowerCase()
				: text.slice(menu.start + 1, cursor)
			: ''
	);
	type Item =
		| { kind: 'command'; key: string; label: string; hint: string }
		| { kind: 'mention'; option: Option }
		| { kind: 'new-document'; label: string };
	const items = $derived.by<Item[]>(() => {
		if (!menu) return [];
		if (menu.kind === 'command')
			return COMMANDS.filter((c) => c.key.startsWith(query) || c.label.toLowerCase().startsWith(query)).map(
				(c) => ({ kind: 'command', key: c.key, label: c.label, hint: c.hint })
			);
		const q = query.trim().toLowerCase();
		const types = menu.types;
		const found: Item[] = options
			.filter(
				(o) => (!types || types.includes(o.type)) && (!q || `${o.label} ${o.hint}`.toLowerCase().includes(q))
			)
			.slice(0, 8)
			.map((option) => ({ kind: 'mention', option }));
		if (
			types?.includes('artifact') &&
			q &&
			!options.some((o) => o.type === 'artifact' && o.label.toLowerCase() === q)
		)
			found.push({ kind: 'new-document', label: query.trim() });
		return found;
	});

	function sync() {
		cursor = field?.selectionStart ?? text.length;
		if (
			menu?.kind === 'mention' &&
			(cursor <= menu.start ||
				text[menu.start] !== '@' ||
				text.slice(menu.start, cursor).includes('\n') ||
				cursor - menu.start > 80)
		)
			menu = null;
		if (
			menu?.kind === 'command' &&
			(cursor <= menu.start || text[menu.start] !== '/' || /\s/.test(text.slice(menu.start, cursor)))
		)
			menu = null;
		active = Math.min(active, Math.max(items.length - 1, 0));
	}

	function oninput(e: Event) {
		const ev = e as InputEvent;
		cursor = field?.selectionStart ?? text.length;
		if (ev.data === '@') {
			menu = { kind: 'mention', start: cursor - 1, types: null };
			active = 0;
		} else if (ev.data === '/' && (cursor === 1 || /\s/.test(text[cursor - 2] ?? ''))) {
			menu = { kind: 'command', start: cursor - 1 };
			active = 0;
		}
		sync();
	}

	async function replaceRange(from: number, to: number, insert: string) {
		text = text.slice(0, from) + insert + text.slice(to);
		await tick();
		const pos = from + insert.length;
		field?.focus();
		field?.setSelectionRange(pos, pos);
		cursor = pos;
	}

	async function choose(item: Item) {
		if (item.kind === 'command') {
			if (menu?.kind !== 'command') return;
			const start = menu.start;
			const c = COMMANDS.find((x) => x.key === item.key)!;
			if (c.key === 'promise' || c.key === 'issue') {
				type = c.key;
				menu = null;
				await replaceRange(start, cursor, '');
			} else {
				await replaceRange(start, cursor, '@');
				menu = { kind: 'mention', start, types: 'types' in c ? c.types : null };
				active = 0;
			}
			return;
		}
		if (menu?.kind !== 'mention') return;
		const start = menu.start;
		const m =
			item.kind === 'mention'
				? { type: item.option.type, id: item.option.id, label: item.option.label }
				: { type: 'artifact' as const, id: '', label: item.label };
		mentions = [...mentions.filter((x) => !(x.type === m.type && x.id === m.id && x.label === m.label)), m];
		menu = null;
		await replaceRange(start, cursor, `@${m.label} `);
	}

	function onkeydown(e: KeyboardEvent) {
		if (menu && items.length) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				active = (active + 1) % items.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				active = (active - 1 + items.length) % items.length;
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				void choose(items[active]!);
				return;
			}
		}
		if (e.key === 'Escape' && menu) {
			e.preventDefault();
			menu = null;
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey && !menu) {
			e.preventDefault();
			if (text.trim()) form?.requestSubmit();
		}
	}

	const typeLabel = $derived(
		type === 'promise' ? 'Promise' : type === 'issue' ? 'Suspected issue (auditor only)' : null
	);
</script>

<form
	method="POST"
	action="?/note"
	class="au-composer"
	bind:this={form}
	use:enhance={() =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				text = '';
				type = 'note';
				mentions = [];
				menu = null;
				field?.focus();
			}
		}}
>
	<input type="hidden" name="type" value={type} />
	<input type="hidden" name="mentions" value={JSON.stringify(mentions)} />
	<div class="au-field">
		<label for="note-text">Note</label>
		{#if typeLabel}
			<span class="au-row">
				<span
					class="au-badge {type === 'issue' ? 'au-badge--danger' : 'au-badge--warn'}"
					data-testid="note-type">{typeLabel}</span
				>
				<button
					class="au-btn au-btn--small au-btn--ghost"
					type="button"
					onclick={() => (type = 'note')}
					aria-label="Make it a plain note">Plain note</button
				>
			</span>
		{/if}
		<textarea
			id="note-text"
			name="text"
			rows="2"
			bind:this={field}
			bind:value={text}
			{oninput}
			{onkeydown}
			onclick={sync}
			onkeyup={(e) => {
				if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) sync();
			}}
			placeholder="Type / for commands, @ to mention"
			role="combobox"
			aria-expanded={!!menu && items.length > 0}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={menu && items.length ? `${listId}-${active}` : undefined}
			aria-invalid={error ? 'true' : undefined}></textarea>
		{#if error}<span class="au-field__error">{error}</span>{/if}
	</div>
	{#if menu && items.length}
		<ul
			class="au-picker au-menu"
			id={listId}
			role="listbox"
			aria-label={menu.kind === 'command' ? 'Commands' : 'Mentions'}
		>
			{#each items as item, i (i)}
				<li role="option" id="{listId}-{i}" aria-selected={i === active}>
					<button
						type="button"
						class="au-picker__opt"
						class:au-picker__opt--active={i === active}
						tabindex="-1"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => choose(item)}
					>
						{#if item.kind === 'command'}
							<strong>/{item.key}</strong> <span class="au-muted">{item.hint}</span>
						{:else if item.kind === 'mention'}
							<strong>{item.option.label}</strong>
							<span class="au-muted"
								>{TYPE_LABEL[item.option.type]}{item.option.hint &&
								item.option.hint !== TYPE_LABEL[item.option.type]
									? ` · ${item.option.hint}`
									: ''}</span
							>
						{:else}
							<strong>+ New document “{item.label}”</strong>
							<span class="au-muted">recorded as mentioned, not received</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if mentions.length}
		<p class="au-muted">Mentions: {mentions.map((m) => m.label).join(', ')}</p>
	{/if}
	<div class="au-row">
		<button class="au-btn au-btn--primary" type="submit" disabled={!text.trim()}>Save note</button>
		<span class="au-muted">Enter saves</span>
	</div>
</form>
