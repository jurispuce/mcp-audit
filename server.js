// Production entry point: `node server.js` (the Docker image runs this).
//
// adapter-node assumes https when neither ORIGIN nor PROTOCOL_HEADER is set. This app is often reached
// over plain http on a private network, by IP or by name, so instead:
// - if ORIGIN is set, it is used as is;
// - otherwise the protocol comes from X-Forwarded-Proto (a TLS proxy sets it), and a request without
//   the header is treated as http, which is what the container itself speaks.
import http from 'node:http';

const useForwardedProto = !process.env.ORIGIN && !process.env.PROTOCOL_HEADER;
if (useForwardedProto) process.env.PROTOCOL_HEADER = 'x-forwarded-proto';

const { handler } = await import('./build/handler.js');

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const server = http.createServer((req, res) => {
	if (useForwardedProto && !req.headers['x-forwarded-proto']) req.headers['x-forwarded-proto'] = 'http';
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

server.listen(port, host, () => console.log(`Listening on http://${host}:${port}`));

function shutdown() {
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
