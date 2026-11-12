<script lang="ts">
	import Field from './Field.svelte';

	/** Role fields: role required; name, unit, email and responsibilities optional. */
	interface Props {
		prefix: string;
		values: Record<string, string>;
		fields?: Record<string, string>;
	}
	let { prefix, values, fields = {} }: Props = $props();
</script>

<Field
	label="Role"
	name="role"
	id="{prefix}-role"
	required
	value={values.role ?? ''}
	error={fields.role}
	placeholder="Head of IT"
/>
<Field label="Name (optional)" name="name" id="{prefix}-name" value={values.name ?? ''} error={fields.name} />
<Field label="Unit (optional)" name="unit" id="{prefix}-unit" value={values.unit ?? ''} error={fields.unit} />
<Field
	label="Email (optional)"
	name="email"
	id="{prefix}-email"
	type="email"
	value={values.email ?? ''}
	error={fields.email}
/>
<div class="au-field">
	<label for="{prefix}-resp">Responsibilities (optional, one per line)</label>
	<textarea id="{prefix}-resp" name="responsibilities" rows="2" defaultValue={values.responsibilities ?? ''}
	></textarea>
</div>
