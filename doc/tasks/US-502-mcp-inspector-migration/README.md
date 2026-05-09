# US-502: MCP Inspector — UIKit migration

## Status

**Plan ready for review** — Phase 4 per-screen migration. Part of
[EPIC-025](../../epics/EPIC-025.md). All Phase-4 prerequisite UIKit primitives
are in place after US-498/499/500 (Dot, Splitter, Select width props,
revealChildrenOnHover, IconButton.hideUntilParentHover, ListBox `browse`
variant). No new UIKit primitives need to be authored to land this task.

## Goal

Migrate the seven rendering files under `src/renderer/editors/mcp-inspector/`
to UIKit primitives. After this task:

- No file in `editors/mcp-inspector/` imports from
  `components/basic|form|layout|overlay/`.
- No file in `editors/mcp-inspector/` uses `@emotion/styled`, `style=` on a
  UIKit component, or `className=` on a UIKit component (Rule 7).
- Visual parity with the legacy editor on the golden path (server picker,
  three capability tabs, tool argument form, resource viewer, prompt viewer,
  history panel).

## Background

### Files to migrate (seven, not five)

The placeholder listed five rendering files. Two more (`ResourceContentView`,
`ToolResultView`) use `@emotion/styled` and so are also in scope per Rule 7,
even though they don't import from `components/basic|form|layout|overlay/`:

| File | Uses `styled` | Uses `components/*` |
|---|---|---|
| `McpInspectorView.tsx` | yes | yes (`Button`) |
| `ToolsPanel.tsx` | yes | yes (`Button`, `Splitter`) |
| `ResourcesPanel.tsx` | yes | yes (`Button`, `TextAreaField`, `Splitter`) |
| `PromptsPanel.tsx` | yes | yes (`Button`, `TextAreaField`, `Splitter`) |
| `ToolArgForm.tsx` | yes | yes (`TextField`, `TextAreaField`) |
| `ResourceContentView.tsx` | yes | no |
| `ToolResultView.tsx` | yes | no |

Files that need NO changes:
- `McpInspectorEditorModel.ts`, `McpConnectionManager.ts`,
  `McpConnectionStore.ts` — pure model/state code, no JSX or styling.
- `index.ts` — re-exports only.

### Old → UIKit primitive mapping

| Old | New |
|---|---|
| `components/basic/Button` (`type="flat"`, `size="small"`) | UIKit `Button` (`size="sm"`); `variant="primary"` for the "Call Tool" / "Read Resource" / "Get Prompt" CTAs that were custom-styled with `background.selection`. |
| `components/basic/TextField` | UIKit `Input` (`size="sm"`) |
| `components/basic/TextAreaField` | UIKit `Textarea` (`size="sm"`) |
| `components/layout/Splitter` (legacy `type/initialWidth/initialHeight/onChangeWidth/onChangeHeight/borderSized`) | UIKit `Splitter` (new `orientation/value/onChange/side/border`) — see Splitter mapping table below. |
| Native `<select>` (transport-select, saved-select, arg-select for enum) | UIKit `Select<IListBoxItem>` |
| Native `<input type="text">` (url, command, args) | UIKit `Input` |
| Native `<input type="checkbox">` (boolean tool args) | UIKit `Checkbox` |
| `styled.div` for sidebar container, panels, info-field, etc. | UIKit `Panel` |
| `styled.div` "section-title" headers (uppercase, letter-spacing) | UIKit `Text size="xs" variant="uppercased" color="light"` inside `Panel borderBottom paddingBottom="sm"` |
| `<span className="bar-separator">` | UIKit `Divider orientation="vertical"` |
| `.status-dot.connected/connecting/disconnected/error` | UIKit `Dot color="success|warning|neutral|error"` |
| `.capability-badge` (Info/Tools/Resources/Prompts/History tabs) | UIKit `SegmentedControl` (items array built conditionally based on `hasTools/hasResources/hasPrompts`) |
| `.annotation-badge` (read-only / destructive on tools) | UIKit `Tag` (`size="sm"`); destructive uses inline color via wrapping the text in `Text color="error"` since Tag has no danger variant |
| `.detail-mime` (small mime-type chip on resource detail) | UIKit `Tag size="sm"` |
| `.conn-transport-badge` (HTTP/STDIO badge on saved-connection rows) | UIKit `Tag size="sm"` |
| Hover-reveal `.conn-delete` X button | UIKit `Panel revealChildrenOnHover` + `IconButton hideUntilParentHover` |
| `.sidebar-list` (Tools simple flat list) | UIKit `ListBox<IListBoxItem>` (`variant="browse"`) |
| `.sidebar-list` (Resources/Prompts multi-line + sections) | Plain `Panel`-based custom list (see Concern C5 for why not ListBox) |

### Splitter API mapping (legacy → new)

Verified against `src/renderer/uikit/Splitter/Splitter.tsx` border/side semantics:

| Legacy | New |
|---|---|
| `<Splitter type="vertical" initialWidth={W} onChangeWidth={cb} borderSized="right" />` | `<Splitter orientation="vertical" value={W} onChange={cb} side="before" />` (border defaults to `"after"` = right edge) |
| `<Splitter type="horizontal" initialHeight={H} onChangeHeight={cb} borderSized="top" />` | `<Splitter orientation="horizontal" value={H} onChange={cb} side="after" border="before" />` |

Reasoning for the horizontal mapping in `ToolsPanel`: the controlled value
(`currentResultHeight`) is the height of the **bottom** panel (the result
pane). Dragging the splitter UP must grow it (bottom panel takes more
space). With `side="after"`, sign is `-1`, so positive drag-down delta
shrinks the value — i.e. drag UP grows the bottom panel. `border="before"`
draws the 1px line on the splitter's top edge, matching the legacy
`borderSized="top"`.

## Implementation plan

Listed in dependency order. Each step says exactly what file to touch and
what to write. Follow the patterns from US-499/US-500 (TodoEditor and
TextEditor migrations) for naming and import shape.

### Step 1 — `ToolResultView.tsx`

Tiny file, no `components/*` imports. Migrate to plain Panel + Text.

- Delete the `ToolResultRoot` styled.div definition and the `EDITOR_OPTIONS`
  constant moves into module-scope (already module-scope; keep as-is).
- Replace the wrapper styled.div with `<Panel direction="column" gap="xs"
  flex={1} overflow="hidden">`.
- Replace the result-editor wrapper (`<div className="result-editor-wrapper${isError ? " error" : ""}">`)
  with `<Panel border borderColor={isError ? "active" : "subtle"} rounded="md"
  overflow="hidden" flex={1} minHeight={40}>`. Note: `borderColor="active"`
  uses `color.border.active` not `color.error.text`. **If the active-error
  border-color difference is visually unacceptable**, extend Panel with a
  `borderColor="error"` token (small Panel extension: add a new token in the
  `borderColor` enum mapped to `color.error.text`); not blocking for the
  golden path.
- Replace `<img className="result-image">`: img is fine as raw HTML, but
  borrow inline border + radius via wrapping `<Panel border rounded="md"
  overflow="hidden">` containing a plain `<img style={{ maxWidth: "100%" }}
  alt="Tool result" />` (raw `<img>` element, not a UIKit component, so
  `style` is allowed; this is the same pattern as raw native HTML elements
  used in other migrated editors).
- Replace `<div className="result-resource-uri">` and `<span
  className="result-link">` with `<Text size="xs" color="info"
  preserveCase>...</Text>` (the legacy uses `color.misc.blue` which maps to
  Text `color="info"`). Note `Text` does not support `fontFamily="monospace"`
  — the app already runs in a monospace font globally per
  `feedback_uikit_single_components_home.md` and
  `project_default_font.md`, so the legacy `'Cascadia Code', 'Consolas',
  monospace` font-family override becomes a no-op. **Do not** add a font
  override.

### Step 2 — `ResourceContentView.tsx`

Tiny file, no `components/*` imports. Same pattern as Step 1.

- Delete `ResourceContentRoot` styled.div.
- Markdown wrapper: `<Panel direction="column" flex={1} overflow="auto"
  border rounded="md" paddingX="lg" paddingY="md"><MarkdownBlock content={...}
  compact /></Panel>`.
- Editor wrapper: `<Panel direction="column" flex={1} overflow="hidden"
  border rounded="md" minHeight={80}><Editor ... /></Panel>`.
- Image: `<Panel border rounded="md" overflow="hidden"><img
  style={{ maxWidth: "100%" }} src="..." alt={content.uri} /></Panel>`.
- Binary info: `<Panel padding="md" rounded="md" border background="light"><Text
  size="sm" color="light">Binary content: {mime || "unknown type"} ({sizeKb}
  KB)</Text></Panel>`.
- Outer: `<Panel direction="column" flex={1} overflow="hidden">{...}</Panel>`.

### Step 3 — `ToolArgForm.tsx`

This is the form that builds dynamic argument inputs from a JSON-Schema-ish
spec. Migrate every form control + the wrapper.

Replacements:
- Outer `ToolArgFormRoot styled.div` → `<Panel direction="column" gap="lg">`.
- `<div className="arg-field">` → `<Panel direction="column" gap="xs">`.
- `<div className="arg-label">` → `<Panel direction="row" gap="md"
  align="center"><Text size="md" color="default">{name}</Text>
  {!boolean && <Tag size="sm" label={type} />}{required && <Text size="xs"
  color="error">required</Text>}</Panel>`.
- `<div className="arg-description">` → `<Text size="md" color="light">{description}</Text>`.
- Boolean (checkbox) input: replace
  ```
  <label className="arg-checkbox">
    <input type="checkbox" ... />
    {name}
  </label>
  ```
  with `<Checkbox checked={value === "true"} onChange={(c) => onArgChange(name, String(c))} disabled={disabled}>{name}</Checkbox>`.
  Note the rendering decision: when type is boolean we still skip the outer
  `arg-label` row (legacy code skips it via `type !== "boolean"` guard) — keep
  the same guard, the Checkbox component renders its own label.
- Enum (select) input: replace native `<select className="arg-select">` with
  `<Select<IListBoxItem> items={enumItems} value={selectedItem} onChange={(it) => onArgChange(name, String(it.value))} placeholder="— select —" disabled={disabled} size="sm" />` where:
  ```ts
  const enumItems: IListBoxItem[] = useMemo(
      () => (propSchema.enum as string[]).map((opt) => ({ value: opt, label: opt })),
      [propSchema.enum],
  );
  const selectedItem = useMemo(
      () => enumItems.find((it) => it.value === value) ?? null,
      [enumItems, value],
  );
  ```
- Number/integer input: `<Input value={value} onChange={handleChange} placeholder={...} disabled={disabled} size="sm" />`.
- String fallback (TextAreaField in legacy): `<Textarea value={value} onChange={handleChange} placeholder={...} readOnly={disabled} size="sm" />`. Note: Textarea uses `readOnly` (not `readonly`).
- Monaco editor wrapper: `<Panel border rounded="md" overflow="hidden" height={height}><Editor ... /></Panel>`. Skip the `:focus-within` border-active highlight (Panel does not support it; Monaco's own focus indicator inside the wrapper is sufficient — see Concern C9).

Remove the deprecated `& .text-field input` Emotion override block — without
`styled` it is gone for free.

### Step 4 — `PromptsPanel.tsx`

Custom sidebar list (see Concern C5 — kept as Panel-based, not ListBox) plus
detail pane.

- Outer styled.div → `<Panel direction="row" flex={1} overflow="hidden">`.
- Sidebar:
  ```
  <Panel direction="column" overflow="hidden" shrink={false} width={sidebarWidth}>
      <Panel
          direction="row" align="center" justify="between"
          paddingX="lg" paddingY="md" borderBottom shrink={false}
      >
          <Text size="xs" variant="uppercased" color="light" bold>Prompts</Text>
          <Tag size="sm" label={ps.prompts.length} />
      </Panel>
      <Panel direction="column" flex={1} overflow="auto">
          {ps.prompts.map((p) => (
              <Panel
                  key={p.name}
                  direction="column"
                  paddingX="lg" paddingY="sm" gap="xs"
                  borderBottom
                  borderColor={p.name === ps.selectedPromptName ? "active" : "subtle"}
                  background={p.name === ps.selectedPromptName ? "light" : undefined}
                  onClick={() => model.selectPrompt(p.name)}
                  title={p.name}
              >
                  <Text size="sm" truncate>{p.name}</Text>
                  {p.description && <Text size="xs" color="light" truncate>{p.description}</Text>}
              </Panel>
          ))}
      </Panel>
  </Panel>
  ```
  Note: the legacy "active" treatment uses `borderLeft: 2px solid border.active` plus shifting the row's `paddingLeft` from 12 to 10 to compensate. With Panel we approximate via `borderColor="active"` on the bottom border + `background="light"`. This is a small visual change — acceptable trade for staying inside Panel's prop surface (see Concern C8).
- Splitter: legacy `<Splitter type="vertical" initialWidth={sidebarWidth} onChangeWidth={setSidebarWidth} borderSized="right" />` → `<Splitter orientation="vertical" value={sidebarWidth} onChange={setSidebarWidth} side="before" />`.
- Detail pane (`.prompt-detail`): `<Panel direction="column" flex={1} overflow="hidden">{selectedPrompt ? ... : <EmptyDetail />}</Panel>`.
- Inside detail: `.prompt-detail-top` → `<Panel direction="column" overflow="auto" padding="xl" gap="lg" shrink={false}>`. Each section maps to Panel + Text pieces.
- Argument editors: `<Textarea value={ps.promptArgs[arg.name] || ""} onChange={(v) => model.setPromptArg(arg.name, v)} placeholder={arg.description || ""} readOnly={ps.getPromptLoading} size="sm" />`.
- "Get Prompt" button: `<Button variant="primary" size="sm" onClick={handleGetPrompt} disabled={ps.getPromptLoading}>{ps.getPromptLoading ? "Loading…" : "Get Prompt"}</Button>`.
- Error: `<Text size="sm" color="error">{ps.promptError}</Text>`.
- `MessageView` and `MessageContentBlock`: re-render with Panel + Text + raw `<img>` (image messages). `.message` → `<Panel direction="column" paddingY="md" borderBottom>`, `.message-role` becomes `<Tag size="sm" variant="filled" label={message.role} />` (a `data-role={message.role}` style override is unnecessary — pick one variant or use `<Text color="info|success">{role}</Text>` to keep distinct user/assistant colors).

### Step 5 — `ResourcesPanel.tsx`

Same shape as PromptsPanel, but the sidebar has two sections (Resources and
Templates) and detail has TWO content paths (static resource vs. template
with parameters).

- Sidebar list mirrors the Prompts pattern (Panel-based custom list with
  click handlers). Section header for "Templates" is a `<Panel paddingX="lg"
  paddingY="sm" borderBottom background="dark"><Text size="xs" variant="uppercased" color="light" bold>Templates</Text></Panel>`.
- Inside each item, render `<Text size="sm" truncate>{r.name}</Text>` and
  `<Text size="xs" color="info" truncate>{r.uri}</Text>`. (Legacy used
  `color.misc.blue` which is the `info` token.)
- Detail panes: `<Panel direction="column" flex={1} overflow="hidden">`
  containing `<Panel direction="column" padding="xl" gap="md" shrink={false}>`
  for the top, then optionally a `<Panel direction="column" flex={1} overflow="hidden" paddingX="xl" paddingBottom="xl" minHeight={80}><ResourceContentView content={...} /></Panel>` content area.
- "Read Resource" button: `<Button variant="primary" size="sm" ...>` (replaces
  the custom `read-btn` Emotion treatment).
- Template parameters: each row is `<Panel direction="column" gap="xs"><Text size="sm">{param}</Text><Textarea value={...} onChange={...} placeholder={param} readOnly={rs.templateReadLoading} size="sm" /></Panel>`.

### Step 6 — `ToolsPanel.tsx`

Largest file. Has both vertical and horizontal splitters.

- Outer `ToolsPanelRoot styled.div` → `<Panel direction="row" flex={1} overflow="hidden" onKeyDown={handleKeyDown}>`.
- Sidebar: same pattern as Prompts/Resources, but the legacy lists tool
  names as a single line each — perfect fit for `ListBox`. Build:
  ```tsx
  const items: IListBoxItem[] = useMemo(
      () => ts.tools.map((t) => ({ value: t.name, label: t.name })),
      [ts.tools],
  );
  const selected = items.find((it) => it.value === ts.selectedToolName) ?? null;
  ```
  And render:
  ```tsx
  <Panel direction="column" overflow="hidden" shrink={false} width={sidebarWidth}>
      <Panel direction="row" align="center" justify="between" paddingX="lg" paddingY="md" borderBottom shrink={false}>
          <Text size="xs" variant="uppercased" color="light" bold>Tools</Text>
          <Tag size="sm" label={ts.tools.length} />
      </Panel>
      <ListBox<IListBoxItem>
          items={items}
          value={selected}
          onChange={(it) => model.selectTool(String(it.value))}
          variant="browse"
          keyboardNav
          getTooltip={(it) => String(it.value)}
      />
  </Panel>
  ```
- Vertical splitter: `<Splitter orientation="vertical" value={sidebarWidth} onChange={setSidebarWidth} side="before" />`.
- Detail pane: `<Panel direction="column" flex={1} overflow="hidden" ref={detailRef}>{selectedTool ? ... : <EmptyDetail/>}</Panel>`.
- Top panel (args): `<Panel direction="column" overflow="hidden" minHeight={0} flex={topFlex /* 1 1 auto or "7 1 0" — pass through Panel.flex prop */}>`. Header inside: `<Panel direction="row" align="center" gap="md" paddingX="xl" paddingY="sm" borderBottom shrink={false} background="dark" onDoubleClick={handleTopHeaderDblClick}><Text size="md" color="default" bold>{selectedTool.name}</Text>{annotations && <Panel direction="row" gap="sm" shrink={false}>...annotations...</Panel>}</Panel>`. Body: `<Panel direction="column" flex={1} overflow="auto" padding="lg" gap="lg"><Text size="md" color="light">{description}</Text><SectionTitle>Arguments</SectionTitle><ToolArgForm .../></Panel>`.
- `<SectionTitle>` is **not** a new component — it's the inline pattern
  `<Panel borderBottom paddingBottom="xs"><Text size="xs" variant="uppercased" color="light" bold>Arguments</Text></Panel>`. Use it as a literal expansion in 3-4 places; do NOT extract a shared helper this task (out of scope).
- Annotation badges: `<Tag size="sm" label="read-only" />` and
  `<Tag size="sm" label={<Text color="error">destructive</Text>} />` (the
  legacy destructive variant uses `color.error.text` for both text and
  border; Tag does not have a danger variant — wrapping the label in a
  Text with `color="error"` is acceptable; the border stays subtle, a
  small visual delta).
- Horizontal splitter: `<Splitter orientation="horizontal" value={currentResultHeight} onChange={handleResultHeightChange} side="after" border="before" />`.
- Bottom panel (result): need to forward the `bottomStyle` (either `height + flex 0 0` or `flex: "3 1 0" + minHeight: 0`) to the wrapping Panel. Panel supports `flex={"3 1 0"}` (string passes through) and `height={number}` and `minHeight={number}`. Build the props conditionally:
  ```tsx
  const bottomFlexProps = resultHeight !== null
      ? { height: currentResultHeight, shrink: false }
      : { flex: "3 1 0" as const, minHeight: 0 };
  ```
  Wait — Panel's `shrink` prop is a boolean toggle, where `shrink={false}` sets `flex-shrink: 0` but does not force `flex-grow: 0`. Legacy used `flexShrink: 0, flexGrow: 0`. To express `flexGrow: 0` cleanly, pass `flex={"0 0 auto"}` instead of `shrink={false}` — this gives `flex: 0 0 auto` (no grow, no shrink) — combined with `height={X}` for the explicit fixed height. So:
  ```tsx
  const bottomFlexProps = resultHeight !== null
      ? { height: currentResultHeight, flex: "0 0 auto" as const }
      : { flex: "3 1 0" as const, minHeight: 0 };
  ```
- Bottom header (`.tool-panel-bottom-header`): `<Panel direction="row" align="center" gap="md" paddingX="lg" paddingY="xs" borderBottom shrink={false} background="dark" onDoubleClick={handleBottomHeaderDblClick}><Text size="xs" variant="uppercased" color="light" bold>Result</Text>{ts.toolResult && <><Tag size="sm" label={`${ts.toolResult.durationMs}ms`} />{ts.toolResult.isError && <Text size="xs" color="error">Error</Text>}</>}<Spacer /><Button variant="primary" size="sm" onClick={handleCallTool} disabled={ts.toolCallLoading}>{ts.toolCallLoading ? "Calling…" : "▶ Call Tool"}</Button></Panel>`.
- Bottom body (`.tool-panel-bottom-body`): `<Panel direction="column" flex={1} overflow="hidden" paddingX="lg" paddingY="md">{ts.toolResult ? <ToolResultView .../> : <Text color="light">Click "Call Tool" to execute.</Text>}</Panel>`.

### Step 7 — `McpInspectorView.tsx`

Outer chrome — most surface area changes. Migrate in this order:

- Outer styled.div → `<Panel direction="column" flex={1} outline="none" overflow="hidden" tabIndex={-1}>`. (Replace `flex: "1 1 auto"` and `outline: "none"` directly. The `outline` prop is **not** a Panel prop — apply this as `tabIndex={-1}` only and accept that the focus outline default is fine in practice; `outline: none` on a non-tabbable container is decorative. If a focus outline appears on the root, we can address as a follow-up.)
- Connection bar inside `<PageToolbar borderBottom>`:
  ```tsx
  <Panel direction="row" align="center" gap="sm" paddingX="lg" paddingY="sm" flex={1}>
      {connections.length > 0 && !isConnected && !isConnecting && (
          <>
              <Select<IListBoxItem>
                  items={savedItems}
                  value={null}
                  onChange={(it) => { handleSelectSaved(String(it.value)); }}
                  placeholder="Saved…"
                  size="sm"
                  maxWidth={160}
              />
              <Divider orientation="vertical" />
          </>
      )}

      <Select<IListBoxItem>
          items={transportItems}
          value={transportItems.find((it) => it.value === s.transportType)!}
          onChange={(it) => model.state.update((st) => { st.transportType = it.value as "http" | "stdio"; })}
          disabled={isConnected || isConnecting}
          size="sm"
          minWidth={70}
      />

      {s.transportType === "http" ? (
          <Panel flex={1}>
              <Input
                  placeholder="http://localhost:7865/mcp"
                  value={s.url}
                  onChange={(v) => model.state.update((st) => { st.url = v; })}
                  onKeyDown={handleKeyDown}
                  disabled={isConnected || isConnecting}
                  size="sm"
              />
          </Panel>
      ) : (
          <>
              <Input
                  placeholder="command (e.g. npx)"
                  value={s.command}
                  onChange={(v) => model.state.update((st) => { st.command = v; })}
                  onKeyDown={handleKeyDown}
                  disabled={isConnected || isConnecting}
                  size="sm"
                  width={160}
              />
              <Panel flex={1}>
                  <Input
                      placeholder="args (e.g. -y @modelcontextprotocol/server-filesystem /path)"
                      value={s.args}
                      onChange={(v) => model.state.update((st) => { st.args = v; })}
                      onKeyDown={handleKeyDown}
                      disabled={isConnected || isConnecting}
                      size="sm"
                  />
              </Panel>
          </>
      )}

      <Button variant="default" size="sm" onClick={handleConnect} disabled={isConnecting}>
          {isConnecting ? "Connecting…" : isConnected ? "Disconnect" : "Connect"}
      </Button>
  </Panel>
  ```
  Where `transportItems` and `savedItems` are memoized arrays of `IListBoxItem`.
  Note for `savedItems`: build label as `c.transport === "http" ? c.url : \`${c.command} ${c.args}\``. For the saved-select reset behavior (`value=""` after selection), passing `value={null}` is enough — `onChange` immediately resets the parent state via `model.fillFromSaved(conn)` and the next render re-renders `value={null}`. (See Concern C2.)
- Error message (`.error-message`): `<Panel paddingX="lg" paddingY="xs" background="light" borderBottom><Text size="sm" color="error">{s.errorMessage}</Text></Panel>`. The legacy used `color.error.background` for the bg; Panel does not have an `error` background variant. Pick `background="light"` as a compromise — the red text alone reads as an error indicator. (See Concern C7.)
- Server info bar (`.server-info`): replace the inline-flex `<div>` with a `<Panel direction="row" align="center" gap="md" paddingX="lg" paddingY="xs" borderBottom>`. Inside:
  ```tsx
  <Dot size="xs" color={dotColorFor(s.connectionStatus)} />
  <Text size="sm" color="default" bold>{s.serverTitle || s.serverName}</Text>
  {s.serverVersion && <Text size="sm" color="light">v{s.serverVersion}</Text>}
  <Divider orientation="vertical" />
  <SegmentedControl
      items={panelSegments}
      value={s.activePanel}
      onChange={(v) => model.setActivePanel(v as McpPanelId)}
      size="sm"
  />
  ```
  `panelSegments: ISegment[]` is built conditionally:
  ```tsx
  const panelSegments: ISegment[] = useMemo(() => {
      const out: ISegment[] = [{ value: "info", label: "Info" }];
      if (s.hasTools)     out.push({ value: "tools", label: "Tools" });
      if (s.hasResources) out.push({ value: "resources", label: "Resources" });
      if (s.hasPrompts)   out.push({ value: "prompts", label: "Prompts" });
      out.push({ value: "history", label: "History" });
      return out;
  }, [s.hasTools, s.hasResources, s.hasPrompts]);
  ```
  And `dotColorFor`:
  ```ts
  function dotColorFor(status: string): DotColor {
      switch (status) {
          case "connected": return "success";
          case "connecting": return "warning";
          case "error": return "error";
          default: return "neutral";
      }
  }
  ```
- Body (`.body`): `<Panel direction="row" flex={1} overflow="hidden">{...children panels...}</Panel>`.
- Empty/connecting states (`.main-panel`, `.empty-state`): `<Panel flex={1} align="center" justify="center" overflow="auto"><Text size="md" color="light" align="center">...</Text></Panel>`.
- Saved-connections list (visible when not connected and `connections.length > 0`):
  ```tsx
  <Panel direction="column" width="100%" maxWidth={560} paddingX="xl" gap="sm">
      <Text size="base" color="default" bold>Saved Connections</Text>
      {connections.map((c) => {
          const isActive = c.transport === s.transportType
              && (c.transport === "http" ? c.url === s.url : c.command === s.command && c.args === s.args);
          return (
              <Panel
                  key={c.id}
                  direction="row" align="center" gap="md"
                  paddingX="lg" paddingY="sm"
                  border rounded="md"
                  borderColor={isActive ? "active" : "subtle"}
                  background={isActive ? "light" : undefined}
                  onClick={() => handleClickConnection(c.id)}
                  revealChildrenOnHover
              >
                  <Panel direction="column" flex={1} overflow="hidden" minWidth={0}>
                      <Text size="sm" color="default" truncate>
                          {c.transport === "http" ? c.url : `${c.command} ${c.args}`}
                      </Text>
                  </Panel>
                  <Tag size="sm" label={c.transport.toUpperCase()} />
                  <IconButton
                      icon={<CloseIcon />}
                      size="sm"
                      title="Delete connection"
                      hideUntilParentHover
                      onClick={(e) => handleDeleteConnection(e, c.id)}
                  />
              </Panel>
          );
      })}
      <Text size="xs" color="light">
          Click a connection to fill the connection bar, then click Connect.
      </Text>
  </Panel>
  ```
- `ServerInfoPanel`: replace `.info-panel`/`.info-field`/`.info-label`/`.info-value`/`.info-link`/`.info-instructions` with Panel + Text + a raw `<a>` for the website link (raw HTML, allowed) styled via Text-wrapping pattern:
  ```tsx
  <Text size="md" color="info"><a href={state.serverWebsiteUrl} onClick={handleWebsiteClick}>{state.serverWebsiteUrl}</a></Text>
  ```
- `HistoryPanel`: simple — `<Panel flex={1} align="center" justify="center" gap="md" direction="column"><Text size="md" color="light">{count} request{count !== 1 ? "s" : ""} recorded</Text><Panel direction="row" gap="md"><Button variant="default" size="sm" onClick={handleShow}>Open in Log View</Button><Button variant="default" size="sm" onClick={handleClear}>Clear</Button></Panel></Panel>`.

### Step 8 — verify

- `npx tsc --noEmit` — only pre-existing errors should remain (commands.ts,
  video editors, WorkerRunner, PageTab, LinkTooltip — same baseline as
  US-500).
- `npm run lint` — clean, no new warnings introduced.
- `Grep` `"@emotion/styled"` and `"components/(basic|form|layout|overlay)"`
  inside `src/renderer/editors/mcp-inspector/` — both must return zero
  matches.
- Manual smoke test (golden path):
  1. Open MCP Inspector via well-known page (or page tab).
  2. Pick Stdio, enter `npx -y @modelcontextprotocol/server-filesystem
     <some-path>`, click Connect — server connects, capability tabs appear.
  3. Click Tools tab — sidebar lists tools, click one — detail pane shows
     args form.
  4. Fill an arg, click Call Tool — result panel renders below.
  5. Click Resources tab — sidebar shows resources + templates section,
     click one — detail pane shows resource info, Read Resource fetches.
  6. Click Prompts tab — sidebar shows prompts, pick one — args form, Get
     Prompt renders messages.
  7. Resize sidebar splitter and result splitter — both work smoothly.
  8. Disconnect — saved connections list re-appears, hover a row to reveal
     the X delete button, click another row to fill the connection bar.
  9. Toggle dark/light theme to confirm Dot colors and Tag styling work
     under both.

## Concerns / Open questions

### C1 — RESOLVED: No new UIKit primitives needed

All required primitives exist after US-498/499/500: Dot, Tag, SegmentedControl,
Select (with width/minWidth/maxWidth), Splitter (new API), Panel
(`revealChildrenOnHover`), IconButton (`hideUntilParentHover`),
ListBox (`browse` variant), Checkbox, Textarea, Input, Button (`primary`
variant). No primitive authoring blocks this task.

### C2 — RESOLVED: Saved-connections Select uses `value={null}` reset pattern

Legacy uses `<select value="" onChange={resetToEmpty}>` so the dropdown is
purely a one-shot fill action. The UIKit equivalent is to pass
`value={null}` always — selecting an item fires `onChange` (which calls
`model.fillFromSaved(conn)`) and the next render re-passes `value={null}`,
so the visible Input shows `placeholder="Saved…"` again. No internal state
or onClose hack needed.

### C3 — RESOLVED: Capability bar uses SegmentedControl with conditional items

The capability "tabs" (Info / Tools / Resources / Prompts / History) are
visually badge-style tabs with a single-active state — exactly
`SegmentedControl` semantics. Tabs are conditionally rendered based on
server-reported capabilities (`hasTools`/`hasResources`/`hasPrompts`); we
build the `ISegment[]` array conditionally. `Info` and `History` are always
present.

### C4 — RESOLVED: Hover-reveal delete uses Panel.revealChildrenOnHover

Legacy `.conn-item:hover .conn-delete { opacity: 1 }` is the exact pattern
US-504 added (`Panel revealChildrenOnHover` + `IconButton
hideUntilParentHover`). One-line migration.

### C5 — RESOLVED: ListBox for Tools, Panel-based custom list for Resources/Prompts

The placeholder recommended ListBox for all three sidebars "to be consistent
with the sidebar arc". On closer inspection:

- **Tools** has flat single-line items — direct fit for ListBox with the
  default ListItem renderer. Use it.
- **Resources** has multi-line items (name + uri) AND a section header
  ("Templates"). ListBox supports `section: true` items, but with the
  default ListItem they render as single-line; we'd need a custom
  `renderItem` to render the two-line shape. The custom render must also
  branch on `section: true` to render the section header differently. The
  net code is comparable to a Panel-based list and adds virtualization
  machinery for ~10-30 items, which is overkill.
- **Prompts** has multi-line items (name + description preview) — same
  trade as Resources.

**Decision:** ListBox for Tools (with `variant="browse"`, `keyboardNav`).
Panel-based custom list for Resources and Prompts. Document this asymmetry
in the panel files' top comments so a future reader doesn't assume it
should be unified. If keyboard nav becomes desirable on
Resources/Prompts later, swapping in ListBox with `renderItem` is
straightforward — at that point the second usage will justify a shared
two-line `<DetailListItem>` render helper.

### C6 — RESOLVED: Splitter API mapping verified against new Splitter source

The mapping table in this document was verified against
`src/renderer/uikit/Splitter/Splitter.tsx` (sign rules, border edge
mapping). Critical case: `ToolsPanel` horizontal splitter requires
`side="after"` so dragging UP grows the bottom (result) panel — matches
legacy behavior.

### C7 — ACCEPTED VISUAL DELTA: Error message bar uses `light` background, not `error.background`

Panel does not have `background="error"` (only `default | light | dark |
overlay`). The legacy `.error-message` uses `color.error.background` for
the bar background. With `background="light"` plus `<Text color="error">`,
the error context is still clear, but the bg is grayish instead of reddish.

**Decision:** Accept the small visual delta. If unacceptable in user
testing, extend Panel with a `background="error"` token mapped to
`color.error.background` (small Panel extension).

### C8 — ACCEPTED VISUAL DELTA: Sidebar item active state shifts from left-border-bar to bottom-border-color + light-background

Legacy `.sidebar-item.active` uses `borderLeft: 2px solid border.active` +
`paddingLeft: 10` (compensating for the 2px border so text aligns). UIKit
Panel does not expose a per-side border thickness, only on/off + color.

**Decision:** Use `borderColor="active"` on the bottom border + `background="light"`.
This preserves "this row is selected" affordance while staying on Panel's
prop surface. Small visual delta from the left-bar accent. Acceptable.

### C9 — ACCEPTED VISUAL DELTA: Monaco editor wrapper loses `:focus-within` border-active highlight

Legacy `.arg-editor-wrapper { &:focus-within { borderColor: active } }`
gave the wrapper a blue border when Monaco was focused. Panel does not
support `:focus-within` border-color. Monaco's own focus indicator inside
the wrapper (cursor blink + selection styling) is sufficient.

**Decision:** Skip the wrapper focus highlight. If user feedback flags
this, add a `Panel borderColorOnFocusWithin` prop in a follow-up.

### C10 — RESOLVED: Width control on chrome-bar inputs

After US-500, both `Input` and `Select` accept `width`/`minWidth`/`maxWidth`
props. The `transport-select` uses `minWidth={70}`, `saved-select` uses
`maxWidth={160}`, the stdio `command` input uses `width={160}`. The
`url-input` and `args-input` use no width prop and are wrapped in
`<Panel flex={1}>` so they fill the remaining horizontal space (Input
default `width: 100%` honors the Panel's flex-grow).

### C11 — RESOLVED: Annotation-badge "destructive" variant uses Text color="error"

Tag does not have a `danger` / `error` variant. Legacy `.annotation-badge.destructive`
sets text color and border color to `color.error.text`. To preserve the
red text, wrap the Tag's label in `<Text color="error">{label}</Text>`. The
border stays subtle (small visual delta — accept). Adding a Tag `tone="error"`
variant is a candidate follow-up if more error-flavored chips appear.

## Acceptance criteria

- [ ] No imports from `components/basic|form|layout|overlay/` in any file
      under `editors/mcp-inspector/`.
- [ ] No `import styled from "@emotion/styled"` anywhere under
      `editors/mcp-inspector/`.
- [ ] No `style={…}` or `className={…}` passed to a UIKit component (these
      would fail TypeScript per Rule 7 anyway — verify with `tsc --noEmit`).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no NEW errors versus
      the baseline.
- [ ] Manual smoke test from Step 8 passes for at least one HTTP and one
      Stdio MCP server.
- [ ] Capability tabs (`SegmentedControl`) correctly render only available
      tabs and switch panels on click.
- [ ] Hover-reveal delete X on saved connections list works.
- [ ] Both splitters (vertical sidebar in all 3 panels, horizontal result
      in Tools) drag smoothly with the new API.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/mcp-inspector/McpInspectorView.tsx` | Modified — full UIKit rewrite (Panel/Select/Input/Button/Tag/Dot/SegmentedControl/Divider/IconButton). |
| `src/renderer/editors/mcp-inspector/ToolsPanel.tsx` | Modified — full UIKit rewrite (Panel/ListBox/Splitter/Button/Tag/Spacer/Text). |
| `src/renderer/editors/mcp-inspector/ResourcesPanel.tsx` | Modified — full UIKit rewrite (Panel/Splitter/Textarea/Button/Tag/Text). |
| `src/renderer/editors/mcp-inspector/PromptsPanel.tsx` | Modified — full UIKit rewrite (Panel/Splitter/Textarea/Button/Tag/Text). |
| `src/renderer/editors/mcp-inspector/ToolArgForm.tsx` | Modified — full UIKit rewrite (Panel/Input/Textarea/Checkbox/Select/Tag/Text). |
| `src/renderer/editors/mcp-inspector/ResourceContentView.tsx` | Modified — drop `@emotion/styled`; rewrite as Panel/Text. |
| `src/renderer/editors/mcp-inspector/ToolResultView.tsx` | Modified — drop `@emotion/styled`; rewrite as Panel/Text. |
| `src/renderer/editors/mcp-inspector/McpInspectorEditorModel.ts` | No change. |
| `src/renderer/editors/mcp-inspector/McpConnectionManager.ts` | No change. |
| `src/renderer/editors/mcp-inspector/McpConnectionStore.ts` | No change. |
| `src/renderer/editors/mcp-inspector/index.ts` | No change. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Reference migrations: US-498 (Settings), US-499 (TodoEditor), US-500 (Text editor chrome)
