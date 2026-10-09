import type { ThemeDefinition } from "./themes/types";
import { THEME_COLOR_VARS, isThemeColorVar, type ThemeColorVar } from "./theme-color-vars";
import {
    compositeColor,
    contrastRatio,
    ensureContrast,
    formatColor,
    parseColor,
    relativeLuminance,
    shiftOklch,
    withAlpha,
} from "./color-math";
import type {
    ContrastReport,
    CustomThemeBase,
    CustomThemeFile,
    CustomThemeOverrideKey,
    CustomThemeValidationResult,
    MonacoColorKey,
} from "./custom-theme-types";
import { CUSTOM_THEME_PALETTE } from "./custom-theme-palette";

const MONACO_COLOR_KEYS: readonly MonacoColorKey[] = [
    "editor.background",
    "menu.background",
    "menu.foreground",
    "menu.selectionBackground",
    "menu.selectionForeground",
    "menu.separatorBackground",
    "menu.border",
];

const BASE_COLOR_KEYS = ["background", "text", "accent", "link", "error", "warning", "success"] as const;
type BaseColorKey = typeof BASE_COLOR_KEYS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasColor(value: unknown): value is string {
    return typeof value === "string" && parseColor(value) !== null;
}

/** Validate an external theme file without throwing; invalid override entries are dropped with warnings. */
export function validateCustomThemeFile(value: unknown): CustomThemeValidationResult {
    const warnings: string[] = [];
    if (!isRecord(value)) return { warnings: ["Theme file must be an object."] };
    if (value.schemaVersion !== 1) return { warnings: ["Theme file schemaVersion must be 1."] };
    if (typeof value.id !== "string" || !/^custom-.+/.test(value.id)) {
        return { warnings: ["Theme file id must start with 'custom-' and include a value."] };
    }
    if (typeof value.name !== "string" || !value.name.trim()) {
        return { warnings: ["Theme file name must be a non-empty string."] };
    }
    if (!isRecord(value.base)) return { warnings: ["Theme file base must be an object."] };

    const base: CustomThemeBase = {
        background: "",
        text: "",
        accent: "",
    };
    for (const key of BASE_COLOR_KEYS) {
        const candidate = value.base[key];
        if (candidate === undefined && key !== "background" && key !== "text" && key !== "accent") continue;
        if (!hasColor(candidate)) {
            return { warnings: [`Theme file base.${key} must be a supported color value.`] };
        }
        base[key as BaseColorKey] = candidate;
    }

    const isDark = value.isDark === undefined || value.isDark === null
        ? null
        : typeof value.isDark === "boolean" ? value.isDark : undefined;
    if (isDark === undefined) return { warnings: ["Theme file isDark must be a boolean or null."] };
    if (value.overrides !== undefined && !isRecord(value.overrides)) {
        return { warnings: ["Theme file overrides must be an object."] };
    }

    const overrides: Partial<Record<CustomThemeOverrideKey, string>> = {};
    const rawOverrides = isRecord(value.overrides) ? value.overrides : {};
    for (const key of Object.keys(rawOverrides).sort()) {
        const candidate = rawOverrides[key];
        const validKey = isThemeColorVar(key)
            || (key.startsWith("monaco:") && MONACO_COLOR_KEYS.includes(key.slice(7) as MonacoColorKey));
        if (!validKey) {
            warnings.push(`Ignored override '${key}': unknown color key.`);
        } else if (!hasColor(candidate)) {
            warnings.push(`Ignored override '${key}': value is not a supported color.`);
        } else {
            overrides[key as CustomThemeOverrideKey] = candidate;
        }
    }

    return {
        value: {
            schemaVersion: 1,
            id: value.id as `custom-${string}`,
            name: value.name,
            base,
            isDark,
            overrides,
        },
        warnings,
    };
}

function shifted(base: string, deltaL: number, deltaC: number): string {
    return shiftOklch(base, deltaL, deltaC);
}

function shiftedBy(base: string, delta: readonly [number, number]): string {
    return shifted(base, delta[0], delta[1]);
}

function alphaOver(value: string, alpha: number): string {
    const color = parseColor(value);
    if (!color) return value;
    return formatColor({ ...color, a: color.a * alpha });
}

function statusSurface(isDark: boolean, bgDark: string, background: string, webview: string): string {
    if (isDark) return bgDark;
    const parsedWebview = parseColor(webview);
    const base = parseColor(background);
    if (!parsedWebview || !base) return background;
    return relativeLuminance(parsedWebview) >= relativeLuminance(base) ? webview : background;
}

function semanticColor(seed: string, background: string): string {
    return ensureContrast(seed, background, 3);
}

/**
 * Derive every declared color from the supplied base. Omitted/null isDark infers polarity from
 * relative background luminance. Base colors are copied byte-for-byte; only calculated tiers adapt.
 */
export function deriveTheme(base: CustomThemeBase, isDark?: boolean | null): ThemeDefinition {
    const background = base.background;
    const text = base.text;
    const accent = base.accent;
    const parsedBackground = parseColor(background);
    const parsedFallbackWebview = parseColor(CUSTOM_THEME_PALETTE.fallback.webview);
    if (!parsedBackground || !parsedFallbackWebview) {
        throw new Error("Invalid base or fallback color in custom theme");
    }
    const effectiveBackground = parsedBackground.a < 1
        ? compositeColor(parsedBackground, parsedFallbackWebview)
        : parsedBackground;
    const dark = isDark ?? relativeLuminance(effectiveBackground) < 0.5;
    const mode = dark ? CUSTOM_THEME_PALETTE.dark : CUSTOM_THEME_PALETTE.light;
    const fallback = CUSTOM_THEME_PALETTE.fallback;

    // Measured OKLCH deltas are starting points; the contrast adjustment only changes derived tiers.
    const bgDark = shiftedBy(background, mode.backgroundDark);
    const bgLight = shiftedBy(background, mode.backgroundLight);
    const borderDefault = shiftedBy(background, mode.borderDefault);
    const borderLight = shiftedBy(background, mode.borderLight);
    // Every built-in puts light text on its selections, so the fills are darkened until that
    // text reads (AA), rather than flipping the text to dark on a fill that came out light.
    const selectionText = fallback.selectionText;
    const selection = ensureContrast(shiftedBy(accent, mode.selection), selectionText);
    const treeSelection = ensureContrast(shiftedBy(accent, mode.treeSelection), selectionText);
    const statusBg = statusSurface(dark, bgDark, background, fallback.webview);
    const muted = ensureContrast(
        shiftedBy(text, mode.textLight), background
    );
    const strong = ensureContrast(
        shiftedBy(text, mode.textStrong), background
    );
    const fixedLink = ensureContrast(dark ? fallback.linkDark : fallback.linkLight, background);
    const errorText = base.error ?? ensureContrast(dark ? fallback.errorDark : fallback.errorLight, statusBg);
    const successText = base.success ?? ensureContrast(dark ? fallback.successDark : fallback.successLight, statusBg);
    const warningText = base.warning ?? ensureContrast(dark ? fallback.warningDark : fallback.warningLight, statusBg);
    const primaryText = ensureContrast(accent, statusBg);
    const errorHover = ensureContrast(shifted(errorText, dark ? 0.045 : -0.045, 0), statusBg);
    const successHover = ensureContrast(shifted(successText, dark ? 0.045 : -0.045, 0), statusBg);
    const warningHover = ensureContrast(shifted(warningText, dark ? 0.045 : -0.045, 0), statusBg);
    const primaryHover = ensureContrast(shifted(primaryText, dark ? 0.045 : -0.045, 0), statusBg);
    const green = semanticColor(dark ? fallback.greenDark : fallback.greenLight, background);
    const red = semanticColor(dark ? fallback.redDark : fallback.redLight, background);
    const yellow = semanticColor(dark ? fallback.yellowDark : fallback.yellowLight, background);
    const orange = semanticColor(dark ? fallback.orangeDark : fallback.orangeLight, background);
    const blue = semanticColor(dark ? fallback.graphBlueDark : fallback.graphBlueLight, background);
    const graphSelected = semanticColor(dark ? fallback.graphSelectedDark : fallback.graphSelectedLight, background);
    const violet = semanticColor(fallback.graphViolet, background);
    const graphLink = ensureContrast(shifted(text, dark ? -0.23 : 0.18, 0), background, 2.2);
    const overlayBase = dark ? fallback.neutralOverlayDark : fallback.neutralOverlayLight;
    const gridHeaderBg = dark ? bgDark : bgDark;
    const gridText = ensureContrast(text, background);
    const gridHeaderText = ensureContrast(text, gridHeaderBg);
    const gridSelected = alphaOver(accent, mode.gridSelectedAlpha);
    const gridHovered = alphaOver(accent, mode.gridHoveredAlpha);

    const colors: Record<ThemeColorVar, string> = {
        "--color-bg-default": background,
        "--color-bg-dark": bgDark,
        "--color-bg-light": bgLight,
        "--color-bg-selection": selection,
        "--color-bg-tree-selection": treeSelection,
        "--color-bg-scrollbar": bgLight,
        "--color-bg-scrollbar-thumb": withAlpha(muted, mode.scrollbarThumbAlpha),
        "--color-bg-message": bgLight,
        "--color-bg-overlay": withAlpha(overlayBase, mode.overlayAlpha),
        "--color-bg-overlay-hover": withAlpha(overlayBase, mode.overlayHoverAlpha),
        "--color-bg-webview": fallback.webview,
        "--color-bg-backdrop": withAlpha(fallback.backdrop, mode.backdropAlpha),
        "--color-text-default": text,
        "--color-text-dark": text,
        "--color-text-light": muted,
        "--color-text-selection": selectionText,
        "--color-text-strong": strong,
        "--color-icon-default": text,
        "--color-icon-dark": text,
        "--color-icon-light": muted,
        "--color-icon-disabled": shifted(background, dark ? 0.2 : -0.2, 0),
        "--color-icon-selection": selectionText,
        "--color-icon-active": ensureContrast(accent, background, 3),
        "--color-border-active": ensureContrast(accent, background, 3),
        "--color-border-default": borderDefault,
        "--color-border-light": borderLight,
        "--color-shadow-default": withAlpha(fallback.backdrop, mode.shadowAlpha),
        "--color-grid-header-bg": gridHeaderBg,
        "--color-grid-header-color": gridHeaderText,
        "--color-grid-data-bg": background,
        "--color-grid-border": borderLight,
        "--color-grid-data-color": gridText,
        "--color-grid-sel-selected": gridSelected,
        "--color-grid-sel-hovered": gridHovered,
        "--color-grid-sel-border": ensureContrast(accent, background, 3),
        "--color-grid-sel-border-light": borderDefault,
        "--color-misc-blue": accent,
        "--color-misc-link": base.link ?? fixedLink,
        "--color-misc-green": green,
        "--color-misc-red": red,
        "--color-misc-yellow": yellow,
        "--color-misc-orange": orange,
        "--color-misc-vlc": semanticColor(fallback.vlc, background),
        "--color-error-bg": statusBg,
        "--color-error-text": errorText,
        "--color-error-border": statusBg,
        "--color-error-text-hover": errorHover,
        "--color-success-bg": statusBg,
        "--color-success-text": successText,
        "--color-success-border": statusBg,
        "--color-success-text-hover": successHover,
        "--color-primary-bg": statusBg,
        "--color-primary-text": primaryText,
        "--color-primary-border": statusBg,
        "--color-primary-text-hover": primaryHover,
        "--color-warning-bg": statusBg,
        "--color-warning-text": warningText,
        "--color-warning-border": statusBg,
        "--color-warning-text-hover": warningHover,
        "--color-highlight-active-match": withAlpha(yellow, mode.highlightAlpha),
        "--color-minimap-bg": withAlpha(muted, mode.minimapAlpha),
        "--color-minimap-hover-bg": withAlpha(muted, mode.minimapHoverAlpha),
        "--color-minimap-active-bg": withAlpha(accent, mode.minimapActiveAlpha),
        "--color-graph-bg": background,
        "--color-graph-node-default": blue,
        "--color-graph-node-highlight": ensureContrast(accent, background, 3),
        "--color-graph-node-selected": graphSelected,
        "--color-graph-border-default": blue,
        "--color-graph-border-highlight": ensureContrast(shifted(accent, dark ? -0.1 : 0.1, 0), background, 3),
        "--color-graph-border-selected": ensureContrast(shifted(graphSelected, dark ? -0.08 : 0.08, 0), background, 3),
        "--color-graph-link-default": graphLink,
        "--color-graph-link-selected": graphSelected,
        "--color-graph-label-bg": withAlpha(dark ? muted : bgLight, mode.graphLabelAlpha),
        "--color-graph-label-text": ensureContrast(text, bgLight),
        "--color-graph-group-border": ensureContrast(accent, background, 3),
        "--color-graph-node-special": violet,
        "--color-graph-border-special": ensureContrast(shifted(violet, dark ? -0.1 : 0.1, 0), background, 3),
    };

    // Keep tuple use explicit so any newly declared key must be added to the typed object above.
    void THEME_COLOR_VARS;
    return {
        id: "custom-derived",
        name: "Derived theme",
        isDark: dark,
        colors,
        monaco: {
            base: dark ? "vs-dark" : "vs",
            colors: {
                "editor.background": colors["--color-bg-default"],
                "menu.background": colors["--color-bg-default"],
                "menu.foreground": colors["--color-text-default"],
                "menu.selectionBackground": colors["--color-bg-selection"],
                "menu.selectionForeground": colors["--color-text-selection"],
                "menu.separatorBackground": colors["--color-border-default"],
                "menu.border": colors["--color-border-default"],
            },
        },
    };
}

/** Build a complete definition, routing validated CSS and Monaco overrides and applying them last. */
export function buildCustomTheme(file: CustomThemeFile): ThemeDefinition {
    const theme = deriveTheme(file.base, file.isDark);
    for (const [key, value] of Object.entries(file.overrides)) {
        if (isThemeColorVar(key)) {
            theme.colors[key] = value;
        } else if (key.startsWith("monaco:")) {
            const monacoKey = key.slice(7) as MonacoColorKey;
            if (MONACO_COLOR_KEYS.includes(monacoKey)) theme.monaco.colors[monacoKey] = value;
        }
    }
    theme.id = file.id;
    theme.name = file.name;
    return theme;
}

/** Extract the user-editable base palette, including the optional semantic colors. */
export function baseFromTheme(theme: ThemeDefinition): CustomThemeBase {
    return {
        background: theme.colors["--color-bg-default"],
        text: theme.colors["--color-text-default"],
        accent: theme.colors["--color-misc-blue"],
        link: theme.colors["--color-misc-link"],
        error: theme.colors["--color-error-text"],
        warning: theme.colors["--color-warning-text"],
        success: theme.colors["--color-success-text"],
    };
}

/** Return exact CSS and Monaco color differences needed to fork this definition pixel-for-pixel. */
export function overridesFor(theme: ThemeDefinition, base: CustomThemeBase): Record<string, string> {
    const derived = deriveTheme(base, theme.isDark);
    const overrides: Record<string, string> = {};
    for (const variable of THEME_COLOR_VARS) {
        if (theme.colors[variable] !== derived.colors[variable]) {
            overrides[variable] = theme.colors[variable];
        }
    }
    for (const key of MONACO_COLOR_KEYS) {
        if (theme.monaco.colors[key] !== derived.monaco.colors[key]) {
            overrides[`monaco:${key}`] = theme.monaco.colors[key];
        }
    }
    return overrides;
}

/** Measure declared text/surface pairs at AA's 4.5:1 threshold without changing any theme value. */
export function contrastReport(theme: ThemeDefinition): ContrastReport {
    const pairs: Array<[string, ThemeColorVar, ThemeColorVar]> = [
        ["text-default/bg-default", "--color-text-default", "--color-bg-default"],
        ["text-light/bg-default", "--color-text-light", "--color-bg-default"],
        ["text-strong/bg-default", "--color-text-strong", "--color-bg-default"],
        ["text-selection/bg-selection", "--color-text-selection", "--color-bg-selection"],
        ["text-selection/bg-tree-selection", "--color-text-selection", "--color-bg-tree-selection"],
        ["grid-header-color/grid-header-bg", "--color-grid-header-color", "--color-grid-header-bg"],
        ["grid-data-color/grid-data-bg", "--color-grid-data-color", "--color-grid-data-bg"],
        ["graph-label-text/graph-label-bg", "--color-graph-label-text", "--color-graph-label-bg"],
        ["misc-link/bg-default", "--color-misc-link", "--color-bg-default"],
        ["error-text/error-bg", "--color-error-text", "--color-error-bg"],
        ["success-text/success-bg", "--color-success-text", "--color-success-bg"],
        ["warning-text/warning-bg", "--color-warning-text", "--color-warning-bg"],
        ["primary-text/primary-bg", "--color-primary-text", "--color-primary-bg"],
        ["primary-text-hover/primary-bg", "--color-primary-text-hover", "--color-primary-bg"],
    ];
    for (const [status, text, background] of [
        ["error", "--color-error-text-hover", "--color-error-bg"],
        ["success", "--color-success-text-hover", "--color-success-bg"],
        ["warning", "--color-warning-text-hover", "--color-warning-bg"],
    ] as const) {
        pairs.push([`${status}-text-hover/${status}-bg`, text, background]);
    }
    const report: ContrastReport = {};
    for (const [name, foregroundKey, backgroundKey] of pairs) {
        const foreground = parseColor(theme.colors[foregroundKey]);
        const background = parseColor(theme.colors[backgroundKey]);
        const underlay = parseColor(name === "graph-label-text/graph-label-bg"
            ? theme.colors["--color-bg-light"]
            : theme.colors["--color-bg-default"]);
        const surface = background && background.a < 1
            ? underlay ? compositeColor(background, underlay) : null
            : background;
        const ratio = foreground && surface ? contrastRatio(foreground, surface) : 0;
        report[name] = { ratio: Number(ratio.toFixed(2)), meetsAA: ratio >= 4.5 };
    }
    return report;
}
