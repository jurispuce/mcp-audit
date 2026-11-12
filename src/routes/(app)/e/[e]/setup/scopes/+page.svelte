<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '#lib/components/Field.svelte';
	import FormMessage from '#lib/components/FormMessage.svelte';
	import ItemCard from '#lib/components/ItemCard.svelte';

	let { data, form } = $props();
	type Result = {
		message?: string;
		success?: string;
		fields?: Record<string, string>;
		values?: Record<string, string>;
		confirmRemove?: { id: string; units: number; name: string };
	};
	const result = $derived((form ?? null) as Result | null);
	const multiple = $derived(data.engagement.scopeMode === 'multiple');
	let renaming = $state<string | null>(null);
	const keep =
		() =>
		async ({
			update,
			result: r
		}: {
			update: (o?: { reset?: boolean }) => Promise<void>;
			result: { type: string };
		}) => {
			await update({ reset: r.type === 'success' });
			if (r.type === 'success') renaming = null;
		};
</script>

<svelte:head><title>Scopes · Set-up · mcp-audit</title></svelte:head>

<FormMessage form={result} />

<section class="au-section" aria-labelledby="mode-title">
	<h2 class="au-section__title" id="mode-title">Scope handling</h2>
	<form method="POST" action="?/mode" class="au-stack" use:enhance={keep}>
		<input type="hidden" name="base_version" value={data.engagement.version} />
		<fieldset class="au-stack">
			<legend class="au-visually-hidden">Scope handling</legend>
			<label class="au-check-row"
				><input
					type="radio"
					name="mode"
					value="single"
					checked={!multiple}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/> Single scope: one finding per requirement</label
			>
			<label class="au-check-row"
				><input
					type="radio"
					name="mode"
					value="multiple"
					checked={multiple}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/> Multiple scopes: a requirement can get a finding per scope</label
			>
		</fieldset>
		<button class="au-visually-hidden" type="submit">Save scope handling</button>
	</form>
	<p data-testid="units-count">
		<strong>{data.units}</strong> assessment {data.units === 1 ? 'unit' : 'units'} result from the selection{multiple
			? ' and the scopes'
			: ''}.
	</p>
</section>

<section class="au-section" aria-labelledby="scopes-title">
	<h2 class="au-section__title" id="scopes-title">{multiple ? 'Scopes' : 'Scope'}</h2>
	{#if result?.confirmRemove}
		{@const c = result.confirmRemove}
		{@const s = data.scopes.find((x) => x.id === c.id)}
		<div class="au-alert au-alert--warn" role="alert" data-testid="confirm-remove">
			<p class="au-alert__title">Remove {c.name}?</p>
			<p>
				It has {c.units} assessment {c.units === 1 ? 'unit' : 'units'}. Their findings stay in the history but
				leave the matrix.
			</p>
			<form method="POST" action="?/remove" class="au-row" use:enhance={keep}>
				<input type="hidden" name="id" value={c.id} />
				<input type="hidden" name="base_version" value={s?.version ?? 0} />
				<input type="hidden" name="confirm" value="yes" />
				<button class="au-btn au-btn--danger" type="submit">Remove scope</button>
				<a class="au-btn au-btn--ghost" href="?">Keep it</a>
			</form>
		</div>
	{/if}
	<ul class="au-list" aria-label="Scopes">
		{#each data.scopes as s (s.id)}
			<li>
				<ItemCard
					ref="{s.units} assessment {s.units === 1 ? 'unit' : 'units'}"
					title={s.name}
					href="?item=scope:{s.id}"
					body={s.description}
					version={s.version}
					testid="scope-{s.name}"
				>
					{#snippet actions()}
						{#if renaming === s.id}
							<form method="POST" action="?/rename" class="au-row" use:enhance={keep}>
								<input type="hidden" name="id" value={s.id} />
								<input type="hidden" name="base_version" value={s.version} />
								<Field label="Name" name="name" id="rename-{s.id}" value={s.name} required />
								<button class="au-btn au-btn--primary au-btn--small" type="submit">Save name</button>
								<button
									class="au-btn au-btn--ghost au-btn--small"
									type="button"
									onclick={() => (renaming = null)}>Cancel</button
								>
							</form>
						{:else}
							<button class="au-btn au-btn--small" type="button" onclick={() => (renaming = s.id)}
								>Rename</button
							>
							{#if data.scopes.length > 1}
								<form method="POST" action="?/remove" use:enhance={keep}>
									<input type="hidden" name="id" value={s.id} />
									<input type="hidden" name="name" value={s.name} />
									<input type="hidden" name="base_version" value={s.version} />
									<button
										class="au-btn au-btn--small au-btn--ghost"
										type="submit"
										aria-label="Remove {s.name}">Remove</button
									>
								</form>
							{/if}
						{/if}
					{/snippet}
				</ItemCard>
			</li>
		{/each}
	</ul>
	{#if multiple}
		{@const v = result?.values?.action === 'add' ? result.values : {}}
		<form method="POST" action="?/add" class="au-form au-item" use:enhance={keep}>
			<h3 class="au-section__title">Add scope</h3>
			<Field
				label="Scope name"
				name="name"
				required
				value={v.name ?? ''}
				error={result?.values?.action === 'add' ? result?.fields?.name : undefined}
				placeholder="Warehouse"
			/>
			<Field label="Description (optional)" name="description" value={v.description ?? ''} />
			<div class="au-row"><button class="au-btn au-btn--primary" type="submit">Add scope</button></div>
		</form>
	{/if}
</section>
