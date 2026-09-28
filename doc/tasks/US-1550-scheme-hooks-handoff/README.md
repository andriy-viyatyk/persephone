# US-1550: Scheme hooks — a `handoff()` helper and shared URL helpers

## Goal

Canonicalize URL scheme prefixes once before registered-scheme parsing so scheme matching is case-insensitive without changing the payload. Add `SchemeHookContext.handoff()` and move URL path and fragment helpers to one shared module while preserving their distinct caller semantics.

## Background

US-1548 replaced scheme registration with `OwnershipRegistry`: duplicate and rejected registrations return results, and `custom-editor-registry.ts` collects refusals as registration issues. US-1537 changed external URL routing. This plan is checked against current source rather than the older line references in [EPIC-115](../../epics/EPIC-115.md).

The pipeline has three layers: `parsers.ts` dispatches registered schemes, `resolvers.ts` builds pipes and targets, and `open-handler.ts` opens or navigates the page from the resulting pipe. Board scheme hooks are renderer-owned adapters over the same registry used by platform and script hooks. `pages.openUrl` has a separate validation gate before `openRawLink`.

### Verified findings

- The external browser-navigation candidate gate in `RendererEventsService.handlePipelineCandidate()` extracts a scheme with a case-insensitive regex and asks `isSchemeRegistered()`, which lowercases the lookup. Thus `TORRENT://…` passes that gate. In contrast, current `schemeFromValue()` in `scheme-registry.ts` uses a lowercase-only regex. Parse dispatch misses, then the LIFO chain reaches the plain-file fallback and warns `Invalid file path`.
- The `pages.openUrl` validator has separate case-sensitive checks: `isValidHttpUrl()` uses `/^https?:\/\//`; `isValidFileUrl()` and `isValidDataUrl()` use lowercase `startsWith`; and `isValidRegisteredScheme()` extracts with a lowercase-only regex. If made case-insensitive, its `new URL(value).protocol` comparison must compare against the normalized lowercase scheme. Preserve the current registered URL `://` shape and payload checks. The validator returns the original href; canonicalization belongs in the pipeline parser.
- In `parsers.ts`, subscriptions are installed file fallback, archive fallback, registered-scheme adapter, then cURL/fetch adapter. EventChannel dispatch is LIFO, so cURL/fetch runs first, the registered-scheme adapter runs before archive/file fallbacks, and it can canonicalize before those fallbacks. The cURL/fetch parser recognizes command prefixes with `/i`; it does not depend on URL scheme casing.
- `resolveRegisteredSourcePath()` has a distinct parse delegate: `parseContext.delegate` calls the registered resolver and marks the path resolved. Only the resolver context's delegate is a no-op. `handoff()` in source-path phase must therefore call the supplied delegate without toggling `data.handled`; the parse delegate still reconstructs the pipe, and the resolver delegate still cannot open a page.
- `io.registerScheme()` passes the registry hook context directly to script callbacks. `ISchemeHookContext` is script-visible in `src/renderer/api/types/io.d.ts`, whose byte-identical copy is `assets/editor-types/io.d.ts`. Additive `handoff()` typing and examples belong in both. Board frames receive no `SchemeHookContext`; `createBoardSchemeHooks()` is renderer-side. `BOARD_BRIDGE_VERSION` is `1.23.0` and does not need a bump.

#### Scheme extraction expressions found

These are the six scheme extraction/detection expressions found in the current source. Extracted renderer schemes should use `schemeOf`; the shared guide expression is only an absolute-URL predicate and remains case-insensitive in `shared/`.

| File:line | Current expression / role | Lowercases result? |
|-----------|--------------------------|--------------------|
| `src/renderer/content/scheme-registry.ts:50` | Captures scheme for parse, resolve, and source-path lookup. | Yes after capture via `normalizeScheme`, but the regex itself rejects uppercase input. |
| `src/renderer/api/pages/open-url-validation.ts:60` | Captures scheme for registered-scheme validation. | No; regex is case-sensitive. |
| `src/renderer/api/pages/open-url-validation.ts:90` | Captures unsupported scheme for the validation error. | No; `/i` accepts uppercase but preserves input casing. The error may retain it. |
| `src/renderer/api/internal/RendererEventsService.ts:111` | Captures scheme for browser-navigation candidate gating. | No; `/i` accepts uppercase, then `isSchemeRegistered()` normalizes for lookup. |
| `src/renderer/editors/video/VideoEditor.ts:293` | Captures persisted source scheme for the missing-provider diagnostic. | No; `/i` accepts uppercase, then `isSchemeRegistered()` normalizes for lookup. |
| `src/shared/guides/guide-links.ts:105` | Tests whether a Markdown link is an absolute URL; it does not extract the captured scheme. | Not applicable; `/i` already makes the predicate case-insensitive. |

#### Effective-path and fragment helper comparison

- The `extractEffectivePath` copies in `builtin-schemes.ts:117` and `resolvers.ts:9` are identical: archive paths return `parseArchivePath(url).innerPath`; HTTP(S) returns the raw last `URL.pathname` segment or `""` on malformed input; every other input is returned unchanged. Keep these exact semantics as `effectivePathOf(url)` in `link-utils.ts`. In particular, do not decode the last segment for a plain or virtual URL.
- The board helper at `custom-editor-registry.ts:179` is different: it parses the URL, takes and percent-decodes the last pathname segment, ignores query/fragment, returns `""` on failure, and has no archive case. Preserve it as a separate `urlPathFileName(url)` helper in `link-utils.ts`. Its comment should explain that board provider URLs percent-encode the file path and the decoded filename feeds editor matching and the tab title. Update the two comments in `custom-editor-registry.ts` that currently refer to `extractEffectivePath` (around lines 177 and 663).
- The `splitUrlFragment` bodies in `builtin-schemes.ts:9` and `parsers.ts:16` are identical: split at the first `#`, decode the suffix, fall back to raw suffix on malformed encoding, and omit an empty fragment. Move this behavior to `link-utils.ts`. Keep existing caller guards: never split a bare Windows path because `#` is legal in filenames; HTTP fragments remain in the URL.
- Current built-in registrations in `builtin-schemes.ts` are `http`, `https`, `data`, `folder-editor`, `git-tree`, `mneme`, `mneme-folder`, `persephone-board`, `persephone-guide`, `persephone-toolset`, and `tree-category`. The architecture table lists representative schemes, so live checks below cover all eleven registrations where safe.

#### Canonicalization boundary and comparison points

`schemeOf(value)` returns the lowercase RFC 3986 scheme or `undefined`; URL parsing likewise exposes the canonical scheme in lowercase through `new URL().protocol`. `canonicalizeScheme(value)` lowercases only a scheme prefix whose name has at least two characters, and preserves every byte after the colon. A one-letter prefix is left untouched because `C:\x` is a Windows drive path. The registered-scheme parser adapter canonicalizes `data.href` before dispatch; its position in the LIFO chain also makes `FILE://` lowercase before file/archive fallback parsing. Since `data.url` is then derived from canonicalized hrefs, existing built-in decoders, `DataUrlProvider`, URL-family helpers and the torrent board receive lowercase schemes without changes to their comparisons. Reuse the same canonicalizer when creating the in-memory link data for a registered persisted source path, so an older uppercase stored URL also reaches its provider in canonical form.

The current scheme comparisons along the path are the validator checks above; `schemeFromValue()` at parser/resolve/source-path registry lookup; the `isSchemeRegistered()` lookup in browser navigation and validation; and the lowercase prefix helpers/decoders that consume pipeline URLs. The single parser-entry canonicalization addresses those downstream checks. The validator remains a separate pre-pipeline gate and needs its own case-insensitive checks, but must return the href unchanged.

The torrent viewer source was checked in `C:/projects/persephone-boards/boards/torrent-viewer/app.js`: `sourceInfoHash()` normalizes source comparisons, while `isLocalTorrentPath()` and `isTorrentSource()` use lowercase `startsWith("magnet:")` / `startsWith("torrent://")`. New pipeline inputs will be canonicalized before provider config and persisted source links are formed, so the viewer receives lowercase schemes. No change in `persephone-boards` is needed.

## Implementation Plan

1. [x] Trace registered URL input through external candidate routing, `pages.openUrl` validation, the LIFO parser adapters, scheme parse/resolve dispatch, pipe creation, and `open-handler.ts`. Record the extraction sites and current uppercase failure above.
2. [x] In `src/renderer/content/scheme-registry.ts`, export `schemeOf(value: string | undefined): string | undefined` using `/^([a-z][a-z\d+.-]*):/i` and lowercase the capture. Export `canonicalizeScheme(value: string): string`, lowercasing the prefix only when its scheme name is at least two characters and returning the remainder unchanged. Use `schemeOf()` in `dispatchRegisteredSchemeParse`, `dispatchRegisteredSchemeResolve`, and `resolveRegisteredSourcePath` for normalized lookup. When constructing source-path hook data, canonicalize the persisted path before passing it to hooks.
3. [x] In the registered-scheme adapter in `src/renderer/content/parsers.ts`, assign `data.href = canonicalizeScheme(data.href)` before `dispatchRegisteredSchemeParse()`. Preserve the original remainder exactly; this also normalizes `FILE://` before archive/file fallbacks. Keep cURL/fetch processing first and verify it does not rely on scheme case.
4. [x] In `src/renderer/api/pages/open-url-validation.ts`, make HTTP, file, data, and hierarchical registered-scheme checks case-insensitive. Use `schemeOf(value)` for registered lookup and compare `new URL(value).protocol` with the normalized scheme plus `:`. Preserve current `://` shape and payload checks, and return the href unchanged; the parser owns canonicalization. The unsupported-scheme error may preserve the user's casing.
5. [x] Add `handoff()` to `SchemeHookContext` in `scheme-registry.ts`, implemented when the registry constructs each open and source-path context. In open phase, set `data.handled = false`, await the existing delegate, then set handled true. In source-path phase, only await the supplied delegate. Keep `delegate()` available and unchanged for backwards compatibility. Current built-in and board hooks only await its result; none uses the boolean. Add `handoff(): Promise<void>` to `ISchemeHookContext` in `src/renderer/api/types/io.d.ts` and identical `assets/editor-types/io.d.ts`; update the script example.
6. [x] Replace the identical `parseHttp` and `parseData` hooks in `builtin-schemes.ts` with one `parsePassThrough` that sets `data.url = data.href` and awaits `context.handoff()`. Keep `parseVirtual`'s target defaulting before handoff.
7. [x] Register `resolveVirtual` directly for its six built-in schemes; remove only the one-line alias wrappers. Share the identical placeholder descriptor shape (file provider at `data.url`, no transformers) between `resolveVirtual` and the unknown-virtual fallback in `resolvers.ts`; keep that fallback for unregistered virtual URLs.
8. [x] Move the built-in helper semantics to `effectivePathOf(url)` and `splitUrlFragment(href)` in `link-utils.ts`. Add a separate `urlPathFileName(url)` for the board-specific decoded pathname behavior, and update callers and the two `custom-editor-registry.ts` comments.
9. [x] Update `doc/architecture/content-pipeline.md` and `assets/guides/scripting/api/io.md` / `assets/guides/agents/scripting.md` for `handoff()` and canonical scheme matching. Keep source and editor type declarations identical.

### Source-path guard audit

Current line numbers are from the source inspected for this plan. Remove the guards marked “remove” only after `handoff()` has the source-path behavior above.

| Current guard | Decision | Reason |
|---------------|----------|--------|
| `src/renderer/content/builtin-schemes.ts:206` (`resolveVirtual`) | Remove | Pipe descriptor and pipe are already built. Source-path `handoff()` only calls the resolver context's no-op delegate, so no page opens and no handled toggles occur. |
| `src/renderer/content/builtin-schemes.ts:214` (`resolveData`, image edit) | Keep | Prevents the image-edit side effect during source-path reconstruction; this branch does not build a pipe. |
| `src/renderer/content/builtin-schemes.ts:235` (`resolveData`, after pipe creation) | Remove | Pipe is built; source-path handoff only invokes the no-op resolver delegate. |
| `src/renderer/content/builtin-schemes.ts:250` (`resolveMneme`, after pipe creation) | Remove | Pipe is built; source-path handoff only invokes the no-op resolver delegate. |
| `src/renderer/content/builtin-schemes.ts:267` (`resolveGuide` source-path branch) | Keep | Builds the guide pipe without calling page lookup; it is phase-specific work, not a redundant handoff guard. |
| `src/renderer/content/builtin-schemes.ts:310` (`resolveHttp` source-path branch) | Keep | Reconstructs the URL pipe and returns before open-only browser/content routing. |
| `src/renderer/editors/board/custom-editor-registry.ts:209` | Keep | Builds a provider pipe and returns before editor-target/title work, which is only needed during open and is discarded during source-path reconstruction. |

## Concerns

- Canonicalize only the scheme prefix. Lowercasing path, query, fragment, board identifiers, or opaque data payload bytes would change content identity.
- Preserve one-letter Windows drive paths. The threshold in `canonicalizeScheme()` prevents `C:\x` from being treated as a scheme.
- Mneme and mneme-folder live checks are excluded for privacy because they read the user's knowledge base. Verify those routes by code reading only. `tree-category://` and `folder-editor://` with valid payloads should also be code-reading-only unless a safe synthetic payload is convenient.
- No unit-test harness exists for this path; this task document must not add one. The implementation's live verification follows EPIC-115's rule to exercise changed message paths twice.

## Acceptance Criteria

- [ ] `schemeOf()` recognizes schemes case-insensitively and returns lowercase; `canonicalizeScheme()` lowercases only prefixes of at least two characters and preserves the rest byte-for-byte.
- [ ] The registered-scheme parser adapter canonicalizes hrefs before parse dispatch, with cURL/fetch still running first. Bare drive paths remain untouched; file URLs and file-URL archive inputs reach the existing fallback paths.
- [ ] The three registry lookup paths use `schemeOf()`, including source-path reconstruction; persisted uppercase paths are canonicalized before scheme hooks use them.
- [ ] `pages.openUrl` accepts uppercase HTTP, file, data, and currently supported hierarchical registered schemes while returning the input href unchanged.
- [ ] `handoff()` uses the open-phase handled/delegate sequence and source-path `await delegate()` without toggling handled. `delegate()` remains available and both `io.d.ts` copies stay identical.
- [ ] The three effective-path behaviors remain distinct as documented; the two fragment helper copies are unified without changing caller guards.
- [ ] Virtual aliases and duplicate placeholder descriptor are removed; parseHttp/parseData are combined into `parsePassThrough`.
- [ ] `BOARD_BRIDGE_VERSION` stays `1.23.0`; board frames do not see the hook context.
- [ ] The live baseline below is preserved for lowercase inputs, and uppercase `DATA:`, `HTTPS://`, `MEM://`, and `TORRENT://` produce the same editor/title as their lowercase forms.

## Live verification

The lowercase baseline below was recorded by the user at `bfe5e336`. After implementation, compare editor and title and invoke each changed route twice where applicable. Do not live-open mneme or mneme-folder links; verify those by source reading only.

| Input / scenario | Existing baseline |
|------------------|-------------------|
| File path | Monaco, `note.txt` |
| `file://` | Monaco, `data.json` |
| `file://` with `#frag` | `md-view`, `inner.md` |
| Archive `!` path | `md-view`, `inner.md` |
| `data:text/plain,…` | Monaco, `plain,hello%20us1550` |
| HTTPS content `.json` | Monaco, `untitled` |
| HTTPS `browserMode: profile:…` | Opens a new `browser-view` page |
| HTTPS `browserMode: internal` | Adds a tab to the active own browser page |
| `persephone-guide://index` | `md-view`, `Persephone User Guide` |
| Empty `persephone-guide://` | Warning: `Invalid guide link` |
| `persephone-board://` | `board-view` |
| `git-tree://` | `git-tree`, `persephone — Git` |
| Invalid `persephone-toolset://` | Error: toolset editor without a root |
| Invalid `folder-editor://` | Warning: `Invalid folder editor link` |
| `mem://` | Monaco, `a.txt` |
| `magnet:` | Torrent Viewer board editor, `Torrent Viewer` |
| `torrent://<hash>/x.txt` | Monaco, `x.txt` |
| Uppercase `DATA:`, `HTTPS://`, `MEM://`, `TORRENT://` | Current behavior: warning `Invalid file path`, no page. After the fix: same editor/title as corresponding lowercase input. |

Additional code-reading/live checks:

- [ ] Verify lowercase parity live, including editor/title, for every safe built-in registration; verify `mneme://` and `mneme-folder://` by code reading only for privacy.
- [ ] Verify uppercase `FILE://`, `DATA:`, `HTTPS://`, `MEM://`, and `TORRENT://` follow the same editor/title as lowercase. Include `magnet:` if an uppercase browser navigation is convenient.
- [ ] Verify HTTP/HTTPS content and browser behavior twice, including internal mode adding a tab to the active browser page.
- [ ] Verify demo board `mem://`, torrent viewer `torrent:` and `magnet:`. Confirm canonicalized lowercase source values reach the torrent viewer's case-sensitive `startsWith` call sites; no `persephone-boards` source change is planned.
- [ ] Verify `mneme://` and `mneme-folder://` by code reading only; do not read the user's knowledge base through live links.
- [ ] Verify valid `tree-category://` and `folder-editor://` payloads by code reading, unless a safe synthetic payload is easy to construct.
- [ ] Verify archive `!` entry routing and file URL fragment handling retain their baseline editor/title.

## Files That Need No Changes

These consumers keep their current lowercase scheme comparisons because the parser canonicalizes the scheme before they receive the URL. The existing family checks in `link-utils.ts` stay as they are while that module gains the shared helpers.

| File / area | Why it stays unchanged |
|-------------|------------------------|
| `src/renderer/content/link-utils.ts` existing `normalizeFileUrl`, `isFileUrl`, `isHttpUrl`, `isUrlOrCurl`, and scheme-prefix branches | Registered adapter canonicalization runs before archive/file fallback and resolvers. Only add the new helper functions here. |
| `src/renderer/content/builtin-schemes.ts` URL-family checks and inline folder-editor decoder | Hooks receive canonicalized href/url values. The file still changes for handoff, parser merge, and direct resolver registration. |
| `src/renderer/content/folder-editor-link.ts`, `src/renderer/content/persephone-board-link.ts`, `src/renderer/content/persephone-toolset-link.ts`, `src/renderer/content/tree-providers/tree-provider-link.ts`, `src/shared/guides/guide-links.ts` | Existing decoders receive canonical schemes; keep their comparisons and payload handling unchanged. |
| `src/renderer/content/providers/DataUrlProvider.ts` | The provider receives a canonical `data:` URL, so media-type parsing needs no scheme-case change. |
| `src/renderer/editors/board/BoardWebview.ts`, `src/board-shim.ts`, `src/shared/board-bridge-version.ts` | Board frames do not receive the renderer hook context. Bridge contract and version `1.23.0` are unchanged. |
| `C:/projects/persephone-boards/` | Torrent viewer's case-sensitive `startsWith()` calls receive lowercase source URLs after canonicalization; grep found no required board-side change. |
| Unit tests / test harness | No unit-test harness exists for this path, and none is to be added for US-1550. |

## Files Changed

| File | Planned change |
|------|---------------|
| `src/renderer/content/scheme-registry.ts` | Export `schemeOf` and `canonicalizeScheme`; use normalized lookup in parse, resolve, and source-path dispatch; construct `handoff()` on each context. |
| `src/renderer/content/parsers.ts` | Canonicalize href in the registered-scheme adapter before dispatch. |
| `src/renderer/api/pages/open-url-validation.ts` | Accept uppercase HTTP/file/data/registered schemes; retain original href. |
| `src/renderer/content/builtin-schemes.ts` | Use `handoff`, merge pass-through parser hooks, register `resolveVirtual` directly, share virtual descriptor and URL helpers, remove only audited redundant guards. |
| `src/renderer/content/resolvers.ts` | Use shared exact-semantics `effectivePathOf`; retain unknown-virtual fallback using shared descriptor. |
| `src/renderer/content/link-utils.ts` | Own `effectivePathOf`, board-specific `urlPathFileName`, `splitUrlFragment`, and shared virtual placeholder descriptor. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Use `urlPathFileName`; update comments; use context `handoff()` while retaining its source-path target/title guard. |
| `src/renderer/api/internal/RendererEventsService.ts`, `src/renderer/editors/video/VideoEditor.ts` | Use `schemeOf` at the two remaining renderer extraction sites. |
| `src/renderer/api/types/io.d.ts`, `assets/editor-types/io.d.ts` | Add additive `handoff(): Promise<void>` declaration and update the example identically. |
| `doc/architecture/content-pipeline.md`, `assets/guides/scripting/api/io.md`, `assets/guides/agents/scripting.md` | Document canonical scheme matching and script hook handoff behavior. |
| `doc/active-work.md`, `doc/epics/EPIC-115.md` | Keep the linked `[ ]` task entry and `In progress` epic status. |

## Live verification results

Run in the dev app after implementation (typecheck, lint and `node scripts/build-prod.mjs` all pass), with synthetic files and URLs only, each route invoked at least twice:

- Every lowercase baseline row above reproduced exactly (same editor and title, same warning/error text for the three invalid links).
- `DATA:`, `HTTPS://`, `MEM://`, `TORRENT://`, `FILE:///`, `MAGNET:` and `PERSEPHONE-GUIDE://` now open the same editor/title as their lowercase forms (`TORRENT://<hash>/x.txt` -> Monaco `x.txt`; `MAGNET:` -> Torrent Viewer). No `Invalid file path` toast appears any more.
- `pages.openUrl` (script path) accepts `MEM://`, `DATA:` and `TORRENT://`; a later lowercase `mem://` open of the same URL reuses the page opened by the uppercase form (the stored source is canonical). `BOGUS://x` is still rejected with the original casing in the message.
- `browserMode: "internal"` (lowercase and `HTTPS://`) adds a tab to the active own browser page twice; other browser pages are untouched.
- Board-scheme pages (`mem://`) still read their content after a renderer reload (source-path reconstruction).

## Not verified

- `mneme://` and `mneme-folder://` were checked by code reading only (live links would read the user's knowledge base).
- `tree-category://` and valid-payload `folder-editor://` / `persephone-toolset://` were checked by code reading only; the invalid-payload forms were verified live.
- A full app restart restoring a page whose persisted source still has an uppercase scheme (pre-fix data) was not exercised; `resolveRegisteredSourcePath` canonicalizes it by code.
