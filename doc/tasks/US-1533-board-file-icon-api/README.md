# US-1533: Boards can ask Persephone for a file's icon

**Status:** Implemented 2026-09-27, awaiting user testing. Deviations: the reply is deduplicated (`urls[]` + `icons: name → index`), the shim caches per exact name (not per extension, because pattern icons like `package.json` depend on the whole name) and batches 500 names per request, and `board-api.d.ts` is not updated (boards are agent-authored; the guides are the reference). Eleven language icons use `currentColor`, so the theme concern applies: they are drawn in `--color-icon-default` and the shim drops its cache on a theme change.

## Goal

Give boards `persephone.icons.forFiles(names)`, which returns the icon Persephone itself shows for
each file name, as an image URL a board can put in an `<img src>`. That lets a board's file list
match the Explorer panel.

## Background

### How Persephone resolves a file icon today

`resolveFileIcon(fileName, language?)` (`src/renderer/components/icons/language-icon-resolver.ts:191`)
returns one of four kinds, in precedence order:

| Kind | Source | How to turn it into an image |
|---|---|---|
| `board` | A trusted board claims the file (`customEditorRegistry.getBoardsForFile`) | Board icon file from `getBoardIconPathSync(boardRoot)` (`src/renderer/editors/board/board-icon-cache.ts`), else the `BoardIcon` glyph (`src/renderer/editors/board/board-glyph-element.ts`) |
| `component` | Static pattern/language icon (`getFilePatternIcon`, `languageIconMap`) | `Icon.createElement({ width: 16, height: 16 })` gives an `SVGElement`; serialize it with `outerHTML` |
| `system` | The OS shell icon, cached per extension | Already a `data:` URL: `api.getFileIcon(fileName)` (`src/ipc/renderer/api.ts:191`, main `src/main/fileIconCache.ts:7`) |
| `default` | Nothing matched | `DefaultIcon` (`src/renderer/theme/language-icons`), serialized like `component` |

`system` icons are filled lazily. `prepareFileIcon(fileName)` (`:206`) triggers an async fetch
into `systemIconModel`, and `resolveFileIcon` returns `default` until it lands.
`createFileTypeIconElement` (`src/renderer/components/icons/icon-elements.ts:33`) is the existing
DOM consumer of all four kinds.

### What a board frame can load

The board protocol CSP allows `img-src 'self' data: blob:` (`src/main/board-protocol-service.ts:82`).
So a `data:` URL works for every kind. A `file://` path (the board icon file) does not, and must be
inlined.

### The request/reply pattern to follow

`board:filePath` is the model for a host-frame request/reply:
- Shim: `filePathRpc()` (`src/board-shim.ts:~427`) posts `{ __persephone: "board:filePath", reqId }`
  and keeps a pending map. The reply listener (`src/board-shim.ts:~1204`) resolves it on
  `"filePath:result"`.
- Host: `BoardWebview.onMessage` case `"board:filePath"` (`src/renderer/editors/board/BoardWebview.ts:610`)
  calls `resolveFilePath` (`:1000`). That drops the reply if the generation or frame changed, then
  posts `BoardFilePathResultMsg`.
- Types: `src/ipc/board-bridge-channels.ts` (`BoardToHostMsg` union `:379-401`, result message `:480`).

## Implementation plan

1. **Types** (`src/ipc/board-bridge-channels.ts`): add `"board:fileIcons"` to the `BoardToHostMsg`
   union with fields `reqId: number; names: string[]`, and a result message
   `BoardFileIconsResultMsg { __persephone: "fileIcons:result"; reqId: number; icons?: Record<string, string>; error?: string }`.
2. **Host resolver** (new `src/renderer/editors/board/board-file-icons.ts`):
   ```ts
   /** Resolve names to image URLs a board frame can load (data: URLs only; see the CSP). */
   export async function resolveBoardFileIcons(names: readonly string[]): Promise<Record<string, string>>
   ```
   - Cap the input (for example 500 names, and each name 260 characters); use basenames only
     (`fpBasename`). Resolve each distinct extension once.
   - For each name, call `prepareFileIcon(name)` and await it, then `resolveFileIcon(name)`.
     `prepareIcon` is fire-and-forget today; add an awaitable variant, for example
     `export function prepareFileIconAsync(fileName): Promise<void>` in `language-icon-resolver.ts`.
   - `component` / `default`: `Icon.createElement({ width: 16, height: 16 })`, then set the `xmlns`
     attribute, take `outerHTML`, and return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`.
     `currentColor` in these SVGs renders black inside an `<img>`. Check the language icons: most
     carry fixed fills. For those that use `currentColor`, substitute the theme's
     `--color-icon-default` value resolved from `getComputedStyle(document.documentElement)`.
   - `system`: return the cached `data:` URL.
   - `board`: read the board icon file with `app.fs` as base64 and build a `data:` URL with the
     right MIME type (`image/svg+xml`, `image/png`, `image/x-icon`); fall back to the serialized
     `BoardIcon` glyph.
3. **Host message** (`BoardWebview.ts`): add a `"board:fileIcons"` case next to `"board:filePath"`
   (`:610`), which calls a `resolveFileIcons(reqId, names, host, frame)` method modelled on
   `resolveFilePath` (`:1000`), including the generation/frame guard before replying. This is
   available to any trusted board frame, main or secondary. The trusted-board rule applies: no
   per-API gate (memory: trusted board = user app).
4. **Shim** (`src/board-shim.ts`): add
   ```ts
   icons: {
       /** Persephone's icon for each file name, as an image URL for `<img src>`. Keyed by the
        *  names passed in. The icon depends only on the name, not on the file's content. */
       forFiles(names: string[]): Promise<Record<string, string>>,
   }
   ```
   with a pending map and a `"fileIcons:result"` listener in the `filePathRpc` shape. Add a per-frame
   cache by lowercased extension (plus exact-name entries for pattern icons such as `package.json`),
   so a list re-render does not round-trip.
5. **Bridge version**: bump `BOARD_BRIDGE_VERSION` (`src/shared/board-bridge-version.ts:2`) to
   `1.18.0`, and add the history line in the shim's version comment (`src/board-shim.ts:~1406-1422`):
   `// 1.18.0 adds persephone.icons.forFiles() (US-1533).`
6. **Types for boards** (`src/renderer/editors/board/board-api.d.ts`): document `icons.forFiles`.
7. **Docs**: `assets/guides/boards.md` and `assets/guides/agents/boards.md` (API reference section),
   plus `assets/guides/whats-new.md`.
8. **Torrent Viewer** (persephone-boards, separate commit): set `minBridgeVersion` to `1.18.0` and
   `minAppVersion` to the release that ships this. In `renderFileRow`, request icons for the
   visible torrent's file names once per torrent selection and set `<img src>`; keep `GLYPHS.file`
   while the request is pending. Bump the board's version and `WHATS-NEW.md`.

### Files that need NO change

`icon-elements.ts` (the DOM consumer stays as is), `fileIconCache.ts` (main already caches), and
`board-icon-cache.ts` (read-only use).

## Concerns

- **Theme dependence.** A `data:` SVG is fixed at resolution time. If any language icon uses
  `currentColor`, a theme switch would leave its colour stale. Mitigation: the shim cache is keyed by
  theme too. Clear it from the shim's existing theme-change dispatch (the one that feeds
  `persephone.onThemeChange`, `src/board-shim.ts:~905-912`), and document that boards should re-request on a theme change. Verify how many icons
  use `currentColor` first; if none do, drop this.
- **Payload size.** The icons are small SVGs or 16px PNGs, and per-extension dedupe keeps a
  thousand-file torrent down to a few distinct extensions.
- **System icons need the file name only**, not an existing file. `app.getFileIcon` on Windows
  resolves by extension, so torrent files that are not on disk work. Confirm this in
  `fileIconCache.ts` during implementation.

## Acceptance criteria

1. `persephone.icons.forFiles(["a.mp4", "b.srt", "package.json", "x.torrent"])` from a trusted
   board returns four `data:` URLs that render in an `<img>` inside the board frame. They match
   the icons the Explorer panel shows for the same names (the `.torrent` one is the Torrent Viewer's
   board icon while that board is trusted).
2. A second call for already-seen extensions does not post a host message.
3. `persephone.version` is `1.18.0`.
4. The Torrent Viewer's file list shows Persephone's icons.
5. `npm run typecheck`, `npm run lint`, `npm run build-prod` pass.

## Files changed

| File | Change |
|---|---|
| `src/ipc/board-bridge-channels.ts` | `board:fileIcons` request, `fileIcons:result` reply |
| `src/renderer/editors/board/board-file-icons.ts` | New: resolve names to `data:` URLs |
| `src/renderer/components/icons/language-icon-resolver.ts` | Awaitable `prepareFileIconAsync` |
| `src/renderer/editors/board/BoardWebview.ts` | `board:fileIcons` case + `resolveFileIcons` |
| `src/board-shim.ts` | `icons.forFiles`, reply listener, extension cache, version comment |
| `src/shared/board-bridge-version.ts` | `1.18.0` |
| `src/renderer/editors/board/board-api.d.ts` | API docs |
| `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `assets/guides/whats-new.md` | Docs |
