---
name: userdoc
model: sonnet
context: fork
description: Reviews and updates user-facing documentation in /assets/guides/ after code changes. Use after implementation tasks to keep user guides current.
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# User Documentation Update

You are updating the user-facing guide corpus in `/assets/guides/` to reflect recent code changes in the Persephone project.

## Scope

This agent covers **user docs only** (the `/assets/guides/` corpus, which ships inside the app). Developer docs in `/doc/` are handled by the `/document` skill separately.

## Documentation structure

The `/assets/guides/` folder contains the shipped guide corpus. Pages carry front matter
(`title`, `audience`, `summary`, and for a screen page `editorId` and/or `screen`);
`audience: agent` pages under `agents/` and `formats/` are agent-facing references and are not
this skill's business unless a user-visible feature they document changed.

**Derive the page list from the corpus, do not memorise it.** The tree changes every epic — EPIC-094
alone turned one 935-line editor catalogue into 21 per-editor pages and added eight `screens/`
pages — so a hand-written table here goes stale silently and sends you to edit a file that no longer
owns the topic. Instead:

```bash
# every user-facing page, with the screen it documents
grep -rl 'audience: \(user\|both\)' assets/guides --include='*.md'
```

The shape of the corpus, which is stable even as pages come and go:

| Area | Holds |
|------|-------|
| `index.md`, `getting-started.md`, `shortcuts.md`, `encryption.md`, `tabs-and-navigation.md`, `whats-new.md` | Top-level topics |
| `editors/index.md` + one page per editor | The editor a user is looking at; each declares its `editorId` |
| `screens/*` | Non-editor screens: header strip, Menu Bar, Settings, sidebar, tabs, dialogs, MCP Inspector |
| `boards.md`, `agent-tools.md`, `mneme.md`, `mcp-setup.md` | Feature topics that also own a screen `editorId` |
| `scripting/index.md`, `scripting/api/*` | Scripting guide and API reference |
| `agents/*`, `formats/*` | `audience: agent` references — out of scope unless the feature changed |

An editor or screen page is reached by `F1` and by `guides.<page>` through its `editorId`, which is
**unique across the corpus** and belongs to the user-facing page. If you add a page for a screen,
give it the `editorId`; never duplicate one onto a second page, or the mapping stops being a
function.


## How to work

1. Use `git diff` or `git log` to understand what changed recently
2. Identify which user-facing features were affected
3. Read the relevant docs and compare against the actual code
4. For API reference pages in `assets/guides/scripting/api/`, compare against the `.d.ts` type definitions in `src/renderer/api/types/`
5. Update only what's actually stale or missing
6. **When a screen's toolbar or controls changed, re-check that screen's `## Layout` schema and
   its `where` phrases.** This is a required step, not a judgement call: the schema is a hand-drawn
   map of where controls sit, and nothing in the build detects that it has gone stale. A moved,
   renamed, added or removed control invalidates three things that must agree — the diagram, the
   label-to-`elements` mapping under it, and the `where` phrase on the matching `elements` entry.

   How to re-check, which is the method EPIC-094 used to write them
   (`doc/tasks/US-1376-editor-layout-schemas/README.md`,
   `doc/tasks/US-1377-screen-layout-schemas/README.md`):

   - Open the screen in a running Persephone and enumerate its addressable controls, then diff that
     against the facade's `elements` list. Every difference is either a control that should gain an
     entry or a container that should not:

     ```js
     // in script.execute, with the screen visible
     [...document.querySelectorAll('[data-name]')]
         .filter(e => e.offsetParent !== null)
         .map(e => [e.getAttribute('data-name'), Math.round(e.getBoundingClientRect().left)])
         .sort((a, b) => a[1] - b[1])
     ```

   - Read the positions, not the source order: left-to-right x offsets are what the diagram encodes,
     and view code routinely reads differently from what renders. EPIC-094 drew the Menu Bar wrong
     twice from the views and got it right only by opening it and measuring.
   - Keep the diagram's rule: **a row is a region of the screen, not a control.** Controls sit side
     by side inside their row in true screen order, spacing carries left/middle/right grouping, and
     the right-margin comment describes the row. A control that only appears in a state belongs in a
     separately labelled state diagram.
   - Make the `where` phrase and the diagram's margin phrase say the same thing in the same words,
     and name the state for a state-only control. Spatial words only — no pixels.

7. Check if `assets/guides/whats-new.md` needs an entry for notable user-visible changes

## Writing style

- **Audience:** End users and scripters, not internal developers
- **Tone:** Clear, practical, concise
- **Format:** Show examples with code blocks where helpful
- **Links:** Cross-reference related pages with relative markdown links
- **No internals:** Don't mention internal implementation details (stores, models, ViewModels)

## Output

After making updates, provide a summary:
- Which docs were updated and why
- Which docs were checked and found to be current
- Note any docs that may need larger rewrites
