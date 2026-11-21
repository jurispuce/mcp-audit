// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- an untyped JavaScript test double
// @ts-nocheck: a plain JavaScript test double; its callers are typed.
// A scripted stand-in for a mail server (#86), as fake-llm.mjs is for the AI gateway. It accepts
// mail over SMTP and keeps it in memory; tests read it back over HTTP:
//   GET    /messages[?to=<address>]   newest last: { to, from, subject, text, html, kind }
//   DELETE /messages                  forget everything
// An address ending in @refused.test is refused, to test what the app does when a send fails.
//   SMTP_PORT=2525 HTTP_PORT=2526 node e2e/fake-smtp.mjs
import http from 'node:http';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

/** Start the sink. Port 0 picks a free port; the result says which. */
export async function startFakeSmtp({ smtpPort = 0, httpPort = null, host = '127.0.0.1' } = {}) {
	const messages = [];
	const smtp = new SMTPServer({
		authOptional: true,
		disabledCommands: ['STARTTLS'],
		logger: false,
		onRcptTo(address, _session, done) {
			if (address.address.toLowerCase().endsWith('@refused.test')) {
				const err = new Error('5.1.1 No such mailbox here');
				err.responseCode = 550;
				return done(err);
			}
			done();
		},
		onData(stream, session, done) {
			simpleParser(stream)
				.then((mail) => {
					for (const rcpt of session.envelope.rcptTo)
						messages.push({
							to: rcpt.address.toLowerCase(),
							from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
							subject: mail.subject ?? '',
							text: mail.text ?? '',
							html: typeof mail.html === 'string' ? mail.html : '',
							kind: mail.headers.get('x-mcp-audit-kind') ?? null
						});
					done();
				})
				.catch(done);
		}
	});
	await new Promise((resolve, reject) => {
		smtp.once('error', reject);
		smtp.listen(smtpPort, host, resolve);
	});
	let web = null;
	if (httpPort !== null) {
		web = http.createServer((req, res) => {
			const url = new URL(req.url ?? '/', 'http://x');
			if (url.pathname !== '/messages') {
				res.writeHead(404).end();
				return;
			}
			if (req.method === 'DELETE') messages.length = 0;
			const to = url.searchParams.get('to')?.toLowerCase();
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(to ? messages.filter((m) => m.to === to) : messages));
		});
		await new Promise((resolve) => web.listen(httpPort, host, resolve));
	}
	return {
		messages,
		smtpPort: smtp.server.address().port,
		httpPort: web ? web.address().port : null,
		close: () =>
			Promise.all([
				new Promise((resolve) => smtp.close(resolve)),
				web ? new Promise((resolve) => web.close(resolve)) : null
			])
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const sink = await startFakeSmtp({
		smtpPort: Number(process.env.SMTP_PORT ?? 2525),
		httpPort: Number(process.env.HTTP_PORT ?? 2526),
		// Containers reach it through the host gateway, so it listens on every interface.
		host: process.env.HOST ?? '0.0.0.0'
	});
	console.log(
		`fake mail server: SMTP on ${sink.smtpPort}, messages on http://127.0.0.1:${sink.httpPort}/messages`
	);
}
