// Persephone's own theme: the colors of the app icon and the r/PersephoneNotepad banner,
// on a dark green ground.

import { ThemeDefinition } from "./types";

// Persephone palette reference:
// bg:       #10201a  bg-dark:  #0b1712  bg-light: #1a3027
// fg:       #d4e2da  fg-light: #8fa89b  fg-bright:#f0f3f4 (petal white)
// accent:   #2ecc71 (the banner's "AI agents")  leaf: #27ae60
// stamens:  #f1c40f / #e67e22                   web:  #3498db (graph nodes)
// success:  #82e0aa (mint, kept apart from the accent)
// selection:#1e8449  tree-sel: #174a33          border:#29443a

export const persephone: ThemeDefinition = {
    id: "persephone",
    name: "Persephone",
    isDark: true,
    colors: {
        // background
        "--color-bg-default": "#10201a",
        "--color-bg-dark": "#0b1712",
        "--color-bg-light": "#1a3027",
        "--color-bg-selection": "#1e8449",
        "--color-bg-tree-selection": "#174a33",
        "--color-bg-scrollbar": "#1a3027",
        "--color-bg-scrollbar-thumb": "rgba(143, 168, 155, 0.2)",
        "--color-bg-message": "#1a3027",
        "--color-bg-overlay": "rgba(0, 0, 0, 0.6)",
        "--color-bg-overlay-hover": "rgba(0, 0, 0, 0.8)",
        "--color-bg-webview": "#ffffff",
        "--color-bg-backdrop": "rgba(0, 0, 0, 0.3)",

        // text
        "--color-text-default": "#d4e2da",
        "--color-text-dark": "#d4e2da",
        "--color-text-light": "#8fa89b",
        "--color-text-selection": "#ffffff",
        "--color-text-strong": "#f0f3f4",

        // icon
        "--color-icon-default": "#d4e2da",
        "--color-icon-dark": "#d4e2da",
        "--color-icon-light": "#8fa89b",
        "--color-icon-disabled": "#3f5a4d",
        "--color-icon-selection": "#ffffff",
        "--color-icon-active": "#27ae60",

        // border
        "--color-border-active": "#2ecc71",
        "--color-border-default": "#29443a",
        "--color-border-light": "#1a2e25",

        // shadow
        "--color-shadow-default": "rgba(0, 0, 0, 0.45)",

        // grid
        "--color-grid-header-bg": "#0b1712",
        "--color-grid-header-color": "#d4e2da",
        "--color-grid-data-bg": "#10201a",
        "--color-grid-border": "#1a2e25",
        "--color-grid-data-color": "#d4e2da",
        "--color-grid-sel-selected": "rgba(46, 204, 113, 0.15)",
        "--color-grid-sel-hovered": "rgba(46, 204, 113, 0.1)",
        "--color-grid-sel-border": "#2ecc71",
        "--color-grid-sel-border-light": "#29443a",

        // misc
        // misc.blue is the app-wide accent (link buttons, breadcrumbs, progress bars, the theme
        // swatch), so it takes the banner's "AI agents" green rather than a literal blue.
        "--color-misc-blue": "#2ecc71",
        // Links take the accent green, brightened so they stand out from the body text.
        "--color-misc-link": "#58d68d",
        // Lighter mint, so success marks stay distinct from the accent.
        "--color-misc-green": "#82e0aa",
        "--color-misc-red": "#f1735f",
        "--color-misc-yellow": "#f1c40f",
        "--color-misc-orange": "#e67e22",
        "--color-misc-vlc": "#ff8800",

        // error
        "--color-error-bg": "#0b1712",
        "--color-error-text": "#f1735f",
        "--color-error-border": "#0b1712",
        "--color-error-text-hover": "#f1735f",

        // success
        "--color-success-bg": "#0b1712",
        "--color-success-text": "#82e0aa",
        "--color-success-border": "#0b1712",
        "--color-success-text-hover": "#82e0aa",

        // primary
        "--color-primary-bg": "#0b1712",
        "--color-primary-text": "#2ecc71",
        "--color-primary-border": "#0b1712",
        "--color-primary-text-hover": "#58d68d",

        // warning
        "--color-warning-bg": "#0b1712",
        "--color-warning-text": "#f1c40f",
        "--color-warning-border": "#0b1712",
        "--color-warning-text-hover": "#f1c40f",

        // highlight
        "--color-highlight-active-match": "rgba(241, 196, 15, 0.35)",

        // minimap slider
        "--color-minimap-bg": "rgba(143, 168, 155, 0.15)",
        "--color-minimap-hover-bg": "rgba(143, 168, 155, 0.25)",
        "--color-minimap-active-bg": "rgba(46, 204, 113, 0.25)",

        // graph
        "--color-graph-bg": "#10201a",
        "--color-graph-node-default": "#3498db",
        "--color-graph-node-highlight": "#2ecc71",
        "--color-graph-node-selected": "#f1c40f",
        "--color-graph-border-default": "#3498db",
        "--color-graph-border-highlight": "#27ae60",
        "--color-graph-border-selected": "#e67e22",
        "--color-graph-link-default": "#6f8a7c",
        "--color-graph-link-selected": "#f1c40f",
        "--color-graph-label-bg": "rgba(143, 168, 155, 0.2)",
        "--color-graph-label-text": "#d4e2da",
        "--color-graph-group-border": "#27ae60",
        "--color-graph-node-special": "#b07ce8",
        "--color-graph-border-special": "#9055c8",
    },
    monaco: {
        base: "vs-dark",
        colors: {
            "editor.background": "#10201a",
            "menu.background": "#10201a",
            "menu.foreground": "#d4e2da",
            "menu.selectionBackground": "#1e8449",
            "menu.selectionForeground": "#ffffff",
            "menu.separatorBackground": "#29443a",
            "menu.border": "#29443a",
        },
    },
};
