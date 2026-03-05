# US-063: Phase 5 — Migration Review

**Status:** Complete
**Phase:** 5 (Migration Review)
**Migration doc:** [10.migration-review.md](../../future-architecture/migration/10.migration-review.md)

## Goal

Review all remaining old folders and decide the final target location for each module.
Then execute the moves as separate subtasks.

## Decisions Log

### `/components/` — **Keep**
Shared component library at renderer root. Used equally by `/editors/`, `/features/`, and `/ui/`.
Moving into `/ui/` would create wrong dependency direction. New `/icons/` subfolder added for cross-cutting icon components.

### `/core/` — **Restructure**
- `core/state/` → **Keep in `/core/`** — foundational state primitives, used by 80+ files
- `core/utils/` → **Keep in `/core/`** — general utilities, widely used
- `core/services/file-watcher.ts` → **Move to `/core/utils/`** — standalone utility class
- `core/services/scripting/` → **Move to top-level `/scripting/`** — distinct product feature that will grow (Phase 7: types, facades, Monaco IntelliSense)
- `core/services/` → **Deleted** after all moves

### `/store/` — **Deleted**
- `menu-folders.ts` → `/api/menu-folders.ts` with `IMenuFolders` interface wired onto `app.menuFolders`
- `link-open-menu.tsx` → `/editors/shared/link-open-menu.tsx` (shared editor utility)
- `language-mapping.ts` → `/core/utils/language-mapping.ts` (pure utility)
- Folder deleted entirely

### `/features/` — **Moved to `/ui/`**
- `tabs/` → `/ui/tabs/`
- `sidebar/` → `/ui/sidebar/` (FileIcon extracted to `/components/icons/`)
- `navigation/` → `/ui/navigation/`
- `editors/base/LanguageIcon.tsx` → `/components/icons/LanguageIcon.tsx` (cross-cutting)
- Folder deleted entirely

### `/types/` — **Keep**
Ambient global type augmentations (Window, MouseEvent). Distinct from API interfaces.

### `/setup/` — **Moved to `/api/setup/`**
Monaco configuration wired into `app.initSetup()` bootstrap. Side-effect import removed from `index.tsx`.

### `/theme/` — **Keep**
Global app styling. Cross-cutting, used by all layers.

## Subtasks

- [x] Audit all remaining old folders
- [x] Decision: `/components/` → Keep (+ new `/icons/` subfolder)
- [x] Decision: `/core/` → Keep (state, utils) + move scripting to `/scripting/`, file-watcher to utils
- [x] Decision: `/store/` → Deleted (files distributed to api, editors/shared, core/utils)
- [x] Decision: `/features/` → Moved to `/ui/` (icons extracted to `/components/icons/`)
- [x] Decision: `/types/` → Keep
- [x] Decision: `/setup/` → Moved to `/api/setup/`, wired into bootstrap
- [x] Decision: `/theme/` → Keep
- [x] Execute all moves
- [x] Update migration README target structure
- [x] Clean up empty old folders (`/store/`, `/features/`, `/setup/`, `/core/services/`)
