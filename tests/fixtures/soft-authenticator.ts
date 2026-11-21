import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A passkey authenticator in software, for unit tests: it answers WebAuthn requests the way a
 * device would (ES256 key, user verified, no attestation), so the real verification code runs.
 */
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export class SoftAuthenticator {
	readonly credentialId = randomBytes(16);
	private readonly privateKey: KeyObject;
	private readonly cosePublicKey: Uint8Array;
	private userHandle: string | null = null;
	counter = 0;

	constructor() {
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		this.privateKey = privateKey;
		const jwk = publicKey.export({ format: 'jwk' });
		// COSE_Key: EC2, ES256, P-256, x, y.
		this.cosePublicKey = isoCBOR.encode(
			new Map<number, number | Uint8Array>([
				[1, 2],
				[3, -7],
				[-1, 1],
				[-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
				[-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))]
			])
		);
	}

	get id(): string {
		return b64(this.credentialId);
	}

	private authData(rpId: string, flags: number, attested: boolean): Buffer {
		const counter = Buffer.alloc(4);
		counter.writeUInt32BE(this.counter);
		const parts = [sha256(rpId), Buffer.from([flags]), counter];
		if (attested) {
			const length = Buffer.alloc(2);
			length.writeUInt16BE(this.credentialId.length);
			parts.push(Buffer.alloc(16), length, this.credentialId, Buffer.from(this.cosePublicKey));
		}
		return Buffer.concat(parts);
	}

	/** Answer navigator.credentials.create(). `verified: false` is a device that did not check the person. */
	register(
		options: PublicKeyCredentialCreationOptionsJSON,
		origin: string,
		opts: { verified?: boolean } = {}
	): RegistrationResponseJSON {
		this.userHandle = options.user.id;
		const clientDataJSON = Buffer.from(
			JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false })
		);
		// User present, user verified (unless told otherwise), attested credential data included.
		const flags = 0x01 | (opts.verified === false ? 0 : 0x04) | 0x40;
		const attestationObject = isoCBOR.encode(
			new Map<string, string | Uint8Array | Map<string, never>>([
				['fmt', 'none'],
				['attStmt', new Map<string, never>()],
				['authData', new Uint8Array(this.authData(options.rp.id!, flags, true))]
			])
		);
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key',
			response: {
				clientDataJSON: b64(clientDataJSON),
				attestationObject: b64(attestationObject),
				transports: ['internal']
			},
			clientExtensionResults: {},
			authenticatorAttachment: 'platform'
		};
	}

	/** Answer navigator.credentials.get(). */
	signIn(
		options: PublicKeyCredentialRequestOptionsJSON,
		origin: string,
		opts: { rpId?: string; verified?: boolean } = {}
	): AuthenticationResponseJSON {
		this.counter++;
		const clientDataJSON = Buffer.from(
			JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false })
		);
		const authData = this.authData(
			opts.rpId ?? options.rpId!,
			0x01 | (opts.verified === false ? 0 : 0x04),
			false
		);
		const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key',
			response: {
				clientDataJSON: b64(clientDataJSON),
				authenticatorData: b64(authData),
				signature: b64(signature),
				userHandle: this.userHandle ?? undefined
			},
			clientExtensionResults: {},
			authenticatorAttachment: 'platform'
		};
	}
}
