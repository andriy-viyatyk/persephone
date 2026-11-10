// Design token constants for UIKit components.
// Numeric values align with the app's spacing, size, and typography tokens.
//
// Usage in UIKit view styles:
//   import { spacing, gap, radius, height, fontSize } from "../tokens";
//
// Values are pixels. Add CSS units when assigning them through CSSOM; static
// stylesheets use the corresponding theme variables.
// Use `spacing.md * 2` for arithmetic when needed.

// ---------------------------------------------------------------------------
// Spacing — padding, margin, inset
// ---------------------------------------------------------------------------

export const spacing = {
    xs:   2,
    sm:   4,
    md:   8,
    lg:   12,
    xl:   16,
    xxl:  24,
    xxxl: 32,
} as const;

// ---------------------------------------------------------------------------
// Gap — flex / grid gap between children
// ---------------------------------------------------------------------------

export const gap = {
    xs:  2,
    sm:  4,
    md:  6,
    lg:  8,
    xl:  12,
    xxl: 16,
} as const;

// ---------------------------------------------------------------------------
// Border radius
// ---------------------------------------------------------------------------

export const radius = {
    xs:   2,
    sm:   3,
    md:   4,
    lg:   6,
    xl:   8,
} as const;

// ---------------------------------------------------------------------------
// Element height
// ---------------------------------------------------------------------------

export const height = {
    // Icon sizes
    iconSm: 12,
    iconMd: 16,
    iconLg: 20,
    // Control (button, input, select) sizes
    controlSm: 24,
    controlMd: 26,
    controlLg: 32,
} as const;

// ---------------------------------------------------------------------------
// Font size
// ---------------------------------------------------------------------------

export const fontSize = {
    // xs is intentionally 12 (same as sm) — 11px is unreadable in monospace at
    // normal monitor distances. Use xs only for non-critical secondary labels;
    // prefer sm or md for anything the user needs to actually read.
    xs:   12,
    sm:   12,
    md:   13,
    base: 14,
    lg:   16,
    xl:   20,
    xxl:  24,
} as const;
