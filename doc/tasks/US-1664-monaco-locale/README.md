# US-1664 — Monaco UI language

Epic: [EPIC-125 — UI localization](../../epics/EPIC-125.md#us-1664--monaco-ui-language)

## Goal

Load Monaco's translated NLS message table before any Monaco module initializes, using the locale resolved synchronously for this window at startup. English and unsupported locales load no translation chunk; Monaco locale selection stays fixed for the life of the window (D5).

## Background

The renderer entry is `src/renderer.ts`. It imports `src/renderer/i18n/startup.ts` before bootstrapping; that module reads the language setting and packs, calls `resolveLocale()`, then sets the shared active locale. Bootstrap currently starts `import("./renderer/index")` and `app.initSetup()` together. `app.initSetup()` dynamically imports `src/renderer/api/setup/configure-monaco.ts`, whose first statement imports `monaco-editor`; other editor views also import Monaco directly, so the NLS table must be ready before bootstrap starts either path. The editor registry itself loads editor modules on demand.

The installed package is Monaco 0.55.1. `esm/vs/nls.messages.js` implements `getNLSMessages()` by reading `globalThis._VSCODE_NLS_MESSAGES`, and `esm/vs/nls.js` consumes that getter. Each `esm/nls.messages.<lang>.js` file assigns the translated array to that global when evaluated. Set `_VSCODE_NLS_LANGUAGE` as well before Monaco imports, because `vs/nls.js` reads it to determine pseudo-localization. The language files do not themselves set that language global.

`vite.renderer.config.ts` uses `vite-plugin-monaco-editor-esm` 2.0.2 with TypeScript, editor worker service, JSON, and HTML workers. The plugin's worker configuration does not inline renderer dynamic imports. `scripts/build-prod.mjs` builds the renderer with this Vite config and does not set `inlineDynamicImports`, custom chunks, or an external rule for Monaco NLS modules. Literal dynamic imports therefore remain independently loadable chunks in dev and production.

Locale resolution returns the selected pack code (including a user pack); D6 resolves exact code, then base-language pack, then English. Map locale identifiers case-insensitively and use an explicit literal-import allow-list. Recommendation: also serve Monaco's `cs`, `tr`, and `zh-tw` messages for matching user packs, even though those codes are not built in. This makes Monaco follow an available translation without broadening the app's built-in set. Keep `ru` absent from the map so no locale value can construct or select its import (D15).

## Implementation Plan

- [x] Confirm package version, Vite plugin/worker config, startup order, NLS globals, and production chunking behavior against source and `node_modules`.
- [x] Add `src/renderer/i18n/monaco-nls.ts`. Normalize the active locale and choose a NLS file only through a `switch` whose branches contain literal imports. Map `pt-BR` to `pt-br`, `zh-CN` to `zh-cn`, exact `zh-TW` to `zh-tw`, and regional tags through their base-language branch; use Monaco's `pt-br` for base `pt` and `zh-cn` for base `zh`. Include `de`, `es`, `fr`, `it`, `ja`, `ko`, `pl`, `cs`, and `tr`. Do not add a `ru` branch or construct an import path from a locale string. Await the selected import, then set `_VSCODE_NLS_LANGUAGE` to the selected Monaco locale before returning.
- [x] In `src/renderer.ts`, call the NLS loader after `src/renderer/i18n/startup.ts` has run and before importing the renderer UI or calling `app.initSetup()`. Preserve the English fast path by returning `undefined` when there is no translation import, and await only a returned promise.
- [x] Keep the existing `vite-plugin-monaco-editor-esm` configuration in `vite.renderer.config.ts`; do not add a glob import, eager NLS import, or production inline-dynamic-import setting.
- [ ] Verify the German user-pack path manually: create `%APPDATA%\persephone\data\languages\de.lang.json` with `{"schemaVersion":1,"code":"de","name":"Deutsch","englishName":"German","messages":{}}`, select German, launch a fresh window, and confirm Monaco's find widget shows German.

Verification run: `npm run lint` passed with the repository's existing warnings. `npm run typecheck` reports three errors in `src/renderer/editors/tools-hub/SiteExtensionsTab.ts` for `tools.extensionValid`, `tools.extensionInvalid`, and `tools.extensionConflictStatus`; none are in this task's files. `npm run build-prod` passed. The build emitted `nls.messages.cs-ON7EhZu8.js`, `nls.messages.de-DrZ8SDHN.js`, `nls.messages.es-NuphEog7.js`, `nls.messages.fr-Dc1veeW4.js`, `nls.messages.it-tzQ1qBHT.js`, `nls.messages.ja-DLYfns7b.js`, `nls.messages.ko-M6h4Lkvm.js`, `nls.messages.pl-DpYUnm_Q.js`, `nls.messages.pt-br-YMTPjlIb.js`, `nls.messages.tr-kNhwRK3J.js`, `nls.messages.zh-cn-6DjRte7D.js`, and `nls.messages.zh-tw-DxJmWQsK.js` as separate chunks.

### Before → after

Before, the startup path can begin importing Monaco while no Monaco NLS table has been selected:

```ts
await Promise.all([import("./renderer/index"), app.init(), app.initSetup()]);
```

After, locale setup gates those imports only when the explicit map has a translation:

```ts
const nlsReady = loadMonacoNls();
if (nlsReady) await nlsReady;
await Promise.all([import("./renderer/index"), app.init(), app.initSetup()]);
```

The loader's source shape is intentionally a closed set of import literals:

```ts
switch (language) {
    case "de": return import("monaco-editor/esm/nls.messages.de.js");
    // Remaining explicit supported codes; no ru branch.
    default: return undefined;
}
```

## Concerns

- The app's built-in set in roadmap §4 includes `de`, `es`, `fr`, `it`, `ja`, `ko`, `pl`, `pt-BR`, and `zh-CN` as Monaco-translated. This plan additionally supports Monaco's shipped `cs`, `tr`, and `zh-TW` files for corresponding user packs; the allow-list remains explicit and excludes Russian.
- Production Vite output names include content hashes; exact names are recorded after the build.
- Manual UI verification requires restarting into a German-selected window because Monaco's NLS locale is fixed at startup.

## Acceptance Criteria

- A German-selected fresh window displays German in Monaco's find widget (and Monaco's other NLS-backed widgets, menus, hovers, and palette).
- The NLS language module finishes loading before the first Monaco import in the renderer.
- English and unsupported locales do not request or include a language-specific NLS chunk at runtime.
- The only NLS imports are literal branches for `de`, `es`, `fr`, `it`, `ja`, `ko`, `pl`, `pt-br`, `zh-cn`, `zh-tw`, `cs`, and `tr`; no code path can import `nls.messages.ru.js`.
- D5's per-window startup selection is preserved; D15 cannot be bypassed through a constructed import path.
- `npm run lint`, `npm run typecheck`, and `npm run build-prod` complete successfully, and production NLS chunk names are recorded.

## Files Changed

Files investigated that need no changes: `vite.renderer.config.ts`, `scripts/build-prod.mjs`, `src/renderer/i18n/startup.ts`, `src/shared/i18n/active-locale.ts`, `src/renderer/api/setup/configure-monaco.ts`, `src/renderer/editors/register-editors.ts`, and `node_modules/monaco-editor/esm/**`.

| File | Change |
|---|---|
| `doc/tasks/US-1664-monaco-locale/README.md` | This implementation task document and progress checklist. |
| `src/renderer/i18n/monaco-nls.ts` | New startup loader using literal, allow-listed Monaco NLS imports. |
| `src/renderer.ts` | Await selected NLS chunk before importing/initializing Monaco consumers. |
