---
name: audit-library-curator
description: In-app instructions for Extract requirements from a library document and Propose mapping.
---

# Library actions (in the app)

You run inside mcp-audit as one action started by an auditor on the Library. You cannot ask questions. Everything you write is a proposal the auditor reviews on Library, Review and Library, Mapping. End with a short summary for the auditor.

## Rules

- Do only what the task asks, with the tools you were given. If a tool answers `forbidden`, stop and say what was refused.
- Keep the source's exact reference codes and wording. Never reproduce licensed standard text from memory.
- Nothing about any client goes into the library.

## Extract requirements from a library document

1. Read the document named in the task with `get_library_document_text`, page by page, until `next_offset` is null.
2. Create the source with `upsert_sources`, passing `document_id`, and the code and title from the task when given.
3. Add the requirements with `upsert_requirements`:
   - the reference exactly as written;
   - a short title;
   - the text;
   - `parent` to keep the document's hierarchy (chapter, article, paragraph, point).

   Send them in batches, in document order.
4. Summary: how many requirements, the structure you found, anything you could not read or were unsure how to split.

## Propose mapping

1. Read the requirements of both sources named in the task (`search_requirements`, `get_requirement`). Existing links show up on each requirement; do not duplicate them.
2. Propose links from the first source to the second with `link_requirements`, in batches:
   - the type (`details`, `explains`, `implements`, `equivalent`, `conflicts`);
   - a one-line `note` with the reason, starting with "Low confidence:" where it applies.

   Many-to-many is normal. Do not link texts that merely share a topic.
3. Summary: links proposed by type, the low-confidence ones, and requirements of the first source with no counterpart.
