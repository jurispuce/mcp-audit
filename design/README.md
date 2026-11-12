# Audit App

A neutral, brandable design system for the audit planning and running app. It is built so an auditor can use the app one-handed in an interview and at a desk afterwards, and so every screen shows who wrote what, when, and whether a person has accepted it.

## Principles

1. **One pattern for every record.** Requirements, events, evidence, artifacts, risks and findings all use ItemCard and ItemSheet. Learn it once.
2. **State is words plus an icon.** Colour supports a state; it never carries it alone.
3. **AI work always looks different.** Anything written by AI and not yet accepted has a dashed `ai` border and reads "Claude on behalf of <user>".
4. **The trail is always one tap away.** Version, author and time sit on every card; History is a tab on every item.
5. **Phone first where the work is live.** The Event and Finding screens are designed for a thumb. Everything tappable is at least `touch-target` high.
6. **Quiet by default.** White and grey surfaces, borders instead of shadows, one accent colour.

## Rebranding

The system is neutral on purpose. To apply a brand, change these and nothing else:

| Change | Tokens |
| --- | --- |
| Brand colour | `accent`, `accent-ink`, `accent-soft` (light and dark values) |
| Typeface | `type.families.sans`, and `mono` if the brand has one |
| Corner style | `radius-md`, `radius-lg` |
| Logo | Place it above the engagement switcher in the rail, maximum 32px high |

Keep `accent-ink` on `accent` at 4.5:1 or better, and `accent` on `accent-soft` at 4.5:1 or better. Do not rebrand the status colours (`ok`, `warn`, `danger`, `ai`): they carry audit meaning.

There is no logo yet. Until there is one, the app name is set in plain type in the `heading` style.

## Colour

| Role | Tokens | Use |
| --- | --- | --- |
| Ground | `bg`, `surface`, `surface-sunken` | Page, cards, wells |
| Lines | `border`, `border-strong` | Hairlines; control borders |
| Text | `ink`, `ink-muted` | Content; metadata |
| Brand | `accent`, `accent-ink`, `accent-soft` | Primary action, links, selection, focus |
| Conformity | `ok`, `ok-soft` | Conformity findings, received evidence |
| Attention | `warn`, `warn-soft` | Minor non-conformity, partial or promised evidence |
| Problem | `danger`, `danger-soft` | Major non-conformity, missing evidence, destructive actions |
| AI | `ai`, `ai-soft` | Unreviewed AI proposals only |

Rules:

- Text in a status colour sits on its own `-soft` background or on `surface`. Never put `ok` text on `warn-soft`, and so on.
- All text pairs meet 4.5:1 in both themes. Control borders and icons meet 3:1.
- Criticality (high, medium, low) is shown with bars in `ink`, not with colour, so it cannot be confused with a finding.
- Light and dark themes use the same token names. Never write a hex value in a component.

## Typography

IBM Plex Sans for everything, IBM Plex Mono for reference codes, version numbers and hashes. Both are open-source, load from Google Fonts, and cover Latvian diacritics. If the fonts fail to load, the stacks fall back to the system fonts.

Seven text styles and one reference style are defined in the tokens. Use `display` once per desktop screen, `title` once per phone screen, `heading` for card titles, `body` for content, `small` for metadata, `label` for badges.

## Spacing, radius and size

Spacing runs on a 4px base: `space-1` (4) to `space-8` (32). Cards are padded `space-4` and separated by `space-6` on desktop, `space-3` on a phone. Corners: `radius-md` for controls, `radius-lg` for cards, `radius-full` for badges. Sizes that shape the layout (`touch-target`, `nav-rail`, `bottom-bar`, `content-max`, `sheet-width`) are tokens too.

## Iconography

Icons are outline, 2px stroke, round caps, on a 24px grid, drawn in the current text colour. The previews use simple inline shapes. For the build, use the open-source Lucide set, which matches this style; no icon files are bundled here.

Fixed meanings: check = conformity or received, plus = positive note, speech note = auditor note, triangle = minor non-conformity, octagon = major non-conformity or missing, ring = no assurance or draft, clock = promised, lock = approved, four-point spark = AI.

## Writing

- Sentence case everywhere, including buttons and badges.
- Buttons are a verb and its object: "Approve finding", "Export plan", "Mark agreed".
- Use the audit terms from the data model exactly: engagement, scope, requirement, event, evidence, artifact, finding, conclusion.
- Authorship reads "Name · 12 Nov 14:02". AI authorship reads "Claude on behalf of Name".
- The interface is in English. Content can be in any language and is never translated or re-cased by the interface.
- Empty states say what to do next in one sentence and offer one button.

## Components

| Component | Use it for |
| --- | --- |
| AppShell | The frame: rail on desktop, top and bottom bars on a phone |
| PhaseChecklist | The engagement home screen |
| ItemCard | Every record in every list |
| ItemSheet | The detail of any record: Details, Links, Comments, History |
| EvidenceRow | Planned evidence on the Event screen |
| Badge | Finding values and workflow states |
| Criticality | High, medium, low |
| Button | Actions, including the AI action style |
| ProposalBar | Unreviewed AI proposals on a screen |

## Using it in the app

Load `design/tokens.css`, then `design/components.css`. Fonts load from Google Fonts (IBM Plex Sans 400 and 600, IBM Plex Mono 400); self-host them if the app must work without internet access. Put class `au` on the app root. Set `data-theme="light"` or `data-theme="dark"` on the `html` element. Every component is plain HTML with `au-` classes, so it works in SvelteKit or any other framework without a component library.
