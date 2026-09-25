# US-1517: A board-scheme link must resolve to the editor its file name deserves

Part of [EPIC-113](../../epics/EPIC-113.md). Decision **D15** in that epic is binding for this task.

## Goal

A link handed to `openRawLink` under a registered board scheme (e.g. `<scheme>://…/photo.jpeg`)
with no explicit target must open in the built-in editor Persephone would pick for that file name
— Monaco, the Image viewer, the media player, a grid, or an installed board — falling back to
Monaco only when nothing else matches.

## Background

`createBoardSchemeHooks` (`src/renderer/editors/board/custom-editor-registry.ts:175-199`) builds
the `SchemeHooks` used for every board-declared `contentProviders` scheme. Its `resolve` hook wrote
`data.target ||= "monaco"` unconditionally, before delegating to the rest of the resolver chain.

Registered schemes resolve **before** the file fallback (`src/renderer/content/resolvers.ts:78-80`),
and every downstream resolver assigns the target with `||`/`??` (`resolvers.ts:67-69`,
`builtin-schemes.ts:234,247`). Once `createBoardSchemeHooks` had written `"monaco"`, nothing
downstream could override it, so the file-name-based resolver (`resolveEditorIdForFile`) was never
reached for any board-scheme link. A `.jpeg` served through a board scheme opened its raw bytes as
text in Monaco instead of the Image viewer.

`resolveEditorIdForFile(filePath?, matchPath?)` already exists in the same file
(`custom-editor-registry.ts:558-589`) and does exactly the lookup needed:
- `matchPath` (falling back to `filePath` via `const match = matchPath || filePath`) drives the
  actual match — `editorRegistry.resolve(match)` for built-ins and
  `customEditorRegistry.getBoardsForFile(match)` for boards.
- `filePath` alone drives the locality gate (`isPlainLocalPath(filePath)`), which decides whether a
  simple board (not `content-host`/`stream-host`, not `editorSources: "any"`) may even be offered.
  A falsy `filePath` short-circuits the board scan and returns only the built-in id.

Because both arguments matter and do different jobs, the original URL is passed as `filePath` (so
locality is judged on the real, possibly-remote source) and the URL's last path segment — decoded,
no query/fragment — is passed as `matchPath` (so the match happens against the file's name, the
same way `extractEffectivePath` in `content/resolvers.ts` does for http(s) sources).

`createBoardSchemeHooks.resolve` serves two callers distinguished by `context.phase`:
- `"open"` — a link the user followed; needs both a pipe and a target, then opens a page. This is
  the phase the defect lives in.
- `"source-path"` — `resolveRegisteredSourcePath` (`src/renderer/content/scheme-registry.ts:228-255`)
  rebuilding a pipe for a page that **already exists** (restored page after restart, cross-window
  move). It reads only `data.pipe`/`data.pipeDescriptor`, never `data.target`, and its `delegate` is
  a no-op. The function already returns early for this phase (`if (context.phase === "source-path")
  return;`), before the old `||=` line — so the defect and the fix both live entirely inside the
  `"open"` branch, but D15 requires proving the `source-path` branch is untouched, not just assuming
  it from the early return.

## Implementation plan

1. **`src/renderer/editors/board/custom-editor-registry.ts`** — add a module-local helper
   immediately above `createBoardSchemeHooks` (around line 175):

   ```ts
   /** Last path segment of a registered-scheme URL — decoded, without query or fragment. This is the
    *  file name `resolveEditorIdForFile` matches on; the ORIGINAL url stays its `filePath` argument so
    *  the locality gate still judges the real source. Mirrors `extractEffectivePath` in
    *  `content/resolvers.ts`, which does the same for http(s). */
   function schemeEffectivePath(url: string): string {
       try {
           return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
       } catch {
           return "";
       }
   }
   ```

2. In the same file, change `createBoardSchemeHooks`'s `resolve` hook: remove the unconditional
   `data.target ||= "monaco";` from the top, and after the `source-path` early return, compute the
   target with an explicit-target-wins chain before delegating:

   ```ts
   async resolve(data, context) {
       data.pipeDescriptor = {
           provider: {
               type: providerType,
               config: { url: data.url },
           },
           transformers: [],
       };
       data.pipe = context.createPipe(data.pipeDescriptor);
       if (context.phase === "source-path") return;
       // Target resolution is an OPEN-phase concern: `source-path` rebuilds a pipe for a page
       // that already exists and discards `data.target` (EPIC-113 D15).
       data.target = data.target
           || resolveEditorIdForFile(data.url, schemeEffectivePath(data.url))
           || "monaco";
       data.handled = false;
       await context.delegate();
       data.handled = true;
   },
   ```

   Pipe construction, the descriptor shape, and the `source-path` early return are untouched — the
   only change inside the function is where and how `data.target` is set, and only on the `"open"`
   path.

No other files require changes. `resolveEditorIdForFile` is already exported from this same file,
so no new import and no async plumbing is introduced.

## Concerns / open questions

1. **Non-local sources now reach `editorSources: "any"` boards.** After this fix, a board-scheme
   link to e.g. `.pdf` can resolve to an installed `pdf-viewer`-like board declaring
   `editorSources: "any"`, which makes Persephone materialize the pipe into a cache file on disk
   (`src/renderer/editors/board/BoardEditorModel.ts:98-106`). For a future torrent-backed source
   (EPIC-114) that means a whole-file download to disk just to open it. **Resolution: keep this
   behavior.** It is exactly what `http://…/x.pdf` already does today via the same
   `resolveEditorIdForFile` path, and diverging would make board schemes an undiscoverable special
   case. The real fix is the `getFilePath()` migration that EPIC-113 D9 already defers to a later
   epic. Flagging this as input to EPIC-114 so the torrent board's design accounts for it.
2. **Restored-page regression risk (D15).** The `source-path` phase rebuilds pipes for restored
   pages (after app restart) purely from `data.pipe`/`data.pipeDescriptor`, and never reads
   `data.target`. Editing the shared `resolve` function to fix the `"open"` phase risks perturbing
   `source-path` if the early return or pipe-construction code is touched by mistake. This was
   verified NOT to happen — the target computation was added strictly after the existing
   `if (context.phase === "source-path") return;` line, and pipe construction above it is
   byte-identical to before. Acceptance below includes a restart check for this reason.

## Acceptance criteria

- `openRawLink("<board-scheme>://…/notes.md")` with no target opens the Markdown editor (via
  Monaco's file-type resolution or a matching board), `…/photo.jpeg` opens the Image viewer, and an
  extension nothing claims still falls back to Monaco.
- An explicit `data.target` set by an earlier hook is still respected (the `data.target || ...`
  chain preserves override behavior).
- A board-scheme page restored after an app restart still rebuilds its pipe and opens with its
  previously-recorded editor — confirming the `source-path` phase is unaffected.
- `npm run typecheck`, `npm run lint`, and `npm run build-prod` all pass.

## Files changed

| File | Change |
|------|--------|
| `src/renderer/editors/board/custom-editor-registry.ts` | Added `schemeEffectivePath()` helper; moved target resolution in `createBoardSchemeHooks.resolve` from an unconditional `data.target ||= "monaco"` at the top to an explicit-target-wins chain using `resolveEditorIdForFile()`, computed only in the `"open"` phase branch. |
