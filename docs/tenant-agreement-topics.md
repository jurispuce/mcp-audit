# What an agreement with a tenant needs to cover

A list of topics for a lawyer to turn into a contract and a data processing agreement. It is not legal text and takes no position on any of the points. Where the app or the host already does something specific, it is noted, so the agreement can describe what really happens. The facts are in `docs/hosting-tenants.md`.

## The parties and the service

- Who the operator is and who the tenant is; who may give instructions on the tenant's side (its admins).
- What is provided: one instance of mcp-audit for the tenant's own use, at its own address, with backups, upgrades and an AI budget.
- What is not provided: audit work, advice, or any assurance about the tenant's clients.
- Fees, the AI budget and what happens when it is used up (the AI buttons stop until the next period; everything else works).
- Term, renewal, and notice periods for ending the agreement by either side.

## Roles under data protection law

- The tenant's clients' data: the tenant decides why and how it is processed; the operator processes it on the tenant's instructions. Which of them is controller and which processor, and for which data.
- The tenant's own people (names, email addresses, sign-in records): the same question.
- The auditees' staff named in documents, notes and findings: whose responsibility it is to inform them.
- The subject matter, duration, nature and purpose of the processing, the kinds of personal data and the categories of people, as the law asks a processing agreement to state.

## Other companies that handle the data

Each needs naming, with what it does, where, and how the tenant is told of a change and may object:

- **Hosting:** whoever owns or houses the server, and its location.
- **Backups off the server:** where the copy is kept. The copy is encrypted before it leaves the server.
- **Cloudflare:** carries all traffic to the instance and sees it unencrypted at its edge; also keeps request logs and statistics. It is outside the EU in part, so transfers need covering.
- **The email service:** sends invitations, sign-in codes and security notices; sees addresses and message text, no audit content.
- **The AI model provider:** receives what an AI action reads of an engagement, when a person uses an AI button. Its terms on retention and on training with customer data need quoting.
- **The operator's AI gateway:** run by the operator on the same server; keeps amounts spent, not text.
- Not a sub-processor of the operator: the tenant's own Claude or ChatGPT connected through MCP, and a gateway or model the tenant sets up itself. The agreement should say that these are the tenant's own choice and responsibility.

## Where the data is and transfers outside the EU/EEA

- The country of the server and of the backup copy.
- Which of the companies above process data outside the EU/EEA, and on what basis.
- That a tenant can keep an engagement away from the model provider (AI off for that engagement, or its own model).

## Security

- What the operator does: one container, database and network per tenant; no shared secrets apart from the mail account; encrypted backups with a passphrase per tenant; upgrades with a backup first; the checks in `docs/hosting-tenants.md`, Threat model.
- What is accepted and should be said plainly: tenants share one server; the operator and Cloudflare are each technically able to read the data.
- What the tenant does: who it invites, the security of its people's devices and mailboxes (email is how a person gets back in), removing people who leave, what it uploads.
- Sign-in: passkeys, or a one-time code by email; no passwords are stored.

## What the operator may see and do

- Day to day: health, version, sizes, counts and dates; never content (`docs/hosting-tenants.md`, What the operator can and cannot see).
- Support inside the instance only when the tenant's admin invites a named person, visible in the instance's history.
- Opening the tenant's data from a backup or the disk: only on the tenant's written request or a legal obligation, with a record, and the tenant told afterwards unless the law forbids it.
- Confidentiality duties of the operator's people.

## Backups, availability and upgrades

- How often backups are made, how long they are kept, that a restore is tested monthly.
- What the operator promises about availability, and what it does not (a single server; planned upgrades show a short "being upgraded" page).
- How quickly a restore is done on request, and that a restore puts the whole instance back to the backup's state.

## Incidents

- How fast the operator tells the tenant of a breach affecting its data, through which contact, and with what information.
- How the tenant tells the operator of a lost device or a taken-over mailbox.
- Help with the tenant's own duties to notify authorities and people.

## The tenant's data at the end

- Export on request at any time, and a final export when the agreement ends: one encrypted file that opens in the tenant's own mcp-audit; the passphrase handed over separately.
- Deletion: the instance, its data and its AI key at once; backups after the retention period (30 days unless changed). What the operator keeps afterwards: a line that the tenant existed, with dates, and its own accounting records.
- Suspension for non-payment: the instance is stopped and its data kept; for how long before deletion.

## People's rights and audits

- How the operator helps with requests from people whose data is in the instance (access, correction, deletion). The tenant can do most of this itself in the app; deletion in the app is a flag, and history is kept, which the agreement should mention.
- The tenant's right to information and audit of the operator, and how it is exercised in practice.

## Liability and the rest

- Limits of liability, and for what there is none (the tenant's own audit conclusions; what the AI proposes and a person accepts).
- That AI output is a proposal for a professional to review, never a finding by itself.
- Intellectual property: the tenant's content is the tenant's; the library sources that ship with the app and their licences.
- Governing law and where disputes go.
- How the agreement and the list of other companies are changed.
