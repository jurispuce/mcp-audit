Badges show the state of an item with an icon and words, never colour alone.

Finding values (the default scale):

| Finding | Class | Icon |
| --- | --- | --- |
| No reasonable assurance | `au-badge` | ring |
| Conformity | `au-badge au-badge--ok` | check |
| Conformity with positive note | `au-badge au-badge--ok` | plus |
| Conformity with auditor note | `au-badge au-badge--info` | note |
| Minor non-conformity | `au-badge au-badge--warn` | triangle |
| Major non-conformity | `au-badge au-badge--danger` | octagon |

Workflow states: Draft (`au-badge`), Proposed by AI (`au-badge--ai`, dashed), Approved (`au-badge--ok` with lock), Promised (`au-badge--warn` with clock), Missing (`au-badge--danger`).

A custom finding scale maps each value to one of the five tones. Text is sentence case. One state badge per item; a second badge is allowed only for "Proposed by AI".
