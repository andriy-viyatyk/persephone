import type { EnglishCatalogEntry } from "./common";

export const logViewCatalog = {
    noEntries: { message: "No log entries" },
    dialogAnswered: { message: "[{type}] {text} — answered: {button}", note: "{type} is a dialog type id such as confirm; keep the square brackets." },
    renderFailure: { message: "This log entry failed to render: {error}" },
    entryRenderFailure: { message: "[{type}] render error: {error}" },
    clearLog: { message: "Clear log" },
    confirmClearLog: { message: "Clear all log entries?" },
    openInGridEditor: { message: "Open in Grid editor" },
    openInMarkdownEditor: { message: "Open in Markdown editor" },
    error: { message: "ERROR", note: "Log severity label for an error-level entry." },
    openInMermaidEditor: { message: "Open in Mermaid editor" },
    rendering: { message: "Rendering..." },
    openInTextEditor: { message: "Open in Text editor" },
    request: { message: "Request" },
    response: { message: "Response" },
    noParams: { message: "(no params)" },
    noResult: { message: "(no result)" },
} satisfies Record<string, EnglishCatalogEntry>;
