ItemCard is the one pattern for every record in the app: requirement, event, evidence item, artifact, risk and finding all use it.

Every card shows the same five things in the same places, so an auditor learns it once:

1. **Reference line** (`au-ref`): the code and scope, for example "A.5.15 · Head office".
2. **Title** and one **state badge**, top right.
3. **Body**: one or two lines of the item's own text.
4. **Meta row**: version number, who wrote this version and when, criticality, counts of evidence and comments.
5. **Actions**: at most one primary button, then ghost buttons.

Three states:

- Default: `au-item`.
- Proposed by AI: `au-item au-item--proposed`. Dashed `ai` border, author reads "Claude on behalf of <user>", actions are Accept, Edit, Reject.
- Approved and locked: `au-item au-item--locked`. No edit action; Reopen creates a new version.

Tapping a card opens the item sheet (see ItemSheet). You provide the reference, title, body, state and metadata.
