# US-045: Phase 3 — UI & Shell

## Status

**Status:** Planned
**Priority:** High
**Depends on:** US-044 (Phase 2 — File System & Window)

## Summary

Implement `app.ui` (IUserInterface) and `app.shell` (IShell) interface objects. These wrap existing dialog components, notifications, OS integration, and utility services (encryption, version, file search) into the App Object Model.

## Why

Phase 3 completes the "service layer" of the App Object Model before Phase 4 adds workspace/page management. After this phase, scripts and AI bots can:
- Show dialogs and notifications to the user
- Check app version and updates
- Encrypt/decrypt content
- Open files in the OS explorer
- Open URLs in the default browser
- Search file contents across folders

---

## Scope Analysis

### What exists and needs wrapping

| Capability | Current implementation | Target API |
|---|---|---|
| Confirmation dialog | `showConfirmationDialog()` in `features/dialogs/` | `app.ui.confirm()` |
| Input dialog | `showInputDialog()` in `features/dialogs/` | `app.ui.input()` |
| Password dialog | `showPasswordDialog()` in `features/dialogs/` | `app.ui.password()` |
| Toast notifications | `alertInfo/Warning/Error/Success()` in `features/dialogs/alerts/` | `app.ui.notify()` |
| Encryption | `encryptText()/decryptText()` in `core/services/encryption.ts` | `app.shell.encryption` |
| Version info | `checkForUpdates()/getRuntimeVersions()` via IPC | `app.shell.version` |
| Open external URL | `require("electron").shell.openExternal()` (direct) | `app.shell.openExternal()` |
| Browser registration | IPC endpoints `registerAsDefaultBrowser` etc. | `app.shell.browserRegistration` |
| File content search | IPC streaming channels in `search-ipc.ts` | `app.shell.fileSearch` |
| Script execution | `ScriptRunner.run()` in `core/services/scripting/` | `app.shell.scripting` |

### What needs to be created

| Capability | Notes |
|---|---|
| `showMessage()` dialog | Simple OK-only message box (not currently available) |
| `showPick()` dialog | Select from list (not currently available) |
| IPC endpoint for `openExternal()` | Currently called via `require("electron").shell` directly — should go through IPC for consistency |

### What is deferred

| Capability | Reason |
|---|---|
| `app.ui.folders` (sidebar shortcuts) | No extracted model yet; deeply embedded in React components. Defer to Phase 4+ |
| `app.ui.setStatus()` / progress API | Status bar not yet exposed. Could add later. |
| `app.shell.spawn()` | Not implemented. Scripts can use `require("child_process")` directly. |
| Popup/context menu wrapping | `showAppPopupMenu(x, y, items)` requires coordinates — not useful for scripts/AI |

---

## Concerns

### Concern 1: `showInExplorer` / `showFolder` — already on `app.fs`

**Issue:** Phase 2 added `app.fs.showInExplorer()` and `app.fs.showFolder()`. The original `interface-objects.md` puts them on `app.shell`. Do we duplicate them?

**Options:**
- (A) Keep on `app.fs` only — they're file-related operations
- (B) Also add to `app.shell` as aliases — `app.shell.showInFolder()` delegates to `app.fs.showInExplorer()`
- (C) Move from `app.fs` to `app.shell` — breaking change for anyone already using `app.fs`

**Recommendation:** (A) Keep on `app.fs` only. They were placed there during Phase 2, changing now creates churn. `app.shell` focuses on process/URL/service operations.

### Concern 2: `openExternal(url)` needs an IPC endpoint

**Issue:** Currently `require("electron").shell.openExternal(url)` is called directly in renderer code (e.g., `link-open-menu.tsx`). In our architecture, renderer↔main communication should go through IPC.

**Options:**
- (A) Add an IPC endpoint `openExternal(url)` and wrap it in `app.shell`
- (B) Use `require("electron").shell.openExternal()` directly in `app.shell` (Electron exposes `shell` in both processes when `nodeIntegration: true`)
- (C) Skip wrapping — scripts can use `require("electron").shell.openExternal()` directly

**Recommendation:** (B) Use Electron's shell module directly in the wrapper. It works in renderer with `nodeIntegration: true`. No IPC roundtrip needed — this is consistent with how `nodeUtils` file I/O works (renderer-side Node.js access). Note: if the app ever moves to `contextIsolation: true`, this would need an IPC endpoint.

### Concern 3: Password dialog — `app.ui` or `app.shell.encryption`?

**Issue:** The password dialog is used exclusively for encryption/decryption. Should `app.shell.encryption.encrypt()` automatically prompt for a password, or should the caller provide it?

**Options:**
- (A) `app.ui.password()` exposes the dialog, `app.shell.encryption.encrypt(text, password)` takes explicit password — caller wires them together
- (B) `app.shell.encryption` has two modes: `encrypt(text, password)` for programmatic use, `encryptInteractive(text)` prompts for password via `app.ui`
- (C) Keep `app.shell.encryption` simple (explicit password). Application code calls `app.ui.password()` first, then passes result.

**Recommendation:** (A) Keep concerns separate. `app.ui.password()` is a dialog, `app.shell.encryption` is a service. The caller (application code or AI bot) decides the flow.

### Concern 4: File search API design — streaming vs collected

**Issue:** File search uses streaming IPC channels (`search:start`, `search:result`, `search:progress`, `search:complete`). How should `app.shell.fileSearch.search()` expose this?

**Options:**
- (A) `search()` returns `Promise<SearchResult[]>` — collects all results, simple for callers
- (B) `search()` returns a handle with `onResult`, `onProgress`, `onComplete` events — streaming
- (C) `search()` returns `Promise<SearchResult[]>` with optional `onProgress` callback parameter
- (D) Defer file search wrapping — it's tightly coupled to NavigationSearchModel and not useful for scripts until we have file opening (Phase 4)

**Recommendation:** (D) Defer. File search is complex (streaming, cancellation, progress) and its primary consumer is NavigationSearchModel which already works. Scripts can't do much with search results without `app.pages.open()` (Phase 4). Wrap it when there's a real consumer.

### Concern 5: Scripting service — circular and premature?

**Issue:** `app.shell.scripting.run(code)` creates a script context that includes `app` itself. The primary consumer is the AI bot (Phase 6).

**Options:**
- (A) Implement now — thin wrapper over ScriptRunner
- (B) Defer to Phase 6 (AI Integration) — implement when the actual consumer exists

**Recommendation:** (B) Defer to Phase 6. The interface is simple but the consumer (AI bot) doesn't exist yet. No point wrapping ScriptRunner if nobody calls the wrapper.

### Concern 6: Browser registration — `app.shell` or too niche?

**Issue:** `registerAsDefaultBrowser()`, `unregisterAsDefaultBrowser()`, `isRegisteredAsDefaultBrowser()`, `openDefaultAppsSettings()` — very specific to Windows browser registration. Is this worth wrapping?

**Options:**
- (A) Include in `app.shell` as direct methods
- (B) Group as `app.shell.browserRegistration` sub-service
- (C) Defer — only used by Settings page, not useful for scripts/AI

**Recommendation:** (C) Defer. This is a niche Windows-only feature used by one UI page. Not useful for scripts or AI. Can be added later if needed.

### Concern 7: Version service — `app.shell.version` or `app.version`?

**Issue:** Version info is fundamental app metadata. Should it be a shell sub-service or more accessible?

**Options:**
- (A) `app.shell.version` — as originally planned, groups version + update + runtime info
- (B) `app.version` (already exists as string), add `app.runtimeVersions` and `app.checkForUpdates()` directly on IApp
- (C) Keep `app.version` as string, add `app.shell.version` for extended info (runtime versions, update check)

**Recommendation:** (C) — `app.version` stays as the simple string (already implemented). `app.shell.version` adds `runtimeVersions` and `checkForUpdates()` for scripts that need deeper info.

### Concern 8: Minimum viable Phase 3

**Issue:** Full Phase 3 as spec'd in interface-objects.md is large. What's the minimum that unblocks Phase 4?

**Analysis:** Phase 4 (`app.pages`) depends on Phase 3 only because of the dependency chain in the migration plan. In practice, `app.pages` primarily depends on `pagesModel` which is independent. However, `app.ui` dialogs are used by page operations (save confirmation, etc.).

**Recommendation:** Implement core `app.ui` (dialogs + notifications) and core `app.shell` (version + encryption + openExternal). Defer: file search, scripting, spawn, browser registration, sidebar folders, progress/status.

---

## Implementation Plan

### Phase A: `app.ui` — IUserInterface

#### Files to Create

| File | Purpose |
|---|---|
| `/src/renderer/api/types/ui.d.ts` | IUserInterface interface |
| `/src/renderer/api/ui.ts` | UserInterface implementation |

#### Files to Modify

| File | Change |
|---|---|
| `/src/renderer/api/types/app.d.ts` | Add `ui: IUserInterface` to IApp |
| `/src/renderer/api/app.ts` | Add `_ui` field, getter, `import("./ui")` in `initServices()` |

#### Interface Design

```typescript
// ui.d.ts
export interface IConfirmOptions {
    title?: string;
    buttons?: string[];
}

export interface IInputOptions {
    title?: string;
    value?: string;
    buttons?: string[];
    selectAll?: boolean;
}

export interface IInputResult {
    value: string;
    button: string;
}

export interface IPasswordOptions {
    mode?: "encrypt" | "decrypt";
}

export type NotificationType = "info" | "success" | "warning" | "error";

export interface IUserInterface {
    /** Show confirmation dialog. Returns the clicked button label. */
    confirm(message: string, options?: IConfirmOptions): Promise<string>;

    /** Show text input dialog. Returns input result or null if cancelled. */
    input(message: string, options?: IInputOptions): Promise<IInputResult | null>;

    /** Show password dialog. Returns password or null if cancelled. */
    password(options?: IPasswordOptions): Promise<string | null>;

    /** Show a toast notification. Fire-and-forget. */
    notify(message: string, type?: NotificationType): void;
}
```

#### Delegation

| Method | Delegates to |
|---|---|
| `confirm(message, options?)` | `showConfirmationDialog({ message, title: options?.title, buttons: options?.buttons })` |
| `input(message, options?)` | `showInputDialog({ message, title: options?.title, value: options?.value, ... })` → maps `undefined` to `null` |
| `password(options?)` | `showPasswordDialog({ mode: options?.mode ?? "decrypt" })` → maps `undefined` to `null` |
| `notify(message, type?)` | `alertInfo/alertSuccess/alertWarning/alertError(message)` based on type |

### Phase B: `app.shell` — IShell

#### Files to Create

| File | Purpose |
|---|---|
| `/src/renderer/api/types/shell.d.ts` | IShell, IVersionService, IEncryptionService interfaces |
| `/src/renderer/api/shell.ts` | Shell implementation (flat file, not subfolder — small enough) |

#### Files to Modify

| File | Change |
|---|---|
| `/src/renderer/api/types/app.d.ts` | Add `shell: IShell` to IApp |
| `/src/renderer/api/app.ts` | Add `_shell` field, getter, `import("./shell")` in `initServices()` |

#### Interface Design

```typescript
// shell.d.ts
export interface IRuntimeVersions {
    electron: string;
    node: string;
    chrome: string;
}

export interface IUpdateInfo {
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    releaseUrl: string | null;
    publishedAt: string | null;
    releaseNotes: string | null;
    error?: string;
}

export interface IVersionService {
    /** Runtime version info (Electron, Node, Chrome). */
    runtimeVersions(): Promise<IRuntimeVersions>;

    /** Check for updates. Returns update info. */
    checkForUpdates(force?: boolean): Promise<IUpdateInfo>;
}

export interface IEncryptionService {
    /** Encrypt text with password. Returns encrypted string. */
    encrypt(text: string, password: string): Promise<string>;

    /** Decrypt text with password. Returns decrypted string. */
    decrypt(encryptedText: string, password: string): Promise<string>;

    /** Check if text is encrypted. */
    isEncrypted(text: string): boolean;
}

export interface IShell {
    /** Open URL in the OS default browser. */
    openExternal(url: string): Promise<void>;

    /** Version and update information. */
    readonly version: IVersionService;

    /** Content encryption/decryption (AES-GCM). */
    readonly encryption: IEncryptionService;

    // Deferred to later phases:
    // readonly fileSearch: IFileSearchService;
    // readonly scripting: IScriptingService;
    // spawn(command, args): Promise<SpawnResult>;
    // browserRegistration: IBrowserRegistration;
}
```

#### Delegation

| Method | Delegates to |
|---|---|
| `openExternal(url)` | `require("electron").shell.openExternal(url)` |
| `version.runtimeVersions()` | `api.getRuntimeVersions()` (IPC) |
| `version.checkForUpdates(force?)` | `api.checkForUpdates(force)` (IPC) → maps to `IUpdateInfo` |
| `encryption.encrypt(text, pw)` | `encryptText(text, pw)` from `core/services/encryption.ts` |
| `encryption.decrypt(text, pw)` | `decryptText(text, pw)` from `core/services/encryption.ts` |
| `encryption.isEncrypted(text)` | `isEncrypted(text)` from `core/services/encryption.ts` |

### Phase C: Documentation & Wiring

- Create `api-reference/ui.md` — full IUserInterface reference
- Create `api-reference/shell.md` — full IShell reference
- Update `api-reference/app.md` — add `ui` and `shell` property sections
- Update `api-reference/README.md` — mark Phase 3 Implemented
- Create `migration/6.app-ui.md` — migration doc (Status: Complete)
- Create `migration/7.app-shell.md` — migration doc (Status: Complete)
- Update `migration/README.md` — Phase 3 table marked Complete
- Verify Monaco IntelliSense sees `ui.d.ts` and `shell.d.ts`
- Update `active.md` — move to Recently Completed

---

## Acceptance Criteria

- [ ] `IUserInterface` interface defined in `types/ui.d.ts`
- [ ] `ui.ts` implementation wraps existing dialog/notification functions
- [ ] `app.ui.confirm()` shows confirmation dialog and returns button label
- [ ] `app.ui.input()` shows input dialog and returns result or null
- [ ] `app.ui.password()` shows password dialog and returns password or null
- [ ] `app.ui.notify()` shows toast notification
- [ ] `IShell` interface defined in `types/shell.d.ts`
- [ ] `shell.ts` implementation wraps version, encryption, openExternal
- [ ] `app.shell.openExternal(url)` opens URL in default browser
- [ ] `app.shell.version.runtimeVersions()` returns Electron/Node/Chrome versions
- [ ] `app.shell.version.checkForUpdates()` checks for updates
- [ ] `app.shell.encryption.encrypt/decrypt()` work correctly
- [ ] `app.shell.encryption.isEncrypted()` detects encrypted content
- [ ] All interfaces visible in Monaco IntelliSense for scripts
- [ ] API reference docs created for `app.ui` and `app.shell`
- [ ] Migration docs created and marked Complete
- [ ] `npm run lint` passes with no new errors
- [ ] No regressions in existing functionality

---

## Notes

### Design Decisions

1. **Flat `shell.ts` file** — Not a subfolder. Only 3 sub-services (version, encryption, openExternal), not enough to warrant `shell/shell.ts`, `shell/version.ts`, etc. If file search/scripting are added later, can refactor to subfolder.

2. **`null` instead of `undefined`** — Dialog methods return `null` on cancel (not `undefined`), consistent with `app.fs` dialog convention established in Phase 2.

3. **`notify()` is fire-and-forget** — Returns `void`, not `Promise`. Toast notifications don't need to be awaited. Internally the alert functions return promises but callers never use them.

4. **`IUpdateInfo` simplifies `UpdateCheckResult`** — Renames `releaseInfo` fields to flat properties (`releaseUrl`, `publishedAt`, `releaseNotes`) for script-friendliness. Maps internally.

5. **Deferred capabilities clearly documented** — File search, scripting, spawn, browser registration, sidebar folders, progress/status are explicitly deferred with rationale.

## Related

- Migration plan: [/doc/future-architecture/migration/README.md](../../future-architecture/migration/README.md)
- Interface objects: [/doc/future-architecture/interface-objects.md](../../future-architecture/interface-objects.md)
- Previous phase: US-044 (Phase 2 — File System & Window)
- Next phase: US-046 (Phase 4 — Core Workspace: app.pages + IPage)
