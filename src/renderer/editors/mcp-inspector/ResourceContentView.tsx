import styled from "@emotion/styled";
import color from "../../theme/color";
import { Editor } from "@monaco-editor/react";
import { MarkdownBlock } from "../markdown/MarkdownBlock";
import { McpResourceContent } from "./McpInspectorEditorModel";

// ============================================================================
// Styles
// ============================================================================

const ResourceContentRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",

    "& .content-editor-wrapper": {
        flex: "1 1 auto",
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        overflow: "hidden",
        minHeight: 80,
    },

    "& .content-markdown-wrapper": {
        flex: "1 1 auto",
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        overflow: "auto",
        padding: "8px 12px",
    },

    "& .content-image": {
        maxWidth: "100%",
        borderRadius: 4,
        border: `1px solid ${color.border.default}`,
    },

    "& .content-binary-info": {
        fontSize: 12,
        color: color.text.light,
        padding: 12,
        background: color.background.light,
        borderRadius: 4,
        border: `1px solid ${color.border.default}`,
    },
});

// ============================================================================
// Helpers
// ============================================================================

const EDITOR_OPTIONS: any = {
    automaticLayout: true,
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    lineNumbers: "off",
    scrollBeyondLastLine: false,
    wordWrap: "on",
    folding: false,
    renderLineHighlight: "none",
    overviewRulerLanes: 0,
    padding: { top: 4, bottom: 4 },
    scrollbar: { alwaysConsumeMouseWheel: false },
};

/** Map mimeType to Monaco language id. */
function mimeToLanguage(mimeType: string): string | null {
    const m = mimeType.toLowerCase();
    if (m === "application/json" || m.endsWith("+json")) return "json";
    if (m === "text/html" || m === "application/xhtml+xml") return "html";
    if (m === "text/css") return "css";
    if (m === "text/javascript" || m === "application/javascript") return "javascript";
    if (m === "text/typescript" || m === "application/typescript") return "typescript";
    if (m === "text/yaml" || m === "application/yaml" || m === "application/x-yaml") return "yaml";
    if (m === "text/xml" || m === "application/xml" || m.endsWith("+xml")) return "xml";
    if (m.startsWith("text/")) return "plaintext";
    return null;
}

// ============================================================================
// Component
// ============================================================================

interface ResourceContentViewProps {
    content: McpResourceContent;
}

export function ResourceContentView({ content }: ResourceContentViewProps) {
    const mime = content.mimeType || "";

    // Text content
    if (content.text !== undefined) {
        // Markdown
        if (mime === "text/markdown" || mime === "text/x-markdown") {
            return (
                <ResourceContentRoot>
                    <div className="content-markdown-wrapper">
                        <MarkdownBlock content={content.text} compact />
                    </div>
                </ResourceContentRoot>
            );
        }

        // Monaco for other text
        const language = mimeToLanguage(mime) || "plaintext";
        return (
            <ResourceContentRoot>
                <div className="content-editor-wrapper">
                    <Editor
                        value={content.text}
                        language={language}
                        theme="custom-dark"
                        options={EDITOR_OPTIONS}
                    />
                </div>
            </ResourceContentRoot>
        );
    }

    // Binary content
    if (content.blob) {
        // Image
        if (mime.startsWith("image/")) {
            return (
                <ResourceContentRoot>
                    <img
                        className="content-image"
                        src={`data:${mime};base64,${content.blob}`}
                        alt={content.uri}
                    />
                </ResourceContentRoot>
            );
        }

        // Other binary
        const sizeKb = Math.round((content.blob.length * 3) / 4 / 1024);
        return (
            <ResourceContentRoot>
                <div className="content-binary-info">
                    Binary content: {mime || "unknown type"} ({sizeKb} KB)
                </div>
            </ResourceContentRoot>
        );
    }

    return (
        <ResourceContentRoot>
            <div className="content-binary-info">No content.</div>
        </ResourceContentRoot>
    );
}
