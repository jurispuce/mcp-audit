# Handoff package for jurispuce/mcp-audit

Everything produced during design: decisions, data model, design system, a clickable prototype, seven audit skills and 56 issues in build order.

## Contents

```
CLAUDE.md                 project context and rules for Claude Code
docs/                     architecture, data model, screens, MCP tools, build phases
design/                   tokens (JSON and CSS), component CSS, component guidelines, navigation and routes
prototype/                the clickable prototype (one HTML file)
skills/                   seven audit skills, unpacked
issues/                   56 issues as Markdown, one per file, plus an index
scripts/create_issues.py  creates labels, milestones and issues with the GitHub CLI
```

> Done on 12 November 2026: the package is committed and the issues exist in GitHub as linked sub-issues of milestone epics (roadmap: issue #1, mapping in `docs/build-plan.md`). The steps below are kept for reference.

## Getting it into the repository

1. Clone the repository and copy the contents of this folder into it. If the repository already has a `README.md` or `CLAUDE.md`, keep yours and merge by hand.

   ```
   git clone https://github.com/jurispuce/mcp-audit.git
   cp -R mcp-audit-handoff/. mcp-audit/
   cd mcp-audit
   ```

2. Commit and push.

   ```
   git add .
   git commit -m "Add design handoff: docs, design system, prototype, skills, issues"
   git push
   ```

3. Create the issues. This needs the GitHub CLI, logged in (`gh auth login`).

   ```
   python3 scripts/create_issues.py --dry-run
   python3 scripts/create_issues.py
   ```

   The script is safe to run twice: it skips issues whose title already exists.

Or open Claude Code in the repository and say: "Read HANDOFF.md, commit the handoff files, and run the issue script."

## Starting development

In Claude Code: "Read CLAUDE.md, then start on issue 1." Work through milestone 1 in order. After milestone 6, run one real engagement before starting milestone 7.

## What is not in this package

- No application code. The prototype is a behaviour reference only.
- No branded report templates; the skills carry plain Markdown templates.
- No requirement library content beyond what the prototype samples. Issue 15 covers importing NIS 2.
- The skills have not been run on real audit material yet.
