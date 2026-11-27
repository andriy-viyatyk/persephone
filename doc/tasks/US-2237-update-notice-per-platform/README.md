# US-2237: Update notice per platform

[EPIC-216](../../epics/EPIC-216.md) · Planned

## Goal

Make the update notice offer the matching installer for the running platform and package format, with a release-page fallback. Keep this a notice, not an automatic updater.

## Background

- `src/main/version-service.ts` uses Electron `net.fetch` for GitHub `releases/latest`, ignores unsuccessful responses, prereleases and exceptions, and maps `tag_name`, `html_url`, `published_at` and `body` into `ReleaseInfo`. It checks at most every 24 hours unless forced, compares with `compareVersions` from `src/shared/version-utils.ts`, and broadcasts `eUpdateAvailable` only once per new version. `src/main/main-services.ts` starts the automatic check only for the default profile. Preserve all of this behavior.
- `src/ipc/api-param-types.ts` defines `ReleaseInfo` and `UpdateCheckResult`; `src/ipc/contracts/app.ts` carries the result both as `checkForUpdates` and `eUpdateAvailable`. `src/ipc/main/app-handlers.ts` delegates the call. The existing typed IPC and event channel already carry the information; no new protocol, channel, correlator or network request is needed.
- `src/renderer/api/internal/RendererEventsService.ts` uses the event to show `api.updateAvailable` ("New version {version} is available! Click to open About page."); clicking opens About, not a download. `src/renderer/editors/about/AboutView.ts` maps that event in `mapUpdateResult`; a manual check calls `shell.version.checkForUpdates(true)`, whose separate mapping is in `src/renderer/api/shell/version.ts`. About's `renderUpdateStatus` opens `releaseUrl` with `shell.openExternal` via `about-update-download`, currently labeled `board.download` ("Download"), although the URL is the release page. What's New opens the in-app guide separately. `src/renderer/api/types/shell.d.ts` owns `IUpdateInfo`; `vite.renderer.config.ts` `editorTypesPlugin` copies it to `assets/editor-types/shell.d.ts` at build and dev start for Monaco IntelliSense. `assets/guides/scripting/api/shell.md` explicitly documents `IUpdateInfo.releaseUrl` as the release-page URL: preserve that meaning.
- `src/shared/platform.ts` owns `supportedPlatform`, `isWindows` and `isLinux`; `src/shared/platform-features.ts` owns feature availability, not package selection. `eslint.config.mjs` enforces `platform-check/no-scattered-platform-checks` for `src`, with a counted, shrinking `existingPlatformChecks` baseline and exemptions for the shared platform owners. Reuse `supportedPlatform`; add no `process.platform` access or allowlist entry. Platform modules remain pure and Electron-free.
- `electron-builder.yml` configures NSIS `persephone-setup-${version}.${ext}` and a separate Windows ZIP. The [US-2234 plan](../US-2234-linux-package-targets/README.md) proposes `persephone-${version}-linux-${arch}.deb` and `persephone-${version}-linux-${arch}.AppImage`; the Windows setup is `persephone-setup-${version}.exe`. All three match the respective patterns below. Match formats, not exact versioned names: case-insensitive `/setup.*\.exe$/` for the Windows setup executable, `/\.deb$/` for Debian and `/\.appimage$/` for AppImage. Do not select the Windows ZIP, `.exe.blockmap`, Linux metadata or another format. US-2234 must retain names satisfying these patterns; verify its final artifacts when available.
- [EPIC-216](../../epics/EPIC-216.md) decisions 2 and 7 prohibit publishing as part of this epic and place platform rules in the platform layer. macOS and unsupported platforms fall back to the release page.

## Implementation Plan

- [x] Add a focused, pure collaborator `src/shared/update-asset-policy.ts` to own format selection and filename matching. Reuse `supportedPlatform` from `src/shared/platform.ts` at the call site; accept the platform and an AppImage-presence boolean as inputs so all cases can be tested without mutating process globals. On Windows match the setup `.exe`; on Linux use AppImage when `process.env.APPIMAGE` is set and `.deb` otherwise; for macOS/unsupported return no match. Treat a nonempty `APPIMAGE` as set. Scan assets in release order and select the first matching name with a nonempty `browser_download_url`; skip malformed entries and return no match for a missing/non-array assets value. Document the three small patterns here, including the proposed US-2234 names. Keep environment access in main and platform/format branching in this collaborator, not `version-service.ts`.
- [x] In `src/main/version-service.ts` `fetchLatestRelease`, pass `data.assets`, `supportedPlatform` and `Boolean(process.env.APPIMAGE)` to that policy. Preserve `htmlUrl: data.html_url`; add a nullable `downloadUrl` holding the selected asset's `browser_download_url` (null if none). Do not replace the release page or change the fetch, timing, version comparison or notification behavior. Before → after, schematically:

  ```ts
  // Before
  htmlUrl: data.html_url,
  // After
  htmlUrl: data.html_url,
  downloadUrl: selectUpdateAssetUrl(data.assets, supportedPlatform, Boolean(process.env.APPIMAGE)),
  ```

- [x] Add `downloadUrl: string | null` to `ReleaseInfo` in `src/ipc/api-param-types.ts`. Preserve `IUpdateInfo.releaseUrl` as the release page and add `downloadUrl: string | null` in the source `src/renderer/api/types/shell.d.ts`. Run the build to sync `assets/editor-types/shell.d.ts` through `editorTypesPlugin` and verify the generated copy matches the source; include that copy in the change. Extract the duplicate `UpdateCheckResult` → `IUpdateInfo` conversion from `AboutView.ts` and `src/renderer/api/shell/version.ts` into a small renderer shell collaborator, e.g. `src/renderer/api/shell/map-update-result.ts`; both event and manual check reuse it. Existing `src/ipc/contracts/app.ts` types automatically carry the extended result. Before → after for the mapping:

  ```ts
  releaseUrl: ri?.htmlUrl ?? null,
  // after, retaining the above:
  downloadUrl: ri?.downloadUrl ?? null,
  ```

- [x] In `src/renderer/editors/about/AboutView.ts` `renderUpdateStatus`, reuse `shell.openExternal` and select `downloadUrl ?? releaseUrl`. Label the action `board.download` when the asset exists; otherwise use a new `about.openReleasePage` message "Open release page" in `src/shared/i18n/en/about.ts`. Keep the `about-update-download` selector stable, and keep What's New and the notification behavior unchanged. Before → after, schematically:

  ```ts
  // Before
  onClick: () => { void shell.openExternal(releaseUrl); },
  children: t("board.download"),
  // After
  onClick: () => { void shell.openExternal(downloadUrl ?? releaseUrl); },
  children: downloadUrl ? t("board.download") : t("about.openReleasePage"),
  ```

  Update `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts`'s `about-update-download` description to mention the release-page fallback. Only `about.openReleasePage` is a new English catalog message; translate it into all built-in language packs at epic close and run `npm run i18n:check` then. Existing `api.updateAvailable`, `board.download` and `about.download` need no change.
- [ ] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. Typecheck and lint are run for this implementation; the concurrent build-prod belongs to the other Codex run and must not be run here. Claude checks the notice manually with available release data on Windows and Linux: setup, `.deb` and AppImage selection, the download and release-page fallback labels and destinations, and agreement between automatic notification and manual About checks. Verify missing/nonmatching assets and unsupported platforms fall back, and confirm no ZIP or blockmap is selected. Do not add unit tests, fixture injection or test plumbing, and do not publish a release.
- [ ] At the epic documentation step, update `assets/guides/getting-started.md` §Checking for Updates to describe the action and fallback; update `assets/guides/scripting/api/shell.md` for the new nullable `downloadUrl` while retaining the `releaseUrl` definition. Review `assets/guides/screens/index.md` (the Download selector's label can now be Open release page) and `assets/guides/boards/published-boards.md` (cross-reference to About's check; board update behavior is unchanged). Run `npm run guides:check` if guides change. Translations and completion skills are deferred to epic close.

## Concerns

- A format-only match assumes at most one intended asset per format; selection is deterministic in GitHub array order. Architecture variants are out of scope (EPIC-216 targets x64); check US-2234's final artifact names against these patterns before implementation/ship. An absent asset, including during a partial draft or on unsupported platforms, must open the release page rather than a different package.
- `APPIMAGE` identifies the running AppImage; an ordinary Linux development run or `.deb` selects `.deb`. This does not infer the installed Windows ZIP; Windows always offers setup as specified.
- `downloadUrl` is nullable and separate from `releaseUrl` so existing scripts retain their documented release-page link. The fallback label must follow actual selection, not just platform. Ignore unusable asset entries rather than breaking the entire update check.

## Acceptance Criteria

- [ ] A newer release offers the Windows setup executable, Linux `.deb`, or Linux AppImage when `APPIMAGE` is nonempty, using its `browser_download_url`; matching does not depend on full artifact names or versions.
- [ ] Missing, malformed or nonmatching assets and unsupported platforms offer `html_url` with "Open release page"; a selected asset shows "Download". The toast still opens About, and both automatic and manual About results agree.
- [x] `releaseUrl` remains the release page for scripts; the separate nullable `downloadUrl` is exposed consistently through existing typed IPC and documented. No extra network request, protocol, direct `process.platform` check or allowlist growth is introduced.
- [ ] Existing version comparison, 24-hour gating, profile behavior, notification deduplication, manual refresh and What's New remain intact. `npm run typecheck`, `npm run lint` and `npm run build-prod` pass; manual/Claude checks cover selection and fallback; user-guide changes and English catalog translation are handled at epic close.
- [ ] No package or release is published by this task. Claude checks live Linux behavior in the epic workflow.

## Files Changed

| Path | Planned change |
|---|---|
| `src/shared/update-asset-policy.ts` | New pure platform/format and asset-selection owner; reuses platform identity passed from `src/shared/platform.ts`. |
| `src/main/version-service.ts` | Feed release assets and runtime context to the policy; retain page URL. |
| `src/ipc/api-param-types.ts` | Add nullable asset URL to `ReleaseInfo`. |
| `src/renderer/api/types/shell.d.ts`, `assets/editor-types/shell.d.ts` | Add nullable asset URL to the source and sync the IntelliSense copy with the Vite build plugin. |
| `src/renderer/api/shell/map-update-result.ts` | New shared renderer mapping for both result paths. |
| `src/renderer/api/shell/version.ts`, `src/renderer/editors/about/AboutView.ts` | Reuse mapping; choose and label About action. |
| `src/shared/i18n/en/about.ts` | Add `about.openReleasePage`. |
| `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts` | Describe fallback for the stable action selector. |
| `assets/guides/getting-started.md`, `assets/guides/scripting/api/shell.md` | Update at epic documentation step; review `assets/guides/screens/index.md` and `assets/guides/boards/published-boards.md`. |
| `assets/languages/` | Translate the new English message at epic close. |

**No changes needed:** `electron-builder.yml` (US-2234 owns packaging), `src/shared/platform.ts`, `src/shared/platform-features.ts`, `eslint.config.mjs`, `src/ipc/contracts/app.ts`, `src/ipc/main/app-handlers.ts`, `src/renderer/api/internal/RendererEventsService.ts`, `src/shared/version-utils.ts`, `src/main/main-services.ts`, and the release workflow. The dashboard and epic task table are maintained separately by Claude.


