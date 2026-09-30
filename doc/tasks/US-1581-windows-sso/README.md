# US-1581: Windows single sign-on for Microsoft work accounts in the browser editor

## Status

**Status:** In Progress  
**Priority:** High  
**Epic:** None (standalone)  
**Started:** 2026-10-01

## Goal

Allow an opted-in Persephone browser profile to use Windows-provided proof-of-possession credentials during Microsoft work and school account sign-in. Keep the feature off by default, restricted to Microsoft identity-provider origins and ordinary browser profiles, and keep all returned credential material transient and private.

## Background

On an Entra-joined device, a browser sign-in can succeed at the password step and still fail Conditional Access with AADSTS 53003 because the request lacks device state. Edge, Chrome, and Firefox integrate Windows' `IProofOfPossessionCookieInfoManager`; Electron webviews do not. The clean Chrome User-Agent is already applied by `cleanUserAgent(ses)` in `src/main/browser-service.ts`, so changing User-Agent is unrelated to the missing proof-of-possession data.

Windows declares `ProofOfPossessionCookieInfo` in `proofofpossessioncookieinfo.h` with `name`, `data`, `flags`, and `p3pHeader`. `GetCookieInfoForUri(uri, &count, &array)` returns allocated entries and the caller must release the result with `FreeProofOfPossessionCookieInfoArray`. The class is created through CLSID `A9927F85-A304-4390-8B23-A75F1C668600`. [Microsoft structure reference](https://learn.microsoft.com/en-us/windows/win32/api/proofofpossessioncookieinfo/ns-proofofpossessioncookieinfo-proofofpossessioncookieinfo) · [Windows SDK interface declaration and allocation contract](https://github.com/tpn/winsdk-10/blob/master/Include/10.0.16299.0/um/ProofOfPossessionCookieInfo.idl)

### Browser implementation research

- Chromium's `chrome/browser/enterprise/platform_auth/cloud_ap_provider_win.cc` obtains the COM class with `CoCreateInstance`, calls `GetCookieInfoForUri` for the request URL, and frees the returned array. It obtains eligible origins from Windows registry `LoginUri` / `LoginUrl` entries; if none exist it falls back to the exact origins `https://login.live.com` and `https://login.microsoftonline.com`. Use that origin policy rather than sending credentials to all Microsoft-looking hosts or all subdomains. [Chromium CloudAP provider](https://chromium.googlesource.com/chromium/src/+/5ecc573cd0c95e8d5513a14836adb41d7c9f31eb/chrome/browser/enterprise/platform_auth/cloud_ap_provider_win.cc)
- Chromium performs the per-request COM fetch asynchronously on a COM-initialized task runner. Its ordinary provider path creates a COM STA task runner, while provider checks assert an MTA; this means COM apartment choice belongs to the operation and must not be assumed from Electron's main thread. Chromium has no persistent credential cache in this path. [Chromium `GetData` / `GetAuthData` implementation](https://chromium.googlesource.com/chromium/src/+/5ecc573cd0c95e8d5513a14836adb41d7c9f31eb/chrome/browser/enterprise/platform_auth/cloud_ap_provider_win.cc)
- Chromium emits names beginning `x-ms-` as dedicated request headers and strips any semicolon-delimited cookie attributes from their values. Other returned entries are serialized into `Cookie`. It does not use `flags` or `p3pHeader` in this HTTP-header path; preserve the fields at the native boundary only as needed to safely own/free the struct, and document that Electron is not applying WinINet cookie semantics. [Chromium cookie conversion](https://chromium.googlesource.com/chromium/src/+/5ecc573cd0c95e8d5513a14836adb41d7c9f31eb/chrome/browser/enterprise/platform_auth/cloud_ap_provider_win.cc)
- Current Firefox `netwerk/protocol/http/HttpWinUtils.cpp` calls Windows for a request URI, caches the COM manager instance, and releases it at shutdown. It attaches `x-ms-` entries as individual headers. Its non-`x-ms-` cookie compatibility path is limited to `.live.com` hosts, where it merges into the existing Cookie header with `; `; the source explicitly says replacing the header is needed because generic header merge separates cookies with commas. It strips attributes after `;` and frees the array after use. [Firefox `HttpWinUtils.cpp`](https://searchfox.org/firefox-main/source/netwerk/protocol/http/HttpWinUtils.cpp)
- Firefox's current WindowsSSO UI copy is “Allow Windows single sign-on for Microsoft, work, and school accounts”; the setting is opt-in and maps to `network.http.windows-sso.enabled`. [Firefox support article](https://support.mozilla.org/en-US/kb/windows-sso?redirectlocale=en-US&redirectslug=windows-sso-redirect-1) · [Firefox admin policy](https://firefox-admin-docs.mozilla.org/reference/policies/windowssso/)

### Existing Persephone integration points

- `src/main/browser-service.ts` listens to Electron's `session-created` event and runs `cleanUserAgent(ses)`; browser partitions are created from `getPartitionString()` in `src/renderer/editors/browser/BrowserEditorModel.ts`: normal sessions are `persist:browser-${profileName || "default"}`, incognito sessions are `browser-incognito-${uuid}`, and Tor sessions are `browser-tor-${uuid}`.
- Electron 43 exposes `Session.isPersistent()` and `Session.storagePath`. For `session.fromPartition("persist:<name>")`, Electron removes `persist:`, lowercases the partition name, and runs Chromium `base::EscapePath` before using it as the directory under the session-data `Partitions` directory; `storagePath` returns that actual path, and in-memory sessions have `storagePath === null`. This repo does not override `sessionData`, so Electron's default is `userData`. Use `isPersistent()` plus the final storage-path component beginning with the escaped `browser-` prefix to identify browser profiles. The profile editor only trims names and prevents case-insensitive duplicates; it does not constrain punctuation, so do not compare against an unescaped renderer string. [Electron 43 Session API](https://github.com/electron/electron/blob/v43.0.0/docs/api/session.md) · [Electron 43 partition-name transformation](https://github.com/electron/electron/blob/v43.0.0/shell/browser/electron_browser_context.cc)
- The only current `webRequest.onBeforeSendHeaders` owner is `src/main/network-logger.ts::hookSession`. Electron permits only one listener per webRequest event per session, so the SSO logic must be composed into this existing listener (or a single shared listener coordinator), not registered as a second handler. `onCompleted` and `onErrorOccurred` also belong to `network-logger.ts`. CDP event subscriptions in `src/main/cdp-service.ts` are separate and do not register webRequest handlers.
- `src/main/network-logger.ts` copies request headers into an in-memory `NetworkLogEntry`. Unlike its separate `getNetworkLogMetadata()` projection, `BrowserChannel.getNetworkLog` returns cloned entries including `requestHeaders`; `src/renderer/automation/operations.ts::networkRequests` forwards that result, and `src/renderer/api/types/browser-editor.d.ts::IBrowserNetworkRequest` exposes the header record to scripts and automation/MCP. Therefore simply omitting the token from a metadata projection is insufficient: redact injected SSO headers and cookies before storing the entry. CDP history in `src/main/cdp-service.ts` stores request URL/method and response headers only.
- Settings are renderer-owned in `src/renderer/api/settings.ts`: add a boolean key with default `false` and a setting comment. `src/renderer/api/types/settings.d.ts` exposes generic `get<T>(key: string)` / `set<T>(key: string, value: T)` and needs no new key union. The settings navigation catalogue is `src/renderer/editors/settings/settings-catalog.ts`; section rendering and setting change subscriptions are in `src/renderer/editors/settings/SettingsView.ts` and `src/renderer/editors/settings/sections/BrowserProfilesSection.ts`. Browser profile settings currently store `{ name, color, bookmarksFile?, network? }`; the feature should be a **global opt-in**, shown in Settings → Browser → Browser Profiles, rather than per-profile. A global switch avoids duplicating a Windows account capability across profile records; main must receive only the boolean policy, never cookie data.
- The existing webview registration in `src/main/browser-service.ts::registerWebview` arrives on `dom-ready`, after the first navigation, and popup windows handled by `guardPopupWindow` / `did-create-window` are not registered webviews. The SSO path must therefore use the `Session` object captured by `src/main/network-logger.ts::hookSession`, not renderer flags, webview registration, or pre-navigation partition IPC. Only a persistent Session whose storage path identifies a `persist:browser-*` partition is eligible; incognito and Tor are in-memory Sessions (`isPersistent() === false`, `storagePath === null`) and are excluded structurally. Cache that verdict in a `WeakMap<Session, boolean>`.

## Implementation Plan

1. **Add a `sso-cookies <uri>` subcommand to the existing Rust helper.** Add `snip-tool/src/sso_cookies.rs` and dispatch it from `snip-tool/src/main.rs`, following the existing `clipboard-read` / `clipboard-write` subcommand shape. The subcommand runs `CoInitializeEx(COINIT_MULTITHREADED)`, creates CLSID `A9927F85-A304-4390-8B23-A75F1C668600` via `CoCreateInstance` for interface IID `CDAECE56-4EDF-43DF-B113-88E4556FA1BB`, calls `IProofOfPossessionCookieInfoManager::GetCookieInfoForUri`, copies each returned name/data string into owned Rust strings, frees the returned allocation on all paths, then calls `CoUninitialize` after successful COM initialization. Emit one JSON line to stdout in the form `{"cookies":[{"name":"...","data":"..."}]}`; omit `flags` and P3P. On any error emit `{"cookies":[]}` and exit 0. Never write token material or error details to stderr.

   - **Windows API binding decision:** `windows-sys` 0.52 already exposes the `ProofOfPossessionCookieInfo` layout and coclass CLSID under `Win32_Networking_WinInet`, but its interface is an opaque pointer alias and it does not expose `GetCookieInfoForUri` or `FreeProofOfPossessionCookieInfoArray`. The SDK defines the free helper as `__inline`, so there is no DLL/import-library export to link. Keep the existing lightweight `windows-sys` dependency and add only the required feature flags (`Win32_Networking_WinInet`, `Win32_System_Com`); define the small COM vtable locally (the three `IUnknown` slots followed by `GetCookieInfoForUri`) and free each field pointer and the array with the already-generated `CoTaskMemFree` binding, matching the SDK inline helper's ownership contract. Pin the interface IID from the SDK declaration and check HRESULTs. This avoids introducing the larger `windows` crate or hand-maintaining unrelated generated bindings. [windows-sys 0.52 WinInet declarations](https://docs.rs/windows-sys/0.52.0/windows_sys/Win32/Networking/WinInet/index.html) · [SDK interface and inline free helper](https://github.com/tpn/winsdk-10/blob/master/Include/10.0.16299.0/um/ProofOfPossessionCookieInfo.idl).
   - **JSON:** `snip-tool` currently hand-serializes JSON in `clipboard.rs` and `clipboard_watch.rs`, using `clipboard::json_escape`; reuse that escape helper for cookie names/data rather than adding `serde_json`.
   - **Build and packaging:** no build or packaging change is needed. `.github/workflows/publish.yml` already runs `cargo build --release` in `snip-tool/`, and `electron-builder.yml::extraFiles` already ships `snip-tool/target/release/persephone-snip.exe` beside the application executable. `scripts/dev.mjs`, `scripts/build-prod.mjs`, `npm run dist`, and `npm run dist:publish` do not build this Rust helper. In development `getSnipToolPath()` expects `snip-tool/target/release/persephone-snip.exe`, so developers need to run `cargo build --release --manifest-path snip-tool/Cargo.toml` manually; the feature silently stays unavailable if the executable is absent. The packaged lookup continues to use the shipped executable beside `process.execPath`. [snip helper path resolution](../../../../src/main/snip-service.ts) · [Rust publish build](../../../../.github/workflows/publish.yml) · [sidecar packaging](../../../../electron-builder.yml).
   - **Process boundary and alternatives:** invoke the already-shipped helper per eligible request; the extra process startup should be on the order of tens of milliseconds and only occurs for the small number of Microsoft login requests. A policy that blocks `persephone-snip.exe` also disables existing screen snip/clipboard helper behavior, and SSO should silently remain off in that case. The Rust subcommand is recommended because it reuses the project build and shipping path, avoids a C++ toolchain and Electron ABI coupling, and contains Windows ownership logic in the helper. A C++ native module would introduce a compiler toolchain, Electron ABI constraints, packaging work, and another binary module. Koffi would still add a native dependency and leave COM vtable, calling convention, and array cleanup declarations in JS-facing code. This task does not add BrowserCore.exe or a persistent helper process.

2. **Add the main-process adapter `src/main/windows-sso.ts`.** Spawn `getSnipToolPath()` with `sso-cookies` and the request URI, piping stdout and stderr; parse stdout and drain/discard stderr without logging either stream. Read the single JSON line and return its `cookies` array; return `[]` on non-Windows, missing executable, non-zero exit, malformed output, timeout, or any other error. Enforce a 3000 ms deadline and kill the child on timeout. Spawn a fresh helper per eligible request; do not keep a persistent process or cache results.

3. **Compose request handling in one place.** In `src/main/network-logger.ts::hookSession`, keep exactly one `onBeforeSendHeaders` listener. Cache the eligibility verdict in a module-level `WeakMap<Session, boolean>` using the `Session` captured by `hookSession`; do not rely on `details.webContentsId`, because popup requests may not resolve through browser registration. Only requests that pass the enabled global setting, cached eligible-session verdict, exact-origin match, and HTTPS check take the asynchronous path. Every other request follows today's synchronous callback path. On eligible requests, await the helper result up to a fixed 3000 ms deadline, merge headers only if it completes in time, redact the injected headers and SSO cookies from the request-log clone, then call Electron's callback exactly once. On timeout or helper failure, kill/settle the child, call back with the original request headers, and discard a late result. Leave OPTIONS preflight behavior unchanged.

   **Origin policy:** v1 uses only the two fixed Chromium fallback origins: `https://login.microsoftonline.com` and `https://login.live.com`. Require HTTPS and exact normalized origin equality; do not authorize broad suffixes such as `*.microsoft.com`, `*.windows.net`, or caller-provided URL patterns. Do not read Windows registry `LoginUri` / `LoginUrl` values in v1. Supporting sovereign-cloud or tenant-specific origins can be considered as a separate follow-up.

   **Header mapping:** emit every `x-ms-` item as its own request header (including `x-ms-RefreshTokenCredential` and optional `x-ms-DeviceCredential`); remove any cookie attributes beginning at the first `;` from those header values. Aggregate non-`x-ms-` items into the existing `Cookie` header with `; ` separators, preserving existing cookie pairs. Match Chromium's generic behavior; Firefox restricts legacy non-`x-ms-` cookie injection to `.live.com`. `flags` and `p3pHeader` control WinINet cookie-setting behavior, not Chromium's HTTP header mapping; do not attempt to emulate those semantics in Electron.

   **Before → after (conceptual; after must remain one webRequest listener):**

   ```ts
   // Before: logger stores the same headers that it forwards.
   const entry = { requestHeaders: { ...details.requestHeaders } };
   callback({ requestHeaders: details.requestHeaders });

   // After: only eligible HTTPS IdP requests await COM; every other request passes through.
   const requestHeaders = await withWindowsSsoIfEligible(session, details.url, details.requestHeaders, enabled);
   const entry = { requestHeaders: redactWindowsSsoHeaders(requestHeaders) };
   callback({ requestHeaders });
   ```

4. **Wire the global opt-in.** Add `browser.windows-sso` (boolean, `false`) to `src/renderer/api/settings.ts` and its comment; add a checkbox row with the Firefox-inspired label “Allow Windows single sign-on for Microsoft, work, and school accounts” in Settings → Browser → Browser Profiles (`src/renderer/editors/settings/settings-catalog.ts`, `SettingsView.ts`, and the Browser Profiles section view/model). `src/renderer/api/types/settings.d.ts` already uses a generic string key and needs no change. Synchronize only this global boolean to main via one dedicated typed IPC path in `src/ipc/browser-ipc.ts` / `src/main/browser-service.ts`, including initial state and later updates. The request listener derives session eligibility directly from the `Session`. Do not store per-profile token material or read the Windows account state just to render Settings.

5. **Keep secrets outside logs and app surfaces.** Ensure the helper output reaches only the main-process request handler. Never log token values, include them in errors, save them in settings, cache them across requests/documents, pass them over IPC to the renderer, or expose them through the scripting API, browser `networkRequests()`, MCP, CDP history, or developer diagnostics. Redact credentials before storing each request-log entry; keep response headers/body behavior unchanged.

6. **Update documentation after implementation.** Revise `assets/guides/editors/browser.md` to explain the opt-in, Windows / supported-origin behavior, default-off state, and private-session exclusion. Revise `doc/architecture/browser-editor.md` to document the main-process helper-process boundary, shared webRequest listener composition, origin policy, settings synchronization, and secret redaction. Update the `snip-tool` row in `doc/architecture/key-files.md` to include `sso-cookies` and `snip-tool/src/sso_cookies.rs`; there is no `snip-tool/README.md` or separate subcommand guide. Keep the task checklist and `doc/active-work.md` current. (This task is investigation/documentation only; no feature code, guide, architecture doc, or native call is being implemented now.)

## Implementation notes (2026-10-01)

Implemented as planned, with these deliberate differences:

- The setting key is `browser-windows-sso`, following the existing `browser-*` key names.
- The boolean reaches main through `Endpoint.setWindowsSsoEnabled` (`src/ipc/api-types.ts`,
  `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts`), the same path
  `main.scripting.enabled` uses; it is sent at startup and on change from `src/renderer/api/app.ts`.
- Only `mainFrame` / `subFrame` requests to the two origins get the proof, matching Chromium's
  navigation-level behavior and keeping the helper off the sign-in page's XHR and script traffic.
- Session eligibility: `ses.isPersistent()` and a storage path ending in `Partitions/browser-<name>`
  (checked against the on-disk `%APPDATA%/persephone/Partitions` folders), cached per Session.

## Concerns / Open questions

- Electron's webRequest callback is asynchronous, but starting the helper can delay the request. The selected maximum wait is 3000 ms; timeout, missing executable, missing COM class (`REGDB_E_CLASSNOTREG`), unavailable Windows API, COM initialization failure, empty results, or any helper/native error silently continues with the original headers and does not fail navigation. The child is killed on timeout and late output is discarded.
- `ProofOfPossessionCookieInfo.flags` and `p3pHeader` are returned for InternetSetCookieEx semantics. Chromium's auth-header path ignores them; if implementation encounters non-`x-ms-` cookies, validate only required value parsing and preserve browser-managed cookie behavior.
- The global preference is persisted in renderer settings while the request path runs in main; initialize the single boolean IPC state before browser use and update it whenever the setting changes. Session eligibility itself is derived and cached in main, so popup webContents and restored browser pages use the same policy without renderer registration.
- v1 intentionally excludes sovereign-cloud origins. If customers require sovereign or tenant-specific IdPs, evaluate safe origin discovery as a separately scoped follow-up.
- Per the project workflow, this task document is review-only. Do not start implementation until the user explicitly says “let's implement”.

## Acceptance Criteria

- [ ] On Windows, with the global setting enabled and a normal persistent browser partition, allowed HTTPS IdP requests receive per-request Windows proof-of-possession data returned by `IProofOfPossessionCookieInfoManager` through `persephone-snip.exe sso-cookies <uri>`.
- [ ] Only Chromium-derived exact eligible origins are considered; all other hosts, non-HTTPS requests, disabled settings, non-Windows systems, missing COM class, and native failures continue with unchanged request behavior.
- [ ] v1's exact origin set is `https://login.microsoftonline.com` and `https://login.live.com`; registry `LoginUri` / `LoginUrl` discovery is deferred.
- [ ] Incognito and Tor requests never call the native API or receive injected values.
- [ ] The native array and all member strings are always released using the SDK helper's `CoTaskMemFree` ownership contract; returned flags/P3P are not misrepresented as browser Cookie storage semantics.
- [ ] Exactly one `webRequest.onBeforeSendHeaders` listener remains per session, composed with `network-logger.ts` and invoked once for every request path.
- [ ] SSO values are transient and never logged, persisted, passed to renderer/scripting/MCP, or returned by browser `networkRequests()`; internal request log entries are redacted before storage.
- [ ] The setting appears in Browser Profiles Settings, is global, opt-in, and defaults to off.
- [ ] `assets/guides/editors/browser.md` and `doc/architecture/browser-editor.md` describe the implemented setting, origin/privacy boundaries, and token handling.
- [ ] No User-Agent change, BrowserCore.exe dependency, or real Windows token inspection is required.
- [ ] The main-process adapter spawns a fresh helper only for eligible requests, enforces a 3000 ms deadline, kills timed-out children, and degrades silently when the helper is missing or fails.
- [ ] Verify by manual real EPAM sign-in, then run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

## Files planned for implementation

| File | Planned role |
|---|---|
| `snip-tool/src/main.rs` | Dispatch the `sso-cookies <uri>` subcommand. |
| `snip-tool/src/sso_cookies.rs` | Call the Windows COM API, copy and free returned entries, and emit the minimal JSON protocol. |
| `snip-tool/Cargo.toml` | Add the `windows-sys` feature flags needed for WinInet/COM declarations; no new crate is recommended. |
| `src/main/windows-sso.ts` | Spawn `persephone-snip.exe`, parse stdout, enforce the deadline, and silently return no cookies on errors. |
| `src/main/network-logger.ts` | Compose SSO injection into the sole per-session before-send listener and redact stored request headers. |
| `src/main/browser-service.ts`, `src/ipc/browser-ipc.ts` | Sync only the global preference; private partition exclusion is derived from the Session in `network-logger.ts`. |
| `src/renderer/api/settings.ts` | Add global default-off browser Windows SSO setting. |
| `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/editors/settings/SettingsView.ts`, `src/renderer/editors/settings/sections/BrowserProfilesSection.ts` | Surface the opt-in in Browser Profiles settings. |
| `assets/guides/editors/browser.md`, `doc/architecture/browser-editor.md`, `doc/architecture/key-files.md` | Explain the user-facing setting, helper integration/privacy boundary, and new subcommand location. |

## Files that need no changes

- `src/main/browser-service.ts::cleanUserAgent` — the User-Agent is already normalized and does not supply device proof.
- Electron webview preload and renderer scripts — credential acquisition and injection belong exclusively in the main process.
- MCP/scripting method definitions and `src/renderer/api/types/browser-editor.d.ts` — no token or new browser API is exposed.
- `BrowserCore.exe` integration — the chosen approach calls the Windows COM API directly and adds no broker process.
- `launcher/` and `mneme/` Rust sidecars — no changes are needed to these unrelated helpers.

## Related

- [Browser editor architecture](../../architecture/browser-editor.md)
- [Browser editor user guide](../../../assets/guides/editors/browser.md)
- [Chromium CloudAP Windows provider](https://chromium.googlesource.com/chromium/src/+/5ecc573cd0c95e8d5513a14836adb41d7c9f31eb/chrome/browser/enterprise/platform_auth/cloud_ap_provider_win.cc)
- [Firefox Windows SSO implementation](https://searchfox.org/firefox-main/source/netwerk/protocol/http/HttpWinUtils.cpp)

## Files Changed Summary

| File | Change |
|---|---|
| `doc/tasks/US-1581-windows-sso/README.md` | This investigation, verified findings, design decision, and implementation plan. |
| `doc/active-work.md` | Active standalone task link for US-1581. |
