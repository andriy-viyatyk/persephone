/** Built-in capability metadata in editor registration order. */
export const PLATFORM_CAPABILITIES = [
    { editorId: "monaco", id: "text.open", version: 1, priority: 50 },
    { editorId: "grid-json", id: "content.view", representation: "grid", version: 1, priority: 50 },
    { editorId: "log-view", id: "content.view", representation: "log", version: 1, priority: 50 },
    { editorId: "md-view", id: "content.view", representation: "markdown", version: 1, priority: 50 },
    { editorId: "svg-view", id: "content.view", representation: "svg", version: 1, priority: 50 },
    { editorId: "html-view", id: "content.view", representation: "html", version: 1, priority: 50 },
    { editorId: "mermaid-view", id: "content.view", representation: "mermaid", version: 1, priority: 50 },
] as const;
