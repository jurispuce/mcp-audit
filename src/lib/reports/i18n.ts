/**
 * Report-language versions of the template lines and the words the app fills in. A language without
 * an entry falls back to English, and the screen says so. Content (titles, evidence, names) is never
 * translated: it is shown as the auditor wrote it.
 */

export interface PlanWords {
	status: Record<'draft' | 'sent' | 'agreed', string>;
	formats: Record<string, string>;
	noEndDate: string;
	noDate: string;
	toBeAgreed: string;
	firstVersion: string;
	purpose: (auditee: string, sources: string) => string;
	singleScope: (auditee: string) => string;
	allScopes: string;
	added: string;
	changed: string;
	removed: string;
	since: (date: string) => string;
	nothing: string;
	notCovered: string;
}

const EN: PlanWords = {
	status: { draft: 'draft', sent: 'sent for agreement', agreed: 'agreed' },
	formats: {
		interview: 'Interview',
		walkthrough: 'Walkthrough',
		document_review: 'Document review',
		technical_test: 'Technical test',
		site_visit: 'Site visit',
		other: 'Other'
	},
	noEndDate: 'end date to be agreed',
	noDate: 'date to be agreed',
	toBeAgreed: 'to be agreed',
	firstVersion: 'First version.',
	purpose: (a, s) => `This audit assesses how ${a} meets the selected requirements of ${s}.`,
	singleScope: (a) => `The audit covers ${a} as a whole.`,
	allScopes: 'All scopes',
	added: 'Added',
	changed: 'Changed',
	removed: 'Removed',
	since: (d) => `Compared with the version of ${d}:`,
	nothing: 'No changes to events since the previous version.',
	notCovered: 'not yet in any event'
};

const LV: PlanWords = {
	status: { draft: 'melnraksts', sent: 'nosūtīts saskaņošanai', agreed: 'saskaņots' },
	formats: {
		interview: 'Intervija',
		walkthrough: 'Procesa apskate',
		document_review: 'Dokumentu pārbaude',
		technical_test: 'Tehniskā pārbaude',
		site_visit: 'Apmeklējums uz vietas',
		other: 'Cits'
	},
	noEndDate: 'beigu datums jāsaskaņo',
	noDate: 'datums jāsaskaņo',
	toBeAgreed: 'jāvienojas',
	firstVersion: 'Pirmā versija.',
	purpose: (a, s) => `Audits novērtē, kā ${a} izpilda izvēlētās prasības: ${s}.`,
	singleScope: (a) => `Audits aptver ${a} kopumā.`,
	allScopes: 'Visi tvērumi',
	added: 'Pievienots',
	changed: 'Mainīts',
	removed: 'Izņemts',
	since: (d) => `Salīdzinājumā ar ${d} versiju:`,
	nothing: 'Kopš iepriekšējās versijas pasākumi nav mainīti.',
	notCovered: 'vēl nav iekļauta nevienā pasākumā'
};

/** audit-plan-template.md, line by line. */
const PLAN_LINES_LV: Record<string, string> = {
	'# Audit plan': '# Audita plāns',
	'**Engagement:** {{engagement name}}': '**Audits:** {{engagement name}}',
	'**Auditee:** {{auditee}}': '**Auditējamā organizācija:** {{auditee}}',
	'**Audit period:** {{start date}} to {{end date}}': '**Audita periods:** {{start date}} līdz {{end date}}',
	'**Auditors:** {{auditors}}': '**Auditori:** {{auditors}}',
	'**Plan version:** {{date}} ({{draft | sent for agreement | agreed}})':
		'**Plāna versija:** {{date}} ({{draft | sent for agreement | agreed}})',
	'## Purpose and basis': '## Mērķis un pamats',
	'Audit criteria: {{sources and the selected requirements, by reference}}':
		'Audita kritēriji: {{sources and the selected requirements, by reference}}',
	'## Scope': '## Tvērums',
	'## Schedule': '## Grafiks',
	'| Date | Time | Event | Format | Duration | Participants (roles) | Requirements covered |':
		'| Datums | Laiks | Pasākums | Formāts | Ilgums | Dalībnieki (lomas) | Aptvertās prasības |',
	'## What to prepare': '## Kas jāsagatavo',
	'For each event, the records and documents the auditors expect to see. Having them ready keeps each session within its planned time.':
		'Katram pasākumam: ieraksti un dokumenti, ko auditori vēlas redzēt. Ja tie ir sagatavoti iepriekš, katra tikšanās iekļaujas plānotajā laikā.',
	'## Practical arrangements': '## Praktiskā informācija',
	"- Sessions may be recorded for the auditors' notes only: {{yes / no / to be agreed}}":
		'- Tikšanās var ierakstīt tikai auditoru piezīmēm: {{yes / no / to be agreed}}',
	'- Documents can be sent in advance to: {{contact}}': '- Dokumentus iepriekš var nosūtīt: {{contact}}',
	'- Changes to dates or participants: please tell {{lead auditor}} as early as possible.':
		'- Par izmaiņām datumos vai dalībniekos, lūdzu, iespējami agrāk informējiet: {{lead auditor}}.',
	'## Changes since the previous version': '## Izmaiņas kopš iepriekšējās versijas'
};

export function planWords(language: string): {
	words: PlanWords;
	lines: Record<string, string>;
	translated: boolean;
} {
	if (language === 'lv') return { words: LV, lines: PLAN_LINES_LV, translated: true };
	return { words: EN, lines: {}, translated: language === 'en' };
}
