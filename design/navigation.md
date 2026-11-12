# Navigation

The app has five destinations inside an engagement, in the order the audit runs: Home, Set-up, Plan, Run, Findings. Nothing is more than two levels below a destination.

## Structure

| Level | What | Where it shows |
| --- | --- | --- |
| 0 | Engagements list, Library, Settings | Engagement switcher; rail footer on desktop |
| 1 | Five destinations of the open engagement | Rail on desktop, bottom bar on a phone |
| 2 | Tabs inside a destination | Tab row under the screen title |
| Item | Any record, opened as an ItemSheet | Right-hand panel on desktop, full screen on a phone |

## Destinations and the eight phases

| Destination | Phases it covers | Tabs | Primary action |
| --- | --- | --- | --- |
| Home | 1 Define the engagement | none | Continue to the next open phase |
| Set-up | 2 Select requirements, 3 Understand the auditee, 4 Set scope handling, 5 Extract internal requirements | Requirements, Scopes, Auditee, Risks, Documents | Depends on tab: Select, Add scope, Add person, Add risk, Upload |
| Plan | 6 Plan events | Events, Coverage, Audit plan | Add event; Export plan |
| Run | 7 Run events | Today, All events, Inbox | Add note or photo |
| Findings | 8 Conclude | Matrix, To approve, Conclusions | Approve |

Notes on the tabs:

- **Set-up, Requirements** shows external and internal requirements in one tree, with a filter for origin. Internal requirements appear once documents are analysed.
- **Run, Inbox** holds artifacts that are not yet linked to planned evidence, including transcripts that arrived through MCP.
- **Findings, Matrix** is requirements by scope. On a phone it becomes a list grouped by requirement, one row per scope.

## Routes

Copy these as the route table. `:e` is the engagement id.

```
/                              Engagements list
/library                       Sources and requirements library
/settings                      Users, models, templates
/e/:e                          Home (phase checklist)
/e/:e/setup/requirements       Selection, scope handling per requirement
/e/:e/setup/scopes
/e/:e/setup/auditee            Description and people
/e/:e/setup/risks
/e/:e/setup/documents          Uploads and extraction
/e/:e/plan/events              Events, AI drafts, planned evidence per event
/e/:e/plan/coverage            Requirements by the events that cover them
/e/:e/plan/document            Audit plan preview and export
/e/:e/run/today
/e/:e/run/events
/e/:e/run/events/:event        Event screen: evidence rows and capture
/e/:e/run/inbox
/e/:e/findings/matrix
/e/:e/findings/to-approve
/e/:e/findings/conclusions
/e/:e/proposals                Review list for AI proposals
?item=<type>:<id>              Opens the ItemSheet over any screen
?item=<type>:<id>&tab=history  Opens it on a given tab
```

## Rules

1. **The five destinations never change.** They are visible on every engagement screen, in the same order, on both layouts.
2. **Home always answers "what next".** It shows the eight phases and one button for the next open step.
3. **Lists open sheets, not pages.** Opening an item keeps the list in place. Closing the sheet returns to the same scroll position.
4. **One back step.** On a phone, back closes the sheet, then leaves the tab. A linked item opened from a sheet replaces the sheet content and shows a back arrow.
5. **Counts mean "needs you".** Run shows events today; Findings shows findings waiting for approval; the proposals badge in the top bar shows unreviewed AI proposals.
6. **Switching engagement keeps the destination.** Changing engagement on the Findings screen lands on Findings in the other engagement.
7. **Capture is always reachable on Run.** On a phone the Event screen has a fixed "Add note or photo" button above the bottom bar.
8. **Search is global.** One search field in the top bar finds requirements by code or text, events, artifacts and findings, and opens the result as a sheet.

## Layouts

- **Desktop, 768px and wider:** rail (`nav-rail`) on the left, content column up to `content-max`, sheet (`sheet-width`) on the right.
- **Phone, under 768px:** top bar with engagement name and proposals badge, content, bottom bar (`bottom-bar`). Tabs scroll sideways if they do not fit.
