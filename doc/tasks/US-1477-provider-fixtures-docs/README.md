# US-1477: Demo-board provider fixtures and authoring documentation

## Goal

Complete EPIC-107's shipped demonstration surface and document every new provider and
stream-host authoring axis without changing the installed board copy or product behavior.

## What was done

- Extended the demo manifest with `demo/mem`, its `mem` scheme, disclosure permission, and a
  `*.stream-demo` `stream-host` association.
- Registered a bounded in-memory provider in the module service; added a local stream fixture and
  an explicit Range probe reporting status and `Content-Range`.
- Bumped the bridge contract to `1.7.0` and updated the board API authoring references, including
  ownership, service-only registration, buffered fallback, and no-copy stream-host policy.
- Updated the board template, user and agent board guides, board-review guidance, and What's New.

## Verification

The fixture follows the live-proven `demo/mem` service shape from US-1473 and the Range URL shape
from US-1475. D11 remains explicit: `ProxyProvider` does not push ranges into board providers.
`node --check` and manifest parsing passed; `npm run typecheck` and `npm run lint` passed. The
main, preload, board-shim, and search-worker production bundles built, but `npm run build-prod`
stopped at the renderer build because the environment denied Vite's child-process spawn (`EPERM`).

## Acceptance criteria

- [x] Every EPIC-107 axis has a shipped demo-board fixture or authoring reference.
- [x] Existing demo-board panels remain present and dependency-free/offline.
- [x] No unit tests, harnesses, commits, `.persephone` changes, epic/roadmap changes, or
  installed-board changes are made by this task.

## Live verification, 2026-09-20 (Claude)

The shipped fixtures were installed into the already-trusted Demo board path (no new trust granted)
and exercised against the running app, then the board was restored byte-identically from a backup.

- **Bridge version is live at `1.7.0`** — the board's own runtime check reported
  `persephone bridge injected — version=1.7.0`.
- **A `stream-host` board opens a non-local-capable association.** `stream-fixture.stream-demo`
  opened in `board-editor:…\Demo` rather than a built-in editor, so the `editorKind: "stream-host"`
  value reaches the open path and wins the association.
- **EPIC-107 criterion 7 — `__pipe` serves a real Range request.**
  `persephone.host.streamUrl()` returned
  `board://b97856f9de71f16b97580/__pipe/4c5f07c6-13d2-495f-bd47-720dd5f43f62`, and a
  `Range: bytes=0-31` fetch from inside the board frame returned:

  ```
  206 · bytes 0-31/140 · 32 bytes
  text: "This small local resource is ope"
  ```

  A correct `Content-Range`, a correct length, and the correct leading bytes — served from the
  page's platform-owned pipe through the renderer, per D4.
- **EPIC-107 criterion 8 — nothing was written to disk.** A sweep of `<userData>` for files modified
  during the run found **no entry at all** under `<userData>/cache` — neither `cache/<pageId>.txt`
  (the `CacheFileProvider` autosave that `content-host` pages get) nor
  `<cache>/<editorId>/<basename>` (the `ensureContentPath()` materialization that
  `editorSources: "any"` relies on). The only recent writes were ordinary session bookkeeping
  (`config.json`, `openFiles1.json`, `openWindows.json`, `recentFiles.txt`). This is the epic's
  headline no-copy guarantee, observed rather than inferred.

As the authoring guide now states, this is a **broker policy, not an OS guarantee**: the platform
writes nothing for this exchange, but memory can be paged and Chromium keeps its own caches.
