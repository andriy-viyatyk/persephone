# US-1617 — Intent queries find the obvious answer in helpSearch and guides.search

## Goal

Make natural-language intent searches surface Persephone's obvious built-in object-model paths and built-in guides before incidental matches or installed-board documentation. Preserve exact-term searches such as `helpSearch("grid")` and `guides.search("grid")` while supporting partial intent matches.

## Background

### `helpSearch` implementation and the “show a table” false positive

The renderer root in `src/renderer/scripting/ai-vision/root.ts` validates the query and calls the dependency's `helpSearch(this, query, limit)` from `ai-vision`. Persephone uses `ai-vision@1.2.0` (`package.json`, `package-lock.json`); the installed implementation is `node_modules/ai-vision/dist/core/help-search.js`, with source in the library repository at `C:\projects\ai-vision\src\core\help-search.ts`.

The current library algorithm:

1. Lowercases and splits only on whitespace: `query.toLowerCase().split(/\s+/).filter(Boolean)`. There is no punctuation normalization, stemming, synonym expansion, or stop-word removal. Words such as `a`, `to`, and `the` remain search terms.
2. Traverses the descriptor graph breadth-first, up to 300 visited descriptors and depth 5. It indexes each kind once: descriptor kind and summary, formatted member names/signatures/summaries, declared element names/purpose/location, and nonblank lines from `help` text. It does not index arbitrary application source, guides, or every live property value.
3. Discovers static children from descriptor members marked `property` and `node: true`, following safe reads, plus dynamic descriptor `children()` entries. Dynamic children are emitted as hits using their `path — kind: summary` line, then traversed unless restricted. Thus `boards.list()`'s current live board children, including trusted test boards in temporary folders, enter the index.
4. Requires *every* query token to be a case-insensitive substring of one candidate line (`tokens.every(token => lower.includes(token))`). Results are not relevance-ranked. After collection, the only explicit sort moves paths containing `[` (concrete indexed instances such as `pages[0].editor.addRows`) ahead of paths without `[`, then deduplicates and applies the limit. This is an intentional concrete-path preference, not a proxy for hit origin. Kind-level/member hits are attributed to the first descriptor instance of each kind reached (`collectKindHits(path, ...)`, guarded by `seenKinds`), so useful member hits may themselves contain `[`. Dynamic descriptor children also generate separate child-entry hits from `${childPath} — ${child.kind}: ${child.summary}`. Stable traversal order otherwise decides ties.

The live `helpSearch("show a table to the user")` result is only `ui`. This is not an intent-aware match: the substring `table` is found at the end of `writable` in the `ui` summary (“A writable property…”); `a`, `to`, `the`, `show`, and `user` also occur there. The result is therefore a coincidental all-substring match. Conversely, a phrase such as `draw a diagram` returns no hit because all tokens must co-occur in one indexed line. For `helpSearch("grid")`, board summaries containing “Grid” are dynamic indexed-child hits, and the `[` ordering rule places them before the Grid editor help/member hits. The live instance returned six such `boards[...]` results (including test-board paths) before its two general help hits. `helpSearch("addRows")` currently returns only generic `$help` paths because the active page is not a Grid editor; when a Grid page exists, `GridEditorFacade` owns the `addRows` member.

Persephone's root descriptor already contains high-value orientation in `ROOT_OVERVIEW`, `ROOT_HELP`, and the root `pages` member summary in `src/renderer/scripting/ai-vision/root.ts`. The operation-level summaries are next to their wrappers: `PAGES_MEMBERS` (`pages.logView`, `addEditorPage`, `addDrawPage`, `openFile`, `openUrlInBrowserTab`) in `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`; `push` in `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts`; `addRows` in `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`; `screenshot` in `src/renderer/scripting/ai-vision/browser-automation-members.ts`; and `listDir` in `src/renderer/scripting/ai-vision/namespaces/fs.ts`. The descriptors need explicit task-language wording because generic `ai-vision` cannot infer Persephone-specific concepts.

### `guides.search` ranking and mounted guide sources

The shared implementation is `src/shared/guides/index.ts`, `createGuideIndex().search()`. It deduplicates query tokens after lowercase whitespace splitting, but retains stop words. For each eligible page it searches the page title and Markdown candidates extracted from the body (`extractMarkdownCandidates` in `src/shared/guides/markdown.ts`). The front-matter `summary` is parsed and exposed on guide pages, but is not included in search candidates. Matching uses word-start substring occurrences (`countWordStartOccurrences`): every distinct query token must have at least one occurrence at a word boundary in the same title or candidate passage. A token can be a prefix, but `table` does not match inside `writable`. It does not split camelCase: for example `rows` does not match the `Rows` component of `addRows` because the preceding lowercase `d` is alphanumeric. The revised tokenizer must split camelCase and punctuation, retain the original identifier as a searchable token, and match a query token against a word token by exact or prefix match. Apply the same rule to helpSearch and guides.search: `row` should match `rows` and `addRows`, while `table` must not match `writable`; `openUrl` should match `openUrlInBrowserTab` and `screenshot` should match its named API.

The expected `pages.addDrawPage` path was checked against the live MCP model and exists as `addDrawPage(dataUrl: string, title?)`; its summary says it creates a drawing page from an image data URL, so it is not the best primary route for “draw a diagram”. The benchmark instead expects the live `pages.addEditorPage` method to create a Mermaid page, then the Mermaid facade's `openInDrawingEditor()` when the rendered diagram should be opened as a drawing. `pages.openFile` and `fs.listDir` were also checked live and exist. No `fs.search` member exists in the descriptor, so the file-discovery benchmark uses `pages.openFile` and `fs.listDir`.

Every matching title gets score 300, heading 200, table row 150, and body 100. `compareHits()` then orders by score, `distinctTokenCount`, shorter passage, occurrence count, page path, source line, and passage. Since candidates are rejected unless all distinct query tokens match, `distinctTokenCount` is the full query-token count for every hit and cannot help distinguish partial-intent relevance. The search does not weight built-in content over mounted board content, and board passages can outrank useful built-in pages when they alone contain every query word.

`src/shared/guides/mounted-source.ts` mounts the root corpus and each trusted board corpus under `installed-boards/<board-id>/`. `src/renderer/guides/board-guide-mounts.ts` and `src/main/mcp/ai-vision/board-guide-mounts.ts` resolve trusted board folders; `src/renderer/guides/index.ts` and `src/main/mcp/server-factory.ts` each compose a mounted source with `createGuideIndex`. The main MCP `guides.search` path is `src/main/mcp/ai-vision/guides.ts` → the shared index. Mount resolution is dynamic, so installed, trusted board guides are deliberately part of the same search corpus and compete under the same score rules. The two current phrase hits are the Excel Viewer and SQLite Viewer agent guides: their “show the user” passages also say “table”. The expected built-in guides exist at `assets/guides/formats/ui-push.md`, `assets/guides/editors/grid.md`, and `assets/guides/editors/log-view.md`.

### Recommended smallest ranking change

Use a two-stage approach that keeps exact-term behavior intact:

1. **In `ai-vision` (generic upstream library):** normalize query and indexed text to word tokens, splitting camelCase and punctuation while retaining each original identifier as a token. Match query tokens by exact word or prefix, so `row` matches `rows` and `addRows`, `openUrl` matches `openUrlInBrowserTab`, and `table` does not match inside `writable`. Filter common stop words only when at least one substantive token remains; rank exact full-token candidates above partial coverage, and partial coverage above misses. Do not add Persephone-specific synonyms or intent hints to this generic library. Track hit origin explicitly on every candidate as `member`, `kind-summary`, `element`, `help-text`, or `child-entry`; rank member/kind-summary and element hits above child-entry hits, and help-text hits below member and child-entry hits. Preserve the preference for a concrete path containing `[` only as a tie-break within an origin/relevance tier. Preserve deterministic ties, limit/depth/restriction behavior, and safe reads. Check `C:\projects\ai-vision\src\core\help-search.ts`.
2. **In Persephone descriptors:** add the user's intent words to the actual member summaries rather than adding Persephone-specific behavior to `ai-vision`. Update `src/renderer/scripting/ai-vision/root.ts`, `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts`, `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`, `src/renderer/scripting/ai-vision/namespaces/fs.ts`, and `src/renderer/scripting/ai-vision/browser-automation-members.ts`. Include exact terms such as “show the user”, “table”, “ask a question”, “rows”, “find/open a file”, “open URL”, and “screenshot” on the most relevant member lines.
3. **In Persephone shared guides (`src/shared/guides/index.ts`):** use the same camelCase/punctuation tokenization, original-identifier token retention, and exact-or-prefix word matching. Keep exact full-token matches above lower partial-match tiers; remove stop words from substantive coverage while retaining an all-stop-word fallback. Search front-matter title and summary with explicit boosts, and apply a small built-in-corpus boost (`installed-boards/` identifies mounted content) to make app-owned guidance win close ties. Prefer adding intent wording to existing guide front-matter summaries over an intent map. If a benchmark case remains poor after the summaries are searchable, add only the smallest guide-side hint needed; do not put app-specific terms in `ai-vision`.
4. **Sequence the upstream release:** US-1616 plans `ai-vision` 1.2.1 for image results. Ship this ranking change as `ai-vision` 1.3.0 after 1.2.1; update the upstream `package.json`, `README.md`, and `CHANGELOG.md`. Build and prepare the release changes, then ask the user before publishing to npm or pushing the `C:\projects\ai-vision` repository; publishing and pushing are the user's steps. Once the user completes that release, bump Persephone's `package.json` and `package-lock.json` to 1.3.0.

Preserve exact-title/exact-word results above partial candidates. Do not modify guide mounting or trust rules: source inclusion is expected; the defect is ranking. `ai-vision` owns generic tokenization, hit-origin and ranking behavior only; Persephone owns descriptor wording and guide ranking/source weighting.

### Live benchmark — Persephone MCP

Measured against the currently connected Persephone MCP on 2026-10-03. Each “Current” entry lists returned hits in order, capped at 8 for `helpSearch` and 5 for `guides.search`; a dash means no hit. Expected entries are desired leading results after the ranking work. These are acceptance benchmarks, not a claim that the final output must contain only those hits.

| Query | Expected `helpSearch` leaders | Current `helpSearch` | Expected `guides.search` leaders | Current `guides.search` |
|---|---|---|---|---|
| `show a table to the user` | `pages.logView` (push; `output.grid` / `output.markdown`), `pages.addEditorPage` (`grid-json`) | `ui` | `formats/ui-push`, `editors/grid`, `editors/log-view` | `installed-boards/excel-viewer/agent`, `installed-boards/sqlite-viewer/agent` |
| `grid` | Grid editor paths and row/column operations before dynamic boards | `boards[1]`, `[2]`, `[3]`, `[4]`, `[9]`, `[32]`, then generic help | `editors/grid` first; relevant scripting grid API next | `editors/grid` title, same page heading, `scripting/api/ui-log`, `shortcuts`, Excel Viewer board guide |
| `draw a diagram` | `pages.addEditorPage("mermaid-view", "mermaid", ...)`; Mermaid editor `openInDrawingEditor()` for a rendered diagram | no hits | `editors/mermaid`, `editors/draw` | Force Graph board, `editors/mermaid`, `whats-new`, DrawIO board, `whats-new` |
| `ask the user a question` | `pages.logView.push` | `pages`, `ui`, `pages.logView`, `pages.$help`, `pages.logView` | `formats/ui-push`, `editors/log-view` | `whats-new` only |
| `open a web page` | `pages.openUrlInBrowserTab` | `pages.openUrlInBrowserTab()`, `pages.openUrl()`, `pages.$help` | `agents/index` and `editors/browser` | `agents/index`, `shortcuts`, `whats-new`, `scripting/api/pages`, `editors/browser` |
| `run a script` | `script.execute` | `pages[0].runScript()`, `tools`, two `$help` hits, then settings/UI/site-extension paths | scripting execution guide / script API | `agents/pages`, `boards`, `site-extensions`, `agents/board-review`, `agents/boards` |
| `add rows to a grid` | `pages[i].editor.addRows()` / Grid editor row API | `pages[0].$help`, root `$help` | `editors/grid`, `scripting/api/page` | `scripting/api/page`, `whats-new`, `editors/env-vars`, `agents/boards`, `scripting/api/index` |
| `find a file` | `pages.openFile` or `fs.listDir` (verified live; no `fs.search` descriptor exists) | `settings.$help` | file opening / filesystem guide | `editors/index`, `agents/board-review`, `agents/ai-vision`, `agents/board-review`, `screens/dialogs` |
| `show output` | `pages.logView.push` | `pages`, root `$help`, `pages.logView`, `pages.logView` | `formats/ui-push`, `editors/log-view` | `mcp-setup`, `scripting/api/ui-log`, `scripting/index` twice, `screens/tabs` |
| `edit a table` | Grid editor facade (`pages[i].editor.*`) | `pages[0].content`, `pages.$help`, `window.screen.type()`, `window.screen.clear()`, `window.screen.$help` | `editors/grid`, scripting grid API | `editors/index`, `mcp-setup`, `agents/pages` twice, `whats-new` |
| `addRows` | Grid editor `addRows()` member when a Grid page is open; otherwise the current page's `$help` explains the editor switch | `pages[0].$help`, `$help` | `editors/grid`, `scripting/api/page` | `scripting/api/page`, `scripting/index`, `whats-new`, `scripting/api/page`, `agents/scripting` |
| `screenshot` | `window.screen.screenshot()` | `window.screen.screenshot()`, `window.screen.$help` twice | `agents/browser` / browser screenshot API | `agents/browser`, `shortcuts`, `agents/scripting`, `agents/boards`, Word Viewer board guide |
| `openUrl` | `pages.openUrlInBrowserTab()` for a web URL; `pages.openUrl()` for file-like URLs | `pages.openUrlInBrowserTab()`, `pages.openUrl()`, `pages.$help` three times | `scripting/api/pages`, `agents/pages` | `scripting/api/pages` twice, `agents/pages`, `agents/index` twice |

### Before → after ranking sketch

Current `ai-vision` candidate matching and ordering:

```ts
const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
return tokens.every(token => text.toLowerCase().includes(token));
// hits do not record origin; then every path containing "[" sorts first
```

Proposed behavior (implementation details are for the upstream library task; exact weights to be calibrated against the live benchmark):

```ts
const queryTokens = tokenizeWithCamelCaseAndOriginalIdentifiers(rawQuery);
addHit(memberLine, { origin: "member" });
addHit(kindSummaryLine, { origin: "kind-summary" });
addHit(helpLine, { path: `${path}.$help`, origin: "help-text" });
addHit(childLine, { path: childPath, origin: "child-entry" });
return rankHits(hits, {
    exactWordOrPrefixMatches: highest,
    partialSubstantiveTokenCoverage: next,
    origin: { memberAndKindSummary: aboveChildEntry, element: aboveChildEntry, childEntry: lower, helpText: belowMember },
    concreteInstancePath: tieBreakWithinTier,
    stopWords: excludedFromCoverage,
});
```

For Persephone, summaries add vocabulary at the descriptor sources: for example `pages.logView` gains “show the user”, “table”, and “ask a question”; `push` gains table/grid and question phrasing; `addEditorPage` mentions `grid-json` tables; `pages.openFile` and `fs.listDir` mention finding files. These are app-specific terms and stay out of `ai-vision`.

Descriptor wording edits (before → after; implementation should keep the summaries concise and behaviorally accurate):

| Descriptor source | Before | After |
|---|---|---|
| `src/renderer/scripting/ai-vision/root.ts`, root `pages` member | “All open pages (tabs) in this window; index by position or page id. Also holds pages.logView — the channel for showing the user output or asking them a question.” | “All open pages (tabs) in this window; index by position or page id. To show the user a table, grid, or other output, or ask a question, use pages.logView.push; pages.addEditorPage can create a dedicated grid-json table page.” |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `logView` member | “SHOW THE USER SOMETHING, or ASK THEM A QUESTION: the agent's output channel…” | “Show the user output such as a table/grid or Markdown, or ask a question: pages.logView.push(entries) is the agent's output channel…” |
| `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts`, `push` member | “Append one string or flat entry object, or an array of them, and return ids immediately.” | “Show the user a message, table/grid (`output.grid`), or Markdown (`output.markdown`), or ask a question: append one string or flat entry object, or an array of them, and return ids immediately.” |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `addEditorPage` member | “New page with a given editor id (monaco, grid-json, md-view, …) and language; optionally initializes its content; returns it.” | “Create a page for content, a table/grid using grid-json, or a Mermaid diagram using mermaid-view; optionally initializes its content; returns it.” |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `openFile` member | “Open a path from disk in a new page (or focus it if already open); returns the page…” | “Find and open a file path from disk in a new page (or focus it if already open); returns the page…” |
| `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`, `addRows` member | “Add new empty rows. Returns the new rows.” | “Add empty rows to a table/grid. Returns the new rows.” |
| `src/renderer/scripting/ai-vision/namespaces/fs.ts`, `listDir` member | “List entry NAMES in a directory, optionally filtered…” | “Find or browse files by listing entry NAMES in a directory, optionally filtered…” |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts`, `screenshot` member | “Capture a page, element, or browser full page as PNG/JPEG…” | “Take a screenshot: capture a page, element, or browser full page as PNG/JPEG…” |

Guide summary wording edits (before → after):

| Guide | Before | After |
|---|---|---|
| `assets/guides/formats/ui-push.md` | `Log View reference: messages, dialogs, entry types, and examples for pages.logView.push and the script ui object.` | `Show the user messages, tables/grids, Markdown, and questions with pages.logView.push; Log View entry and dialog reference.` |
| `assets/guides/editors/grid.md` | `Spreadsheet-like viewing and editing of JSON, CSV, and JSONL data.` | `View and edit tables, rows, and columns in JSON, CSV, and JSONL Grid pages.` |
| `assets/guides/editors/log-view.md` | `Structured JSONL output, messages, and interactive dialogs for agent and script results.` | `Show the user structured output, tables/grids, messages, and interactive questions in Log View.` |
| `assets/guides/editors/draw.md` | `The bundled Excalidraw board for drawing, annotation, screen snips, and image export.` | `Draw or annotate diagrams with the bundled Excalidraw board; capture screen snips and export images.` |
| `assets/guides/agents/pages.md` | `Pages and windows reference: page properties, editor types, creating pages, and multi-window object-model paths.` | `Find or open files, create pages, and work with page properties, editor types, and multi-window object-model paths.` |

Current `guides.search` only emits a candidate if every distinct query token is present and applies one fixed score for its passage type. The implementation plan adds the same camelCase-aware exact/prefix token matching, lower-ranked partial candidates, searchable front-matter summaries and a small built-in-source tie-break while keeping full exact matches ahead.

## Implementation Plan

- [ ] In `C:\projects\ai-vision\src\core\help-search.ts`, implement camelCase/punctuation tokenization with original-identifier retention and exact-or-prefix word-token matching, stop-word-aware partial scoring, and explicit hit-origin metadata (`member`, `kind-summary`, `element`, `help-text`, `child-entry`). Rank member/kind-summary and element hits above child-entry hits, help-text hits below member hits, and use paths containing `[` only as a concrete-instance tie-break within each relevance/origin tier. Keep the library generic: no Persephone-specific synonyms or intent hints.
- [ ] Update upstream `C:\projects\ai-vision\package.json` to `1.3.0` after US-1616's planned `1.2.1`; document the generic tokenizer/ranking contract in `C:\projects\ai-vision\README.md` and add a `1.3.0` entry to `C:\projects\ai-vision\CHANGELOG.md`. Build and prepare the upstream release. Publishing to npm and pushing `C:\projects\ai-vision` are the user's steps; ask the user before either action. After the user publishes/pushes 1.3.0, update this repo's `package.json` and `package-lock.json` to `ai-vision@^1.3.0` and verify the installed dist matches.
- [x] Update Persephone's task-language member summaries in `src/renderer/scripting/ai-vision/root.ts`, `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts`, `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`, `src/renderer/scripting/ai-vision/namespaces/fs.ts`, and `src/renderer/scripting/ai-vision/browser-automation-members.ts`, following the before → after wording table above. Include “diagram” in the `addEditorPage` wording to make the existing Mermaid route discoverable. Keep each summary accurate about behavior and safety.
- [x] In `src/shared/guides/index.ts`, use camelCase/punctuation tokenization with original-identifier retention and exact-or-prefix matching; add stop-word-aware exact and lower partial coverage. Search `GuidePage.summary` in addition to title/body, ranking exact title/body matches above partial matches and summaries above ordinary body matches.
- [x] Update front-matter summaries in `assets/guides/formats/ui-push.md`, `assets/guides/editors/grid.md`, `assets/guides/editors/log-view.md`, `assets/guides/editors/draw.md`, and `assets/guides/agents/pages.md` with the words shown in the table above. Apply a modest built-in-corpus tie-break for otherwise comparable results using `installed-boards/`; do not filter mounted guides or change their visibility, trust, paths, or merge behavior.
- [ ] Prefer guide-summary vocabulary to a synonym map. Add a minimal guide-only hint only if a benchmark case still misses after summary indexing and ranking; never add Persephone-specific hints to `ai-vision`.
- [ ] Do not add unit tests per the task instruction/project rule. Verify all benchmark queries through live MCP after implementation, recording ordered results and confirming exact/prefix terms remain useful.

### Post-change benchmark attempt — 2026-10-04

The Persephone MCP tool was available, but calls to `guides.search` for `show a table to the user` and `grid` remained pending for over a minute each and were stopped without a response. No post-change live rankings could be recorded; the `Current` columns above remain the original 2026-10-03 baseline. Expected leaders are therefore unverified for every row, and no result is claimed to lead after this change. Retry these rows when the live MCP responds.

### Files expected to change

| File | Planned change |
|---|---|
| `C:\projects\ai-vision\src\core\help-search.ts` (upstream dependency repository) | Generic tokenization, explicit hit origin, relevance tiers, and concrete-instance tie-break |
| `C:\projects\ai-vision\README.md`, `C:\projects\ai-vision\CHANGELOG.md`, `C:\projects\ai-vision\package.json` | Document/version upstream 1.3.0 after 1.2.1 |
| `package.json`, `package-lock.json` | Bump Persephone to released `ai-vision@^1.3.0` |
| `src/renderer/scripting/ai-vision/root.ts` | Add intent terms to the root `pages` member summary |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Improve `logView`, `addEditorPage`, `openFile`, and related page member summaries |
| `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts` | Improve `push` summary for user-facing tables, output, and questions |
| `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` | Improve `addRows` summary for row/table intent |
| `src/renderer/scripting/ai-vision/namespaces/fs.ts` | Improve `listDir` summary for file discovery |
| `src/renderer/scripting/ai-vision/browser-automation-members.ts` | Include “screenshot” wording in the screenshot member summary |
| `src/shared/guides/index.ts` | Guide tokenization, summary/partial matching, and source ranking |
| `assets/guides/formats/ui-push.md`, `assets/guides/editors/grid.md`, `assets/guides/editors/log-view.md` | Add intent words to searchable front-matter summaries |
| `assets/guides/editors/draw.md` | Add natural-language diagram intent to its front-matter summary |
| `assets/guides/agents/pages.md` | Add file discovery/opening intent wording to its front-matter summary |

### Files that do not need changes

| File | Reason |
|---|---|
| `src/shared/guides/mounted-source.ts` | Mounting and path names correctly merge trusted board content; source precedence belongs in shared guide ranking. |
| `src/renderer/guides/board-guide-mounts.ts` | Trusted-board discovery and mount roots are not the ranking defect. |
| `src/main/mcp/ai-vision/board-guide-mounts.ts` | Main-process trusted-board discovery and mount roots are not the ranking defect. |
| `src/main/mcp/ai-vision/guide-source.ts` | The main adapter correctly reads the root and mounted guide sources. |
| `src/renderer/guides/guide-source.ts` | The renderer adapter correctly reads the root and mounted guide sources. |
| `src/main/mcp/ai-vision/guides.ts` | It validates arguments and delegates `search()` to the shared guide index; no separate ranking layer is needed. |
| `src/main/mcp/server-factory.ts` | It constructs the correctly mounted guide index; no merge change is needed. |
| `doc/active-work.md` | Explicitly excluded by the requester; the user will add the dashboard entry. |

## Concerns

- `ai-vision` is maintained in a separate user-owned repository. US-1616 plans 1.2.1; this ranking behavior change is planned for 1.3.0 after that release. Publishing and pushing are user steps and require asking the user first.
- Stop-word removal can make short queries such as `to` empty. Retain an all-stop-word fallback and test exact one-token queries.
- Partial matching may increase noisy results. Keep a strong exact-match tier and exact-or-prefix word-token matching; benchmark `grid`, `addRows`, `screenshot`, and `openUrl` before considering any guide-only hints.
- `GuidePage.summary` is present in parsed/front-matter data but currently not searched. Boosting it should make useful pages discoverable without rewriting the guide corpus; verify that summary-only results remain below exact title/body matches.
- Live ordering can include machine-specific mounted board guides and board names. Acceptance should assert stable built-in leaders and relative ranking, while allowing later low-ranked mounted-guide hits.
- Acceptance is live MCP verification only for this task; do not add or run unit tests.

## Acceptance Criteria

- `helpSearch("show a table to the user")` leads with `pages.logView` and `pages.addEditorPage` (or their exact actionable children), not `ui` alone.
- `guides.search("show a table to the user", 5)` leads with `formats/ui-push` and the Grid/Log View guides; installed-board guides do not occupy the top slots ahead of them.
- `helpSearch("grid")` ranks the built-in Grid editor API before dynamic board children, including temporary test boards.
- Help and guide tokenization splits camelCase/punctuation, retains the original identifier token, and supports exact/prefix word-token matching: `row` matches `rows` and `addRows`, `openUrl` matches `openUrlInBrowserTab`, `screenshot` matches its named API, and `table` does not match `writable`.
- Every query in the thirteen-row live benchmark is re-run and its ordered paths recorded. In particular, `open a web page` continues to find `pages.openUrlInBrowserTab`, and other exact/concrete API queries remain above broad partial matches.
- Intent phrases with relevant built-in answers (`draw a diagram`, `ask the user a question`, `run a script`, `add rows to a grid`, `find a file`, and `show output`) surface the expected API or guide family at the top.
- No unit tests are added or run; no dashboard entry is made as requested.

## Files Changed Summary

| File | Change |
|---|---|
| `C:\projects\ai-vision\src\core\help-search.ts` | Generic tokenization, explicit hit origin, relevance tiers, concrete-instance path tie-break |
| `C:\projects\ai-vision\README.md`, `C:\projects\ai-vision\CHANGELOG.md`, `C:\projects\ai-vision\package.json` | Document/version upstream 1.3.0 after 1.2.1 |
| `package.json`, `package-lock.json` | Consume `ai-vision@^1.3.0` in Persephone |
| `src/renderer/scripting/ai-vision/root.ts`, `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts`, `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`, `src/renderer/scripting/ai-vision/namespaces/fs.ts`, `src/renderer/scripting/ai-vision/browser-automation-members.ts` | Add natural intent words to Persephone's relevant descriptor summaries |
| `src/shared/guides/index.ts` | Guide tokenization, summary/partial matching, source ranking |
| `assets/guides/formats/ui-push.md`, `assets/guides/editors/grid.md`, `assets/guides/editors/log-view.md`, `assets/guides/editors/draw.md`, `assets/guides/agents/pages.md` | Add intent language to searchable guide front matter |
