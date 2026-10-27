# US-1729: Give board services the app locale

## Goal

Expose Persephone's effective UI locale to every board module service started by the main process. Ensure a service that is already running cannot keep using an outdated locale after the user changes the app language.

## Background

### Verified source of truth

- `src/renderer/i18n/startup.ts` reads the saved language and preferred OS languages, loads built-in/user packs, and resolves `activeLocale` through `resolveLocale()`. It calls `setActiveLocale(activeLocale)` for renderer consumers, then reports the effective code through `api.setActiveLocale(activeLocale)`.
- `src/ipc/main/core-handlers.ts`, `Controller.setActiveLocale()`, receives that report and calls `setMainLocale()` in `src/main/i18n-locale.ts`. `setMainLocale()` resolves the reported code against available packs, then updates the main process's `shared/i18n/active-locale.ts` state via `setActiveLocale(locale)`. `getActiveLocale()` is therefore the main-process source of truth for the effective language; it returns a resolved code (including `en-XA`), not the saved `auto` preference.
- `src/renderer/editors/settings/sections/LanguageSection.ts` and `src/renderer/api/languages.ts` save the selected language and request `api.reloadAllWindows()`. The new renderer reports its effective locale during startup. `assets/guides/agents/boards.md`'s Bridge 1.36.0 note confirms board registration happens again after this reload.
- Board pages already receive the locale at registration: `BoardWebview.registerBoard()` loads `boardI18n` and passes `boardI18n.context` to `api.registerBoard(...)`; `loadBoardI18n()` in `src/renderer/editors/board/board-i18n.ts` uses `getActiveLocale()`. `src/main/board-protocol-service.ts` puts this context in `window.__persephoneBoot`, and the board shim exposes its `locale.code` as `persephone.locale.code`. The guide documents the same contract and examples such as regional codes and `en-XA`.

### Service process and API

- `ModuleServiceSupervisor.startOneAttempt()` in `src/main/module-service-supervisor.ts` launches `assets/module-service-host.mjs` with `utilityProcess.fork()`, the service entry as an argument, the board root as `cwd`, and `buildServiceEnvironment(boardRoot)` as `env`.
- `buildServiceEnvironment()` intentionally copies only an allow-list, including `APPDATA`, `LOCALAPPDATA`, PATH and standard Windows/runtime variables; it then adds `PERSEPHONE_SERVICE=1` and `PERSEPHONE_BOARD_ROOT`. It does not copy the main process's arbitrary environment, and currently carries no Persephone UI locale.
- `assets/module-service-host.mjs` imports the board's ESM service entry and exposes a global `persephone` object. The host-managed APIs include `persephone.storage`, `persephone.settings`, `persephone.providers.register()`, and `persephone.service.onRequest()`, `onChannel()`, and `onShutdown()`. The guide documents `persephone.service.request()` as the frame-side request API and the host-side callbacks. The service runs in a utility-process Node runtime with Node built-ins and board-root module resolution; it has no Electron `app`, `BrowserWindow`, `webContents`, or `ipcMain` API. Legacy raw parent-port services remain supported.
- The env value is for the Node service process (`process.env`), not a board-frame bridge member. Services that need the locale read `process.env.PERSEPHONE_LOCALE` when handling each request that needs it; they must not cache it once at startup. The host keeps this process environment value current while the service remains running, including for `speech.transcribe` callers without an open Speech to Text page.

### Delivery and lifecycle decision

Keep `PERSEPHONE_LOCALE` in the sanitized service environment, populated from main's `getActiveLocale()` at spawn time. Preserve the resolved code exactly (`uk`, `zh-CN`, `pt-BR`, `en`, `en-XA`, etc.). Do not use the persisted `"auto"` setting or derive the locale from Windows `LANG`.

When the effective locale changes, update every running utility process in place. Add a host control message `{ kind: "locale-changed", locale: string }` to the main/utility-process protocol in `src/ipc/module-service-channels.ts`. The supervisor sends it with the existing `record.process?.postMessage(message)` path to records with a running process. In `assets/module-service-host.mjs`, handle this control message in the host's parent-port message dispatch by assigning `process.env.PERSEPHONE_LOCALE = message.locale`; consume it in the host and do not forward it to a board callback. This adds no service API or callback and does not stop or restart processes, so agent sessions and other in-flight service work survive language changes.

`setMainLocale()` is called for every renderer startup report, including each window and reload. Compare the resolved code with `getActiveLocale()` before changing it and notify the supervisor only when those codes differ. If a service starts before the first report, `getActiveLocale()` has the initialized `"en"` default, so it starts with that spawn-time environment value and receives the first differing locale report as an in-place host message. Repeated same-code reports do nothing.

No change to the board-frame bridge is required: this is a live service-process environment contract, while `persephone.locale.code` remains a page API. Keep `BOARD_BRIDGE_VERSION` unchanged at `1.42.0`. The Speech to Text board change in `persephone-boards` (BT-064) must gate on `minAppVersion: "5.0.15"`, the Persephone version in `package.json` that will ship US-1729; that version is currently unreleased. Do not add a `minBridgeVersion` requirement for this service environment value.

## Implementation Plan

1. [x] **Capture effective locale changes in main.** In `src/main/i18n-locale.ts`, compare the resolved `locale` with `getActiveLocale()` before replacing the active locale. After updating it, notify the existing `moduleServiceSupervisor` singleton (exported at the bottom of `src/main/module-service-supervisor.ts`) only when the effective code changed. Keep pack reload/tray behavior intact. The locale is established in main by the renderer's startup call through `Controller.setActiveLocale()` in `src/ipc/main/core-handlers.ts`; this runs on every window startup and reload, so same-code reports are no-ops.

2. [x] **Update running service hosts in place.** Add a supervisor method in `src/main/module-service-supervisor.ts` that sends `{ kind: "locale-changed", locale }` with `record.process.postMessage(...)` to each record that currently has a running process. Extend `ServiceParentMessage` in `src/ipc/module-service-channels.ts` with this control message. The existing `process.on("message", ...)` routing in the supervisor can ignore this host-directed message; `assets/module-service-host.mjs` receives it through its existing parent-port message listener, assigns `process.env.PERSEPHONE_LOCALE = message.locale`, and consumes it without invoking or forwarding to a board callback. Do not stop/restart services or disturb their running work.

3. [x] **Pass the effective locale at each spawn.** In `ModuleServiceSupervisor.buildServiceEnvironment()`, add `PERSEPHONE_LOCALE: getActiveLocale()` alongside the existing explicit `PERSEPHONE_SERVICE` and `PERSEPHONE_BOARD_ROOT` values. Continue not inheriting unrelated `process.env` variables. Services read the value when needed (per request), rather than capturing it at startup. If the service starts before the first renderer report, it receives the initialized `"en"` default and is updated in place when a different locale is reported.

4. [x] **Update the board authoring guide.** In `assets/guides/agents/boards.md`, extend “Declared services and shared storage” with `PERSEPHONE_LOCALE`, its supported value shape, spawn-time default, and live updates on locale changes. Tell service authors to read it when needed, per request. State that the environment value does not require a new `minBridgeVersion`; keep the page-only `persephone.locale.code` requirement at Bridge 1.36.0. For the Speech to Text board change tracked in BT-064, require `minAppVersion: "5.0.15"`.

5. [x] **Update the architecture reference.** Update the module-service spawning and host sections in `doc/architecture/overview.md` with the spawn-time locale and live `locale-changed` host control message. Update the supervisor and host descriptions in `doc/architecture/key-files.md` as needed to keep its purpose index current. The architecture overview already documents service spawning and the static host, so do not update `doc/epics/EPIC-131.md` for this behavior.

### Before → after contract

Current `buildServiceEnvironment()` behavior in `src/main/module-service-supervisor.ts`:

```ts
environment.PERSEPHONE_SERVICE = "1";
environment.PERSEPHONE_BOARD_ROOT = boardRoot;
return environment;
```

Planned service startup contract:

```ts
environment.PERSEPHONE_SERVICE = "1";
environment.PERSEPHONE_BOARD_ROOT = boardRoot;
environment.PERSEPHONE_LOCALE = getActiveLocale();
return environment;
```

Service usage (read at the point of use, such as inside each request handler):

```js
function transcribe(request) {
    const appLocale = process.env.PERSEPHONE_LOCALE; // e.g. "uk", "zh-CN", "pt-BR", "en", "en-XA"
    // Handle request using the current appLocale.
}
```

## Concerns / Open Questions

- **Design decision resolved:** keep spawn-time `PERSEPHONE_LOCALE` and add a host-only `locale-changed` parent message to update running processes in place. No callback or new board API is added, and services read the current environment value when needed. Services started before the first renderer report receive the initialized `en` default and are corrected by the first differing report.
- `setMainLocale()` receives startup reports from every renderer window and reload. It compares the resolved code against the previous `getActiveLocale()` and sends no supervisor message when the code is unchanged.
- The allow-list includes OS `LANG`/`LC_ALL`, but these are not the Persephone UI locale and must not be used as a substitute for `PERSEPHONE_LOCALE`.

## Acceptance Criteria

- Every newly spawned board service receives `process.env.PERSEPHONE_LOCALE` equal to the main process's resolved active UI locale, including `en-XA` and regional pack codes.
- A changed effective app locale sends `{ kind: "locale-changed", locale }` to each running service process; the host updates `process.env.PERSEPHONE_LOCALE` in place and service processes, sessions, requests, and channels are not stopped by this update.
- Same-code locale reports do not notify the supervisor. A service spawned before the first report starts with `en` and receives an in-place update if the reported effective locale differs.
- `assets/guides/agents/boards.md` documents the live environment variable and per-request reading contract; `doc/architecture/overview.md` and `doc/architecture/key-files.md` document service spawning and the host message handling.
- No board-frame bridge API is introduced, `BOARD_BRIDGE_VERSION` remains `1.42.0`, and no `minBridgeVersion` is added for the environment value. The Speech to Text board change (BT-064) requires `minAppVersion: "5.0.15"`, the app version that will ship US-1729.
- No unit tests or harnesses are added or run for this task document.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/main/i18n-locale.ts` | Detect effective locale changes and notify service supervisor after updating active locale. |
| `src/main/module-service-supervisor.ts` | Notify running service processes of locale changes; pass `PERSEPHONE_LOCALE` in `buildServiceEnvironment()`. |
| `src/ipc/module-service-channels.ts` | Add the host-directed `locale-changed` parent message type. |
| `assets/module-service-host.mjs` | Handle locale updates in the parent message dispatch by updating `process.env.PERSEPHONE_LOCALE`. |
| `assets/guides/agents/boards.md` | Document service locale env value, its live updates, and per-request reading contract. |
| `doc/architecture/overview.md` | Document spawn-time locale and the in-place host control message. |
| `doc/architecture/key-files.md` | Keep the supervisor and host purpose entries current. |
| `src/shared/board-bridge-version.ts` | **No change**; environment value does not change the board-frame bridge. |
| `src/renderer/editors/board/BoardWebview.ts` and `src/renderer/editors/board/board-i18n.ts` | **No change**; the existing registration-time page locale stays as-is. |
| Board bridge shim and `src/ipc/board-bridge-channels.ts` | **No change**; this is a main-to-host process control message, not a board-frame bridge API. |
| `doc/epics/EPIC-131.md` | **No change**; `doc/architecture/overview.md` already documents service spawning and the static service host. |
| `assets/editor-types/` | **No change**; there is no new TypeScript board API. |
| `doc/tasks/US-1729-board-service-locale/README.md` | Task plan. |
| `doc/epics/EPIC-134.md` | Add US-1729 to the linked task table as Planned. |
| `doc/active-work.md` | Add the linked US-1729 task under EPIC-134 in Planned. |
