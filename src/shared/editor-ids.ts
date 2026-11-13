import type { EditorView } from "./types";

export const EditorId = {
    monaco: "monaco",
    gridJson: "grid-json",
    gridCsv: "grid-csv",
    gridJsonl: "grid-jsonl",
    mdView: "md-view",
    imageView: "image-view",
    svgView: "svg-view",
    aboutView: "about-view",
    mermaidView: "mermaid-view",
    htmlView: "html-view",
    settingsView: "settings-view",
    linkView: "link-view",
    logView: "log-view",
    browserView: "browser-view",
    mcpView: "mcp-view",
    mnemeConfig: "mneme-config",
    archiveView: "archive-view",
    categoryView: "category-view",
    videoView: "video-view",
    storybookView: "storybook-view",
    gitTree: "git-tree",
    mnemeRoot: "mneme-root",
    boardView: "board-view",
    toolsetView: "toolset-view",
    boardInfo: "board-info",
    toolsHubView: "tools-hub-view",
    fileDiff: "file-diff",
    envVarsView: "env-vars-view",
} as const satisfies Record<string, EditorView>;

export type BoardEditorId = `board-editor:${string}`;
