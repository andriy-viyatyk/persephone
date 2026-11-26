# US-2229: Hide clipboard history on Linux

Epic: [EPIC-215](../../epics/EPIC-215.md), US-2224 capture decision 3.

## Goal

Do not offer or run clipboard history on Linux, even with a profile copied from Windows. Preserve Windows history and the separate file clipboard.

## Background

GNOME Wayland provides no supported background clipboard watch; the user decided that focus-only capture is misleading for a clipboard manager meant to record everything copied. The epic rejects XWayland polling and keeps file copy, cut, and paste.

`src/shared/platform-features.ts` already owns a Windows-only `clipboard.backgroundWatch` matrix entry and produces `Not available on Linux.` via `getPlatformFeature`, its single public reader. Its only current caller is the focus-only note in `src/renderer/editors/settings/sections/ClipboardSection.ts`. Rename it `clipboard.history`: the rule now covers the entire feature, not merely its watching mechanism. Keep the existing generic reason pattern; explain GNOME Wayland in the guide. `clipboard.files` remains independent.

Verified surfaces and behavior:

- `src/renderer/editors/settings/settings-catalog.ts` defines the Clipboard section and filters the default-browser section only in `createSettingsSectionDescriptors`; `src/renderer/scripting/ai-vision/namespaces/settings.ts` independently consumes the raw `SETTINGS_CATALOG` for agent elements and sections. `SettingsView.ts` maps the Clipboard factory. `settings-schema.ts` retains both setting keys and embeds a Linux sampling comment. `settings-effects.ts` sends the stored value to main after startup and on changes.
- `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` filters the Mneme switch using the feature matrix, but always offers Clipboard. `src/renderer/editors/explorer/ExplorerSecondaryView.ts` shows its Clipboard button whenever the saved setting is true. `src/renderer/api/creatable-items.ts` always registers the Clipboard tool; `getCreatableItems` supplies Tools & Editors and new-page choices independently of that setting.
- `src/renderer/api/pages/standalone-pages.ts` opens the dedicated Clipboard page. A copied/restored page can contain the panel via `src/renderer/editors/register-editors.ts` and `src/renderer/api/pages/descriptor-migrations.ts`; `ClipboardSecondaryView.ts` currently mounts the history model and offers Settings or Restart. `ClipboardHistoryModel` fetches saved history via IPC.
- `src/renderer/scripting/ai-vision/root.ts` owns the MCP and `app.call` tree: its `clipboardEnabled()` only checks the setting for descriptor members and children, while its getter returns a node. `namespaces/clipboard.ts` describes focus-only Linux behavior in `$help`. The script `AppWrapper` has `app.call`, but no direct `app.clipboard` history API; `page.editor.clipboard` in the browser facade is a separate page-scoped test API. The test client's `ctx.app.clipboard` is a call-tree proxy, not that script API. `src/main/mcp/manifest.ts` unconditionally advertises the node. There is no `assets/agent/` directory in this checkout.
- `src/main/clipboard-service.ts` branches on `isLinux` in status, enable, restart, health monitoring and shutdown; `captureLinuxClipboardSample` feeds persistence. Both `setEnabledInternal` and `restartClipboard` load and trim history before starting the sampler in `src/main/clipboard-history-linux.ts`, which reads the separate Linux file clipboard. `src/ipc/main/clipboard-handlers.ts` exposes these operations. A saved true value therefore starts sampling today.
- There is no separately named clipboard guide: the Clipboard guide is `assets/guides/screens/sidebar.md#clipboard`. Other current claims appear in `assets/guides/desktop-integration.md`, `tabs-and-navigation/menu-bar.md`, `screens/settings.md`, `agents/scripting/the-app-object.md`, `scripting/api/settings.md`, and `scripting/api/page.md`. `assets/guides/whats-new.md` is historical release text.

## Implementation Plan

- [x] **Availability owner:** rename `clipboard.backgroundWatch` to `clipboard.history` in `src/shared/platform-features.ts`, retaining its current matrix and generic `unavailableReason`. Every consumer calls `getPlatformFeature`; do not add `isLinux` branches for this rule. Search for the old ID after the rename.

  ```ts
  // Before
  "clipboard.backgroundWatch": { win32: true, linux: false, darwin: false, unsupported: false },
  // After
  "clipboard.history": { win32: true, linux: false, darwin: false, unsupported: false },
  ```

- [x] **Settings catalog owner:** in `src/renderer/editors/settings/settings-catalog.ts`, expose one availability-filtered catalog to both `createSettingsSectionDescriptors` and `src/renderer/scripting/ai-vision/namespaces/settings.ts`, reusing `getPlatformFeature`; preserve the existing default-browser filter as well. This removes both Clipboard rows and the section from UI and agent settings discovery on Linux. Remove focus-only claims from the remaining Clipboard metadata. In `ClipboardSection.ts`, remove the obsolete Linux note and its `isLinux`/feature imports. Remove `settings.clipboardFocusedLinux` from `src/shared/i18n/en/settings.ts`. In `src/renderer/api/settings-schema.ts`, keep the keys and defaults for profile compatibility but replace the Linux sampling comment with an availability-aware comment using the feature result; keep unrelated `isLinux` uses. Do not rewrite the stored value.

  ```ts
  // Before: raw catalog is used by the agent; UI applies its own filter
  SETTINGS_CATALOG.filter((catalog) => catalog.id !== "default-browser" || getPlatformFeature("desktop.defaultBrowser").available)
  // After: both consumers use the same filtered catalog
  getAvailableSettingsCatalog()
  ```

- [x] **Presentation owners:** `HeaderQuickSettingsPopover.ts` filters the Clipboard switch using the same feature result alongside its existing Mneme filter. `ExplorerSecondaryView.ts` combines availability with the setting inside `setClipboardButton`, so initial load and later watches cannot expose it from a copied profile. `src/renderer/api/creatable-items.ts` filters its Clipboard entry in `getCreatableItems` using the feature, covering Tools & Editors and new-page menus without changing category storage. Keep the standalone-page and editor restore registrations so old layouts can restore safely. In `src/renderer/editors/clipboard/ClipboardSecondaryView.ts`, handle an unavailable restored panel before starting monitoring or showing history: display an English-catalog unavailable message, suppress its list, Settings, Clear and Restart actions, and allow Close. Reuse `getPlatformFeature` and `NotificationView`; add any new UI message only in `src/shared/i18n/en/explorer.ts` and defer translations to epic close. No growth in roadmap §2.3 files.

- [x] **Main lifecycle owner:** in `src/main/clipboard-service.ts`, remove the sampler import, `captureLinuxClipboardSample`, all sampler/status/health/shutdown branches and `src/main/clipboard-history-linux.ts`. Gate both `setEnabledInternal` and `restartClipboard` on `getPlatformFeature("clipboard.history")` **before** loading or trimming history, starting a watcher, or setting `enabled = true`; return disabled status without treating unavailable as a startup error. Thus copied settings and data stay intact, and IPC restart cannot bypass the gate. Keep Windows sidecar, persistence, queue, and health behavior unchanged; avoid passing a Linux request through the Windows sidecar. Keep `settings-effects.ts` forwarding stored settings: main is the authoritative enforcement boundary.

  ```ts
  // Before: stored true starts Linux sampling after loading/trimming
  if (isLinux) startLinuxClipboardHistory(captureLinuxClipboardSample, onError);
  // After: setEnabledInternal and restartClipboard, before history IO
  if (!getPlatformFeature("clipboard.history").available) return getStatus();
  ```

- [x] **Agent owner:** in `src/renderer/scripting/ai-vision/root.ts`, make `clipboardEnabled()` require both availability and the setting, for descriptor members and children. Ensure direct `clipboard`, `clipboard.$help`, and descendants through MCP and `app.call` cannot bypass the condition: use the existing AiVision restriction/descriptor mechanism and the shared unavailable reason, while preserving disabled-setting behavior. Update `namespaces/clipboard.ts` help and root summary to remove focus-only claims. In `src/main/mcp/manifest.ts`, use the platform feature result to produce accurate server instructions, including the shared unavailable reason when off; no unconditionally advertised usable node on Linux. Verify both discovery and direct paths, including with a true stored setting.

- [x] **Guides:** in `assets/guides/screens/sidebar.md#clipboard`, add the short sentence: “Clipboard history is unavailable on Linux because GNOME Wayland gives apps no way to watch the clipboard.” Update the affected current guides listed above to remove focus-only and always-available claims, accurately describe platform availability and restored-panel behavior, and preserve file clipboard guidance. Keep `whats-new.md` as historical release notes. Run `npm run guides:check` after guide edits.

- [x] **Tests (Codex writes, Claude runs):** adapt `integration-test/tests/tools/clipboard/clipboard.test.mjs`, `integration-test/tests/shell/menu-bar/menu-bar.test.mjs` and `integration-test/tests/sidebar/panels/other-panels.test.mjs`: tests that use clipboard history get `requires: ["windows"]` (the existing platform tag); add one Linux-only test (`requires: ["linux"]`: add "linux" as a new automatic requirement in its owner `src/shared/test-requirements.ts` — `automaticRequirementReason` returns "requires Linux" on Windows — and to `REQUIREMENT_TAGS` in `integration-test/lib/context.mjs`; mention it in `doc/standards/integration-tests.md` where the windows tag is described) that seeds `clipboard.enabled: true` and asserts absence of the Settings section, quick switch, Explorer button, creatable Clipboard tool and the agent `clipboard` node (direct path errors). No other new coverage. Codex cannot start Persephone, so it runs `npm run typecheck`, `npm run lint`, `npm run guides:check` and `npm run build-prod` only; Claude runs the affected UI areas on Windows and in the VM. Translation and epic-wide review/document/userdoc are deferred to epic close.

## Concerns

- The matrix is off for macOS and unsupported platforms too, matching its existing entries; do not silently launch the Windows helper there.
- A restored Clipboard page must stay closeable without showing saved items or suggesting a nonexistent settings toggle. A copied history directory must not be trimmed merely because Linux starts or receives restart.
- The settings catalog also supplies agent metadata; filtering only the visible Settings view would leave a false offer. The AiVision getter needs a direct-path check in addition to hiding discovery.
- No unresolved product decision: EPIC-215 decision 3 resolves the mechanism and Linux policy.

## Acceptance Criteria

- Linux shows no history setting, quick switch, Explorer button, or creatable Clipboard tool, including with `clipboard.enabled: true`; restored panels show an unavailable reason and can close.
- Linux main never starts a watcher, loads or trims history as a consequence of enabling/restarting, or overwrites the stored setting. Windows history behavior is unchanged.
- MCP and `app.call` discovery and direct paths honor availability; help and server instructions accurately describe it. The direct script `app` surface remains unchanged.
- Linux sampler and wiring are gone; file clipboard copy, cut, and paste remain unchanged. Current guides state the Linux limitation; guide check passes.
- Typecheck, lint and affected Windows UI tests pass; Linux runtime verification is handed to the epic VM check. New English UI text is in the catalog, with translations deferred to epic close.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/platform-features.ts` | Rename feature and retain availability/reason. |
| `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Share filtered catalog for UI and agent discovery. |
| `src/renderer/editors/settings/sections/ClipboardSection.ts`, `src/renderer/api/settings-schema.ts`, `src/shared/i18n/en/settings.ts` | Remove focus-only note and correct settings comment. |
| `src/renderer/ui/app/HeaderQuickSettingsPopover.ts`, `src/renderer/editors/explorer/ExplorerSecondaryView.ts`, `src/renderer/api/creatable-items.ts` | Hide history entry points. |
| `src/renderer/editors/clipboard/ClipboardSecondaryView.ts`, `src/shared/i18n/en/explorer.ts` | Safe unavailable restored panel and catalog text. |
| `src/main/clipboard-service.ts`, `src/main/clipboard-history-linux.ts` | Enforce availability; remove sampler file and wiring. |
| `src/renderer/scripting/ai-vision/root.ts`, `src/renderer/scripting/ai-vision/namespaces/clipboard.ts`, `src/main/mcp/manifest.ts` | Gate and correct agent discovery, access, and help. |
| `assets/guides/screens/sidebar.md`, `assets/guides/screens/settings.md`, `assets/guides/desktop-integration.md`, `assets/guides/tabs-and-navigation/menu-bar.md`, `assets/guides/agents/scripting/the-app-object.md`, `assets/guides/scripting/api/settings.md`, `assets/guides/scripting/api/page.md` | Correct current user and agent guidance. |
| `integration-test/tests/tools/clipboard/clipboard.test.mjs`, `integration-test/tests/shell/menu-bar/menu-bar.test.mjs`, `integration-test/tests/sidebar/panels/other-panels.test.mjs` | Cover platform behavior and preserve Windows tests. |

**No changes:** `src/main/clip-service-linux.ts` and `clipboard.files` (file clipboard); `src/renderer/scripting/api-wrapper/AppWrapper.ts` and browser clipboard facade (no direct history API); IPC contracts and `src/renderer/api/settings-effects.ts` (existing transport); restore registrations and descriptor migrations (old layouts still restore); `assets/guides/whats-new.md` (historical); `assets/languages/` (translations deferred).
