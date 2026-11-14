# Guide structure (assets/guides)

The guides under `assets/guides/` are read through the `guides.*` tree (ai-vision), the About guide
browser, F1 context help, and the `persephone://guides/*` MCP resources. A page is read as one
string and the default read length is 20,000 characters, so a longer page is cut off silently.
These rules keep every page readable in one read. `npm run guides:check`
(`scripts/guides-check.mjs`, `scripts/guides-check-entry.ts`) enforces them.

## Limits

- **Page ≤ 20,000 characters** (content after the front matter). Aim for 7–15 KB.
- **Hub ≤ 10,000 characters** — the `index.md` of a split folder listed in `HUB_FOLDERS` in
  `scripts/guides-check-entry.ts`. Add a folder there when you create a hub.
- Exempt pages are listed with a reason in `SIZE_EXEMPT` (the changelog `whats-new.md` and the
  lookup table `agents/languages-glossary.md`). Adding an exemption needs a stated reason.
- Every page has front matter with quoted `title`, `audience` (`user` | `agent` | `both`) and
  `summary`, written as a search target (what questions it answers). The parser
  (`src/shared/guides/front-matter.ts`) accepts only double-quoted values; unquoted values make the
  app fall back to the file name and an empty summary. `editorId` / `screen` stay on the page that
  documents that surface (usually the hub).

## Splitting a page

1. `X.md` becomes the folder `X/` with `X/index.md` as the hub. A file and a folder with the same
   stem must never coexist. Under `scripting/` and `scripting/api/`, which already have a router
   `index.md`, add sibling pages instead of a nested folder.
2. The hub carries what most tasks need (concepts, the common path, the most-used members) and a
   **"Read next"** table: one row per sub-page — what you need, the relative link, and the
   object-model path (for example ``guides.agents.boards["toolbar-and-footer"]``).
3. Sub-pages hold one theme each, 2–4 pages per source is usually right; many pages of a few
   hundred characters are worse than one 10 KB page (each is another read).
4. Move text verbatim; only fix links and promote headings. Keep headings (their anchors are
   linked from elsewhere) — after a move, repoint every `page.md#anchor` link to the page that now
   holds the heading. `guides:check` verifies relative `.md` links, not anchors.
5. Update path consumers: `src/main/mcp/manifest.ts` (resource `file` entries and server
   instructions), `src/renderer/editors/register-editors.ts` (editor `guidePath`),
   `AboutGuideBrowserView.ts`, the READMEs and skill files that name guide paths.

## The board authoring guide

`assets/guides/agents/boards/index.md` (the hub) is also the source of the `CLAUDE.md` written into
every new blank board (`src/renderer/api/boards/board-scaffold.ts`, with
`assets/board-template-header.md`). Spans between `<!-- board-template:exclude -->` markers are
removed from that copy, so keep links that only make sense inside Persephone (the "Read next" page
links) wrapped in the markers, with the `guides.agents.boards[...]` path left outside. The sub-pages
are read through `guides.agents.boards` and are not copied into boards.

## Checklist for guide edits

- `npm run guides:check` passes.
- New section goes on the page for its topic; a new page gets a hub "Read next" row and a `summary`.
- Check with `guides.search("<term>")` that the page is found.
