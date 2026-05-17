# US-501: RestClient editor — UIKit migration

## Status

**Plan ready for review** — part of [EPIC-025](../../epics/EPIC-025.md) Phase 4
per-screen migration. **Blocked on [US-533](../US-533-uikit-autocomplete/README.md)**
— the new UIKit `Autocomplete` primitive replaces the legacy
`ComboSelect freeText` pattern used by `KeyValueEditor`'s header-name field.

Two further small UIKit primitive extensions ship inline with this task
(see Concern B / C below):

- `Textarea` — `width` / `minWidth` / `maxWidth` / `flex` props.
- `Panel` — `dimmed?: boolean` prop.

## Goal

Migrate the Rest Client editor surface to UIKit primitives. After this task,
no file under `src/renderer/editors/rest-client/` imports from
`components/basic|form|layout|overlay/` or uses `@emotion/styled`. Legacy
`components/TreeView` usage is **out of scope** (covered by US-497).

## Background

### File inventory

| File | Lines | Migration scope |
|---|---:|---|
| `RestClientEditor.tsx` | 756 | Outer shell, request tree, request/response panel split |
| `RequestBuilder.tsx` | 744 | URL bar, headers panel, body panel, form-data editor |
| `ResponseViewer.tsx` | 466 | Response tabs, body view, headers view |
| `KeyValueEditor.tsx` | 227 | Shared row editor for headers / params / form-urlencoded |
| `RestClientViewModel.ts` | — | **No changes** (logic-only) |
| `httpConstants.ts` | — | **No changes** |
| `multipartBuilder.ts`, `parseClipboardRequest.ts`, `serializeRequest.ts`, `restClientTypes.ts`, `open-in-rest-client.ts` | — | **No changes** |

### Legacy → UIKit primitive map

| Legacy import | New UIKit | Notes |
|---|---|---|
| `components/basic/Button` (`type="icon"`) | `IconButton` | `<Button type="icon">` becomes `<IconButton icon={...} title={...} />`; UIKit `title` auto-wraps in a `<Tooltip>` (Concern E). |
| `components/basic/Button` (text) | `Button` | `size="small"` → `size="sm"`. Send button gains `variant="primary"`. |
| `components/basic/Checkbox` | `Checkbox` | Drop `className`; checkbox state unchanged. |
| `components/basic/TextAreaField` | `Textarea` | `singleLine`, `value`, `onChange(string)` survive. Inline-edit fields use `variant="ghost"`. Width/flex sizing needs a small Textarea prop extension (Concern B). |
| `components/form/ComboSelect` (freeText) | UIKit `Autocomplete` (US-533) | New primitive — string-valued combobox with suggestions dropdown. |
| `components/layout/Splitter` | `Splitter` | Prop rename: `type`→`orientation`, `initialWidth`/`initialHeight`→`value`, `onChangeWidth`/`onChangeHeight`→`onChange`, `borderSized`→`side`+`border`. |
| `components/layout/Elements.FlexSpace` | `Spacer` | Drop-in. |
| `components/overlay/WithPopupMenu` | `WithMenu` | Same render-prop signature `(setOpen) => ReactElement`. |
| `components/overlay/PopupMenu.MenuItem` (type) | `import type { MenuItem }` from `uikit/Menu` | Both re-export from `api/types/events.d.ts` — identical shape. |
| `RestClientRoot` / `RequestBuilderRoot` / etc. (`@emotion/styled`) | `Panel` | Combine layout (`direction`/`gap`/`padding`/`overflow`/`background`/`border*`/`flex`) on the row container. Inline `kv-row-disabled` opacity needs Panel extension (Concern C). |
| `body-type-tabs` (`<div>` cells) | `SegmentedControl` | Same for view-toggle (Table/JSON) and response tabs (Body/Headers). |
| `EditorError` (already UIKit) | `EditorError` | Keep import from `../base/EditorError`. |

### Out-of-scope dependencies

These imports stay as-is:
- `components/TreeView` — covered by US-497.
- `components/icons/LanguageIcon` — `components/icons/` is not in the US-532
  scope.
- `editors/base/EditorError` — already a UIKit Panel wrapper.
- `ui/dialogs/poppers/showPopupMenu` — covered by US-531; we still call it for
  context menus from the request tree.
- `@monaco-editor/react` — kept for headers JSON view, raw body editor, and
  response body view.
- `api/app`, `api/pages/pagesModel`, `core/traits/*`, `editors/link-editor/linkTraits` — domain APIs, unchanged.

### Splitter prop translation (canonical patterns)

Vertical splitter, left panel controlled (outer `RestClientEditor` split):

```tsx
// Before
<Splitter type="vertical" initialWidth={leftPanelWidth}
          onChangeWidth={handleLeftPanelWidthChange} borderSized="right" />

// After
<Splitter orientation="vertical" value={leftPanelWidth}
          onChange={handleLeftPanelWidthChange}
          side="before" border="after" min={150} max={500} />
```

Horizontal splitter, bottom panel controlled (inner request/response and
headers/body splits):

```tsx
// Before
<Splitter type="horizontal" initialHeight={currentResultHeight}
          onChangeHeight={handleResultHeightChange} borderSized="top" />

// After
<Splitter orientation="horizontal" value={currentResultHeight}
          onChange={handleResultHeightChange}
          side="after" border="before" />
```

Pattern verified against migrated callers
`editors/mcp-inspector/ToolsPanel.tsx:191` and
`editors/link-editor/panels/LinkTagsSecondaryEditor.tsx:146`.

## Implementation plan

### Step 0 — UIKit primitive extensions (precursors inside this task)

Two small extensions ship with this task. The Autocomplete primitive itself
ships separately in US-533 (precursor — blocking).

**0.1 — Add width/flex props to UIKit Textarea**
`src/renderer/uikit/Textarea/Textarea.tsx`:
- Add `width?: number | string`, `minWidth?: number | string`, `maxWidth?: number | string`, `flex?: boolean | number | string` to `TextareaProps`.
- Map to inline `style` on the Root `styled.div` (Textarea is single-element, so the same style object that carries `minHeight`/`maxHeight` carries these too).
- `flex={true}` → `"1 1 auto"`; `flex={n}` → `"${n} 1 auto"`; string passes through. Same resolver as `Panel.flex`.

**0.2 — Add `dimmed` prop to UIKit Panel**
`src/renderer/uikit/Panel/Panel.tsx`:
- Add `dimmed?: boolean` to `PanelProps`.
- Emits `data-dimmed="true"`; styled rule `&[data-dimmed] { opacity: 0.5 }`. No `pointerEvents` change — interactive children (checkbox to re-enable) remain clickable.
- Distinct from `disabled` (which adds `pointer-events: none`).

### Step 1 — `KeyValueEditor.tsx`

Rewrite as ~110 lines (down from 227). Delete `KeyValueEditorRoot` `@emotion/styled` block.

```tsx
import { useCallback } from "react";
import { Autocomplete, Checkbox, IconButton, Panel, Textarea } from "../../uikit";
import { CloseIcon } from "../../theme/icons";
import { RestHeader } from "./restClientTypes";

interface KeyValueEditorProps { /* unchanged */ }

export function KeyValueEditor({ items, onUpdate, onDelete, onToggle,
                                 keyOptions, keyPlaceholder = "Key",
                                 valuePlaceholder = "Value" }: KeyValueEditorProps) {
    return (
        <Panel name="kv-editor" direction="column" gap="xs">
            {items.map((item, index) => (
                <KeyValueRow key={index} item={item} index={index}
                             isLast={index === items.length - 1}
                             onUpdate={onUpdate} onDelete={onDelete} onToggle={onToggle}
                             keyOptions={keyOptions}
                             keyPlaceholder={keyPlaceholder}
                             valuePlaceholder={valuePlaceholder} />
            ))}
        </Panel>
    );
}

function KeyValueRow({ item, index, isLast, onUpdate, onDelete, onToggle,
                       keyOptions, keyPlaceholder, valuePlaceholder }: KeyValueRowProps) {
    const isEmpty = !item.key && !item.value;
    /* handlers identical to legacy */

    return (
        <Panel name="kv-row" direction="row" align="start" gap="xs" paddingTop="xs"
               dimmed={!item.enabled}>
            <Checkbox checked={item.enabled} onChange={handleToggle} />
            {keyOptions ? (
                <Autocomplete name="kv-row-key" items={keyOptions} value={item.key}
                              onChange={handleKeyChange} placeholder={keyPlaceholder}
                              filterMode="contains" size="sm"
                              width="35%" minWidth={100} />
            ) : (
                <Textarea variant="ghost" singleLine value={item.key}
                          onChange={handleKeyChange} placeholder={keyPlaceholder}
                          width="35%" minWidth={100} minHeight={24} />
            )}
            <Textarea variant="ghost" singleLine value={item.value}
                      onChange={handleValueChange} placeholder={valuePlaceholder}
                      flex={1} minWidth={0} minHeight={24} />
            {isLast && isEmpty
                ? <Panel width={24} shrink={false} />
                : <IconButton name="kv-row-delete" size="sm" icon={<CloseIcon />}
                              title="Delete" onClick={handleDelete} />}
        </Panel>
    );
}
```

### Step 2 — `ResponseViewer.tsx`

Drop `ResponseViewerRoot` `@emotion/styled` block. Replace tab strip with `SegmentedControl`. Use Panel for layout. Headers table stays as a plain `<table>` inside a scrolling Panel (no UIKit Table primitive).

Key structural rewrite:

```tsx
<Panel name="response-viewer" direction="column" flex={1} overflow="hidden">
    <Panel name="response-tabs" direction="row" align="center" gap="xs"
           paddingX="sm" paddingY="xs" background="dark" borderBottom>
        <SegmentedControl name="response-tab-select" size="sm"
            value={activeTab}
            onChange={(v) => setActiveTab(v as ResponseTab)}
            items={[
                { value: "body", label: `Body${bodySize ? ` (${bodySize})` : ""}` },
                { value: "headers", label: `Headers (${response.headers.length})` },
            ]} />
        <Spacer />
        {activeTab === "body" && !response.isBinary && (
            <>
                <IconButton name="response-open-in-tab" size="sm"
                            icon={<NewWindowIcon />}
                            title="Open in new tab" onClick={handleOpenInTab} />
                <WithMenu items={languageMenuItems}>
                    {(setOpen) => (
                        <Button size="sm" variant="ghost"
                                icon={<LanguageIcon language={language}
                                                     width={16} height={16} />}
                                onClick={(e) => setOpen(e.currentTarget)}>
                            {language}
                        </Button>
                    )}
                </WithMenu>
            </>
        )}
        {activeTab === "headers" && (
            <>
                <SegmentedControl name="response-headers-view" size="sm"
                    value={headersView}
                    onChange={(v) => setHeadersView(v as "table" | "json")}
                    items={[
                        { value: "table", label: "Table" },
                        { value: "json", label: "JSON" },
                    ]} />
                <IconButton name="response-copy-headers" size="sm"
                            icon={<CopyIcon />} title="Copy headers as JSON"
                            onClick={handleCopyHeaders} />
            </>
        )}
    </Panel>
    <Panel name="response-tab-body" direction="column" flex={1} overflow="hidden">
        {/* …active-tab body unchanged (Monaco for body, table or Monaco for headers) */}
    </Panel>
</Panel>
```

The empty / sending message and the binary view become small Panel compositions:

```tsx
<Panel name="response-binary" direction="column" align="center" justify="center"
       gap="md" padding="lg" flex={1} overflowY="auto">
    <Text color="light" italic>Binary response — {response.contentType || "unknown type"} ({bodySize})</Text>
    {isImage && blobUrl && <img src={blobUrl} alt="Response" style={{ maxWidth: "100%", maxHeight: 300 }} />}
    <Panel name="response-binary-actions" direction="row" gap="sm">
        <Button icon={<SaveIcon />} onClick={handleSaveBinary}>Save to File</Button>
        {isImage && <Button icon={<NewWindowIcon />} onClick={handleOpenImage}>Open in Image Viewer</Button>}
    </Panel>
</Panel>
```

(Note: the raw `<img style={...}>` is a plain HTML element — Rule 7 only forbids style on UIKit components.)

### Step 3 — `RequestBuilder.tsx`

Drop `RequestBuilderRoot` `@emotion/styled` block. Replace internal `<div>` layout with Panel. URL bar, headers panel, body panel.

Outline (showing structural skeleton — handlers/state unchanged):

```tsx
<Panel name="request-builder" direction="column" flex={1} overflow="hidden">
    {/* URL bar */}
    <Panel name="url-bar" direction="row" align="start" gap="xs"
           paddingX="md" paddingY="xs" background="dark">
        <WithMenu items={methodMenuItems}>
            {(setOpen) => (
                <Text name="method-label"
                      onClick={(e) => setOpen(e.currentTarget)}
                      style={/* method color stays inline via Text.color? — see Concern F */}>
                    {request.method}
                </Text>
            )}
        </WithMenu>
        <Textarea name="url-input" value={request.url}
                  onChange={handleUrlChange} onKeyDown={handleUrlKeyDown}
                  onPaste={handleUrlPaste}
                  placeholder="Enter URL or paste cURL/fetch..."
                  flex={1} minHeight={24} maxHeight={54} />
        <Button name="rest-send" variant="primary" size="md"
                disabled={state.executing || !request.url}
                onClick={vm.sendRequest}>
            {state.executing ? "Sending..." : "Send"}
        </Button>
    </Panel>

    {/* Split: headers (top) / body (bottom) */}
    <Panel name="request-split" direction="column" flex={1} overflow="hidden" ref={splitRef}>
        <Panel name="headers-panel" direction="column" overflow="hidden"
               flex={headersFlex} minHeight={0}>
            <Panel name="headers-section-header" direction="row" align="center"
                   paddingX="md" paddingY="xs" background="dark"
                   onDoubleClick={handleHeadersDblClick}>
                <Text size="xs" weight="semibold" color="light" uppercase>Headers</Text>
                <Spacer />
                <SegmentedControl name="headers-view" size="sm"
                    value={headersView}
                    onChange={(v) => v === "json" ? switchToJsonView() : switchToTableView()}
                    items={[{ value: "table", label: "Table" }, { value: "json", label: "JSON" }]} />
                <IconButton name="headers-copy" size="sm" icon={<CopyIcon />}
                            title="Copy headers as JSON" onClick={…} />
            </Panel>
            {headersView === "table"
                ? <Panel name="headers-scroll" direction="column" flex={1}
                         overflowY="auto" paddingX="md" paddingBottom="sm">
                    <KeyValueEditor items={request.headers} … keyOptions={COMMON_HEADERS} />
                  </Panel>
                : <Panel name="headers-json" flex={1} overflow="hidden">
                    <Editor value={headersJson} language="json" theme="custom-dark"
                            options={BODY_EDITOR_OPTIONS}
                            onChange={handleHeadersJsonChange} />
                  </Panel>}
        </Panel>

        <Splitter orientation="horizontal" value={currentBodyHeight}
                  onChange={handleBodyHeightChange} side="after" border="before" />

        <Panel name="body-panel" direction="column" overflow="hidden"
               height={bodyHeight ?? undefined} flex={bodyHeight !== null ? undefined : "4 1 0"}
               shrink={bodyHeight !== null ? false : undefined} minHeight={0}>
            <Panel name="body-section-header" direction="row" align="center"
                   paddingX="md" paddingY="xs" background="dark"
                   onDoubleClick={handleBodyDblClick}>
                <Text size="xs" weight="semibold" color="light" uppercase>Body</Text>
                <SegmentedControl name="body-type-select" size="sm"
                    value={request.bodyType}
                    onChange={(v) => handleBodyTypeChange(v as BodyType)}
                    items={BODY_TYPES.map(({type, label}) => ({ value: type, label }))} />
                {request.bodyType === "raw" && (
                    <WithMenu items={languageMenuItems}>
                        {(setOpen) => (
                            <Button size="sm" variant="ghost"
                                    icon={<LanguageIcon language={request.bodyLanguage} width={16} height={16} />}
                                    onClick={(e) => setOpen(e.currentTarget)}>
                                {request.bodyLanguage}
                            </Button>
                        )}
                    </WithMenu>
                )}
            </Panel>
            <BodyContent vm={vm} request={request} onMonacoChange={handleMonacoBodyChange} />
        </Panel>
    </Panel>
</Panel>
```

`BodyContent` and `FormDataEditor` similarly rewrite to Panel + UIKit primitives. `FormDataEditor` row pattern follows `KeyValueRow` (Panel direction=row, `dimmed={!entry.enabled}`, IconButton for browse / delete, conditional file-display vs Textarea, etc.).

### Step 4 — `RestClientEditor.tsx`

Drop `RestClientRoot` `@emotion/styled` block. Wrap shell in Panel. `RequestTree` (legacy `TreeView` consumer) stays — only its surrounding chrome moves to Panel.

Outline:

```tsx
return (
    <Panel name="rest-client-root" direction="row" flex={1} height={0}
           overflow="hidden">
        <Panel name="rest-left-panel" direction="column" overflow="hidden"
               background="default" width={leftPanelWidth} minWidth={150}
               maxWidth="80%" shrink={false}>
            <Panel name="rest-left-tree" flex={1} overflow="auto">
                <RequestTree vm={vm} root={rootItem} selectedId={state.selectedRequestId} />
            </Panel>
        </Panel>
        <Splitter orientation="vertical" value={leftPanelWidth}
                  onChange={handleLeftPanelWidthChange}
                  side="before" border="after" min={150} max={500} />
        <Panel name="rest-right-panel" direction="column" flex={1}
               width={0} overflow="hidden">
            {selectedRequest
                ? <SplitDetailPanel vm={vm} request={selectedRequest} state={state} />
                : <Panel name="rest-empty" flex={1} align="center" justify="center"
                         padding="lg">
                    <Text color="light" italic>
                        {state.data.requests.length === 0
                            ? "No requests yet. Click + to add one."
                            : "Select a request from the list."}
                    </Text>
                  </Panel>}
        </Panel>
    </Panel>
);
```

`SplitDetailPanel` (the request/response split + the panel-header bar with collection/name inputs + copy/delete buttons) restructures similarly:

```tsx
<Panel name="rest-detail" direction="column" flex={1} height={0} overflow="hidden"
       ref={detailRef}>
    <Panel name="request-pane" direction="column" overflow="hidden" minHeight={0}
           flex={topFlex} /* see height/flex resolver below */>
        <Panel name="request-pane-header" direction="row" align="center" gap="xs"
               paddingX="md" paddingY="xs" background="dark"
               onDoubleClick={handleTopHeaderDblClick}>
            <Textarea variant="ghost" singleLine value={request.collection}
                      onChange={handleCollectionChange} placeholder="Collection"
                      maxWidth="40%" minHeight={20} />
            <Text color="light">/</Text>
            <Textarea variant="ghost" singleLine value={request.name}
                      onChange={handleNameChange} placeholder="Request name"
                      flex={1} minWidth={50} minHeight={20} />
            <Spacer />
            <WithMenu items={copyMenuItems}>
                {(setOpen) => (
                    <IconButton name="request-copy-as" size="sm" icon={<CopyIcon />}
                                title="Copy request as..."
                                onClick={(e) => setOpen(e.currentTarget)} />
                )}
            </WithMenu>
            <IconButton name="request-delete" size="sm" icon={<DeleteIcon />}
                        title="Delete request" onClick={handleDelete} />
        </Panel>
        <Panel name="request-pane-body" direction="column" flex={1} overflow="auto">
            <RequestBuilder vm={vm} request={request} state={state} />
        </Panel>
    </Panel>

    <Splitter orientation="horizontal" value={currentResultHeight}
              onChange={handleResultHeightChange} side="after" border="before" />

    <Panel name="response-pane" direction="column" overflow="hidden" minHeight={0}
           /* height/flex via bottomStyle equivalent */>
        <Panel name="response-pane-header" direction="row" align="center" gap="xs"
               paddingX="md" paddingY="xs" background="dark"
               onDoubleClick={handleBottomHeaderDblClick}>
            <Text size="xs" weight="semibold" color="light" uppercase>Response</Text>
            <Spacer />
            {state.response && (
                <>
                    <Text size="xs" weight="semibold" mono
                          style={/* status color — see Concern F */}>
                        {state.response.status === 0 ? "Error" : `${state.response.status} ${state.response.statusText}`}
                    </Text>
                    <Text size="xs" color="light">{state.responseTime}ms</Text>
                    <Text size="xs" color="light">{getResponseSize(state.response)}</Text>
                </>
            )}
        </Panel>
        <Panel name="response-pane-body" direction="column" flex={1} overflow="hidden">
            <ResponseViewer response={state.response} responseTime={state.responseTime}
                            executing={state.executing} />
        </Panel>
    </Panel>
</Panel>
```

`RequestTree` (TreeView consumer): the `<Button type="icon">` for the root "+" button and the leaf `<Button>` instances that live inside `getLabel` migrate to `IconButton`. The TreeView itself stays.

### Step 5 — Verification

- `npx tsc -p tsconfig.json --noEmit` — confirm zero new errors (baseline includes pre-existing errors in `automation/commands.ts`, `editors/video/VideoPlayerEditor.tsx`, `scripting/worker/WorkerRunner.ts`, `ui/tabs/PageTab.tsx`).
- `npm run lint` clean.
- Manual smoke pass (see Test surface below).

## Concerns

### Concern A — Free-text combobox for KeyValueEditor header-name field — **RESOLVED (US-533 precursor)**

The legacy `<ComboSelect freeText selectFrom={COMMON_HEADERS} value={item.key} onChange={handleKeyChange} />` is a free-text string-valued input with suggestions dropdown. UIKit `Select` does not fit (value is `T | null`, the dropdown commits a list item only, and arbitrary text is a transient filter query).

**Resolution:** [US-533](../US-533-uikit-autocomplete/README.md) introduces a new UIKit primitive `Autocomplete` modeled on the Browser URL bar's hand-rolled `Input + Popover + ListBox` composition (`BrowserUrlBarModel` + `UrlSuggestionsDropdown`). KeyValueEditor adopts it in this task with `<Autocomplete items={COMMON_HEADERS} value={item.key} onChange={handleKeyChange} filterMode="contains" />`. US-501 is **blocked on US-533** landing first.

Rationale for a new primitive (not a `Select` extension): the contract is fundamentally different (string-valued, accepts arbitrary text, no commit-by-default). See US-533 Q5 for details. Future migration of the Browser URL bar to `Autocomplete` becomes natural after this primitive exists — a follow-up per-screen task can collapse `UrlSuggestionsDropdown.tsx` and most of `BrowserUrlBarModel.ts` into a thin wrapper around `Autocomplete`.

### Concern B — Textarea width/flex props — **RESOLVED**

The legacy RestClient has many `<TextAreaField style={{ width: "30%", flex: "1 1 auto", minWidth: 80, ... }}>` call sites. UIKit `Textarea` currently exposes only `minHeight` / `maxHeight`. Adding `width` / `minWidth` / `maxWidth` / `flex` (mirroring `Input`'s pattern) keeps callers in props-only mode without `style=` (Rule 7).

**Resolution:** Step 0.2 adds the four props. ~10 lines in `Textarea.tsx`. No story change.

### Concern C — Disabled-row dim without disabling interaction — **RESOLVED**

`kv-row-disabled` and `form-data-row[!enabled]` show the row at `opacity: 0.5` but the checkbox inside must remain clickable to re-enable the row. UIKit `Panel.disabled` adds `pointer-events: none`, which breaks the re-enable. Need a separate dim prop.

**Resolution:** Step 0.3 adds `Panel.dimmed?: boolean` — opacity only, no pointer-events change. ~5 lines in `Panel.tsx`.

### Concern D — Tabs become SegmentedControl — **RESOLVED**

The legacy renders three independent tab-like UIs as flat clickable `<div>` cells:
- Body type picker (`none / form-data / x-www-form-urlencoded / raw / binary`).
- Headers view toggle (`Table / JSON`) in both `RequestBuilder` and `ResponseViewer`.
- Response top-level tabs (`Body / Headers`).

UIKit `SegmentedControl` renders these as a rounded button group (active = primary background). This is a visual change — flat text becomes pill-style group.

**Resolution:** Adopt SegmentedControl across all three. Pattern verified at
`editors/mcp-inspector/McpInspectorView.tsx:221`. Visual change is consistent
with the rest of the migrated app — a different look in this one editor is a
larger regression than the SegmentedControl chrome change.

### Concern E — `<Button title="...">` becomes a Tooltip wrap — **RESOLVED**

UIKit `Button` and `IconButton` automatically wrap themselves in `<Tooltip>` when `title` is set, instead of rendering a native browser tooltip. This is a small UX upgrade (rich tooltips, hover delay) but means hovering a button now shows the styled UIKit tooltip rather than the OS tooltip.

**Resolution:** Accept. Every migrated editor in EPIC-025 has the same behaviour change. Use `title` for all destination buttons.

### Concern F — Inline-only style needs: HTTP-method colour and response-status colour

Two places paint text in a colour derived from runtime data:
1. `RequestBuilder` URL bar `method-label` — `style={{ color: METHOD_COLORS[request.method] }}`.
2. `RestClientEditor` response-status — `style={{ color: getStatusColor(state.response.status) }}`.

UIKit `Text` accepts a fixed set of named colours (`default | light | strong | warning | ...`) — not arbitrary CSS color strings. The colour values themselves (METHOD_COLORS, http codes) live in `universalColors.ts` and are theme tokens, not arbitrary hex.

**Resolution options (recommend F1):**
- **F1 — Add `Text` accent-color prop sourced from `universalColors`.** Extend `Text` with `accentColor?: keyof typeof universalColors.http | keyof typeof universalColors.method` (or a more generic `tokenColor` mapping). Most flexible and reusable.
- F2 — Render a plain `<span style={{ color: ... }}>` next to the UIKit chrome. Rule 7 forbids `style=` on UIKit components but allows it on plain HTML elements. This is the path-of-least-effort fallback. (Same pattern already used for the binary image preview.)

For an editor with two colour-keyed labels, F2 (plain `<span>`) is acceptable — keeps the change scoped to RestClient. **Recommendation: F2 unless the user prefers Text extension.**

### Concern G — Multi-line URL textarea overlapping monospace style

Legacy `url-input` mixes `fontFamily: monospace`, `padding: "2px 6px"`, `min-height: 24, max-height: 54` and `flex: 1 1 auto`. With per-app monospace already enforced (memory `project_default_font.md`), the font part disappears. With Step 0.2 width/flex props on Textarea, the layout part fits. The `padding: "2px 6px"` is non-standard — current Textarea uses `padding: 4px 8px` (`spacing.sm` / `spacing.md`). Visual change: slightly more padding.

**Resolution:** Accept. The current Textarea padding has been validated across multiple editors already (it matches the URL bar's surrounding `paddingY="xs"`).

### Concern H — Headers JSON editor uses Monaco — **RESOLVED**

The JSON-view headers editor and raw-body editor and response-body view use `@monaco-editor/react`'s `<Editor>` directly. There is no UIKit equivalent and this task doesn't aim to replace it. Keep the imports as-is.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in `editors/rest-client/`.
- [ ] No `@emotion/styled` import in any `editors/rest-client/*.tsx` file.
- [ ] No `style=` or `className=` prop passed to a UIKit primitive in `editors/rest-client/` (plain HTML elements may still use `style=`).
- [ ] Every UIKit primitive in the file carries a `name` prop (per US-521 / US-522 standard).
- [ ] `npm run lint` clean; `npx tsc -p tsconfig.json --noEmit` reports no new errors.
- [ ] Manual smoke pass:
  - [ ] Open a `.rest.json` file — collection renders in the left tree.
  - [ ] Pick a request — request builder populates URL, method, headers, body.
  - [ ] Type a header name not in `COMMON_HEADERS` — value persists (freeText path).
  - [ ] Type a header name that is in `COMMON_HEADERS` — autocomplete suggestions appear.
  - [ ] Click a suggestion — `key` field commits to that string.
  - [ ] Add/remove/toggle rows in headers, params (form-urlencoded), form-data.
  - [ ] Toggle row checkbox — row dims, checkbox stays clickable.
  - [ ] Switch headers Table↔JSON, response Body↔Headers tabs, body-type tabs — values round-trip.
  - [ ] Resize outer splitter (left/right) — width clamps to 150..500.
  - [ ] Resize inner splitters (request/response top-bottom; headers/body inside request).
  - [ ] Double-click panel header — top/bottom toggle to 30/70.
  - [ ] Right-click a tree row (collection or request) — context menu opens.
  - [ ] Drag a request into another collection — collection assignment updates.
  - [ ] Drop an external link into the tree — request is created from the link.
  - [ ] Send a request — response loads, status colour reflects code class.
  - [ ] Round-trip: edit a request, send, save — `.rest.json` persists changes.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change | Lines (approx.) |
|---|---|---:|
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | Rewritten — UIKit Panel/Splitter/IconButton/Button/Text/WithMenu/Textarea; drop `@emotion/styled`; legacy components dropped | 756 → ~480 |
| `src/renderer/editors/rest-client/RequestBuilder.tsx` | Rewritten — UIKit Panel/Splitter/SegmentedControl/Textarea/IconButton/Button/WithMenu/Spacer/Text | 744 → ~520 |
| `src/renderer/editors/rest-client/ResponseViewer.tsx` | Rewritten — UIKit Panel/SegmentedControl/Button/IconButton/WithMenu/Spacer/Text | 466 → ~290 |
| `src/renderer/editors/rest-client/KeyValueEditor.tsx` | Rewritten — UIKit Panel/Checkbox/Autocomplete/Textarea/IconButton | 227 → ~110 |
| `src/renderer/uikit/Textarea/Textarea.tsx` | Add `width` / `minWidth` / `maxWidth` / `flex` props | +~10 |
| `src/renderer/uikit/Panel/Panel.tsx` | Add `dimmed?: boolean` prop + styled rule | +~5 |
| `doc/active-work.md` | US-501 entry — status "placeholder" → "plan ready for review" | 1 |

## Files NOT Changed

- `src/renderer/editors/rest-client/RestClientViewModel.ts` — logic only.
- `src/renderer/editors/rest-client/httpConstants.ts` — constants.
- `src/renderer/editors/rest-client/multipartBuilder.ts`, `parseClipboardRequest.ts`, `serializeRequest.ts`, `restClientTypes.ts`, `open-in-rest-client.ts` — domain helpers.
- `src/renderer/components/TreeView/*` — out of scope (US-497).
- `src/renderer/components/icons/LanguageIcon.tsx` — out of scope (different folder).
- `src/renderer/editors/base/EditorError.tsx` — already UIKit.
- `src/renderer/ui/dialogs/poppers/showPopupMenu.tsx` — out of scope (US-531).
- `@monaco-editor/react` consumers — out of scope.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Pattern references (Splitter / SegmentedControl):
  - `src/renderer/editors/mcp-inspector/McpInspectorView.tsx:221` (SegmentedControl panel-switch)
  - `src/renderer/editors/mcp-inspector/ToolsPanel.tsx:191` (horizontal Splitter side=after / border=before)
  - `src/renderer/editors/link-editor/panels/LinkTagsSecondaryEditor.tsx:146` (same pattern)
- Blocked on: [US-533](../US-533-uikit-autocomplete/README.md) — UIKit `Autocomplete` primitive
- Related: US-497 (TreeView migration), US-531 (showPopupMenu migration), US-532 (legacy folder removal)
