// Light companion to the Persephone theme: the same icon and banner colors on a pale slate ground.

import { ThemeDefinition } from "./types";

// Persephone Light palette reference:
// bg:       #fbfcfd  bg-dark:  #ecf0f1 (icon petal, Flat UI "clouds")  bg-light: #e3e9ed
// fg:       #2c3e50 (the icon's circle)  fg-light: #5d6d7e  fg-bright:#151f29 (dark theme bg-dark)
// accent:   #1e8449 (the banner's "AI agents" green, deepened to read on white)
// stamens:  #9a6700 / #c0611a (darkened for contrast)  web: #2874a6 (graph nodes), links #1f6fa8
// success:  #4d7c0f (olive, kept apart from the accent)  border: #d0d9e0

export const persephoneLight: ThemeDefinition = {
    id: "persephone-light",
    name: "Persephone Light",
    isDark: false,
    colors: {
        // background
        "--color-bg-default": "#fbfcfd",
        "--color-bg-dark": "#ecf0f1",
        "--color-bg-light": "#e3e9ed",
        "--color-bg-selection": "#1e8449",
        "--color-bg-tree-selection": "#1e8449",
        "--color-bg-scrollbar": "#e3e9ed",
        "--color-bg-scrollbar-thumb": "rgba(44, 62, 80, 0.3)",
        "--color-bg-message": "#e3e9ed",
        "--color-bg-overlay": "rgba(255, 255, 255, 0.8)",
        "--color-bg-overlay-hover": "rgba(255, 255, 255, 0.9)",
        "--color-bg-webview": "#ffffff",
        "--color-bg-backdrop": "rgba(0, 0, 0, 0.3)",

        // text
        "--color-text-default": "#2c3e50",
        "--color-text-dark": "#2c3e50",
        "--color-text-light": "#5d6d7e",
        "--color-text-selection": "#ffffff",
        "--color-text-strong": "#151f29",

        // icon
        "--color-icon-default": "#2c3e50",
        "--color-icon-dark": "#2c3e50",
        "--color-icon-light": "#5d6d7e",
        "--color-icon-disabled": "#b4c0ca",
        "--color-icon-selection": "#ffffff",
        "--color-icon-active": "#1e8449",

        // border
        "--color-border-active": "#1e8449",
        "--color-border-default": "#d0d9e0",
        "--color-border-light": "#e6ecf0",

        // shadow
        "--color-shadow-default": "rgba(21, 31, 41, 0.16)",

        // grid
        "--color-grid-header-bg": "#ecf0f1",
        "--color-grid-header-color": "#2c3e50",
        "--color-grid-data-bg": "#fbfcfd",
        "--color-grid-border": "#d0d9e0",
        "--color-grid-data-color": "#2c3e50",
        "--color-grid-sel-selected": "rgba(30, 132, 73, 0.15)",
        "--color-grid-sel-hovered": "rgba(30, 132, 73, 0.08)",
        "--color-grid-sel-border": "#1e8449",
        "--color-grid-sel-border-light": "#d0d9e0",

        // misc
        // misc.blue is the app-wide accent, so it takes the accent green (see persephone.ts).
        "--color-misc-blue": "#1e8449",
        // Links stay blue, as everywhere else: the banner's "Web pages" blue, darkened for white.
        "--color-misc-link": "#1f6fa8",
        "--color-misc-green": "#4d7c0f",
        "--color-misc-red": "#c0392b",
        "--color-misc-yellow": "#9a6700",
        "--color-misc-orange": "#c0611a",
        "--color-misc-vlc": "#ff8800",

        // error
        "--color-error-bg": "#ffffff",
        "--color-error-text": "#c0392b",
        "--color-error-border": "#ffffff",
        "--color-error-text-hover": "#962d22",

        // success
        "--color-success-bg": "#ffffff",
        "--color-success-text": "#4d7c0f",
        "--color-success-border": "#ffffff",
        "--color-success-text-hover": "#3b5f0b",

        // primary
        "--color-primary-bg": "#ffffff",
        "--color-primary-text": "#1e8449",
        "--color-primary-border": "#ffffff",
        "--color-primary-text-hover": "#145a32",

        // warning
        "--color-warning-bg": "#ffffff",
        "--color-warning-text": "#9a6700",
        "--color-warning-border": "#ffffff",
        "--color-warning-text-hover": "#7d5200",

        // highlight
        "--color-highlight-active-match": "rgba(241, 196, 15, 0.45)",

        // minimap slider
        "--color-minimap-bg": "rgba(44, 62, 80, 0.15)",
        "--color-minimap-hover-bg": "rgba(44, 62, 80, 0.28)",
        "--color-minimap-active-bg": "rgba(30, 132, 73, 0.3)",

        // graph
        "--color-graph-bg": "#fbfcfd",
        "--color-graph-node-default": "#2874a6",
        "--color-graph-node-highlight": "#1e8449",
        "--color-graph-node-selected": "#c0611a",
        "--color-graph-border-default": "#2874a6",
        "--color-graph-border-highlight": "#145a32",
        "--color-graph-border-selected": "#c0611a",
        "--color-graph-link-default": "#aab7c4",
        "--color-graph-link-selected": "#c0611a",
        "--color-graph-label-bg": "rgba(227, 233, 237, 0.85)",
        "--color-graph-label-text": "#2c3e50",
        "--color-graph-group-border": "#1e8449",
        "--color-graph-node-special": "#7c3aed",
        "--color-graph-border-special": "#6d28d9",
    },
    monaco: {
        base: "vs",
        colors: {
            "editor.background": "#fbfcfd",
            "menu.background": "#fbfcfd",
            "menu.foreground": "#2c3e50",
            "menu.selectionBackground": "#1e8449",
            "menu.selectionForeground": "#ffffff",
            "menu.separatorBackground": "#d0d9e0",
            "menu.border": "#c5d0d8",
        },
    },
};
