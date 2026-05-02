# US-462: TorStatusOverlay — UIKit migration

## Goal

Migrate [src/renderer/editors/browser/TorStatusOverlay.tsx](../../../src/renderer/editors/browser/TorStatusOverlay.tsx) from a `styled.div` root with raw `<button>` / `<span>` / `<pre>` children to a pure UIKit composition (`Panel`, `IconButton`, `Button`, `Text`, `Spinner`) — the next per-screen migration of [EPIC-025](../../epics/EPIC-025.md) Phase 4.

After this task, `TorStatusOverlay.tsx` contains zero `styled.*` calls, zero `style={...}`, zero `className={...}`. It imports UIKit primitives plus the existing app-level `ColorizedCode` (from `editors/shared/`) for the log pane. Two small UIKit extensions are added along the way (`Spinner.color`, `Panel.whiteSpace`) — both reusable beyond this screen.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop (from [EPIC-025](../../epics/EPIC-025.md) Phase 4):

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

Recent precedents:
- [US-460 MarkdownSearchBar](../US-460-markdown-search-bar-migration/README.md) — added `top` / `right` / `bottom` / `left` to `Panel`, then rewrote the floating bar.
- [US-461 Shared FindBar](../US-461-shared-findbar-consolidation/README.md) — consolidated MarkdownSearchBar + BrowserFindBar into `editors/shared/FindBar.tsx` using the same UIKit recipe.
- [US-455 MermaidView](../US-455-mermaid-view-migration/README.md) — added `position` / `inset` / `zIndex` to `Panel`, then rewrote the screen.

### Why TorStatusOverlay

- **Self-contained** — one file, one consumer ([BrowserEditorView.tsx:755-761](../../../src/renderer/editors/browser/BrowserEditorView.tsx#L755-L761)). No cross-screen coupling.
- **Small surface** — 154 LOC, ~5 distinct UI elements (close button, icon area, status message, reconnect button, log pane). Tight rewrite.
- **Exercises full-area overlay positioning** — `position: absolute; inset: 0; zIndex: 5; background: dark`. UIKit Panel already supports all these props (added in US-455 / US-460).
- **No `Dialog` dependency** — overlay sits inside its parent (the webview region) and does not block the rest of the app; `Dialog` (US-432) blockage does not apply.

### Current implementation (file body)

[src/renderer/editors/browser/TorStatusOverlay.tsx](../../../src/renderer/editors/browser/TorStatusOverlay.tsx) — 154 lines:

```tsx
import { useEffect, useRef } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { TorIcon } from "../../theme/language-icons";
import { TOR_BROWSER_COLOR } from "../../theme/palette-colors";
import { CloseIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import type { BrowserEditorModel } from "./BrowserEditorModel";

interface TorStatusOverlayProps {
    model: BrowserEditorModel;
    torStatus: "disconnected" | "connecting" | "connected" | "error";
    torLog: string;
}

function TorStatusOverlayComponent({ model, torStatus, torLog }: TorStatusOverlayProps) {
    const logRef = useRef<HTMLPreElement>(null);
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [torLog]);

    const canClose = torStatus === "connected";
    const showReconnect = torStatus === "disconnected" || torStatus === "error";
    const showSpinner = torStatus === "connecting";

    return (
        <TorOverlayRoot>
            {canClose && (
                <button className="close-btn" onClick={() => model.toggleTorOverlay()} title="Close">
                    <CloseIcon />
                </button>
            )}
            <div className="status-area">
                <div className="status-icon">
                    {showSpinner ? (
                        <span style={{ color: TOR_BROWSER_COLOR }}>
                            <CircularProgress size={24} />
                        </span>
                    ) : (
                        <TorIcon />
                    )}
                </div>
                <div className="status-text">
                    {torStatus === "connecting" && "Connecting to Tor network..."}
                    {torStatus === "connected" && "Connected to Tor"}
                    {torStatus === "error" && "Failed to connect to Tor"}
                    {torStatus === "disconnected" && "Tor is not connected"}
                </div>
                {showReconnect && (
                    <Button className="reconnect-btn" onClick={() => model.reconnectTor()}>
                        Reconnect
                    </Button>
                )}
            </div>
            {torLog && (
                <pre className="log-area" ref={logRef}>{torLog}</pre>
            )}
        </TorOverlayRoot>
    );
}

const TorOverlayRoot = styled.div({
    position: "absolute", inset: 0, zIndex: 5,
    background: color.background.dark,
    display: "flex", flexDirection: "column", alignItems: "center", overflow: "hidden",
    "& .close-btn": {
        position: "absolute", top: 8, right: 8,
        background: "none", border: "none", color: color.icon.light,
        cursor: "pointer", padding: 4, display: "flex",
        alignItems: "center", justifyContent: "center", borderRadius: 4,
        "&:hover": { background: color.background.overlay },
        "& svg": { width: 16, height: 16 },
    },
    "& .status-area": {
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 12, paddingTop: 60,
    },
    "& .status-icon": { "& svg": { width: 40, height: 40 } },
    "& .status-text": { fontSize: 14, color: color.text.light },
    "& .reconnect-btn": { marginTop: 8 },
    "& .log-area": {
        marginTop: 20, padding: "8px 16px",
        width: "100%", maxWidth: 600, flex: 1, overflow: "auto",
        fontSize: 11, lineHeight: 1.5, color: color.text.dark,
        fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word",
    },
});
```

### Audit results — element by element

| Old element | UIKit replacement | Gap |
|---|---|---|
| `TorOverlayRoot` — `position: absolute; inset: 0; zIndex: 5; background: dark; flex column; align center; overflow hidden` | `<Panel position="absolute" inset={0} zIndex={5} background="dark" direction="column" align="center" overflow="hidden">` | none |
| `<button.close-btn>` — top:8 right:8, transparent bg, color.icon.light, hover bg.overlay, padding 4, radius 4, 16×16 icon | wrap in floating Panel: `<Panel position="absolute" top={8} right={8}><IconButton size="sm" title="Close" icon={<CloseIcon/>} onClick={...}/></Panel>` | none — `IconButton size="sm"` is a 24×24 square with 16×16 icon and `color.icon.light` rest color. Same drift as US-460 / US-461 (hover changes icon color, not bg). |
| `<div.status-area>` — flex column, gap 12, paddingTop 60 | `<Panel direction="column" align="center" gap="lg" paddingTop="xxxl">` (paddingTop 32) **or** explicit `paddingTop={60}` via Panel `paddingTop` accepting raw px | gap "lg" = 8 (drift, see table below). The Panel `paddingTop` token does not have a 60px option (`xxxl` = 32). Decision below. |
| `<div.status-icon>` — 40×40 svg wrapper | direct `<TorIcon width={40} height={40}/>` — `SvgIcon` already accepts `width` and `height` props ([icons.tsx:13-40](../../../src/renderer/theme/icons.tsx#L13-L40)). For the spinner branch: `<Spinner size={40} color={TOR_BROWSER_COLOR}/>` | **`Spinner.color` prop missing**. Old code uses `<span style={{color}}>` to colorize the spinner — Rule 7 forbids that in app code. |
| `<div.status-text>` — fontSize 14, color.text.light | `<Text size="base" color="light">{message}</Text>` | none — `size="base"` = 14, `color="light"` = `color.text.light` |
| `<Button.reconnect-btn>` — legacy Button with `marginTop: 8` | `<Button onClick={...}>Reconnect</Button>` (UIKit Button) | UIKit Button has no `marginTop` prop. The 8px is replaced by parent Panel's `gap="lg"` (8px) — actually identical (see drift table). |
| `<pre.log-area>` — width 100%, maxWidth 600, flex 1, overflow auto, padding 8px 16px, fontSize 11, lineHeight 1.5, color.text.dark, fontFamily monospace, whiteSpace pre-wrap, wordBreak break-word | scroll container Panel + ColorizedCode inside: `<Panel ref={logRef} width="100%" maxWidth={600} flex paddingX="xl" paddingY="md" overflowY="auto" whiteSpace="pre-wrap"><ColorizedCode code={torLog} language="log"/></Panel>` | **`Panel.whiteSpace` prop missing** (needed to preserve `\n` characters in Monaco's colorize output). Other gaps (lineHeight, wordBreak, fontSize 11) accepted as drift. |

### Reuse of `ColorizedCode` for the log pane

The Tor connection log is now rendered through [src/renderer/editors/shared/ColorizedCode.tsx](../../../src/renderer/editors/shared/ColorizedCode.tsx) with `language="log"`. Two reasons this is a clear win:

1. **Free syntax highlighting**. The `log` Monaco language is registered at app startup ([configure-monaco.ts:233](../../../src/renderer/api/setup/configure-monaco.ts#L233) → [monaco-languages/log.ts](../../../src/renderer/api/setup/monaco-languages/log.ts)). It already tokenizes bracketed log levels (`[notice]`, `[err]`, `[warn]`, `[debug]`, `[verbose]`), ISO/time-only timestamps, URLs, GUIDs, exception types, stack-trace lines, hex literals, and constants. Tor's bootstrap output (`[notice] Bootstrapped 30% (loading_status): Loading authority key certs`) uses this exact shape, so each log level gets a distinct color and key tokens (percentages, URLs, hostnames) stand out.
2. **Established pattern**. `ColorizedCode` is the codebase's canonical syntax-highlight primitive — used by the markdown `CodeBlock.tsx` and the MCP-inspector `McpRequestView.tsx`. Reusing it keeps the visual language consistent with other code/log surfaces in the app.

Caveat: `monaco.editor.colorize()` returns HTML where newlines are real `\n` characters (not `<br/>`), so the container needs `whiteSpace: pre-wrap` to render line breaks. UIKit Panel does not expose `whiteSpace` today — see the second UIKit extension below.

### UIKit extensions added in this task

Two minimal additions, both reusable beyond this screen:

#### 1. `Spinner.color?: string`

Add an optional CSS color override to [Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx). Implementation:

```tsx
export interface SpinnerProps
    extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "className" | "color"> {
    size?: number;
    /** CSS color override applied to the spinner stroke. Default: inherits via currentColor. */
    color?: string;
}

const Root = styled.span<{ $size: number; $color?: string }>(
    ({ $size, $color }) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: $size,
        height: $size,
        flexShrink: 0,
        color: $color,
        "& svg": {
            width: $size,
            height: $size,
            animation: `${spin} 1.5s steps(10) infinite`,
        },
    }),
    { label: "Spinner" },
);

export function Spinner({ size = 32, color, ...rest }: SpinnerProps) {
    return (
        <Root data-type="spinner" role="status" aria-live="polite" aria-label="Loading"
            $size={size} $color={color} {...rest}>
            <ProgressIcon />
        </Root>
    );
}
```

Why a raw string and not a curated token: the only real consumer here is `TOR_BROWSER_COLOR` (a brand hex literal already living in [palette-colors.ts](../../../src/renderer/theme/palette-colors.ts)). Curating it into `color.ts` themes adds noise for one consumer. The raw-string escape hatch is consistent with how `palette-colors.ts` is used elsewhere in the codebase (TAG_COLORS, DEFAULT_BROWSER_COLOR).

#### 2. `Panel.whiteSpace?: "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line"`

Add an optional `whiteSpace` prop to [Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx). The value is forwarded directly to the inline style — no token mapping. Implementation:

```tsx
type WhiteSpace = "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line";

export interface PanelProps extends ... {
    // ...existing props...
    /** Controls whitespace handling for descendants. Use "pre-wrap" for log/code panes that contain real `\n` characters. */
    whiteSpace?: WhiteSpace;
}

// In the Panel component, add to inlineStyle:
const inlineStyle: React.CSSProperties = {
    // ...existing fields...
    whiteSpace,
};
```

Why on Panel and not on Text: the consumer here is a scroll container that hosts a non-UIKit child (`ColorizedCode`'s `<code>` element). The whitespace property must apply to the scroll container so it cascades to the descendant code. Other future consumers (any panel that hosts pre-formatted content from a script, an editor, or a fetched response) will benefit from the same prop.

### Why no `Text.monospace` prop

Persephone is monospace-first by design — `body` in [GlobalStyles.tsx:14](../../../src/renderer/theme/GlobalStyles.tsx#L14) sets `font-family: Consolas, monospace, "Courier New"`, so every component inherits monospace unless it explicitly overrides. The legacy `<pre.log-area>` setting `fontFamily: "monospace"` was redundant. Adding a UIKit `monospace` prop would set what is already the default — pure noise. The right direction (if/when needed) is a `sans-serif` opt-out, not a monospace opt-in.

### Visual drift accepted in the migration

| Drift | Old | New | Reason |
|---|---|---|---|
| Status-area `gap` | 12px | 8px (`gap="lg"`) | Closest token. Visible but mild — 4px less spacing between icon, text, button. |
| Status-area `paddingTop` | 60px | 32px (`paddingTop="xxxl"`) | UIKit padding scale ends at xxxl=32. Top of content sits 28px higher. Acceptable — overlay still feels balanced. |
| Reconnect button `marginTop` | 8px | replaced by parent `gap="lg"` (8px) | Functionally identical. |
| Close button hover | bg change (overlay) | icon color change | Same drift as US-460 / US-461 IconButton migrations. |
| Close icon size | 16×16 (explicit) | 16×16 (`IconButton size="sm"` default) | No drift — coincidence. |
| Log font size | 11 | 14 (body default, inherited through ColorizedCode's `<code>`) | Larger and more readable. The previous 11 was below `xs=12` in the UIKit scale anyway. |
| Log line-height | 1.5 | body default (browser ~1.2 on `<code>`) | Slightly tighter. Tor logs are short status messages — readability remains good. |
| Log `wordBreak: break-word` | enabled | not exposed | Long unbroken tokens (URLs, hashes) may overflow horizontally. Tor log lines rarely contain unbroken tokens long enough to overflow a 600px box. Accepted; can be revisited if real overflow appears. |
| Log color | flat `color.text.dark` | per-token Monaco theme colors via `language="log"` | Visual upgrade — bracketed log levels and tokens are color-cued. |
| Log container `padding` | 8px / 16px | `paddingY="md"` (8) / `paddingX="xl"` (16) | Net same. |
| Box shadow on overlay | none | none | No change. |

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/uikit/Spinner/Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx) | Spinner primitive | Add optional `color?: string` prop |
| [src/renderer/uikit/Spinner/Spinner.story.tsx](../../../src/renderer/uikit/Spinner/Spinner.story.tsx) | Spinner story | Add a `color` prop entry |
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Panel primitive | Add optional `whiteSpace` prop |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Panel story | Add a `whiteSpace` prop entry |
| [src/renderer/editors/browser/TorStatusOverlay.tsx](../../../src/renderer/editors/browser/TorStatusOverlay.tsx) | Tor connection overlay | Rewrite — drop `@emotion/styled`, `color`, `CircularProgress`, legacy `Button`; use `Panel` / `IconButton` / `Button` / `Text` / `Spinner` plus shared `ColorizedCode` for the log pane |

### Files NOT changed

- `BrowserEditorView.tsx` — the `<TorStatusOverlay>` call site (line 755-761) keeps the same props. No prop renames.
- `BrowserEditorModel.ts` — model methods (`toggleTorOverlay`, `reconnectTor`) and state (`torStatus`, `torLog`) untouched.
- `palette-colors.ts` — `TOR_BROWSER_COLOR` still exported and used.
- `language-icons.tsx` — `TorIcon` still exported (now consumed via `width`/`height` props directly).
- `editors/shared/ColorizedCode.tsx` — used as-is.
- `api/setup/monaco-languages/log.ts` — used as-is. The `log` language is already registered at startup.
- `components/basic/Button.tsx`, `components/basic/CircularProgress.tsx` — still used by other screens; only this file's imports change.

## Implementation plan

### Step 1 — Extend `Spinner` with `color` prop

[src/renderer/uikit/Spinner/Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx):

- Add `color?: string` to `SpinnerProps` (and `"color"` to the `Omit` list to free the name from `HTMLAttributes`).
- Add `$color?: string` transient prop on `Root`; apply `color: $color` in the styled function.
- Pass `$color={color}` from the component.

### Step 2 — Update `Spinner.story.tsx`

Add a `color` entry alongside `size`. Use a hex literal preview value (e.g. `"#7D4698"`). Confirms the prop appears in Storybook editor.

### Step 3 — Extend `Panel` with `whiteSpace` prop

[src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx):

- Add `whiteSpace?: "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line"` to `PanelProps`.
- Destructure in the component body.
- Add `whiteSpace` to `inlineStyle`.

### Step 4 — Update `Panel.story.tsx`

Add a `whiteSpace` entry. Use `"pre-wrap"` as preview value with sample multi-line content to demonstrate the effect.

### Step 5 — Rewrite `TorStatusOverlay.tsx`

Replace the entire file body with:

```tsx
import { useEffect, useRef } from "react";
import { Panel, IconButton, Button, Text, Spinner } from "../../uikit";
import { ColorizedCode } from "../shared/ColorizedCode";
import { TorIcon } from "../../theme/language-icons";
import { TOR_BROWSER_COLOR } from "../../theme/palette-colors";
import { CloseIcon } from "../../theme/icons";
import type { BrowserEditorModel } from "./BrowserEditorModel";

interface TorStatusOverlayProps {
    model: BrowserEditorModel;
    torStatus: "disconnected" | "connecting" | "connected" | "error";
    torLog: string;
}

const STATUS_MESSAGE: Record<TorStatusOverlayProps["torStatus"], string> = {
    connecting:   "Connecting to Tor network...",
    connected:    "Connected to Tor",
    error:        "Failed to connect to Tor",
    disconnected: "Tor is not connected",
};

export function TorStatusOverlay({ model, torStatus, torLog }: TorStatusOverlayProps) {
    const logRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [torLog]);

    const canClose      = torStatus === "connected";
    const showReconnect = torStatus === "disconnected" || torStatus === "error";
    const showSpinner   = torStatus === "connecting";

    return (
        <Panel
            position="absolute"
            inset={0}
            zIndex={5}
            background="dark"
            direction="column"
            align="center"
            overflow="hidden"
        >
            {canClose && (
                <Panel position="absolute" top={8} right={8}>
                    <IconButton
                        size="sm"
                        title="Close"
                        onClick={() => model.toggleTorOverlay()}
                        icon={<CloseIcon />}
                    />
                </Panel>
            )}

            <Panel
                direction="column"
                align="center"
                gap="lg"
                paddingTop="xxxl"
            >
                {showSpinner
                    ? <Spinner size={40} color={TOR_BROWSER_COLOR} />
                    : <TorIcon width={40} height={40} />}

                <Text size="base" color="light">{STATUS_MESSAGE[torStatus]}</Text>

                {showReconnect && (
                    <Button onClick={() => model.reconnectTor()}>Reconnect</Button>
                )}
            </Panel>

            {torLog && (
                <Panel
                    ref={logRef}
                    width="100%"
                    maxWidth={600}
                    flex
                    paddingY="md"
                    paddingX="xl"
                    overflowY="auto"
                    whiteSpace="pre-wrap"
                >
                    <ColorizedCode code={torLog} language="log" />
                </Panel>
            )}
        </Panel>
    );
}
```

Notes:
- The export name returns to plain `TorStatusOverlay` (no `Component` alias). The legacy file aliases at line 154 (`export { TorStatusOverlayComponent as TorStatusOverlay }`) was leftover from a refactor — drop it.
- Status messages moved into a const map for clarity (no behavior change).
- `<TorIcon width={40} height={40}/>` works because `SvgIcon` ([icons.tsx:13-40](../../../src/renderer/theme/icons.tsx#L13-L40)) accepts `width`/`height` props — no styling wrapper needed.
- The log container's `ref` is now `useRef<HTMLDivElement>(null)` (was `HTMLPreElement`). Panel forwards refs to its inner `<div>`.
- `import type { BrowserEditorModel }` already type-only — keep as-is.
- `ColorizedCode` is rendered without props beyond `code` and `language`; it inherits font-family (monospace from body) and font-size (14px from body) automatically. The `whiteSpace="pre-wrap"` on the parent Panel cascades to the child `<code>` so Monaco's `\n`-separated colorized output renders with line breaks.

### Step 6 — Verify no other consumers

`grep TorStatusOverlay` showed only [BrowserEditorView.tsx:26](../../../src/renderer/editors/browser/BrowserEditorView.tsx#L26) (import) and [line 756](../../../src/renderer/editors/browser/BrowserEditorView.tsx#L756) (usage). No prop renames — call site needs no changes.

### Step 7 — Run TypeScript check

`npx tsc --noEmit` — confirm no new errors on `Spinner.tsx`, `Panel.tsx`, `TorStatusOverlay.tsx`, `BrowserEditorView.tsx`.

### Step 8 — Manual smoke test (user)

User performs the smoke checks listed in Acceptance Criteria below.

### Step 9 — Update dashboard

Per CLAUDE.md task workflow: when this task moves from Planned → Active (or stays in Active under EPIC-025), upgrade its dashboard entry to a markdown link to this README.

## Concerns / Open questions

All resolved before implementation; record kept here for future readers.

### 1. Should the Spinner accept a raw color string, or a curated token? — RESOLVED: raw string

The only real caller wants a brand color (`TOR_BROWSER_COLOR`) that lives in `palette-colors.ts`, not `color.ts`. Curating it into a theme color requires touching all 11 themes for one purple. A raw `string` prop on `Spinner.color` matches how `palette-colors.ts` already handles brand identity (DEFAULT_BROWSER_COLOR, TAG_COLORS).

### 2. How should the log area render content? — RESOLVED: reuse `ColorizedCode` with `language="log"`

The codebase already has both halves of the right answer: [ColorizedCode](../../../src/renderer/editors/shared/ColorizedCode.tsx) (Monaco's `colorize()` → highlighted `<code>`) and a registered `log` Monaco grammar ([log.ts](../../../src/renderer/api/setup/monaco-languages/log.ts)) that recognizes the exact tokens Tor's bootstrap output contains (`[notice]`, `[err]`, percentages, URLs, GUIDs, stack traces). Reusing both gives free, theme-aware syntax highlighting and matches the markdown CodeBlock / MCP-inspector pattern. The only constraint is that Monaco's colorize output uses real `\n` characters, so the parent Panel needs `whiteSpace: pre-wrap` — that's the second UIKit extension this task adds.

A purpose-built UIKit `<Code>` / `<Pre>` component remains a meaningful future addition (semantic `<pre>`, copy button, line numbers), but it's a separate scope and not needed here.

### 3. paddingTop of 60px has no token — should we add one? — RESOLVED: no, accept drift to 32

The 60px value is arbitrary visual whitespace, not a meaningful design token. Accepting 32 (`xxxl`) and centering content slightly higher in the overlay is reasonable. Token sprawl avoided.

### 4. The status-area `gap` is currently 12 but UIKit `gap="lg"` is 8 — is this acceptable? — RESOLVED: yes

4px less spacing between icon, text, and reconnect button. Visible but mild. UIKit's gap scale tops out at `xxl=16` which would over-space; `lg=8` is the closest match. Same drift category as US-455 / US-460.

### 5. `wordBreak: break-word` is lost — does it matter? — RESOLVED: no

Tor log lines are short status messages (`"[NOTICE] Bootstrapped 30%"`, etc.) — no long unbroken tokens. If overflow appears in real use, add `wordBreak` to UIKit Text in a follow-up.

### 6. Spinner size mismatch (old: 24, new: 40) — intentional? — RESOLVED: yes, fix to 40

In the current code, the spinner renders at 24×24 because `<CircularProgress size={24}/>` has component-level `& svg { width: 24 }` that wins specificity over the parent `.status-icon { & svg { width: 40 } }`. The other branch (`<TorIcon/>`) inherits 40×40 from the parent rule. So the spinner is currently smaller than the static icon — a bug, not a design intent. New code makes both 40×40 (consistent with the design intent of `.status-icon { width: 40 }`).

### 7. Why a Panel wrapper around `<IconButton>` for the close button? — RESOLVED: consistent floating-anchor pattern

`IconButton` does not accept `position`/`top`/`right` props (and shouldn't — those are layout concerns, not button concerns). Wrapping in a positioned `<Panel position="absolute" top={8} right={8}>` keeps positioning where it belongs (layout primitive). Same pattern used for floating overlays elsewhere.

### 8. Folder placement — does `TorStatusOverlay.tsx` move to `editors/shared/`? — RESOLVED: no, stays in `editors/browser/`

The overlay is browser-specific (consumes `BrowserEditorModel`, references Tor profile state). No second consumer exists or is planned. Keep in `editors/browser/`. Multi-consumer move applies only when a second consumer appears (US-461 precedent).

## Acceptance criteria

1. `TorStatusOverlay.tsx` contains zero `@emotion/styled` imports, zero `style={...}` attributes, zero `className={...}` attributes.
2. `TorStatusOverlay.tsx` imports `Panel`, `IconButton`, `Button`, `Text`, `Spinner` from `../../uikit`, `ColorizedCode` from `../shared/ColorizedCode`, plus `TorIcon`, `CloseIcon`, and `TOR_BROWSER_COLOR`.
3. `Spinner.tsx` exposes a `color?: string` prop; passing it changes the spinner stroke color.
4. `Panel.tsx` exposes a `whiteSpace?: "normal" | "nowrap" | "pre" | "pre-wrap" | "pre-line"` prop; passing `"pre-wrap"` preserves real `\n` characters in descendant content.
5. `npx tsc --noEmit` reports no new errors on `Spinner.tsx`, `Panel.tsx`, `TorStatusOverlay.tsx`, `BrowserEditorView.tsx`.
6. **Smoke test — connecting state**: Open a Tor profile browser tab. Overlay appears full-area; spinner renders at 40×40 in Tor purple (#7D4698); status text reads "Connecting to Tor network..." in light text. No close button visible.
7. **Smoke test — connected state**: After Tor bootstraps, status text reads "Connected to Tor"; the static TorIcon renders at 40×40; close button (X) appears top-right; no Reconnect button. Clicking close hides the overlay.
8. **Smoke test — error state**: With Tor service blocked or misconfigured, overlay shows "Failed to connect to Tor" + Reconnect button. Clicking Reconnect re-enters the connecting state.
9. **Smoke test — disconnected state**: After explicit disconnect (Tor profile setting), overlay shows "Tor is not connected" + Reconnect button.
10. **Smoke test — log pane**: While connecting, the log pane fills the lower portion of the overlay, scrolls to the bottom as new lines arrive. Bracketed log levels (`[notice]`, `[warn]`, `[err]`) and other tokens (timestamps, percentages, URLs) are colored by the Monaco `log` grammar. Newlines render as actual line breaks (not collapsed).
11. **Smoke test — DevTools**: Inspect the overlay root — it has `data-type="panel"` with `data-bg="dark"`. The icon-button has `data-type="icon-button" data-size="sm"`. The log Panel has `data-type="panel"` and CSS `white-space: pre-wrap`. The Spinner has `data-type="spinner"` with the color attribute set.
12. **Smoke test — themes**: Cycle through `default-dark`, `light-modern`, `monokai`. Status text remains readable in each; log token colors update with the active Monaco theme. (Tor purple on the spinner is theme-independent — same hex on all themes.)

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [src/renderer/uikit/Spinner/Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx) | Modify | Add `color?: string` prop |
| [src/renderer/uikit/Spinner/Spinner.story.tsx](../../../src/renderer/uikit/Spinner/Spinner.story.tsx) | Modify | Add `color` prop entry |
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Modify | Add `whiteSpace?: "normal" \| "nowrap" \| "pre" \| "pre-wrap" \| "pre-line"` prop |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Modify | Add `whiteSpace` prop entry |
| [src/renderer/editors/browser/TorStatusOverlay.tsx](../../../src/renderer/editors/browser/TorStatusOverlay.tsx) | Rewrite | Pure UIKit composition; log pane uses shared `ColorizedCode` with `language="log"` |
| [doc/active-work.md](../../active-work.md) | Modify | Convert US-462 line to a link to this README (already done in draft phase) |
