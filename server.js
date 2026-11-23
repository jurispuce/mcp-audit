// Production entry point: `node server.js` (the Docker image runs this).
//
// adapter-node assumes https when neither ORIGIN nor PROTOCOL_HEADER is set. This app is often reached
// over plain http on a private network, by IP or by name, so instead:
// - if ORIGIN is set, it is used as is;
// - otherwise the protocol comes from X-Forwarded-Proto (a TLS proxy sets it), and a request without
//   the header is treated as http, which is what the container itself speaks.
// Empty settings in .env (for example `ORIGIN=`) count as unset.
import http from 'node:http';
import { prepareEnv } from './server-env.js';

const { useForwardedProto } = prepareEnv(process.env);

// A variable path keeps the type checker out of the generated build folder.
const entry = './build/handler.js';
/** @type {{ handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void }} */
const { handler } = await import(entry);

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const server = http.createServer((req, res) => {
	if (useForwardedProto && !req.headers['x-forwarded-proto']) req.headers['x-forwarded-proto'] = 'http';
	// Static files are served before the app's own code sees the request. They get the strictest
	// policy here; pages and API answers replace it with their own (src/hooks.server.ts, #99).
	res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
	res.setHeader('x-content-type-options', 'nosniff');
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

// Proxies in front (cloudflared, Caddy) reuse idle connections to the app for longer than Node's
// default 5 s. If Node closes one just as the proxy sends on it, the proxy answers 502 with
// "connection reset by peer". Keep idle connections open longer than the proxies do.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

server.listen(port, host, () => console.log(`Listening on http://${host}:${port}`));

function shutdown() {
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
