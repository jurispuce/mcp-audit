Buttons trigger one action; each screen has at most one primary button.

- `au-btn au-btn--primary`: the next step in the flow (Mark agreed, Approve finding). One per screen.
- `au-btn`: every other action (Edit, Export plan).
- `au-btn au-btn--ghost`: low-weight actions in rows and sheets (View history).
- `au-btn au-btn--danger`: delete and revert. Always followed by a confirmation.
- `au-btn au-btn--ai`: starts an AI action. Dashed border in `ai`, so an auditor always knows the result will be a proposal.
- Add `au-btn--small` only on desktop tables. On a phone every button keeps `touch-target` height.

You provide the label: a verb and its object, sentence case, no full stop.
