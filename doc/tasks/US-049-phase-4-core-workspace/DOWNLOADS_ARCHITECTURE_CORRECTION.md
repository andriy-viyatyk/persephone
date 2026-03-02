# Downloads Architecture Correction (US-049 Follow-up)

## Issue Identified

During US-049 implementation, a critical architectural flaw was identified:

**Problem:** DownloadTrackerService was created as a thin wrapper calling `downloadsStore.init()` during event service initialization.

This violated the migration strategy stated in the README: **"No thin wrappers that delegate back to old code — move the logic itself."**

**Root Cause:** Downloads is global infrastructure (main process managed, shared across all windows), not an event service or editor-specific concern. It should be:
- Phase 3 interface (like `app.ui`, `app.shell`)
- Initialized in `app.initServices()`
- Exposed as `app.downloads` to all consumers

---

## Correction Implemented

### 1. Created IDownloads Interface
**File:** `/src/renderer/api/types/downloads.d.ts`

```typescript
export interface IDownloads {
    readonly downloads: DownloadEntry[];
    readonly hasActiveDownloads: boolean;
    readonly aggregateProgress: number;

    cancelDownload(id: string): void;
    openDownload(id: string): void;
    showInFolder(id: string): void;
    clearCompleted(): void;

    init(): Promise<void>;
}
```

### 2. Created Downloads Implementation
**File:** `/src/renderer/api/downloads.ts`

Moved all logic from `downloads-store.ts`:
- Extends `TModel<DownloadsState>` (maintains React hook pattern for components)
- Implements `IDownloads` interface
- Event subscriptions: eDownloadStarted, eDownloadProgress, eDownloadCompleted, eDownloadFailed, eDownloadCleared
- All methods: `init()`, `cancelDownload()`, `openDownload()`, `showInFolder()`, `clearCompleted()`
- Getters: `downloads`, `hasActiveDownloads`, `aggregateProgress`
- Note: `.state.use()` method hidden from .d.ts (not exposed to scripts, for internal React components only)

### 3. Updated app.ts

**Added:**
- Import `IDownloads` type
- Private `_downloads` property
- Public `downloads` getter
- Added downloads import + init to `initServices()`

**Removed:**
- Removed DownloadTrackerService from `initEvents()`
- Removed all DownloadTrackerService imports

### 4. Updated Browser Editor Components

**DownloadButton.tsx:**
- Changed import: `downloadsStore` → `downloads`
- Updated state subscription: `downloadsStore.state.use()` → `downloads.state.use()`

**BrowserDownloadsPopup.tsx:**
- Changed import: `downloadsStore` → `downloads`
- Updated state subscription: `downloadsStore.state.use()` → `downloads.state.use()`
- Updated all method calls: `downloadsStore.*` → `downloads.*`

### 5. Updated Migration Document

**File:** `/doc/future-architecture/migration/README.md`

Changed:
- Line 219: Updated downloads from "Phase 5b (stays near browser editor)" to **"Phase 3b (global infrastructure, not editor-specific)"**
- Added note under Phase 3 explaining why downloads is global infrastructure, not editor-specific

### 6. Deleted Old Files

```
✅ DELETED: /src/renderer/api/internal/DownloadTrackerService.ts
✅ DELETED: /src/renderer/store/downloads-store.ts
```

---

## Files Changed Summary

| File | Change | Type |
|------|--------|------|
| `/src/renderer/api/types/downloads.d.ts` | Created | NEW |
| `/src/renderer/api/downloads.ts` | Created | NEW |
| `/src/renderer/api/app.ts` | Updated init + wiring | MODIFIED |
| `/src/renderer/editors/browser/DownloadButton.tsx` | Update imports | MODIFIED |
| `/src/renderer/editors/browser/BrowserDownloadsPopup.tsx` | Update imports | MODIFIED |
| `/doc/future-architecture/migration/README.md` | Update phase classification | MODIFIED |
| `/src/renderer/api/internal/DownloadTrackerService.ts` | Deleted | REMOVED |
| `/src/renderer/store/downloads-store.ts` | Deleted | REMOVED |

---

## Bootstrap Sequence Updated

**Before (US-049 initial):**
```
app.initServices()
  └─ 7 APIs (settings, fs, ui, window, shell, editors, recent)

app.initPages()

app.initEvents()
  ├─ GlobalEventService
  ├─ KeyboardService
  ├─ WindowStateService
  ├─ DownloadTrackerService ❌ (thin wrapper)
  └─ RendererEventsService
```

**After (Corrected):**
```
app.initServices()
  ├─ 7 APIs (settings, fs, ui, window, shell, editors, recent)
  └─ 8 APIs (downloads) ✅ NEW - global infrastructure

app.initPages()

app.initEvents()
  ├─ GlobalEventService
  ├─ KeyboardService
  ├─ WindowStateService
  └─ RendererEventsService
```

---

## Key Architectural Insight

This correction demonstrates the migration strategy principle:

**"No thin wrappers that delegate to old code — move the logic itself."**

✅ Instead of:
```typescript
// WRONG: Thin wrapper
class DownloadTrackerService {
    async init() {
        await downloadsStore.init();  // Just delegates!
    }
}
```

✅ Do this:
```typescript
// CORRECT: Full API implementation
class Downloads implements IDownloads {
    async init() {
        // Actual logic moved here from old store
        const downloads = await api.getDownloads();
        // ... event subscriptions, state management, etc.
    }
}
```

---

## TypeScript Verification

TypeScript compilation after changes:
- ✅ No download-related errors
- ✅ All imports correct
- ✅ Interface properly implemented
- ✅ Type safety maintained

---

## Status

✅ **Correction Complete** - Downloads now follows proper migration architecture:
- Global infrastructure service (Phase 3)
- Exposed via `app.downloads` public API
- Initialized in `initServices()` (not event services)
- Logic moved from store → implementation
- All consumers updated
- Old files deleted
- Migration document updated
