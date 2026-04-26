# US-452: About screen — UIKit migration

## Goal

Migrate the About page from app-side `styled.div` definitions to UIKit primitives — the first per-screen migration of [EPIC-025](../../epics/EPIC-025.md) Phase 4. Add the `maxWidth` / `minWidth` / `maxHeight` / `minHeight` size-constraint props to `Panel` (the only UIKit gap discovered during the audit), then rewrite [AboutPage.tsx](../../../src/renderer/editors/about/AboutPage.tsx) using only UIKit components (`Panel`, `Text`, `Button`, `Divider`) with no Emotion, no `style=`, and no `className=` (UIKit Rule 7).

## Background

### EPIC-025 Phase 4 context

EPIC-025 Phase 4 migrates Persephone screens to the new UIKit one screen at a time. The About page is the first selected target — a self-contained, simple screen with no cross-screen coupling. The per-screen migration loop is:

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / props in Storybook first
4. Rewrite the screen with UIKit
5. Test the screen

The old `src/renderer/components/` folder stays in place during the migration as a behavioral reference; only the About screen and `Panel` change here.

### Audit results

Every visual element in the About page maps cleanly to existing UIKit primitives **except** for one missing prop on `Panel` — there is no way to express "max-width 400, width 100%" in the current API.

| About element (current) | UIKit replacement | Gap |
|---|---|---|
| Outer container — `styled.div` flex column, padding 32, centered, overflow auto | `<Panel direction="column" align="center" justify="center" padding="xxxl" flex overflow="auto">` | none |
| `.about-card` — flex column, **maxWidth 400**, width 100%, padding 32, bg light, radius 8 | `<Panel direction="column" align="center" padding="xxxl" background="light" rounded="xl" width="100%" maxWidth={400}>` | **`maxWidth` missing on Panel** |
| `.app-icon` — 64×64 centered svg holder | `<Panel width={64} height={64} align="center" justify="center">` | none |
| `<h1>` Persephone — fontSize 24, weight 600 | `<Text size="xxl" bold>Persephone</Text>` | none |
| `.version-text` — fontSize 14, color light | `<Text color="light">Version …</Text>` | none |
| `<hr>` divider — margin 20 | `<Divider />` (parent gap replaces margin) | none |
| `.info-section` — flex column, gap 8 | `<Panel direction="column" gap="lg">` | none |
| `.info-row` — flex justify space-between, fontSize 13 | `<Panel justify="between">` with two `<Text size="md">` children | none |
| `.update-section` — flex column, centered, gap 12 | `<Panel direction="column" align="center" gap="xl">` | none |
| `.update-button` — selection-bg button | `<Button variant="primary">` | none |
| `.update-status` — fontSize 13, light/success/warning text | `<Text size="md" color="light\|success\|warning">` | none |
| `.link-button` — transparent border, blue text, fontSize 12 | `<Button variant="link" size="sm">` | none |
| `.links-section` — flex row, wrap, gap 8, centered | `<Panel justify="center" wrap gap="lg">` | none |

Token alignment is exact:
`32 → spacing.xxxl`, `24 → fontSize.xxl`, `14 → fontSize.base`, `13 → fontSize.md`, `12 → fontSize.sm`, `8 → gap.lg` / `radius.xl`, `12 → gap.xl`, `4 → radius.md`.

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Layout primitive | Add `maxWidth` / `minWidth` / `maxHeight` / `minHeight` props |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Panel story | Add new prop entries so Storybook exposes the constraints |
| [src/renderer/editors/about/AboutPage.tsx](../../../src/renderer/editors/about/AboutPage.tsx) | About editor module | Rewrite the render body — drop `AboutEditorRoot` styled.div, replace with UIKit composition. `AboutEditorModel`, registration, and event subscriptions stay unchanged. |

The `AboutEditorModel`, `aboutEditorModule`, registration in `register-editors.ts`, and the IPC subscription via `rendererEvents[EventEndpoint.eUpdateAvailable]` are unaffected.

## Implementation Plan

### Step 1 — Add size-constraint props to `Panel`

In [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx):

1. Extend `PanelProps` after the existing `width` / `height`:
   ```ts
   /** Max width — number → px, string passes through (e.g. "100%"). */
   maxWidth?: number | string;
   /** Min width — number → px, string passes through. */
   minWidth?: number | string;
   /** Max height — number → px, string passes through. */
   maxHeight?: number | string;
   /** Min height — number → px, string passes through. */
   minHeight?: number | string;
   ```
2. Destructure them in `Panel(props)` alongside `width`, `height`.
3. Add them to `inlineStyle` next to the existing `width` / `height`. No styled-component changes — these are inline-style values, the same as `width` / `height` already are.

### Step 2 — Update Panel story

In [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx):

Add the new constraint props after `overflow`:
```ts
{ name: "width",     type: "string", default: "" },
{ name: "height",    type: "string", default: "" },
{ name: "maxWidth",  type: "string", default: "" },
{ name: "minWidth",  type: "string", default: "" },
{ name: "maxHeight", type: "string", default: "" },
{ name: "minHeight", type: "string", default: "" },
```

Note: the existing story is also missing `width` / `height` entries — this is the natural moment to add all six size-related props together.

### Step 3 — Rewrite `AboutPage.tsx`

In [src/renderer/editors/about/AboutPage.tsx](../../../src/renderer/editors/about/AboutPage.tsx):

1. **Remove** the entire `AboutEditorRoot` `styled.div` block (lines 16–151).
2. **Remove** the import of `styled from "@emotion/styled"`.
3. **Remove** the import of `color from "../../theme/color"` (no longer needed in render).
4. **Add** import: `import { Panel, Text, Button, Divider } from "../../uikit";`
5. **Rewrite** the `AboutPage` component's `return` statement using UIKit primitives:

```tsx
return (
    <Panel direction="column" align="center" justify="center" padding="xxxl" flex overflow="auto">
        <Panel
            direction="column"
            align="center"
            padding="xxxl"
            background="light"
            rounded="xl"
            width="100%"
            maxWidth={400}
            gap="xl"
        >
            <Panel width={64} height={64} align="center" justify="center">
                <PersephoneIcon width={64} height={64} />
            </Panel>

            <Panel direction="column" align="center" gap="xs">
                <Text size="xxl" bold>Persephone</Text>
                <Text color="light">Version {app.version || "..."}</Text>
            </Panel>

            <Divider />

            <Panel direction="column" gap="lg" width="100%">
                <Panel justify="between">
                    <Text size="md" color="light">Electron</Text>
                    <Text size="md">{runtimeVersions?.electron || "..."}</Text>
                </Panel>
                <Panel justify="between">
                    <Text size="md" color="light">Node.js</Text>
                    <Text size="md">{runtimeVersions?.node || "..."}</Text>
                </Panel>
                <Panel justify="between">
                    <Text size="md" color="light">Chromium</Text>
                    <Text size="md">{runtimeVersions?.chrome || "..."}</Text>
                </Panel>
            </Panel>

            <Divider />

            <Panel direction="column" align="center" gap="lg" width="100%">
                <Button variant="primary" onClick={handleCheckForUpdates} disabled={checking}>
                    {checking ? "Checking..." : "Check for Updates"}
                </Button>
                {renderUpdateStatus()}
            </Panel>

            <Divider />

            <Panel justify="center" wrap gap="lg" width="100%">
                <Button
                    variant="link"
                    size="sm"
                    onClick={() => shell.openExternal("https://github.com/andriy-viyatyk/persephone")}
                >
                    GitHub Repository
                </Button>
                <Button
                    variant="link"
                    size="sm"
                    onClick={() => shell.openExternal("https://github.com/andriy-viyatyk/persephone/issues")}
                >
                    Report Issue
                </Button>
            </Panel>
        </Panel>
    </Panel>
);
```

6. **Rewrite** `renderUpdateStatus()` to return UIKit JSX:

```tsx
const renderUpdateStatus = () => {
    if (checking) {
        return <Text size="md" color="light">Checking for updates...</Text>;
    }
    if (!updateResult) {
        return null;
    }
    if (updateResult.updateAvailable && updateResult.releaseVersion && updateResult.releaseUrl) {
        const { releaseVersion, releaseUrl } = updateResult;
        return (
            <>
                <Text size="md" color="warning">
                    New version {releaseVersion} available!
                </Text>
                <Panel justify="center" wrap gap="lg">
                    <Button variant="link" size="sm" onClick={() => shell.openExternal(releaseUrl)}>
                        Download
                    </Button>
                    <Button
                        variant="link"
                        size="sm"
                        onClick={() => shell.openExternal("https://github.com/andriy-viyatyk/persephone/blob/main/docs/whats-new.md")}
                    >
                        What's New
                    </Button>
                </Panel>
            </>
        );
    }
    return <Text size="md" color="success">You're up to date!</Text>;
};
```

The model + module exports below (`AboutEditorModel`, `aboutEditorModule`, named exports) stay unchanged.

### Step 4 — Verify TypeScript

Run `npx tsc --noEmit`. The about-related code must produce no new errors. (Pre-existing errors elsewhere in the repo are unrelated to this task.)

### Step 5 — Manual smoke test

Open the About page (sidebar → About) and verify:
- Page layout matches the original visually — padded card, centered, max ~400px wide, scroll on small windows
- App icon renders at 64×64
- Title "Persephone" + version line under it
- Three info rows (Electron / Node.js / Chromium) populate after the IPC roundtrip
- "Check for Updates" button:
  - disabled state during check
  - "You're up to date!" renders in green (`color.success.text`)
  - new-version path renders warning text + Download / What's New link buttons
- "GitHub Repository" and "Report Issue" buttons open external URLs via `shell.openExternal`
- Theme switching: card stays readable in all themes (default-dark, light-modern, monokai, etc.)

## Concerns / Open Questions

### Resolved

1. **Font family change.** The original card sets `fontFamily: "Arial, sans-serif"` and re-applies monospace only on the `value` cells. After migration the entire card uses Persephone's default monospace. Consistent with the earlier decision (April 2026) that justified dropping the `mono` prop on `Text` — Persephone is a developer tool and monospace is the house font.
2. **`<h1>` becomes `<span>`.** UIKit `Text` always renders `<span>`. Acceptable for an Electron app About page; visual hierarchy is preserved via `size="xxl" bold`.
3. **Icon sizing.** `PersephoneIcon` already accepts numeric `width` / `height` props. The wrapping `Panel width={64} height={64}` keeps the layout slot stable even if the icon's internal sizing changes.
4. **`Panel` `maxWidth` API.** `number | string` — number → px, string passes through (`"100%"`, `calc(...)`, etc.). Same shape as the existing `width` / `height` props. Adding all four (`maxWidth` / `minWidth` / `maxHeight` / `minHeight`) at once because they form one symmetric group.
5. **Centered Divider inside `align="center"` parent.** `Divider` sets explicit `width: 100%`; this overrides cross-axis content sizing under `align-items: center` and the line spans the card edge-to-edge as expected. Verified by reading [Divider.tsx](../../../src/renderer/uikit/Divider/Divider.tsx).

### None open.

## Acceptance Criteria

- [ ] `Panel` accepts `maxWidth` / `minWidth` / `maxHeight` / `minHeight` props (`number | string`), mirroring the existing `width` / `height` shape
- [ ] `Panel.story.tsx` exposes `width`, `height`, `maxWidth`, `minWidth`, `maxHeight`, `minHeight` in the property editor
- [ ] `AboutPage.tsx` contains zero `styled.*` calls, zero `style={...}` props, zero `className={...}` props
- [ ] `AboutPage.tsx` imports only UIKit components (`Panel`, `Text`, `Button`, `Divider`) for rendering — no app-side styled components
- [ ] `AboutEditorModel`, `aboutEditorModule`, and named exports are unchanged
- [ ] About page renders correctly across all themes (visual smoke test)
- [ ] "Check for Updates" flow works — button states, status text colors, and Download / What's New links
- [ ] External links (GitHub repo, Report Issue) open via `shell.openExternal`
- [ ] No new TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Add `maxWidth` / `minWidth` / `maxHeight` / `minHeight` props |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Add `width`, `height`, `maxWidth`, `minWidth`, `maxHeight`, `minHeight` story entries |
| [src/renderer/editors/about/AboutPage.tsx](../../../src/renderer/editors/about/AboutPage.tsx) | Replace `AboutEditorRoot` `styled.div` and its imports with a UIKit composition (`Panel` / `Text` / `Button` / `Divider`); rewrite `renderUpdateStatus()` to return UIKit JSX |

## Files NOT Changed

- `src/renderer/editors/about/index.ts` — re-exports only, no edits needed
- `src/renderer/editors/register-editors.ts` — module registration unchanged
- All theme files (`src/renderer/theme/themes/*.ts`) — no token changes
- `src/renderer/api/types/shell.d.ts` — type definitions unchanged
- `src/ipc/api-param-types.ts` — IPC types unchanged
- `src/renderer/uikit/Text/Text.tsx`, `Button.tsx`, `Divider.tsx` — already provide everything About needs
