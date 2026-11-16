<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';

	let { data, form } = $props();
	type Result = { message?: string; success?: string; fields?: Record<string, string>; values?: Record<string, string> };
	const result = $derived((form ?? null) as Result | null);
	const s = $derived(data.skill);
	const href = (set: string, skill?: string) => `?set=${set}${skill ? `&skill=${skill}` : ''}`;
	let comparing = $state(false);
	// The editor starts from the skill as it is now, or from the text of a failed save; typing overrides it.
	let body = $derived(result?.values?.body ?? s?.body ?? '');
	const dirty = $derived(!!s && body !== s.body);
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
		await update({ reset: false });
	};
</script>

<svelte:head><title>Skills · Settings · mcp-audit</title></svelte:head>

<section class="au-section" aria-labelledby="skills-title">
	<h2 class="au-section__title" id="skills-title">Skills</h2>
	<p class="au-muted">
		Skills are the instructions the AI follows. <strong>For your Claude</strong>: the skills an auditor installs in
		their own Claude (claude.ai, Claude Desktop or Claude Code) next to the mcp-audit connector; it asks before
		it drafts and can research online. <strong>In the app</strong>: what the AI buttons follow, in one run with
		the inputs from the screen. Edits apply to everyone on this instance{data.canEdit
			? ''
			: '; only an admin can change them'}.
	</p>

	<nav class="au-tabbar" aria-label="Skill set">
		{#each data.sets as [key, label] (key)}
			<a href={href(key, s?.name)} aria-current={data.set === key ? 'page' : undefined} data-sveltekit-noscroll
				>{label}</a
			>
		{/each}
	</nav>

	{#if data.set === 'connector' && !s}
		<div class="au-item" data-testid="install-skills">
			<p>
				<strong>Install in your Claude.</strong> Download the skills and add them in claude.ai or Claude Desktop
				(Settings, Capabilities, Skills: upload each skill's .zip), or unzip them into a Claude Code project's
				<code>.claude/skills</code> folder. Connect mcp-audit as a connector too: <code>{data.mcpUrl}</code>.
				The connector also offers each skill as a prompt, always the version saved here.
			</p>
			<div class="au-row">
				<a class="au-btn au-btn--primary" href="/settings/skills/download" download>Download all skills</a>
			</div>
		</div>
	{/if}

	{#if !s}
		<ul class="au-list" aria-label="Skills">
			{#each data.skills as k (k.name)}
				<li>
					<ItemCard
						title={k.name}
						href={href(data.set, k.name)}
						body={k.description}
						badge={k.newerDefault
							? { label: 'Edited · newer default available', tone: 'warn' }
							: k.edited
								? { label: 'Edited here', tone: 'info' }
								: { label: 'Default', tone: 'neutral' }}
						testid="skill-{k.name}"
					>
						{#snippet actions()}
							<a class="au-btn au-btn--small" href={href(data.set, k.name)} aria-label="Open {k.name}"
								>{data.canEdit ? 'Edit' : 'Read'}</a
							>
							{#if data.set === 'connector'}<a
									class="au-btn au-btn--small au-btn--ghost"
									href="/settings/skills/download?skill={k.name}"
									download
									aria-label="Download {k.name}">Download</a
								>{/if}
						{/snippet}
					</ItemCard>
				</li>
			{/each}
		</ul>
	{:else}
		<p><a href={href(data.set)}>All skills</a></p>
		<FormMessage form={result} />
		<div class="au-row au-between au-wrap">
			<h3 class="au-section__title">{s.name}</h3>
			<span class="au-row au-wrap">
				{#if s.newerDefault}<span class="au-badge au-badge--warn">Newer default available</span>
				{:else if s.edited}<span class="au-badge au-badge--info">Edited here</span>
				{:else}<span class="au-badge">Default</span>{/if}
				{#if s.id}<a class="au-btn au-btn--small au-btn--ghost" href="?set={s.set}&skill={s.name}&item=skill_override:{s.id}" data-sveltekit-reset="false"
						>History</a
					>{/if}
				{#if s.edited}<button class="au-btn au-btn--small au-btn--ghost" type="button" onclick={() => (comparing = !comparing)}
						>{comparing ? 'Hide default' : 'Compare with default'}</button
					>{/if}
				{#if s.set === 'connector'}<a
						class="au-btn au-btn--small au-btn--ghost"
						href="/settings/skills/download?skill={s.name}"
						download>Download</a
					>{/if}
			</span>
		</div>
		{#if s.newerDefault}
			<p class="au-alert au-alert--info">
				A newer version of this skill came with an update of the app. Compare it with your edit, then copy what you
				want to keep, or reset to the new default.
			</p>
		{/if}
		<div class="au-row au-wrap au-skill-edit" class:au-skill-edit--compare={comparing}>
			<form method="POST" action="?set={s.set}&skill={s.name}&/save" class="au-form au-grow" use:enhance={keep}>
				<input type="hidden" name="base_version" value={s.version ?? ''} />
				<div class="au-field" data-invalid={result?.fields?.body ? '' : undefined}>
					<label for="skill-body">{s.edited ? 'Instructions (edited here)' : 'Instructions (default)'}</label>
					<textarea
						id="skill-body"
						name="body"
						rows="28"
						class="au-mono"
						bind:value={body}
						readonly={!data.canEdit}
					></textarea>
					{#if result?.fields?.body}<span class="au-field__error">{result.message}</span>{/if}
				</div>
				{#if data.canEdit}
					<div class="au-row au-wrap">
						<button class="au-btn au-btn--primary" type="submit" disabled={!dirty}>Save for everyone</button>
						{#if dirty}<button class="au-btn au-btn--ghost" type="button" onclick={() => (body = s.body)}
								>Discard changes</button
							>{/if}
					</div>
				{/if}
			</form>
			{#if comparing}
				<div class="au-field au-grow">
					<label for="skill-default">Default shipped with the app</label>
					<textarea id="skill-default" rows="28" class="au-mono" readonly value={s.defaultBody}></textarea>
				</div>
			{/if}
		</div>
		{#if data.canEdit && s.edited}
			<form
				method="POST"
				action="?set={s.set}&skill={s.name}&/reset"
				use:enhance={({ cancel }) => {
					if (!confirm(`Reset ${s.name} to the default? Your edit stays in its history.`)) return cancel();
					return keep();
				}}
			>
				<button class="au-btn au-btn--ghost" type="submit">Reset to default</button>
			</form>
		{/if}
	{/if}
</section>
