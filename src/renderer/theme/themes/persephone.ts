// Persephone's own theme: the colors of the app icon and the r/PersephoneNotepad banner,
// on the banner's dark slate ground with its "AI agents" green as the accent.

import { ThemeDefinition } from "./types";

// Persephone palette reference:
// bg:       #1b2935  bg-dark: #151f29  bg-light: #22313f  (the banner's gradient stops)
// fg:       #dfe6e9  fg-light: #9fb0bf  fg-bright:#f0f3f4 (petal white)
// accent:   #2ecc71 (the banner's "AI agents")  leaf: #27ae60
// stamens:  #f1c40f / #e67e22                   web:  #3498db (graph nodes), links #5dade2
// success:  #82e0aa (mint, kept apart from the accent)
// selection:#1e8449  tree-sel: #1f6e4a          border:#2c3e50 (the icon's circle)

export const persephone: ThemeDefinition = {
    id: "persephone",
    name: "Persephone",
    isDark: true,
    colors: {
        // background
        "--color-bg-default": "#1b2935",
        "--color-bg-dark": "#151f29",
        "--color-bg-light": "#22313f",
        "--color-bg-selection": "#1e8449",
        "--color-bg-tree-selection": "#1f6e4a",
        "--color-bg-scrollbar": "#22313f",
        "--color-bg-scrollbar-thumb": "rgba(159, 176, 191, 0.2)",
        "--color-bg-message": "#22313f",
        "--color-bg-overlay": "rgba(0, 0, 0, 0.6)",
        "--color-bg-overlay-hover": "rgba(0, 0, 0, 0.8)",
        "--color-bg-webview": "#ffffff",
        "--color-bg-backdrop": "rgba(0, 0, 0, 0.3)",

        // text
        "--color-text-default": "#dfe6e9",
        "--color-text-dark": "#dfe6e9",
        "--color-text-light": "#9fb0bf",
        "--color-text-selection": "#ffffff",
        "--color-text-strong": "#f0f3f4",

        // icon
        "--color-icon-default": "#dfe6e9",
        "--color-icon-dark": "#dfe6e9",
        "--color-icon-light": "#9fb0bf",
        "--color-icon-disabled": "#4a5f73",
        "--color-icon-selection": "#ffffff",
        "--color-icon-active": "#27ae60",

        // border
        "--color-border-active": "#2ecc71",
        "--color-border-default": "#2c3e50",
        "--color-border-light": "#1f2d3a",

        // shadow
        "--color-shadow-default": "rgba(0, 0, 0, 0.45)",

        // grid
        "--color-grid-header-bg": "#151f29",
        "--color-grid-header-color": "#dfe6e9",
        "--color-grid-data-bg": "#1b2935",
        "--color-grid-border": "#22313f",
        "--color-grid-data-color": "#dfe6e9",
        "--color-grid-sel-selected": "rgba(46, 204, 113, 0.15)",
        "--color-grid-sel-hovered": "rgba(46, 204, 113, 0.1)",
        "--color-grid-sel-border": "#2ecc71",
        "--color-grid-sel-border-light": "#2c3e50",

        // misc
        // misc.blue is the app-wide accent (link buttons, breadcrumbs, progress bars, the theme
        // swatch), so it takes the banner's "AI agents" green rather than a literal blue.
        "--color-misc-blue": "#2ecc71",
        // Links stay blue, as everywhere else: the banner's "Web pages" blue, lightened to read
        // on the dark slate.
        "--color-misc-link": "#5dade2",
        // Lighter mint, so success marks stay distinct from the accent.
        "--color-misc-green": "#82e0aa",
        "--color-misc-red": "#f1735f",
        "--color-misc-yellow": "#f1c40f",
        "--color-misc-orange": "#e67e22",
        "--color-misc-vlc": "#ff8800",

        // error
        "--color-error-bg": "#151f29",
        "--color-error-text": "#f1735f",
        "--color-error-border": "#151f29",
        "--color-error-text-hover": "#f1735f",

        // success
        "--color-success-bg": "#151f29",
        "--color-success-text": "#82e0aa",
        "--color-success-border": "#151f29",
        "--color-success-text-hover": "#82e0aa",

        // primary
        "--color-primary-bg": "#151f29",
        "--color-primary-text": "#2ecc71",
        "--color-primary-border": "#151f29",
        "--color-primary-text-hover": "#58d68d",

        // warning
        "--color-warning-bg": "#151f29",
        "--color-warning-text": "#f1c40f",
        "--color-warning-border": "#151f29",
        "--color-warning-text-hover": "#f1c40f",

        // highlight
        "--color-highlight-active-match": "rgba(241, 196, 15, 0.35)",

        // minimap slider
        "--color-minimap-bg": "rgba(159, 176, 191, 0.15)",
        "--color-minimap-hover-bg": "rgba(159, 176, 191, 0.25)",
        "--color-minimap-active-bg": "rgba(46, 204, 113, 0.25)",

        // graph
        "--color-graph-bg": "#1b2935",
        "--color-graph-node-default": "#3498db",
        "--color-graph-node-highlight": "#2ecc71",
        "--color-graph-node-selected": "#f1c40f",
        "--color-graph-border-default": "#3498db",
        "--color-graph-border-highlight": "#27ae60",
        "--color-graph-border-selected": "#e67e22",
        "--color-graph-link-default": "#7f8c8d",
        "--color-graph-link-selected": "#f1c40f",
        "--color-graph-label-bg": "rgba(159, 176, 191, 0.2)",
        "--color-graph-label-text": "#dfe6e9",
        "--color-graph-group-border": "#27ae60",
        "--color-graph-node-special": "#b07ce8",
        "--color-graph-border-special": "#9055c8",
    },
    monaco: {
        base: "vs-dark",
        colors: {
            "editor.background": "#1b2935",
            "menu.background": "#1b2935",
            "menu.foreground": "#dfe6e9",
            "menu.selectionBackground": "#1e8449",
            "menu.selectionForeground": "#ffffff",
            "menu.separatorBackground": "#2c3e50",
            "menu.border": "#2c3e50",
        },
    },
};
