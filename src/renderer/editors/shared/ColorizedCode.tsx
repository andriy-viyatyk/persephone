import { useState, useEffect } from "react";
import * as monaco from "monaco-editor";

// =============================================================================
// JSON Monarch Grammar
// =============================================================================
// Monaco's JSON language uses a web worker for tokenization, which loads
// asynchronously. The `colorize()` API needs a synchronous monarch grammar.
// Register a basic one so JSON colorization works immediately.
// The worker-based tokenizer takes precedence in the actual editor.

monaco.languages.setMonarchTokensProvider("json", {
    tokenizer: {
        root: [
            [/\s+/, "white"],
            [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number.float.json"],
            [/\b(?:true|false|null)\b/, "keyword.json"],
            [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "string.key.json"],
            [/"(?:[^"\\]|\\.)*"/, "string.value.json"],
            [/[{}]/, "delimiter.bracket.json"],
            [/[\[\]]/, "delimiter.array.json"],
            [/[,:]/, "delimiter.json"],
        ],
    },
});

// =============================================================================
// Component
// =============================================================================

interface ColorizedCodeProps extends React.HTMLAttributes<HTMLElement> {
    /** Source code text to colorize. */
    code: string;
    /** Monaco language ID (e.g. "json", "javascript", "typescript"). */
    language: string;
    /** Tab size for colorization. Default: 4. */
    tabSize?: number;
}

/**
 * Renders syntax-highlighted code using Monaco's `colorize()` API.
 * Produces a `<code>` element — wrap in `<pre>` for block display.
 */
export function ColorizedCode({
    code,
    language,
    tabSize = 4,
    className,
    ...props
}: ColorizedCodeProps) {
    const [html, setHtml] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        monaco.editor.colorize(code, language, { tabSize }).then((result) => {
            if (!cancelled) setHtml(result);
        });

        return () => { cancelled = true; };
    }, [code, language, tabSize]);

    if (html) {
        return (
            <code
                className={className}
                dangerouslySetInnerHTML={{ __html: html }}
                {...props}
            />
        );
    }

    return (
        <code className={className} {...props}>
            {code}
        </code>
    );
}
