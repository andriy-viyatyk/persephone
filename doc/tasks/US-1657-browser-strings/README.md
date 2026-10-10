# US-1657: Browser editor strings

**Epic:** [EPIC-125 — Extract every UI string, phase 2](../../epics/EPIC-125.md) · **Status:** In Progress

## Goal

Extract app-owned browser-editor UI copy to a typed `browser` English catalog, reusing existing `common`, `shell`, `menus`, and `dialogs` messages. Preserve English identity and agent contracts, and make each browser menu item addressable by a stable ID in every locale.

## Background

EPIC-125 decisions E1–E7 and roadmap D3/D4/D8 apply. Before implementation, scoped lint found **103 findings in 15 files**. After extraction, **14 intentional findings remain**: 11 search-provider product names (`SEARCH_ENGINES[].label`), the two English `Browser` state-title assignments retained for scripts/MCP, and the `untitled.svg` generated filename. The other 89 findings were resolved. The current typed key shape is `<area>.<entryName>`; `t()` must be resolved when rendering/updating, not in module-level translated constants. Counts use CLDR message objects with `params.count`, and complete sentences with dynamic values remain a single message with `{name}` placeholders. The English `browser` catalog now has **125 keys**.

The browser view is composed from `src/renderer/editors/browser/BrowserView.ts`, `BrowserTabsPanel.ts`, `BrowserDownloadsPopup.ts`, `BookmarksDrawer.ts`, `BrowserWebviewModel.ts`, and related models. Use those existing views and model boundaries; leave dynamic page/web content untouched. Browser automation is exposed through `pages[i].editor` in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`; the stable renderer `data-name` contracts are declared in that facade and described in `assets/guides/editors/browser.md`.

### Before → after patterns

For app-authored copy in a complete sentence, keep the cause/error as a placeholder:

```ts
ui.notify(`Failed to view certificate: ${errMessage(error)}`, "error");
ui.notify(t("browser.certificateViewFailed", { error: errMessage(error) }), "error");
```

For a menu action, keep selection identity distinct from translated presentation:

```ts
{ label: "Open Link in New Tab", onClick: openLink }
{ id: "open-link-in-new-tab", label: t("browser.openLinkInNewTab"), onClick: openLink }
```

The implementation must use the actual `MenuItem` contract from `src/renderer/core/events/context-menu.ts`; these snippets show the intended identity/presentation split.

## Implementation Plan

### 1. Register and populate the browser catalog

- [x] Add and register the typed browser catalog (**125 keys**).

- Add `src/shared/i18n/en/browser.ts` using `EnglishCatalogEntry` from `src/shared/i18n/en/common.ts`, and register `browserCatalog` in `src/shared/i18n/en/index.ts` and its derived `EnglishCatalog` type. Keep keys flat and two-part.
- Add semantically named entries for the lint findings below and the missed UI copy in section 2. Reuse existing entries before adding duplicates: `common.cancel`, `common.open`, `common.items`; `shell.closeTab`, `shell.closeOtherTabs`, `shell.openInNewTab`; `menus.copy`, `menus.cut`, `menus.paste`; and `dialogs.buttonCancel`, `dialogs.buttonOpen`, `dialogs.popupCopy`, `dialogs.popupPaste` where the control is the matching dialog/popup default. Use the key whose context matches the browser action when a shared key is ambiguous; add a browser-specific message only when the existing key has a different meaning or context.
- Resolve all `t()` values in constructors, prop builders, or update/render callbacks after the active language is ready. Do not translate search-engine names, URLs, file names, web page titles, profiles, paths, permission values, or exception causes.
- Use CLDR messages for the blocked-popup count (one/other) and any other actual count-bearing sentence found in the scoped render paths. Replace conditional singular/plural strings with one catalog message, passing `count`.
- Make dynamic complete sentences single messages: profile-network retry guidance with the error and Settings destination; proxy-chip title with the current network label; certificate errors; popup/permission prompts; Tor/proxy setup and route failures. Preserve runtime `errMessage(e)` and network/certificate/page values as placeholder data. The `wants permission to access …` request must be a single message with a `{permissions}` placeholder rather than a translated prefix plus permission list.
- Put translator notes beside ambiguous short messages, shortcut strings, and technical values. Keep visible shortcut glyph/text (`Alt+Left`, `Alt+Right`) unchanged per E5.

### 2. Convert lint findings and grep-only UI copy

- [x] Convert app-owned lint and grep findings; leave provider names and deliberate agent/data text unchanged. Scoped lint leaves 14 explained findings: 11 provider names, two English Browser state-title values required by the script/MCP contract, and `untitled.svg` as a generated filename.

The 103 lint findings are recorded exactly by source file and current line below. Entries named `Google` etc. are provider/product names and stay unchanged under E5; all other listed findings are app-owned visible copy to extract. Lint flags repeated call-site occurrences separately; repeated text may share one key when the context is the same.

| File | Lint findings (`line: English literal`) |
|---|---|
| `src/renderer/editors/browser/BrowserBookmarksUIModel.ts` | `80: "This profile has no bookmarks file associated.\\nChoose an option:"`; `81: "Bookmarks File"`; `86: "Select Bookmarks File"`; `92: "Create Bookmarks File"` |
| `src/renderer/editors/browser/BrowserDownloadsPopup.ts` | `70: "Downloads"`; `109: "No downloads"`; `134: "Clear"`; `203: "Cancel"`; `211: "Open"`; `215: "Show in Folder"`; `223: "Dismiss"` |
| `src/renderer/editors/browser/BrowserEditor.ts` | `469: "Browser"` (see identity section) |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | `27: "Google"`; `34: "Bing"`; `41: "DuckDuckGo"`; `48: "Yahoo"`; `55: "Ecosia"`; `62: "Brave"`; `69: "Startpage"`; `76: "Qwant"`; `83: "Baidu"`; `90: "Perplexity"`; `98: "Gibiru"` (provider names/data: retain); `278: "Browser"` (see identity section) |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts` | `60: \`Could not apply the profile network: ${invokeErrorMessage(err)}\``; `104: "The profile network changed — reload open tabs to load them over the new route."` |
| `src/renderer/editors/browser/BrowserTabsModel.ts` | `311: "Open in New Tab"` |
| `src/renderer/editors/browser/BrowserTabsPanel.ts` | `57: "Close Tab"`; `59: "Close Tab"`; `118: "Close Tab"`; `135: "New Tab"`; `148: "Close Tab"`; `148: "Close Other Tabs"`; `148: "Close Tabs Below"` |
| `src/renderer/editors/browser/BrowserUrlBarModel.ts` | `209: "Paste and Go"` |
| `src/renderer/editors/browser/BrowserView.ts` | `317: "Retry"`; `318: "The profile's proxy could not be applied, so no page is loaded."`; `322: \`${props.error} Fix the profile's network in Settings → Browser Profiles, then retry.\``; `367: "Reload the page to apply"`; `374: "Reset permissions"`; `375: "Reload"`; `377: "View certificate"`; `434: "View certificate"`; `525: "Proxy"`; `533: "Navigate"`; `534: "Site permissions"`; `536: "Add Bookmark"`; `537: "Enter URL or search term..."`; `580: "Back (Alt+Left)"`; `581: "Forward (Alt+Right)"`; `583: "Enter URL or search term..."`; `584: "Navigate"`; `586: "Open Bookmarks"`; `587: "Tor connection info"`; `588: "Page Menu"`; `589: "Open DevTools"`; `590: "Close Tab"`; `618: \`Proxy: ${state.networkLabel} — click for connection info\``; `662: "The certificate for this page is not available yet. Reload the page and try again."`; `667: "This page changed while the certificate was being read. Reopen the site-info popover and try again."`; `688: \`Failed to view certificate: ${errMessage(error)}\``; `782: "Allow"`; `782: "Dismiss"`; `801: "Allow"`; `802: "Block"`; `820: \`wants permission to access ${names.join(" and ")}\``; `838: "Trust"`; `839: "Not now"`; `992: "Find in page..."` |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | `977: "View Source"`; `992: "View Actual DOM"`; `1007: "Show Resources"`; `1038: "No resources found on this page."` |
| `src/renderer/editors/browser/DownloadButton.ts` | `24: "Downloads"`; `28: "Downloads"` |
| `src/renderer/editors/browser/TorStatusOverlay.ts` | `35: "Close"`; `38: "Reconnect"` |
| `src/renderer/editors/browser/UrlSuggestionsDropdown.ts` | `33: "Clear"`; `33: "Clear"` |
| `src/renderer/editors/browser/browser-pages.ts` | `36: "Browser (Tor) requires tor.exe path. Configure it in Settings → tor.exe-path"`; `42: \`tor.exe not found at: ${torPath}\``; `89: \`Could not secure the Tor session — the page was not opened: ${errMessage(err)}\`` (multiline template); `103: \`Could not apply the profile's proxy — the page was not opened: ${networkError}\`` |
| `src/renderer/editors/browser/webview-context-menu.ts` | `88: "Open Link in New Tab"`; `95: "Copy Link Address"`; `99: "Add to Bookmarks"`; `138: "Open Image in New Tab"`; `144: "The page's secure route is not connected — the image was not opened."`; `151: "Copy Image Address"`; `155: "Use Image for Bookmark"`; `166: "Copy"`; `179: "Cut"`; `189: "Copy"`; `198: "Paste"`; `211: "Back"`; `217: "Forward"`; `222: "Reload"`; `229: "View Source"`; `247: "View Actual DOM"`; `263: "Show Resources"`; `270: "Open SVG in Editor"`; `275: `untitled.svg` (data filename; retain); `283: "Inspect Element"` |

The lint count includes repeated display sites, not just unique English phrases. Keep duplicate sites synchronized and reuse keys for identical meanings.

Grep/manual review also found visible copy the rule misses:

- `src/renderer/editors/browser/BrowserDownloadsPopup.ts`: `statusText` selects the app-authored strings `"Waiting for save location"`, `"Cancelled"`, and `"Failed"`; extract these and preserve filename, error payload, byte counts/units, and transfer data. There is no download-count sentence in this view today.
- `src/renderer/editors/browser/TorStatusOverlay.ts`: module-level `STATUS_MESSAGE` maps `connecting`, `connected`, `error`, and `disconnected` to `"Connecting to Tor network..."`, `"Connected to Tor"`, `"Failed to connect to Tor"`, and `"Tor is not connected"`. Keep the status codes as map keys, but resolve catalog text at sync/render time.
- `src/renderer/editors/browser/BrowserView.ts`: the blocked-popup text uses `count === 1 ? "A popup was blocked on this page" : ...`; replace with one CLDR message. Permission-row names come from permission keys; localize the fixed labels `Camera`, `Microphone`, `Location`, `Notifications`, `MIDI`, `MIDI full control (SysEx)`, `Clipboard read`, `Device use (idle detection)`, `Window management`, `Speaker selection`, and `Ask`, while retaining permission keys and `allow`/`block` values. Permission request copy in lines 814–820 has another app-authored label map (`camera`, `microphone`, `location`, `notifications`, `MIDI devices`, `MIDI system messages`, `clipboard contents`, `idle detection`, `window information`, `audio output`) and a dynamic `open {scheme} links`; translate those known labels and make the entire `wants permission to access {permissions}` sentence one message. The AI-vision badge and tooltip copy at lines 420–430 (`built-in ai-vision`, `site extension ai-vision · {name}`, and the two explanations of the site-published/site-extension model) is user-visible Browser UI; translate its fixed prose, preserving `ai-vision`, `MCP`, names and the remote model/API path as terms/data. Site-extension consent copy in lines 847–850 must be translated as complete messages with `{name}`, `{host}`, `{otherHosts}` placeholders while preserving extension identity and host data.
- `src/renderer/editors/browser/BrowserTabsPanel.ts`: `"New Tab"` is a fallback for an empty page title; when the page supplies a title/URL, that is page-authored data and stays untouched.
- `src/renderer/editors/browser/BrowserEditorModel.ts`: `SEARCH_ENGINES[].label` is shown in the search-engine selector, but the provider names are data/product names under E5 and selection already uses `id`; retain both provider names and IDs.
- `src/renderer/editors/browser/BrowserView.ts`: helper `make(name, icon, title, onClick)` takes the displayed English title positionally. Review each call and localize title descriptors lazily; `title` is not a selector or `data-name`.
- Review all `items.push`/`ContextMenuEvent.items` arrays in the scoped models, ternary labels, `textContent` assignments, templates rendered into controls, and `createTextElement`/`ButtonView` positional arguments. No app-owned English should be considered data just because it bypasses a lint property. Preserve user page DOM/text and browser errors supplied from Chromium.

### 3. Keep mixed identity and agent-facing values stable

- [x] Preserve English/API identity, add stable IDs to translated menu rows, and split translated profile-color presentation from shared palette names.

See the dedicated section below for the required case-by-case boundary. For every app menu item whose label becomes translated, add a stable `id` in kebab case, unique within that menu; callers and `scripting/ai-vision/**` must identify it by ID, not by displayed label. Search-engine provider labels and page-authored titles are not translated, so retain their current data behavior.

### 4. Exercise each live surface under `en-XA`

- [x] Run requested static checks (`npm run lint`, `npm run typecheck`, `npm run build-prod`; scoped lint also run).
- [ ] Live-check browser surfaces under `en-XA` outside the sandbox if unavailable here.

Set the language through **Settings → General → Language → Pseudo-English** and reload the development window as required. Open the Browser editor through the app menu's **Browser** command or through MCP `script.execute` using `await app.pages.showBrowserPage({ url: "about:blank" })`; navigate to an ordinary test URL using `await app.pages.openUrlInBrowserTab(url)`. Use MCP `window.screen.snapshot({ interactive: true })` to inspect the application-owned browser chrome and its returned refs/data-names; use `pages[pageId].editor.snapshot({ interactive: true })` for the browser page itself. Drive controls by `data-name`/ref and context actions by stable item ID.

Walk these states, entering each through the listed live action:

| Surface | Live entry / action |
|---|---|
| Browser toolbar, URL bar, search engine picker, navigation, page menu, DevTools, downloads | Open a Browser page as above; use its `[data-name="url-input"]`, `toolbar-*`, and `url-*` controls from `assets/guides/editors/browser.md`; click Downloads, then More for page actions. |
| Tabs and tab menu | Open at least two tabs; right-click a tab for Close Tab / Close Other Tabs / Close Tabs Below. |
| Suggestions and URL context menu | Focus and type in `[data-name="url-input"]`; right-click the field; select/dismiss a suggestion. |
| Bookmarks drawer and bookmark dialog | Click `[data-name="toolbar-bookmarks"]`; if unconfigured, choose Select Bookmarks File or Create Bookmarks File and cancel the native picker as appropriate. Click the star to add/edit; right-click a web link and choose Add to Bookmarks. Use a disposable `.link.json` file for save verification. |
| Downloads popup | Start a download from a test page; click `[data-name="toolbar-downloads"]`; check empty and in-progress/completed/failed states and actions. |
| Site permissions / certificate | Open a secure site. Use the site-info button `[data-name="url-site-permissions"]`, permission prompt controls, and View certificate. Use a test origin and do not grant capabilities beyond the check. |
| Profile network/proxy state | Configure a temporary proxy in Settings → Browser Profiles, then open/reload a Browser page with that profile. Check active chip/info, retry/error panel, and profile-network change notice. |
| Tor | Configure the Tor executable in Settings → Browser Profiles and open **Browser (Tor)** from the app menu; inspect reconnect/status overlay and toolbar Tor information. Without an available Tor executable, inspect setup/error flow only; do not treat the unavailable service as a localization defect. |
| Blocked popups and site-extension trust | Use a controlled test page that requests a popup or a site-extension trust prompt; inspect the banner, permission wording, Trust/Not now actions, and plural count. |
| Find bar | In a browser page press Ctrl+F; inspect placeholder, match count, next/previous, and close. |
| Browser-profile color names | Open Settings → Browser Profiles → a profile color menu. This is the one adjacent UI entry point included by EPIC-124 leftovers; inspect every palette tooltip/name under `en-XA`. |

For `en-XA`, verify every app-authored fixed phrase appears pseudo-localized; English remaining should be attributable to E3/E5, user/page data, or documented agent-facing English. Include both ordinary and long-label/narrow-window layouts. No code or catalog changes are part of this investigation document.

## Identity and agent-facing text

1. **Browser-generated page titles are agent-visible state.** `src/renderer/editors/browser/BrowserEditorModel.ts` initializes `state.title` to `"Browser"`; `browserPageTitle()` returns the literal `"Browser"` or `"Browser (agent)"` for private pages, otherwise the page-authored title. `src/renderer/editors/browser/BrowserEditor.ts` writes that title to editor/page state and returns it in `serialize()` (`title: s.title`). The scripting page wrapper (`src/renderer/scripting/api-wrapper/PageWrapper.ts`) and MCP AI-vision page summary expose `PageModel.title`. Keep `state.title` / `PageModel.title` English for scripts and MCP; localize only display projection in `src/renderer/ui/tabs/page-title.ts` if the shell shows it, following existing `Empty` and `Pasted HTML` projection in `src/renderer/ui/tabs/PageTabView.ts`. This also applies to browser-generated `Source: …`, `DOM: …`, and `… — Resources` titles: preserve their stored/API English titles and translate only the tab/sidebar presentation. Page-authored titles stay data. Do not translate raw state or break privacy filtering.
2. **Bookmarks chooser result is both label and control flow.** `src/renderer/editors/browser/BrowserBookmarksUIModel.ts` defines `SELECT_BOOKMARK_FILE = "Select a file"` and `CREATE_BOOKMARK_FILE = "Create new file"`, passes them as `ui.confirm` button labels, then compares returned choice with `===`. Give both buttons stable IDs and translated labels (use the confirm button-object form); compare only IDs. Keep `DialogButton.cancel` result unchanged. The later file chooser titles are display-only, and `filePath` remains persisted data.
3. **Browser context menu labels are agent-click targets today.** App items in `src/renderer/editors/browser/webview-context-menu.ts`, `BrowserTabsPanel.ts`, `BrowserTabsModel.ts`, `BrowserUrlBarModel.ts`, and `BrowserWebviewModel.ts` are visible menu rows. The AI-vision menu adapter can match by current label (`src/renderer/scripting/ai-vision/menus/index.ts`), but D4 requires IDs for extracted labels: pass/retain an ID and have automation select by it. Add IDs to items that lack one, including both distinct Copy rows in the webview menu.

   Proposed IDs, unique in their respective menus: browser webview menu — `open-link-in-new-tab`, `copy-link-address`, `add-to-bookmarks`, `open-image-in-new-tab`, `copy-image-address`, `use-image-for-bookmark`, `copy-selection`, `cut-field`, `copy-field`, `paste-field`, `back`, `forward`, `reload`, `view-source`, `view-actual-dom`, `show-resources`, `open-svg-in-editor`, `inspect-element`; browser-tab menu — `close-tab`, `close-other-tabs`, `close-tabs-below`; URL field context menu — `paste-and-go`; bookmark-link menu — `open-in-new-tab`; browser page menu (`BrowserWebviewModel`) — `view-source`, `view-actual-dom`, `show-resources`; search-engine picker — use the existing engine IDs (`google`, `bing`, `duckduckgo`, `yahoo`, `ecosia`, `brave`, `startpage`, `qwant`, `baidu`, `perplexity`, `gibiru`) as menu item IDs. Do not duplicate IDs within a single menu. The popup menu's built-in Paste/Copy/Inspect items use their existing command identity in `src/renderer/ui/dialogs/poppers/showPopupMenu.ts` and stay aligned with the `dialogs.popup*` keys.
4. **Search-provider labels are names, not translated UI prose.** `SEARCH_ENGINES` in `src/renderer/editors/browser/BrowserEditorModel.ts` has stable `id`, host, URL template, and `label`; `BrowserUrlBarModel.searchEngineMenuItems` selects by `engine.id`, and the name is a displayed provider/product name. Preserve all fields and names per E5; add IDs to menu rows if the shared menu automation requires them.
5. **Profile color names have a shared semantic use.** `src/renderer/theme/palette-colors.ts` exports `TAG_COLORS` (Dodger Blue, Hot Pink, Olive, Medium Purple, Orange, Dark Khaki, Deep Sky Blue, Tomato, Lime Green, Cornflower Blue, Sienna). `src/renderer/editors/settings/sections/BrowserProfilesSection.ts` shows each `.name` as a color-menu label/title; `src/renderer/components/git-tree/git-status-meta.ts` also looks up colors by these English names. Translate only the Browser Profiles UI, using the hex/value as selection identity and stable menu ID. Do not change `TAG_COLORS` or Git color lookups.
6. **Other passed-through values are data.** `BrowserTargetModel.ts` and `BrowserEditorFacade.ts` return internal tab IDs, URLs, loading state, and page-authored titles. Bookmarks, profile names, home URLs, download filenames/error payloads, selected text, resources, permission origins/keys, extension names/hosts, Tor status codes, network labels, file paths, search text, engine IDs/hosts, and shortcut values are data or identity; keep them unchanged. Agent-facing `$help`, MCP descriptions, thrown errors, and logs remain English. No `scripting/ai-vision/**` text/catalog adapter is to be localized here.

## Strings that stay English

- **E3 errors:** `src/renderer/editors/browser/BrowserView.ts:279` throws `Browser tab ${props.tabId} was not found.` and remains English. Any other thrown error that flows from Chromium, Tor, or the browser automation layer remains English as well. UI wrappers such as notifications/panels localize only their fixed framing and interpolate `errMessage(error)` or the raw service cause as runtime data. Tor daemon/Chromium/network error payloads remain unchanged.
- **E5 product/protocol/shortcut names:** `Persephone`, `MCP`, `Git`, `Tor`, provider/product labels `Google`, `Bing`, `DuckDuckGo`, `Yahoo`, `Ecosia`, `Brave`, `Startpage`, `Qwant`, `Baidu`, `Perplexity`, `Gibiru`; technical `SOCKS5`, HTTP, `tor.exe`, `.link.json`, `about:blank`, MIME/DOM/SVG/HTML names; and `Alt+Left` / `Alt+Right` remain exact.
- **Data and agent-facing surfaces:** URLs, origins, user/page-authored text and titles, profile names, hosts, paths, filenames, errors, download byte values, bookmarks, permission enum values, engine IDs, `BrowserEditorFacade` help/agent descriptions, MCP/AiVision contracts, and persisted `state.title` as described above remain English/data. Do not put board-owned content into this catalog. Palette names stay English in the shared palette for Git/ref semantics; only the browser-profile color picker presents their separate translated labels.

## Plurals and complete messages

- `BrowserView.ts` blocked-popup notice: one/other CLDR forms such as `"A popup was blocked on this page"` / `"{count} popups were blocked on this page"`; pass `{ count }`.
- Any download item/count summary that is a sentence must use CLDR rather than `n === 1` branches. Preserve raw progress bytes and filenames; units/data are not count grammar.
- Make the permission prompt sentence one message with `{permissions}`; do not concatenate its prefix and rendered permission names.
- Keep complete proxy/network/certificate/Tor error wrappers and profile retry instructions as one catalog message with `{error}`, `{network}`, or `{route}` placeholders, preserving error cause as data.
- Toolbar dynamic text such as `Proxy: {network} — click for connection info`, `Go to {homeUrl}`, and dynamic page title prefixes should each be a whole message if localized. Do not compose translated fragments with user or network values.

## Concerns

- `BrowserEditorModel.state.title` is deliberately privacy filtered and MCP-visible. Splitting it must not reveal private page titles to agents or change saved page title behavior.
- Profile palette labels are shared with Git UI semantics. Translate only the profile color menu presentation and keep the color's hex/value and all shared `TAG_COLORS.name` consumers stable.
- Several browser surfaces contain page-originated content by design. A pseudo-locale scan must distinguish app-authored labels from the page, downloads, URLs, filenames, errors, profile names, or user-created bookmarks.
- Browser download and Tor/proxy live states need suitable local fixtures/services. If Tor is unavailable, verify the settings-required and failure surfaces without changing the service setup just for localization.
- Browser view contains fixed-width toolbar, tab rail, and popover layouts. Check longer pseudo labels at the normal and narrow widths; record any layout fix for the epic's layout sweep.

## Acceptance Criteria

- [x] Add and register `src/shared/i18n/en/browser.ts` (**125 keys**); keep all new keys in the current `<area>.<entryName>` shape and reuse `common`, `shell`, `menus`, and `dialogs` keys where meanings match.
- [x] Convert app-owned lint findings and grep-only visible strings listed above; retain provider/product names and data per E3/E5. Fourteen scoped reports remain for the reasons recorded above.
- [x] Convert singular/plural user-facing count messages to CLDR forms, and make every complete dynamic sentence a single message with placeholders.
- [x] Preserve the English `state.title` / `PageModel.title` contract and all browser API, AI-vision, persisted data, settings values, and error causes; translate only localized shell display projection.
- [x] Every translated menu row has a stable, unique-within-menu ID and is addressable by ID in the AI-vision menu surface, in every language.
- [ ] Under `en-XA`, live-check all browser surfaces in the table above; no app-owned plain English remains outside E3/E5/data.
- [x] Browser profile UI palette labels use separate translated presentation; `TAG_COLORS` and Git lookups remain unchanged. (Live `en-XA` visual check remains pending.)

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/shared/i18n/en/browser.ts` | New typed browser messages, plural entries, placeholders, notes |
| `src/shared/i18n/en/index.ts` | Register browser catalog and derived type |
| `src/renderer/editors/browser/BrowserBookmarksUIModel.ts` | Translate chooser/dialog UI; separate confirm button IDs/results |
| `src/renderer/editors/browser/BrowserDownloadsPopup.ts`, `DownloadButton.ts` | Translate popup, actions, statuses and empty states |
| `src/renderer/editors/browser/BrowserEditor.ts`, `BrowserEditorModel.ts` | Keep English agent title data; provide any distinct localized display projection |
| `src/renderer/editors/browser/BrowserProfileNetworkModel.ts`, `browser-pages.ts` | Translate fixed route notifications and setup/error wrappers |
| `src/renderer/editors/browser/BrowserTabsModel.ts`, `BrowserTabsPanel.ts` | Translate tab controls/fallback/menu labels and add menu IDs |
| `src/renderer/editors/browser/BrowserUrlBarModel.ts`, `UrlSuggestionsDropdown.ts` | Translate URL actions, suggestions, search controls; keep engine IDs/names |
| `src/renderer/editors/browser/BrowserView.ts` | Translate toolbar, permission/certificate/Tor/pop-up/trust/find strings; implement popup plural |
| `src/renderer/editors/browser/BrowserWebviewModel.ts`, `webview-context-menu.ts` | Translate page/context actions and fixed notifications; add stable IDs |
| `src/renderer/editors/browser/TorStatusOverlay.ts` | Translate status/reconnect controls |
| `src/renderer/editors/settings/sections/BrowserProfilesSection.ts` | Adjacent exception: translate browser-profile color menu names using stable palette IDs/hex values |
| `src/renderer/theme/palette-colors.ts` | No change planned; keep shared English color names and hex values intact |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, `src/renderer/scripting/ai-vision/**`, `src/shared/i18n/en/common.ts`, `shell.ts`, `menus.ts`, `dialogs.ts` | No changes planned unless implementation proves a contract-level ID adapter is required; reuse existing catalog entries |

Files inspected and expected to need no changes: `src/renderer/editors/browser/BrowserBookmarks.ts` (bookmark storage/model), `browser-search-history.ts` (persisted search values), `network-log-links.ts` (URL/data conversion), `BrowserTargetModel.ts` (agent target projection; values remain data), `BrowserSecondaryViews.ts`, `BrowserPanelHost.ts`, `index.ts`, and the browser CSS files unless live `en-XA` review demonstrates a concrete layout issue. Also leave `src/renderer/theme/palette-colors.ts` unchanged: the shared palette names remain English identity for Git/ref consumers; the profile picker supplies separate localized presentation.
