# US-1636: Theme derivation and the custom theme model

Epic: [EPIC-123: Custom themes](../../epics/EPIC-123.md)

## Goal

Add the renderer-side custom-theme data model and deterministic derivation so a compact base palette can produce a complete `ThemeDefinition`, with validated per-token overrides and a pixel-identical path for forking built-in themes. The work is the color/model foundation only; custom theme persistence, registry wiring, settings, startup, bridge and editor UI belong to US-1637..1640.

## Progress

- [x] Read the shared project guidelines and this reviewed implementation plan.
- [x] Add the authoritative color-token tuple, custom-theme types, and color math.
- [x] Implement validation, derivation, contrast reporting, and built-in forking helpers.
- [x] Narrow existing theme types and guard dynamic color lookups.
- [x] Run typecheck, lint, and production build; fix reported issues.
- [x] Claude live-renderer comparison of Persephone, Persephone Light, and Default Dark.

### Live verification (Claude, 2026-10-09)

Run in the dev renderer over MCP against `deriveTheme` from each theme's three required bases
(background, text, accent), with polarity inferred. Distance is OKLab ΔE plus alpha difference.

- **Polarity inference** matched all three references.
- **Forking is exact:** `buildCustomTheme` with `baseFromTheme` + `overridesFor` reproduced every
  CSS color and every `monaco:` color of all three themes byte for byte.
- **Closeness:** Persephone 2 of 77 variables over ΔE 0.1 (graph accents only); Persephone Light 9;
  Default Dark 27 — expected, since Default Dark uses neutral grey grid selections and a green graph
  highlight where the derivation follows the accent by design.
- **Contrast:** no AA failures for the three references or for four extra base sets (sepia light,
  purple dark, yellow-accent dark, cyan-accent light).

Tuning applied after the first run, which found selections failing AA:

- **Selections keep light text.** The derivation chose black or white per fill and, on Persephone,
  put dark text on a mid-green selection with the tree selection at 2.36:1. Every built-in uses light
  selection text, so `text-selection`/`icon-selection` are now `fallback.selectionText` (`#ffffff`)
  and both selection fills are darkened by `ensureContrast` until that text meets 4.5:1.
  `chooseSelectionText` was removed.
- **Translucent neutrals follow the muted tier.** Scrollbar thumb, minimap and (dark) graph label
  fills now use `text-light`, as the built-ins do, instead of `text-default`.
- **`ensureContrast` judges the rounded color.** It measured the unrounded candidate, so byte
  rounding left results at 4.48–4.49:1; it now tests the color as serialized.

## Background

`ThemeDefinition` in `src/renderer/theme/themes/types.ts` is `{ id, name, isDark, colors, monaco }`. Each of the eleven built-ins (`abyss.ts`, `default-dark.ts`, `light-modern.ts`, `monokai.ts`, `persephone-light.ts`, `persephone.ts`, `quiet-light.ts`, `red.ts`, `solarized-dark.ts`, `solarized-light.ts`, `tomorrow-night-blue.ts`) supplies the same 77 `--color-*` keys. `persephone.ts` and `persephone-light.ts` document the palette intent most clearly; `default-dark.ts` includes a VS Code token mapping reference.

`src/renderer/theme/themes/index.ts` owns the static list, applies CSS vars and `colorScheme`, calls `api.setNativeTheme`, and updates `themeState`. `src/renderer/api/setup/configure-monaco.ts` calls `getThemeById(themeState.get().id)`, then defines Monaco with `theme.monaco.base` and `.colors`; its custom token rules are shared and out of scope. This task adds pure model/derivation modules and does not add the resulting themes to that registry.

`src/renderer/theme/color.ts` is the semantic token map. CSS and typed consumers commonly reference its `var(--color-...)` values, so a search for the custom property name finds both the central map and direct CSS readers. `p-vars.ts` exposes selected values to boards and av-grid (including the graph family); those public mappings must continue to resolve from the generated palette. `token-vars.ts` concerns non-color geometry/font tokens and `theme-state.ts` only publishes the active `{id,isDark}` snapshot.

The audit below searches usages under `src/renderer`, excluding `src/renderer/theme/themes` definitions. File references in each row are actual matches; `src/renderer/theme/color.ts` means a semantic `color` entry maps to that variable and is read by its downstream themed consumers. Long families list representative direct readers where the same semantic token is shared broadly. `p-vars.ts` identifies the board/av-grid bridge. The two newest Persephone themes have comments clarifying the misleading accent/link names: `--color-misc-blue` is the app-wide accent, and `--color-misc-link` is the link color.

`package.json` has no color-math dependency. Keep this dependency-free: add a small in-repo utility for sRGB parsing/encoding, relative luminance and contrast, plus OKLCH conversion and gamut mapping. Keep it isolated from the custom-theme model so it can be reasoned about without changing existing theme application behavior.

### Custom theme file model

The persisted schema is intentionally intent-based; it stores base colors and user overrides rather than freezing the current palette. Derivation fills any new variables added by later releases.

```ts
export interface CustomThemeBase {
    background: string;
    text: string;
    accent: string;
    link?: string;
    error?: string;
    warning?: string;
    success?: string;
}

export interface CustomThemeFile {
    schemaVersion: 1;
    id: `custom-${string}`;
    name: string;
    base: CustomThemeBase;
    isDark: boolean | null;
    overrides: Partial<Record<CustomThemeOverrideKey, string>>;
}
```

`isDark: null` infers darkness from background relative luminance; `true`/`false` force the mode. Validate an `unknown` input without throwing and return a structured result such as `{ value?: CustomThemeFile; warnings: string[] }`. Reject the whole file for an invalid/missing schema version, id, name, required base color, or malformed object shape. For `overrides`, retain only exact known `--color-*` keys and valid color values; drop each invalid/unknown entry and append a warning naming the key. Also allow exactly these seven Monaco override keys: `monaco:editor.background`, `monaco:menu.background`, `monaco:menu.foreground`, `monaco:menu.selectionBackground`, `monaco:menu.selectionForeground`, `monaco:menu.separatorBackground`, and `monaco:menu.border`. The colon form cannot be mistaken for a CSS custom property. When applying a file, route `--color-*` keys into `ThemeDefinition.colors` and `monaco:<key>` entries into `ThemeDefinition.monaco.colors[<key>]`. Ignore unknown top-level/base keys for forward compatibility. Do not allow an override to introduce a new token or non-color CSS value. Define and share a parser-supported color grammar (hex and the generated `rgb()/rgba()` forms); never use `eval` or throw on malformed input.

### Derivation and token use audit

The derivation rules below are the implementation contract: calculate all 77 keys on every call. Before overrides, `deriveTheme` maps `--color-bg-default === base.background`, `--color-text-default === base.text`, `--color-misc-blue === base.accent`, and any supplied optional `link`, `error`, `warning`, or `success` value to its corresponding token byte-for-byte. Never alter the base object. `buildCustomTheme` then applies valid overrides verbatim and last; if an override targets a base-mapped token, that explicit override wins in the resulting theme while the stored base remains unchanged. Both inputs preserve the user's exact intent, even when their contrast is low. Contrast guidance applies only to derived tiers. No calculated value may come from a built-in palette literal. Use OKLCH lightness changes for background/border ramps, contrast-guided derived text, accent-derived interaction states, and fixed semantic status hues. Use sRGB alpha composition for translucent CSS colors. Derive the `monaco` block from the same colors and `isDark`.

### Measured starting constants

The following values were measured by a scratch Node script that parsed the three reference theme files, converted sRGB to OKLab/OKLCH, and reported token deltas from the stated reference color. Each delta cell is `ΔL, ΔC` (OKLCH lightness/chroma); hues for nearly neutral colors are unstable and are not compared. These are initial constants, not claims that every hand-made theme uses one universal ramp. Use the `dark start` for dark derivation and `light start` for light derivation; preserve the base color exactly and apply the delta only to derived colors. Keep constants co-located in the derivation palette module for live tuning.

| Derived token | Delta reference | Persephone measured ΔL, ΔC | Persephone Light measured ΔL, ΔC | Default Dark measured ΔL, ΔC | Dark start ΔL, ΔC | Light start ΔL, ΔC |
|---|---|---:|---:|---:|---:|---:|
| `bg-dark` | `bg-default` | `-0.0394, -0.0053` | `-0.0382, +0.0028` | `-0.0303, 0.0000` | `-0.0349, -0.0027` | `-0.0382, +0.0028` |
| `bg-light` | `bg-default` | `+0.0323, +0.0029` | `-0.0600, +0.0067` | `+0.0739, 0.0000` | `+0.0531, +0.0015` | `-0.0600, +0.0067` |
| `border-default` | `bg-default` | `+0.0825, +0.0097` | `-0.1101, +0.0120` | `+0.1169, 0.0000` | `+0.0997, +0.0049` | `-0.1101, +0.0120` |
| `border-light` | `bg-default` | `+0.0166, +0.0011` | `-0.0509, +0.0067` | `+0.0498, 0.0000` | `+0.0332, +0.0006` | `-0.0509, +0.0067` |
| `bg-message` | `bg-default` | `+0.0323, +0.0029` | `-0.0600, +0.0067` | `+0.0739, 0.0000` | `+0.0531, +0.0015` | `-0.0600, +0.0067` |
| `bg-scrollbar` | `bg-default` | `+0.0323, +0.0029` | `-0.0600, +0.0067` | `+0.0739, 0.0000` | `+0.0531, +0.0015` | `-0.0600, +0.0067` |
| `text-light` | `text-default` | `-0.1716, +0.0202` | `+0.1714, -0.0060` | `-0.1721, 0.0000` | `-0.1719, +0.0101` | `+0.1714, -0.0060` |
| `text-strong` | `text-default` | `+0.0417, -0.0051` | `-0.1219, -0.0149` | `+0.0523, 0.0000` | `+0.0470, -0.0026` | `-0.1219, -0.0149` |
| `bg-selection` | `misc-blue` (accent) | `-0.2035, -0.0527` | `0.0000, 0.0000` | `-0.0980, -0.0141` | `-0.1508, -0.0334` | `0.0000, 0.0000` |
| `bg-tree-selection` | `misc-blue` (accent) | `-0.2649, -0.0854` | `0.0000, 0.0000` | `-0.3317, -0.0979` | `-0.2983, -0.0917` | `0.0000, 0.0000` |

Measured alpha values for each reference theme are listed below in Persephone / Persephone Light / Default Dark order. Starting alpha is likewise a numeric constant; use the dark/light column for the derived theme mode. Overrides still replace these generated strings verbatim.

| Token | Reference alpha P / PL / DD | Dark start | Light start |
|---|---:|---:|---:|
| `grid-sel-selected` | `0.15 / 0.15 / 0.20` | `0.175` | `0.15` |
| `grid-sel-hovered` | `0.10 / 0.08 / 0.20` | `0.15` | `0.08` |
| `bg-overlay` | `0.60 / 0.80 / 0.60` | `0.60` | `0.80` |
| `bg-overlay-hover` | `0.80 / 0.90 / 0.80` | `0.80` | `0.90` |
| `bg-backdrop` | `0.30 / 0.30 / 0.30` | `0.30` | `0.30` |
| `shadow-default` | `0.45 / 0.16 / 0.36` | `0.405` | `0.16` |
| `bg-scrollbar-thumb` | `0.20 / 0.30 / 0.20` | `0.20` | `0.30` |
| `highlight-active-match` | `0.35 / 0.45 / 0.35` | `0.35` | `0.45` |
| `minimap-bg` | `0.15 / 0.15 / 0.20` | `0.175` | `0.15` |
| `minimap-hover-bg` | `0.25 / 0.28 / 0.35` | `0.30` | `0.28` |
| `minimap-active-bg` | `0.25 / 0.30 / 0.20` | `0.225` | `0.30` |
| `graph-label-bg` | `0.20 / 0.85 / 0.20` | `0.20` | `0.85` |

Run `contrastReport(theme)` after derivation and override application. It returns the measured contrast ratio and an AA boolean for each declared text/surface pair: `text-default/bg-default`, `text-light/bg-default`, `text-strong/bg-default`, `text-selection/bg-selection`, `text-selection/bg-tree-selection`, `grid-header-color/grid-header-bg`, `grid-data-color/grid-data-bg`, `graph-label-text/graph-label-bg`, `misc-link/bg-default`, each status text against its status background, and each primary text tier against `primary-bg`. It reports low contrast but never changes base colors or override values. This report is also the board-facing warning source for US-1640.

The all-eleven-theme status audit found that each theme sets error/success/primary/warning backgrounds and borders to the same value, making those borders invisible; all four families share one neutral surface per theme. Measured shared `bg/border` values were:

| Built-in | All four status families' `bg` and `border` |
|---|---|
| Abyss | `#000c18` |
| Default Dark | `#000000` |
| Light Modern | `#FFFFFF` |
| Monokai | `#272822` |
| Persephone Light | `#ffffff` |
| Persephone | `#151f29` |
| Quiet Light | `#F5F5F5` |
| Red | `#300000` |
| Solarized Dark | `#002b36` |
| Solarized Light | `#FDF6E3` |
| Tomorrow Night Blue | `#002451` |

The generated convention is `status-bg === status-border` for every family, using a neutral dark surface (`bg-dark` direction) for dark themes and the lightest neutral surface for light themes. No status tint and no visible status border. Forking uses overrides to retain the exact built-in surface when it differs from this general derivation.

#### Backgrounds (12)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-bg-default` | `theme/color.ts`; `ui/app/MainPage.css`, `ui/tabs/PageTab.css`; `theme/p-vars.ts`; `theme/Ornament.ts` | Exactly `base.background`. |
| `--color-bg-dark` | `theme/color.ts`; `ui/tabs/PageTab.css`, `ui/app/MainPage.css`; `components/page-manager/ImperativeSplitter.ts` | Background ramp one OKLCH lightness step darker than default for dark themes and a subdued surface step for light themes; ensure it remains distinguishable. |
| `--color-bg-light` | `theme/color.ts`; `uikit/Panel/Panel.css`, `uikit/Tree/TreeItem.css`, `ui/app/MainPage.css`; `components/pipe-status/PageLoadingShellView.css` | Background ramp one OKLCH lightness step lighter than default for dark themes and a darker surface step for light themes. |
| `--color-bg-selection` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Button/Button.css`, `uikit/Menu/Menu.css`, `uikit/Tag/Tag.css` | Accent-tinted filled selection color, shifted in OKLCH lightness as needed for legible selected text; derive from `base.accent`. |
| `--color-bg-tree-selection` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Tree/Tree.css`, `uikit/ListBox/ListItem.css`, `ui/sidebar/FolderItem.css` | Lower-emphasis accent tint for the focused selected row; keep distinct from general selection while preserving selected-text contrast. |
| `--color-bg-scrollbar` | `theme/color.ts`, `theme/p-vars.ts` | Surface color (`bg-light` direction), suitable behind a thumb. |
| `--color-bg-scrollbar-thumb` | `theme/color.ts`, `theme/p-vars.ts` | `text` composited over scrollbar background at `0.20` dark / `0.30` light alpha. |
| `--color-bg-message` | `theme/color.ts`; `uikit/Notification/Notification.css`, `uikit/Tree/TreeItem.css`, `uikit/CategoryList/CategoryList.css` | Raised message surface derived from `bg-light`; avoid treating status foreground colors as its fill. |
| `--color-bg-overlay` | `theme/color.ts`; `components/pipe-status/PagePipeStatusView.css`, `uikit/ImageViewport/ImageViewport.css`, `uikit/Panel/Panel.css` | Neutral black alpha overlay for dark themes and white alpha overlay for light themes; start at `0.60` dark / `0.80` light. |
| `--color-bg-overlay-hover` | `theme/color.ts`; `components/pipe-status/PagePipeStatusView.css`, `uikit/ImageViewport/ImageViewport.css` | Same neutral overlay with stronger alpha: `0.80` dark / `0.90` light. |
| `--color-bg-webview` | `theme/color.ts` | Fixed white web document surface. |
| `--color-bg-backdrop` | `theme/color.ts` | Neutral black backdrop with the low alpha used for modal/scrim dimming; independent of light/dark overlay direction. |

#### Text (5)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-text-default` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Button/Button.css`, `uikit/Breadcrumb/Breadcrumb.css`, `ui/tabs/PageTab.css`, `components/pipe-status/PagePipeStatusView.css` | Exactly `base.text`; never shift it to improve contrast. Report its contrast through `contrastReport(theme)`. |
| `--color-text-dark` | `theme/color.ts`; `uikit/Tree/TreeItem.css`, `uikit/Textarea/Textarea.css`, `editors/settings/settings.css` | Exactly `text-default`; all eleven built-ins use the same value for these two variables. |
| `--color-text-light` | `theme/color.ts`; `uikit/Breadcrumb/Breadcrumb.css`, `ui/sidebar/PinnedRail.css`, `components/tree-provider/CategoryView.css` | Derived muted text tier using the measured mode-specific OKLCH delta above; adjust only this derived value if needed to reach 4.5:1. |
| `--color-text-selection` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Button/Button.css`, `uikit/Tree/Tree.css`, `uikit/PathInput/PathInput.css` | Derived foreground for `bg-selection` and `bg-tree-selection`; choose the higher-contrast black/white direction and tune to 4.5:1. |
| `--color-text-strong` | `theme/color.ts`, `theme/p-vars.ts`; `editors/markdown/MarkdownBlock.css`, `editors/browser/BrowserTabsPanel.css`, `uikit/PathInput/PathInput.css` | Derived higher-emphasis tier using the measured mode-specific OKLCH delta above; keep the base `text-default` unchanged and meet 4.5:1 where used as text. |

#### Icons (6)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-icon-default` | `theme/color.ts`; `uikit/Tree/TreeItem.css`, `uikit/IconButton/IconButton.css`, `editors/board/board-file-icons.ts` | Match `text-default` exactly; do not alter the base text color to tune an icon. |
| `--color-icon-dark` | `theme/color.ts`; `uikit/IconButton/IconButton.css`, `components/file-search/FileSearch.css` | Match `text-dark` (and therefore `text-default`). |
| `--color-icon-light` | `theme/color.ts`; `uikit/IconButton/IconButton.css`, `uikit/SplitButton/SplitButton.css`, `ui/secondary-views/SideBarPanelHeader.css` | Match `text-light`. |
| `--color-icon-disabled` | `theme/color.ts`; `uikit/IconButton/IconButton.css`, `uikit/Menu/Menu.css` | Low-emphasis neutral formed from the background/text OKLCH ramp; disabled affordance need not meet text AA. |
| `--color-icon-selection` | `theme/color.ts`; `uikit/Tree/TreeItem.css`, `ui/sidebar/FolderItem.css` | Match `text-selection` so selected icons stay legible with selected labels. |
| `--color-icon-active` | `theme/color.ts`; `uikit/Tree/TreeItem.css`, `uikit/IconButton/IconButton.css` | Accent-derived active indicator, contrast-adjusted against its actual surface. |

#### Borders and shadow (4)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-border-active` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Tree/Tree.css`, `uikit/IconButton/IconButton.css`, `editors/browser/BrowserView.css` | Accent-derived focus/active stroke, adjusted in OKLCH for visible separation from the adjacent surface. |
| `--color-border-default` | `theme/color.ts`, `theme/p-vars.ts`; `ui/app/Pages.css`, `ui/tabs/PageTab.css`, `uikit/Panel/Panel.css` | Neutral border at a moderate OKLCH distance from `bg-default`. |
| `--color-border-light` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Panel/Panel.css`, `uikit/Input/Input.css`, `uikit/Dialog/Dialog.css` | More subtle neutral border, closer to `bg-default` than `border-default`. |
| `--color-shadow-default` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Tooltip/Tooltip.css`, `uikit/Panel/Panel.css`, `uikit/Dialog/Dialog.css` | Neutral black shadow at `0.405` dark / `0.16` light alpha. |

#### Grid (9)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-grid-header-bg` | `src/renderer/uikit/DataGrid/` mounts AVGrid; `doc/epics/EPIC-041.md:117` documents AVGrid's selection family use. This header token is only declared in `theme/color.ts:42`; no direct reader found. Not in `theme/p-vars.ts`. | Use `bg-dark` direction for dark themes and the measured subdued surface direction for light themes. |
| `--color-grid-header-color` | Header token is currently only declared in `theme/color.ts:43`; no direct reader or `p-vars.ts` mapping found. AVGrid's documented selection consumer is in `doc/epics/EPIC-041.md:117`. | Derived text tier against `grid-header-bg`; target 4.5:1 and report its measured ratio. |
| `--color-grid-data-bg` | Declared in `theme/color.ts:44`; no direct consumer found. `components/git-tree/GitTree.css:51` explicitly says its cell background comes from av-grid's `--avg-cell-bg` / `--p-bg`, not this token. | Match `bg-default`. |
| `--color-grid-border` | Grid palette token declared in `theme/color.ts:45`; no direct reader found. | Match `border-light` or a slightly stronger neutral when needed to delineate cells. |
| `--color-grid-data-color` | Grid palette token declared in `theme/color.ts:46`; no direct reader found and not exposed through `p-vars.ts`. | Derived text color against `grid-data-bg`; target 4.5:1 and report its measured ratio. |
| `--color-grid-sel-selected` | `AVGrid` selection is documented as reading `color.grid.selectionColor.*` in `doc/epics/EPIC-041.md:117`; the current renderer has no direct property read. `p-vars.ts` does not expose this token. | Accent at the measured mode-specific alpha above, composited over `grid-data-bg`. |
| `--color-grid-sel-hovered` | `AVGrid` selection is documented as reading `color.grid.selectionColor.*` in `doc/epics/EPIC-041.md:117`; the current renderer has no direct property read. `p-vars.ts` does not expose this token. | Accent at the measured mode-specific alpha above over `grid-data-bg`, lower than selected. |
| `--color-grid-sel-border` | `AVGrid` selection is documented as reading `color.grid.selectionColor.*` in `doc/epics/EPIC-041.md:117`; current renderer has no direct property read and `p-vars.ts` omits it. | Match `border-active`. |
| `--color-grid-sel-border-light` | `AVGrid` selection is documented as reading `color.grid.selectionColor.*` in `doc/epics/EPIC-041.md:117`; current renderer has no direct property read and `p-vars.ts` omits it. | Match `border-default`. |

#### Miscellaneous semantic colors (7)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-misc-blue` | `theme/color.ts`; `uikit/Button/Button.css`, `uikit/Breadcrumb/Breadcrumb.css`, `theme/icons.ts`, `ui/secondary-views/SideBarPanelHeader.css` | **App-wide accent**, exactly `base.accent`, with no color correction. |
| `--color-misc-link` | `theme/color.ts`, `theme/p-vars.ts`; `editors/markdown/MarkdownBlock.css` | Exactly `base.link` when supplied; otherwise derive a link from the fallback blue-family hue and tune to 4.5:1. Do not correct a supplied link. |
| `--color-misc-green` | `theme/color.ts`; `uikit/ProgressBar/ProgressBar.css`, `uikit/Panel/Panel.css`, `theme/icons.ts` | Fixed green-family semantic hue, lightness-adjusted against the theme background. |
| `--color-misc-red` | `theme/color.ts`; `ui/tabs/PageTab.css`, `ui/app/MainPage.css`, `editors/markdown/MarkdownBlock.css` | Fixed red-family semantic hue, adjusted for readable error/destructive indicators. |
| `--color-misc-yellow` | `theme/color.ts`; `uikit/ProgressBar/ProgressBar.css`, `uikit/IconButton/IconButton.css`, `theme/icons.ts` | Fixed yellow-family semantic hue, adjusted for readable warning indicators. |
| `--color-misc-orange` | `theme/color.ts` | Fixed orange-family semantic hue for the conversion action; background-adjust its lightness. |
| `--color-misc-vlc` | `theme/color.ts` | Fixed orange-family VLC brand/action color; preserve hue and adjust lightness only enough for its surface. |

#### Status and primary colors (16)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-error-bg` | `theme/color.ts`; `uikit/Button/Button.css`, `uikit/Notification/Notification.css` | Neutral status surface: `bg-dark` for dark themes, lightest of `bg-default` / `bg-webview` for light themes; match `error-border`. |
| `--color-error-text` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Text/Text.css`, `uikit/Notification/Notification.css`, `components/pipe-status/PagePipeStatusView.css` | Exactly `base.error` when supplied; otherwise fixed red-family fallback adjusted to 4.5:1. Never alter a supplied status base. |
| `--color-error-border` | `theme/color.ts`; `uikit/Input/Input.css`, `uikit/Notification/Notification.css` | Exactly `error-bg`; status borders are intentionally invisible in all built-ins. |
| `--color-error-text-hover` | `theme/color.ts`; `uikit/Notification/Notification.css` | Derived stronger error text tier; keep 4.5:1, without changing `error-text`. |
| `--color-success-bg` | `theme/color.ts`; `uikit/Notification/Notification.css` | Same neutral status surface as `error-bg`; match `success-border`. |
| `--color-success-text` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Text/Text.css`, `uikit/Notification/Notification.css`, `uikit/Tag/Tag.css` | Exactly `base.success` when supplied; otherwise fixed green-family fallback adjusted to 4.5:1. |
| `--color-success-border` | `theme/color.ts`; `uikit/Notification/Notification.css` | Exactly `success-bg`; status borders are intentionally invisible in all built-ins. |
| `--color-success-text-hover` | `theme/color.ts`; `uikit/Notification/Notification.css` | Derived stronger success text tier; keep 4.5:1, without changing `success-text`. |
| `--color-primary-bg` | `theme/color.ts` | Same neutral status surface as `error-bg`; match `primary-border`. |
| `--color-primary-text` | `theme/color.ts`; `uikit/Text/Text.css`, `editors/browser/BrowserView.css`, `editors/board/BoardStatusBarItems.css` | Derived accent-family primary text; adjust to 4.5:1 against its actual surface. |
| `--color-primary-border` | `theme/color.ts` | Exactly `primary-bg`; status borders are intentionally invisible in all built-ins. |
| `--color-primary-text-hover` | `theme/color.ts` | Derived stronger primary text tier at 4.5:1; base accent remains unchanged. |
| `--color-warning-bg` | `theme/color.ts`; `uikit/Notification/Notification.css` | Same neutral status surface as `error-bg`; match `warning-border`. |
| `--color-warning-text` | `theme/color.ts`, `theme/p-vars.ts`; `uikit/Notification/Notification.css`, `uikit/Text/Text.css`, `ui/app/MainPage.css` | Exactly `base.warning` when supplied; otherwise fixed amber/yellow-family fallback adjusted to 4.5:1. |
| `--color-warning-border` | `theme/color.ts`; `uikit/Notification/Notification.css` | Exactly `warning-bg`; status borders are intentionally invisible in all built-ins. |
| `--color-warning-text-hover` | `theme/color.ts`; `uikit/Notification/Notification.css`, `ui/app/MainPage.css` | Derived stronger warning text tier at 4.5:1; never change a supplied warning base. |

#### Highlight and minimap (4)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-highlight-active-match` | `theme/color.ts` | Fixed yellow-family highlight at `0.35` dark / `0.45` light alpha; use sRGB alpha rather than blending into an opaque color. |
| `--color-minimap-bg` | `theme/color.ts`, `uikit/Minimap/Minimap.css` | `text` at `0.175` dark / `0.15` light alpha over the minimap surface. |
| `--color-minimap-hover-bg` | `theme/color.ts`, `uikit/Minimap/Minimap.css` | `text` at `0.30` dark / `0.28` light alpha over the minimap surface. |
| `--color-minimap-active-bg` | `theme/color.ts`, `uikit/Minimap/Minimap.css` | Accent at `0.225` dark / `0.30` light alpha over the minimap surface. |

#### Graph palette (14)

| Variable | Where used (grep matches) | `deriveTheme` rule |
|---|---|---|
| `--color-graph-bg` | `theme/color.ts`, `theme/p-vars.ts` | Match `bg-default`. |
| `--color-graph-node-default` | `theme/color.ts`, `theme/p-vars.ts` | Fixed cool-blue graph hue, OKLCH-adjusted for node visibility on graph background. |
| `--color-graph-node-highlight` | `theme/color.ts`, `theme/p-vars.ts` | Match the app accent (`base.accent`) with graph contrast adjustment. |
| `--color-graph-node-selected` | `theme/color.ts`, `theme/p-vars.ts` | Fixed warm/amber graph hue, adjusted for visibility against graph background. |
| `--color-graph-border-default` | `theme/color.ts`, `theme/p-vars.ts` | Match graph default node hue; use enough contrast to trace node edges. |
| `--color-graph-border-highlight` | `theme/color.ts`, `theme/p-vars.ts` | Darker/lighter accent-family edge than the highlighted node, based on theme polarity. |
| `--color-graph-border-selected` | `theme/color.ts`, `theme/p-vars.ts` | Warm selected-node edge related to the selected hue, with visible separation. |
| `--color-graph-link-default` | `theme/color.ts`, `theme/p-vars.ts` | Muted neutral graph connection line, contrasting with graph background without competing with nodes. |
| `--color-graph-link-selected` | `theme/color.ts`, `theme/p-vars.ts` | Match selected-node hue. |
| `--color-graph-label-bg` | `theme/color.ts`, `theme/p-vars.ts` | `bg-light`-family label surface with `0.20` dark / `0.85` light alpha. |
| `--color-graph-label-text` | `theme/color.ts`, `theme/p-vars.ts` | Contrast-corrected `text-default`; meet 4.5:1 against label surface. |
| `--color-graph-group-border` | `theme/color.ts`, `theme/p-vars.ts` | Accent-family group outline, adjusted for visibility. |
| `--color-graph-node-special` | `theme/color.ts`, `theme/p-vars.ts` | Fixed violet-family hue for special nodes, adjusted for graph background. |
| `--color-graph-border-special` | `theme/color.ts`, `theme/p-vars.ts` | Darker/lighter violet edge related to special-node hue, with visible separation. |

#### Monaco block

`configure-monaco.ts` consumes the whole `ThemeDefinition.monaco` object: `base` selects Monaco's `vs-dark`/`vs`/`hc-black` base and `colors` supplies the explicit Monaco UI colors. Derive all seven currently used colors without a built-in lookup: `base` is `vs-dark` when `isDark`, otherwise `vs`; `editor.background` and `menu.background` use `--color-bg-default`; `menu.foreground` uses `--color-text-default`; `menu.selectionBackground` uses `--color-bg-selection`; `menu.selectionForeground` uses `--color-text-selection`; `menu.separatorBackground` and `menu.border` use `--color-border-default`. Keep Monaco token/syntax colors out of this model. The exact override key strings are `monaco:editor.background`, `monaco:menu.background`, `monaco:menu.foreground`, `monaco:menu.selectionBackground`, `monaco:menu.selectionForeground`, `monaco:menu.separatorBackground`, and `monaco:menu.border`.

## Implementation Plan

1. Add `src/renderer/theme/theme-color-vars.ts` with one authoritative `THEME_COLOR_VARS` const tuple containing all 77 variable keys and `ThemeColorVar = typeof THEME_COLOR_VARS[number]`. Change `src/renderer/theme/themes/types.ts` so `ThemeDefinition.colors` is `Record<ThemeColorVar, string>`. `deriveTheme` must return `Record<ThemeColorVar, string>` so missing a derivation for any new tuple member fails typecheck. Type-check all eleven built-in files against the narrower record; they currently share the same 77 keys and are expected to need no edits.
2. Add `src/renderer/theme/custom-theme-types.ts` for `CustomThemeBase`, `CustomThemeFile`, the `--color-*` and explicit Monaco override key union, and validator/contrast-report result types. Import `ThemeColorVar` from the authoritative tuple module rather than duplicating keys.
3. Add `src/renderer/theme/color-math.ts`: strict supported-color parsing/formatting; sRGB transfer functions; relative luminance and contrast ratio; OKLCH conversion; gamut mapping; lightness shifting while preserving hue/chroma as far as in-gamut output permits; and alpha composition. Keep all fixed fallback hues and measured starting alpha/lightness/chroma constants in this theme-specific module (or a co-located `custom-theme-palette.ts`) with comments naming their semantic use. This is the one legal home for derivation fallback literals; do not add color literals to UI/CSS or consumers.
4. Add `src/renderer/theme/custom-theme.ts` with non-throwing `validateCustomThemeFile(value: unknown)` and `contrastReport(theme: ThemeDefinition)`. Make warnings deterministic and specific to each dropped override; filter `--color-*` override keys against `ThemeColorVar` and Monaco keys against the seven exact colon-form keys. `contrastReport` returns the measured ratios and AA result for defined text/surface pairs; it does not mutate the theme.
5. Implement `deriveTheme(base: CustomThemeBase, isDark?: boolean | null): ThemeDefinition` in `custom-theme.ts`. Infer `isDark` when omitted/null from background relative luminance; use the numeric starting constants above for derived token groups; preserve every supplied base value byte-for-byte; derive all 77 keys as `Record<ThemeColorVar,string>`; and fill the Monaco block from the computed tokens. Never import a built-in palette as a fallback.
6. Implement `buildCustomTheme(file: CustomThemeFile): ThemeDefinition`: call `deriveTheme(file.base, file.isDark)`, route `--color-*` overrides to `.colors`, route `monaco:<MonacoColorKey>` values to `.monaco.colors`, then assign `file.id` and `file.name`. Preserve override strings verbatim and apply them last.
7. Implement `baseFromTheme(theme: ThemeDefinition): CustomThemeBase` by extracting `--color-bg-default`, `--color-text-default`, `--color-misc-blue` (accent), `--color-misc-link`, `--color-error-text`, `--color-warning-text`, and `--color-success-text`. Implement `overridesFor(theme, base)` by deriving with `theme.isDark`, comparing all 77 generated CSS values and all seven Monaco colors exactly, and returning only differences using the exact key forms (`--color-*` and `monaco:<key>`). Applying the result through `buildCustomTheme` must recreate the built-in's CSS and Monaco values exactly.
8. Type-check the existing consumers with the narrower key type. `applyTheme` uses `Object.entries(theme.colors)`, whose keys remain strings and values remain strings. `p-vars.ts` retains its string-to-string mapping and passes source strings to `resolveColor`. `resolveColor` currently indexes with an arbitrary string, so use an `isThemeColorVar(value): value is ThemeColorVar` guard from `theme-color-vars.ts` before indexing; unknown names still resolve to `"transparent"`. This is a narrow lookup type-safety adjustment, not registry wiring.
9. Add API comments documenting `null`/omitted `isDark`, exact base preservation, override precedence/key formats, `buildCustomTheme`, `contrastReport`, and that derivation covers every tuple member.

### API sketch (before → after)

Before: built-ins are literal `ThemeDefinition` values selected only by the static `getThemeById()` list in `src/renderer/theme/themes/index.ts`.

After: the new pure model is importable without registry wiring:

```ts
validateCustomThemeFile(value: unknown): CustomThemeValidationResult;
deriveTheme(base: CustomThemeBase, isDark?: boolean | null): ThemeDefinition;
buildCustomTheme(file: CustomThemeFile): ThemeDefinition;
baseFromTheme(theme: ThemeDefinition): CustomThemeBase;
overridesFor(theme: ThemeDefinition, base: CustomThemeBase): Record<string, string>;
contrastReport(theme: ThemeDefinition): ContrastReport;
```

`buildCustomTheme` owns the full file-to-definition operation; US-1637 must call it rather than reassembling derivation and override routing. The helper's internal `ThemeDefinition.id`/`name` from `deriveTheme` may be deterministic placeholders, but `buildCustomTheme` always replaces them with the file's exact `id` and `name`.

## Concerns

- **Visual quality is not settled by the algorithm alone.** The OKLCH step sizes, alpha levels, fallback status hues and semantic graph hues need live comparison against the three required built-ins. Keep these as documented constants in the derivation module so Claude can tune them from evidence.
- **Base contrast can be low by design.** Never shift `base.text`, `base.background`, `base.accent`, any supplied optional base color, or any override to satisfy contrast. Adjust only derived tiers. `contrastReport(theme)` reports low ratios for base pairs so the Theme Editor can warn without rewriting user intent.
- **Alpha overrides and serialization.** The validator and color utility need one explicit grammar for existing generated `rgba()` values as well as hex, and serialization must be stable so exact fork comparison is meaningful. Reject unsupported CSS functions rather than passing arbitrary strings through.
- **Pixel-identical forking needs Monaco override keys.** Include the four optional semantic colors when extracting a built-in, preserve its `isDark` during comparison, and compare alpha strings consistently. Persephone Light sets `monaco:menu.border` to `#c5d0d8`, which does not equal any of its CSS border tokens. The schema's `overrides` object therefore needs an allowlist for the seven exact `monaco:<key>` strings alongside `--color-*`; a CSS-only allowlist cannot satisfy the identical-fork requirement.
- **Future token growth.** `THEME_COLOR_VARS` is the one authoritative tuple and the `ThemeColorVar` union types both `ThemeDefinition.colors` and the derivation result. Adding a tuple member without a value in any built-in or derivation becomes a type error. `Object.entries` remains valid; arbitrary string lookup in `resolveColor` needs the documented type guard. `p-vars.ts` remains string-to-string and resolves through that guard.
- **No automated tests or harness.** The project does not use unit tests for this feature, and this task will not add a test harness. Codex cannot run Persephone live. Claude should validate in a running renderer through MCP with a temporary renderer script that calls `deriveTheme` for the `persephone`, `persephone-light`, and `default-dark` bases, prints every variable with actual and derived values plus exact differences, and reports contrast ratios for text tiers against their real backgrounds. Tune until differences are reviewed and text tiers reach WCAG AA (4.5:1); include the generated report in review notes. This is a live renderer inspection, not a committed test.

## Acceptance Criteria

- `CustomThemeFile` matches EPIC-123's schema: `schemaVersion`, `id`, `name`, `base` (`background`, `text`, `accent`, optional `link`, `error`, `warning`, `success`), `isDark: null | boolean`, and `overrides`.
- Validation accepts unknown input without throwing, ignores unknown schema keys, and drops invalid override entries (unknown `--color-*` key, unknown `monaco:<key>`, or invalid/non-color value) with a warning for each dropped entry.
- `deriveTheme(base, isDark?)` returns a complete `ThemeDefinition`: every one of the 77 variables in the table, plus the Monaco `base` and all seven Monaco colors. `ThemeDefinition.colors` and the derived color record are `Record<ThemeColorVar,string>` from the authoritative 77-entry tuple; a missing built-in or derived token fails typecheck.
- `buildCustomTheme(file)` performs derive, exact override routing and final id/name assignment; US-1637 can consume it as one function.
- `deriveTheme` maps `base.background`, `base.text`, `base.accent`, and every supplied optional base color unchanged. `buildCustomTheme` preserves valid override values verbatim and applies them last, including when one intentionally overrides a base-mapped token. Low contrast is reported, never corrected.
- `contrastReport(theme)` returns measured contrast ratios and AA status for the documented text/surface pairs, including base pairs and derived tiers; it never mutates the theme.
- Each table row's derivation is implemented according to actual token use; specifically `--color-misc-blue` equals the accent base exactly and `--color-misc-link` equals the optional link base exactly when supplied, otherwise it uses the fallback link hue.
- Base colors and overrides use the agreed supported color grammar. Derived text tiers (including selection and semantic status text only when no corresponding status base was supplied) target WCAG AA 4.5:1; the live verification reports measured ratios. Supplied base values remain untouched and may be reported below AA.
- `baseFromTheme(theme)` extracts the three required bases and four optional semantic bases. `overridesFor(theme, base)` computes the exact differences so a fork of Persephone, Persephone Light, or Default Dark reproduces all CSS colors and Monaco colors exactly after applying its overrides, including Monaco-only differences.
- Claude's live renderer/MCP comparison checks every variable and Monaco field for those three built-ins and records the per-variable difference output; Codex does not claim to have run Persephone.
- No unit tests or test harness are added.
- No custom theme is registered or wired to persistence, settings, startup, theme cycling, bridge, or UI as part of US-1636; those remain US-1637..1639 (and editor UI US-1640).

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1636-theme-derivation/README.md` | This implementation-ready task document and audited 77-token derivation table. |
| `doc/active-work.md` | Link the US-1636 dashboard entry to this document. |
| `doc/epics/EPIC-123.md` | Link the US-1636 row in the linked task table to this document. |
| `src/renderer/theme/theme-color-vars.ts` | **Implementation only:** authoritative tuple, `ThemeColorVar` union and runtime guard. |
| `src/renderer/theme/custom-theme-types.ts` | **Implementation only:** custom theme schema, override-key and report types. |
| `src/renderer/theme/color-math.ts` | **Implementation only:** dependency-free sRGB, OKLCH, gamut, luminance, contrast and alpha helpers. |
| `src/renderer/theme/custom-theme-palette.ts` | **Implementation only:** documented measured derivation constants and semantic fallback colors. |
| `src/renderer/theme/custom-theme.ts` | **Implementation only:** validator, derivation and built-in forking helpers. |
| `src/renderer/theme/themes/types.ts` | **Type-only change:** narrow `ThemeDefinition.colors` to `Record<ThemeColorVar,string>`. |
| `src/renderer/theme/themes/abyss.ts`, `default-dark.ts`, `light-modern.ts`, `monokai.ts`, `persephone-light.ts`, `persephone.ts`, `quiet-light.ts`, `red.ts`, `solarized-dark.ts`, `solarized-light.ts`, `tomorrow-night-blue.ts` | Type-only check against the narrower color record; all currently have the same 77 keys, and no edits are expected. |
| `src/renderer/theme/themes/index.ts` | Type-only compatibility check; make `resolveColor` guard dynamic string keys with `isThemeColorVar` before indexing. `applyTheme`'s `Object.entries` loop remains valid. No custom-theme registry wiring. |
| `src/renderer/theme/color.ts`, `src/renderer/theme/p-vars.ts`, `src/renderer/theme/token-vars.ts`, `src/renderer/theme/theme-state.ts`, `src/renderer/api/setup/configure-monaco.ts`, `package.json` | Read-only investigation/type compatibility check; no changes planned. |
| `src/renderer/editors/settings/sections/ThemeSection.ts`, `src/renderer/api/settings.ts`, `src/renderer/api/cycle-app-theme.ts`, `index.html`, `src/renderer/api/types/themes.d.ts`, `src/shared/board-manifest-utils.ts`, `src/renderer/editors/board/BoardWebview.ts`, `src/renderer/editors/board/board-theme.ts`, `src/shared/board-bridge-version.ts`, `assets/board-template/board-manifest.json`, `assets/board-template/index.html` | **No changes:** custom registry/persistence/startup/Settings/cycling are US-1637; scripting/MCP API is US-1638; permission/bridge is US-1639. Theme Editor board files in `persephone-boards` are US-1640. |
