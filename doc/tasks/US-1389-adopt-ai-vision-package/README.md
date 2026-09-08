# US-1389: Adopt the `ai-vision` package

## Goal

Use the published `ai-vision@^1.0.0` package as Persephone's sole AiVision engine and remove the
internal engine, elements helper, and highlight asset without changing the public call surface.

## Background

The engine is imported by both `src/main/**` and `src/renderer/**`; the survey found 83 importing
files. The package preserves the existing `IAi*`, resolver, validation, shaping, and help-search
names. Its `ai-vision/dom` entry supplies the generalized element helper and the overlay installer.

Before -> after:

```ts
import { resolveCall } from "../../../shared/ai-vision/resolver";
import { createElements } from "../ai-vision/elements";
// ->
import { resolveCall } from "ai-vision";
import { createElements } from "ai-vision/dom";
```

The renderer UI keeps lazy one-time installation and the existing `all`, `id`, and reveal behavior,
but calls `installHighlightOverlay()` and reads `window.__aiVisionHighlight` instead of fetching an
asset.

## Implementation Plan

- [x] Add the normal `ai-vision` dependency and lock entry; never use a `file:` dependency.
- [x] Repoint all 83 imports, delete `src/shared/ai-vision/`, and replace every elements-helper
  import with `ai-vision/dom`.
- [x] Delete `src/renderer/scripting/ai-vision/elements.ts` and `assets/agent/ui-highlight.js`.
- [x] Update `src/renderer/api/ui.ts` to lazily call `installHighlightOverlay()` and use the new
  package global.
- [x] Update the required architecture, standards, roadmap, and EPIC-096 pointers.
- [ ] Run the TypeScript, lint, production-build, reference, and encoding checks.

## Concerns

The package was unavailable to npm in this environment: the requested install returned `ENOTCACHED`
under npm's cache-only policy, and the online retry could not reach the registry. The published
package metadata and tarball integrity are recorded in the lock entry, but final commands require
the package to be installed in `node_modules`.

No genuine type mismatch was found: Persephone's highlight option/result/reveal types are
structurally compatible with the package DOM types, so no cast or local wrapper was added.

## Acceptance Criteria

- `package.json` records `"ai-vision": "^1.0.0"`; `package-lock.json` records the published 1.0.0
  registry package.
- No internal engine, local elements helper, overlay asset, old global, or old import path remains
  in active source/docs outside explicitly historical records.
- `ui.highlightElement()` and `ui.clearHighlights()` preserve lazy install, options, reveal, and
  clear semantics.
- `npx tsc --noEmit`, `npm run lint`, and `npm run build-prod` pass, with no new mojibake or BOM.

Left for US-1393: the two `app-asset://agent/ui-highlight.js` examples and old global references in
`assets/guides/screens/index.md` remain untouched as requested.

Files intentionally not changed: `assets/guides/**`, `doc/active-work.md`, and the remaining
Persephone AiVision namespaces, dialogs, menus, root, call, and `page-*` files.

## Files Changed Summary

| Group | Paths |
|---|---|
| Dependency | `package.json`, `package-lock.json` |
| Runtime | `src/main/**` and `src/renderer/**` AiVision importers; `src/renderer/api/ui.ts`; deleted internal engine, elements helper, and overlay asset |
| Developer docs | `doc/architecture/{key-files,scripting,folder-structure,overview}.md`, `doc/standards/coding-style.md`, `doc/ai-vision-library-roadmap.md`, `doc/epics/EPIC-096.md` |
