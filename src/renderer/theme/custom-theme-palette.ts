/** Measured OKLCH offsets for background ramps and emphasis tiers. */
export const CUSTOM_THEME_PALETTE = {
    dark: {
        // Panel and border offsets from the supplied background.
        backgroundDark: [-0.0349, -0.0027] as const,
        backgroundLight: [0.0531, 0.0015] as const,
        borderDefault: [0.0997, 0.0049] as const,
        borderLight: [0.0332, 0.0006] as const,
        // Selection offsets from the supplied accent.
        selection: [-0.1508, -0.0334] as const,
        treeSelection: [-0.2983, -0.0917] as const,
        // Muted and strong text offsets from the supplied text color.
        textLight: [-0.1719, 0.0101] as const,
        textStrong: [0.047, -0.0026] as const,
        // Translucency levels measured from the dark reference themes.
        gridSelectedAlpha: 0.175,
        gridHoveredAlpha: 0.15,
        overlayAlpha: 0.6,
        overlayHoverAlpha: 0.8,
        backdropAlpha: 0.3,
        shadowAlpha: 0.405,
        scrollbarThumbAlpha: 0.2,
        highlightAlpha: 0.35,
        minimapAlpha: 0.175,
        minimapHoverAlpha: 0.3,
        minimapActiveAlpha: 0.225,
        graphLabelAlpha: 0.2,
    },
    light: {
        // Panel and border offsets from the supplied background.
        backgroundDark: [-0.0382, 0.0028] as const,
        backgroundLight: [-0.06, 0.0067] as const,
        borderDefault: [-0.1101, 0.012] as const,
        borderLight: [-0.0509, 0.0067] as const,
        // Selection offsets from the supplied accent.
        selection: [0, 0] as const,
        treeSelection: [0, 0] as const,
        // Muted and strong text offsets from the supplied text color.
        textLight: [0.1714, -0.006] as const,
        textStrong: [-0.1219, -0.0149] as const,
        // Translucency levels measured from the light reference themes.
        gridSelectedAlpha: 0.15,
        gridHoveredAlpha: 0.08,
        overlayAlpha: 0.8,
        overlayHoverAlpha: 0.9,
        backdropAlpha: 0.3,
        shadowAlpha: 0.16,
        scrollbarThumbAlpha: 0.3,
        highlightAlpha: 0.45,
        minimapAlpha: 0.15,
        minimapHoverAlpha: 0.28,
        minimapActiveAlpha: 0.3,
        graphLabelAlpha: 0.85,
    },
    // Semantic hues supply defaults when a user has not provided a role-specific base color.
    fallback: {
        linkDark: "#59aee8", // Link text on dark surfaces.
        linkLight: "#1f6fa8", // Link text on light surfaces.
        errorDark: "#ff796c", // Error and destructive status text on dark surfaces.
        errorLight: "#c0392b", // Error and destructive status text on light surfaces.
        successDark: "#76d39b", // Success status text on dark surfaces.
        successLight: "#4d7c0f", // Success status text on light surfaces.
        warningDark: "#f1c94c", // Warning status text on dark surfaces.
        warningLight: "#9a6700", // Warning status text on light surfaces.
        greenDark: "#62c987", // General semantic green.
        greenLight: "#32864c",
        redDark: "#ef6b61", // General semantic red.
        redLight: "#c0392b",
        yellowDark: "#f1c40f", // General semantic yellow and active-match highlight.
        yellowLight: "#9a6700",
        orangeDark: "#e67e22", // Conversion action orange.
        orangeLight: "#c0611a",
        vlc: "#ff8800", // VLC action color.
        graphBlueDark: "#3498db", // Default graph node color.
        graphBlueLight: "#2874a6",
        graphSelectedDark: "#f1c40f", // Selected graph node color.
        graphSelectedLight: "#c0611a",
        graphViolet: "#8a62c7", // Special graph node color.
        neutralOverlayDark: "#000000", // Modal overlay on dark themes.
        neutralOverlayLight: "#ffffff", // Modal overlay on light themes.
        backdrop: "#000000", // Modal backdrop independent of theme polarity.
        webview: "#ffffff", // Fixed white web document surface.
        selectionText: "#ffffff", // Text and icons on accent-filled selections, in both modes.
    },
} as const;
