ItemSheet is the detail view of any item, with the same four tabs everywhere: Details, Links, Comments, History.

- **Desktop:** a panel `sheet-width` wide that slides in from the right over the list. The list stays visible so the auditor keeps their place.
- **Phone:** full screen, with a back arrow top left.
- **Details:** the item's fields, editable in place. Saving creates a new version.
- **Links:** what this item is connected to (requirements, evidence, artifacts, risks), grouped by type. Each row is an ItemCard reference line that opens that item's sheet.
- **Comments:** append-only discussion, newest last, with one input at the bottom.
- **History:** every version, newest first, with author, time, channel (UI, MCP, in-app AI) and the fields that changed. Removed values use `au-diff-del`, new values `au-diff-ins`. Revert sits on every row except the current one and asks for confirmation; it creates a new version.

Tabs show a count when there is something in them. The sheet never nests: opening a linked item replaces the sheet content and adds a back arrow.
