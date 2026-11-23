// The tenant profile the end-to-end tests start an instance from (#91).
//   node e2e/tenant-profile.mjs <gateway address>     prints it as JSON, for CI to mount into a container
export const PROFILE_ADMIN = { name: 'Tia Tenant-Admin', email: 'tenant-admin@example.test' };
export const PROFILE_INSTANCE = 'Baltic Audit';
/** The operator token the profile instance is started with (#98). Test value only. */
export const OPERATOR_TOKEN = 'e2e-operator-token-0123456789abcdef0123456789';

/** @param {string} gateway The AI gateway's address, as the instance reaches it. */
export function tenantProfile(gateway) {
	return {
		instance_name: PROFILE_INSTANCE,
		sign_in_method: 'passkey',
		first_admin: PROFILE_ADMIN,
		library_sources: ['nis2'],
		ai: { base_url: gateway, api_key: 'sk-profile-test', default_model: 'fake-tools', web_search: true }
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	console.log(JSON.stringify(tenantProfile(process.argv[2] ?? 'http://127.0.0.1:4999'), null, '\t'));
}
