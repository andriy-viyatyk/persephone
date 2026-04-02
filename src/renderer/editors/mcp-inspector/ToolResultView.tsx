import { useMemo } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Editor } from "@monaco-editor/react";
import { McpToolResult } from "./McpInspectorEditorModel";

// ============================================================================
// Styles
// ============================================================================

const ToolResultRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: "1 1 auto",
    overflow: "hidden",

    "& .result-editor-wrapper": {
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        overflow: "hidden",
        flex: "1 1 auto",
        minHeight: 40,
    },

    "& .result-editor-wrapper.error": {
        borderColor: color.error.text,
    },

    "& .result-image": {
        maxWidth: "100%",
        borderRadius: 4,
        border: `1px solid ${color.border.default}`,
    },

    "& .result-resource-uri": {
        fontSize: 11,
        color: color.misc.blue,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
    },

    "& .result-link": {
        fontSize: 12,
        color: color.misc.blue,
        textDecoration: "underline",
        cursor: "pointer",
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

function detectLanguage(text: string): string {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            JSON.parse(text);
            return "json";
        } catch { /* not valid JSON */ }
    }
    return "plaintext";
}

// ============================================================================
// Component
// ============================================================================

interface ToolResultViewProps {
    result: McpToolResult;
}

export function ToolResultView({ result }: ToolResultViewProps) {
    return (
        <ToolResultRoot>
            {result.content.map((item, i) => (
                <ResultItem key={i} item={item} isError={result.isError} />
            ))}
        </ToolResultRoot>
    );
}

// ============================================================================
// ResultItem
// ============================================================================

function ResultItem({ item, isError }: { item: McpToolResult["content"][number]; isError?: boolean }) {
    if (item.type === "text") {
        return <TextResult text={item.text} isError={isError} />;
    }
    if (item.type === "image") {
        return (
            <img
                className="result-image"
                src={`data:${item.mimeType};base64,${item.data}`}
                alt="Tool result"
            />
        );
    }
    if (item.type === "resource") {
        return (
            <>
                <div className="result-resource-uri">{item.resource.uri}</div>
                {item.resource.text && <TextResult text={item.resource.text} />}
            </>
        );
    }
    if (item.type === "resource_link") {
        return (
            <span className="result-link" title={item.uri}>
                {item.name || item.uri}
            </span>
        );
    }
    return null;
}

// ============================================================================
// TextResult — Monaco editor for text content
// ============================================================================

function TextResult({ text, isError }: { text: string; isError?: boolean }) {
    const language = useMemo(() => detectLanguage(text), [text]);

    return (
        <div className={`result-editor-wrapper${isError ? " error" : ""}`}>
            <Editor
                value={text}
                language={language}
                theme="custom-dark"
                options={EDITOR_OPTIONS}
            />
        </div>
    );
}
