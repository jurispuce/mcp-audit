AppShell is the frame around every screen: a navigation rail on desktop, a top bar and bottom bar on a phone, with the same five destinations in the same order.

The five destinations follow the audit flow left to right: **Home, Set-up, Plan, Run, Findings**. Full rules are in the Navigation section of this system.

- **Desktop** (`au-rail`, `nav-rail` wide): engagement switcher on top, the five destinations, a divider, then Library and Settings, which are not tied to one engagement.
- **Phone** (`au-topbar` + `au-bottombar`): the top bar shows the engagement name (tap to switch) and the proposals badge; the bottom bar holds the five destinations at `bottom-bar` height. Library and Settings move into the engagement switcher screen.
- The current destination uses `aria-current="page"`: `accent` text on `accent-soft` in the rail, `accent` icon and label in the bottom bar.
- A count on a destination means "needs you": events today on Run, findings awaiting approval on Findings.

Switch from rail to bottom bar below 768px width.
