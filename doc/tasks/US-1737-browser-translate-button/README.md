# US-1737: Translate toggle button in the browser

Epic: [EPIC-135 — Translation service](../../epics/EPIC-135.md)

## Goal

Add an explicit Translate toggle to the browser toolbar. For the current page load, detect or let the user correct the source language, use the configured target language, obtain consent before any model download, translate through US-1736, and restore the original page when the user toggles translation off.

## Background

The behavior is fixed by EPIC-135’s [“Browser behaviour (user decision, 2026-10-27)”](../../epics/EPIC-135.md#browser-behaviour-user-decision-2026-10-27): no offer bar, auto-translation, or persistent always/never choice. A reload or navigation starts untranslated with the button off. The toggle is hidden when no trusted provider is available.

Verified implementation patterns:

- The browser toolbar is `BrowserToolbarView` in [src/renderer/editors/browser/BrowserView.ts](../../../src/renderer/editors/browser/BrowserView.ts). It creates `IconButtonView` controls in the constructor, updates their `active`, `hidden`, `title`, and callbacks in `sync`, and owns popovers through `PopoverView`. `BrowserEditorView` composes it with `EditorToolbarView`. The existing registry icon `globe` is defined as `GlobeIcon` in `src/renderer/theme/icons.ts` and registered in `src/renderer/theme/icon-registry.ts`.
- [src/renderer/editors/browser/BrowserEditor.ts](../../../src/renderer/editors/browser/BrowserEditor.ts) composes browser submodels; `BrowserEditorModel` is the state/data module [src/renderer/editors/browser/BrowserEditorModel.ts](../../../src/renderer/editors/browser/BrowserEditorModel.ts). The `BrowserTabData` state is per internal tab. `BrowserWebviewModel.applyNavigation` and its `did-navigate` handler already distinguish full navigation from in-page navigation; full navigation clears document-scoped browser state.
- [src/renderer/ui/translation/TextTranslationProvider.ts](../../../src/renderer/ui/translation/TextTranslationProvider.ts) lists trusted host providers through `api.getBoardServiceProviders("text.translate")` and filters to v1. It provides `describe`, `detect`, `download`, `translate`, scoped cancellation, progress callbacks, and four in-flight translate channels per shared provider instance. `detect` accepts at most 4,096 code points; `translate` accepts at most 32 items and 64,000 code points per batch.
- [src/renderer/ui/translation/TranslationServiceChannel.ts](../../../src/renderer/ui/translation/TranslationServiceChannel.ts) owns the existing `MessagePort` framing, channel backpressure, and 1 MiB message cap. Browser UI code must call the provider client, not connect directly to the board channel.
- [assets/guides/agents/text-translate.md](../../../assets/guides/agents/text-translate.md) is the service contract: `describe` reports directed pairs and sizes; `detect` returns normalized language, confidence, and candidates; `download` is explicit and reports per-leg byte progress; translation `not-ready` must not trigger a download. Provider listing is already trust-gated by the host service API.
- [src/renderer/ui/translation/TranslateTextPageController.ts](../../../src/renderer/ui/translation/TranslateTextPageController.ts) currently implements the text-editor route lookup, `Intl.DisplayNames` language names, `ui.confirm` consent, and download progress. US-1736 owns extraction of the shared workflow and provider accessor; this task only consumes them. Use `formatBytes` from [src/renderer/core/utils/format.ts](../../../src/renderer/core/utils/format.ts).
- Settings values/defaults/comments and key typing are in [src/renderer/api/settings.ts](../../../src/renderer/api/settings.ts). The browser settings group and `browser-profiles` section are in [src/renderer/editors/settings/settings-catalog.ts](../../../src/renderer/editors/settings/settings-catalog.ts); its view is [src/renderer/editors/settings/sections/BrowserProfilesSection.ts](../../../src/renderer/editors/settings/sections/BrowserProfilesSection.ts). The public [src/renderer/api/types/settings.d.ts](../../../src/renderer/api/types/settings.d.ts) exposes generic `get` / `set`; existing internal settings are not added as direct API properties. UI source strings belong in the flat English catalogs under [src/shared/i18n/en/](../../../src/shared/i18n/en/) and UI call sites use `t()` per [doc/standards/localization.md](../../standards/localization.md).
- The existing `TranslateTextToolbarContributionView` in [src/renderer/ui/translation/TranslateTextToolbarContributionView.ts](../../../src/renderer/ui/translation/TranslateTextToolbarContributionView.ts) uses a text `ButtonView`; it does not define an icon to reuse. Use the already registered `globe` icon for the browser toolbar.
- US-1736 owns the frame document agent and exact restoration. US-1737 owns toolbar activation, language detection/correction, target selection, user consent, and page-load lifecycle; it calls the US-1736 coordinator rather than manipulating the DOM itself.

### Before → after toolbar shape

The existing toolbar constructs fixed controls and synchronizes their state:

    const reload = make("toolbar-reload", "refresh", t("browser.toolbarReload"), this.model.webview.reloadOrStop);
    this.controls = [home, back, forward, reload];

Add the Translate toggle beside those controls, with availability and active state driven by the browser translation controller:

    const reload = make("toolbar-reload", "refresh", t("browser.toolbarReload"), this.model.webview.reloadOrStop);
    const translate = make("toolbar-translate", "globe", t("translation.button"), this.model.translation.toggle);
    this.controls = [home, back, forward, reload];
    // sync() updates active while on and hidden when provider discovery is empty.

## Implementation Plan

- [x] Add `BrowserTranslationController` to `src/renderer/editors/browser/BrowserTranslationController.ts` and compose it from `BrowserEditor` in `src/renderer/editors/browser/BrowserEditor.ts`. It should use the shared `TextTranslationProvider` instance/accessor from US-1736, scope all operations to the current internal tab and document generation, and expose provider availability, active state, detected language, source correction, and toggle methods to the toolbar.
- [x] On activation, call `describe`, then read `<html lang>` and a bounded visible text sample from the top-frame agent only. Read both before starting any translation writes (or derive the sample from the agent’s saved originals) so detection never receives translated output. Call provider `detect` with that sample and `htmlLang`. Use confident detection when it disagrees with `html lang`; otherwise prefer the valid page language, falling back to provider detection. Keep the detected language as the initial source. Limit the sample to 1,000–4,096 characters.
- [x] Resolve the configured target from `settings.get("browser-translate-target")`. For `"app"`, call the US-1736 shared target resolver with `getActiveLocale()` and provider target codes: select an exact locale-code match, then a match on the locale’s primary subtag, then `en`. Do not assume the UI locale is itself a supported model language. An explicit BCP-47 setting is used directly. If source and resolved target match, show the localized “already in {language}” message, leave translation off, and perform no download/request.
- [x] Resolve a direct or English-pivot route using the shared workflow helper. If all route models are installed, start translation immediately. If any are missing, ask with the summed missing size formatted by `formatBytes`; only on explicit consent call `TextTranslationProvider.download`, show localized per-leg progress using `formatBytes`, and begin page translation when the download completes. Cancellation or failure leaves/restores the page original and the toggle off.
- [x] Add a Translate `IconButtonView` to `BrowserToolbarView` in `src/renderer/editors/browser/BrowserView.ts`, place it with the navigation controls, and update it in `sync` from controller state. Hide it when no trusted `text.translate@1` provider is listed. Keep it active for the duration of translation. Do not add a browser “offer” or automatic start.
- [x] Add a button-anchored `PopoverView` showing “Translated from {language}” (or the detected language before translation) and a source-language `SelectView` populated from the detector candidates and languages supported by the provider description. A correction made while active cancels the current page scope, restores original units, and restarts translation for that page load with the corrected `from`; future batches always carry that language.
- [x] Update `BrowserWebviewModel` / the US-1736 coordinator so only a full `did-navigate` or a reload/new document ends the translated scope and resets the button to off. Same-document navigation does not count as a reload. On toggle-off, cancel outstanding requests and ask US-1736 to restore all frames. New or changed content while active remains translated by the page engine.
- [x] Add a `browser-translate-target` setting with default `"app"` (the app-language sentinel) to `AppSettingsKey`, `settingsComments`, `defaultAppSettingsState`, and the setting read/write path in `src/renderer/api/settings.ts`. Add a “Translate pages into” row to the existing `browser-profiles` section inside the existing `browser` settings group in `src/renderer/editors/settings/settings-catalog.ts`; implement its selector in `src/renderer/editors/settings/sections/BrowserProfilesSection.ts`. The selector offers “App language” plus languages advertised as provider targets; choosing a language stores its BCP-47 code. Keep the generic public settings API unchanged.
- [x] Add semantic English catalog entries in `src/shared/i18n/en/translation.ts` and/or `src/shared/i18n/en/browser.ts` for the toolbar accessible label, popup/source correction, target setting, download consent, already-in-target-language, no-route, and operation failure messages. Use `t()` at UI positions and keep whole sentences in single catalog entries with placeholders.
- [x] Consume the shared provider accessor and route, language-name, locale-to-target, consent, download, and progress helpers implemented by US-1736. Do not extract duplicate helpers, create a second provider client, or change the translation service protocol.
- [x] Leave board-facing `text.translate@1` unchanged. No `BOARD_BRIDGE_VERSION` bump is needed.

## Concerns

- Provider discovery may change while the browser page is open. Refresh availability when the browser controller is initialized and after a provider operation closes for provider removal; hide the button and restore/stop translation if the selected provider is no longer available.
- The setting sentinel `"app"` must resolve dynamically to the active app locale, including when the locale is `"auto"` and the app follows the system language. Explicit targets remain BCP-47 language codes.
- The popup’s source correction must be applied to the original source content, never to an already translated fragment; cancel and restore before restarting with the corrected language.
- All UI strings must be localized. The service contract and board API are unchanged.

## Acceptance Criteria

- [ ] Toolbar Translate is hidden when no trusted v1 provider exists and visible when one does.
- [ ] Nothing detects or translates until the user clicks the button; no offer bar or automatic translation is shown.
- [ ] A click checks page `html lang` and provider detection on a 1,000–4,096 character sample; a confident detector result wins a disagreement. The button’s popup shows the source language and lets the user correct it.
- [ ] The target comes from “Translate pages into”, whose default `"app"` follows the app language; explicit target language values are supported.
- [ ] Same source and target produces a localized already-in-target-language message and leaves page content and toggle unchanged.
- [ ] Installed routes start translation immediately. Missing model routes prompt with the aggregate missing download size, require consent, show download progress, and then begin translation.
- [ ] While active, the button remains active and later page content is translated. Correcting the source cancels, restores, and restarts from originals.
- [ ] Clicking again cancels pending work, restores original content in all participating frames, and sets the button off.
- [ ] Full reload/navigation starts the next page load with translation off; same-document navigation does not prematurely reset it.
- [ ] Browser and text-editor translation share route/name/consent/download-progress helpers and the per-window provider client’s four-channel translate cap.
- [ ] No board API or service contract change is made; `BOARD_BRIDGE_VERSION` stays unchanged.

## Files Changed

| File | Expected change |
|------|-----------------|
| `src/renderer/editors/browser/BrowserTranslationController.ts` | New controller for source detection/correction, target resolution, consent/download, toggle state, and page-load lifecycle. |
| `src/renderer/editors/browser/BrowserEditor.ts` | Compose the controller with the browser editor model. |
| `src/renderer/editors/browser/BrowserView.ts` | Add the toolbar toggle and language popup; display active/provider state. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Reset/cancel the page-load controller on full navigation and coordinate with US-1736’s frame translation engine. |
| `src/renderer/editors/settings/settings-catalog.ts` | Add the browser target setting row to the Browser settings section. |
| `src/renderer/editors/settings/sections/BrowserProfilesSection.ts` | Add the localized “Translate pages into” selector to the existing Browser Profiles settings section. |
| `src/renderer/api/settings.ts` | Declare the setting key, default, and settings-file comment. |
| `src/shared/i18n/en/translation.ts` | Add English source entries for the browser translation workflow and popup. |

### Files changed by US-1736 (shared dependencies)

| File | US-1736 change used by this task |
|------|---------------------------------|
| `src/renderer/ui/translation/TextTranslationProvider.ts` | Shared per-window client/accessor; four-channel cap remains shared. Consumers use `cancelScope` and never dispose it. |
| `src/renderer/ui/translation/TranslateTextPageController.ts` | Reuses the shared provider accessor and workflow helpers; scope remains unique per dialog run. |
| `src/renderer/ui/translation/TranslationWorkflow.ts` | Shared route, language-name, locale-to-target, consent, download, and progress helpers. |

### Files that need no changes

| File | Reason |
|------|--------|
| `assets/guides/agents/text-translate.md` | Existing contract already specifies detection, `htmlLang`, directed routes, consent-before-download, progress, cancellation, and limits. |
| `src/renderer/ui/translation/TranslationServiceChannel.ts` | Existing channel wrapper handles service message framing, acknowledgements, backpressure, and size limits. |
| `src/renderer/core/utils/format.ts` | Reuse its existing `formatBytes`; no helper change is required. |
| `src/main/module-service-supervisor.ts` | No service interface change is needed. |
| `src/shared/board-manifest-utils.ts` | No interface id change is needed. |
| `src/ipc/board-bridge-channels.ts` | No board API change is planned, so no bridge version bump. |
| `src/renderer/api/types/settings.d.ts` | Its existing generic `get` / `set` contract already supports internal settings without adding a board-facing property. |
| `src/preload-webview.ts` | US-1736 owns per-frame injection and messaging; this task uses that frame engine. |
| `src/main/browser-service.ts` | US-1736 owns the browser guest subframe-preload preference; renderer replies go directly through the webview frame API. |
| `src/renderer/ui/translation/TextTranslationProvider.ts` | US-1736 owns shared-accessor and provider-lifetime changes; US-1737 only consumes them. |
| `src/renderer/ui/translation/TranslateTextPageController.ts` | US-1736 owns its provider/workflow refactor; US-1737 does not edit the text editor controller. |
| `src/renderer/ui/translation/TranslationWorkflow.ts` | New shared helper module is created by US-1736, not duplicated by this task. |
