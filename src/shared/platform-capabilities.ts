import { PLATFORM_CAPABILITY_IDS } from "./capability-constants";
/** Built-in capability metadata in editor registration order. */
export const PLATFORM_CAPABILITIES = [
    { editorId: "monaco", id: PLATFORM_CAPABILITY_IDS.textOpen, version: 1, priority: 50 },
    { editorId: "grid-json", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "grid", version: 1, priority: 50 },
    { editorId: "log-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "log", version: 1, priority: 50 },
    { editorId: "md-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "markdown", version: 1, priority: 50 },
    { editorId: "svg-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "svg", version: 1, priority: 50 },
    { editorId: "html-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "html", version: 1, priority: 50 },
    { editorId: "mermaid-view", id: PLATFORM_CAPABILITY_IDS.contentView, representation: "mermaid", version: 1, priority: 50 },
] as const;
