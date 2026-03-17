import { useRef, useEffect, useCallback } from "react";
import * as monaco from "monaco-editor";
import styled from "@emotion/styled";
import { TextOutputEntry } from "../logTypes";
import { DialogHeader } from "./DialogHeader";
import { Button } from "../../../components/basic/Button";
import { OpenLinkIcon } from "../../../theme/icons";
import { pagesModel } from "../../../api/pages";
import { DIALOG_CONTENT_MAX_HEIGHT } from "../logConstants";
import color from "../../../theme/color";

// =============================================================================
// Constants
// =============================================================================

const PADDING_VERTICAL = 4;

// =============================================================================
// Styled Components
// =============================================================================

const TextOutputRoot = styled.div({
    position: "relative",
    border: "1px solid",
    borderColor: color.border.default,
    borderRadius: 4,
    margin: "2px 0",
    overflow: "hidden",
    width: "100%",

    "& .text-editor-container": {
        overflow: "hidden",
    },

    "& .text-hover-actions": {
        position: "absolute",
        top: 4,
        right: 4,
        opacity: 0,
        transition: "opacity 0.15s",
        zIndex: 1,
    },

    "&:hover .text-hover-actions": {
        opacity: 1,
    },
});

// =============================================================================
// Component
// =============================================================================

interface TextOutputViewProps {
    entry: TextOutputEntry;
}

export function TextOutputView({ entry }: TextOutputViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

    // Create / dispose Monaco editor
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const editor = monaco.editor.create(container, {
            value: entry.text,
            language: entry.language || "plaintext",
            readOnly: true,
            domReadOnly: true,
            wordWrap: entry.wordWrap !== false ? "on" : "off",
            lineNumbers: entry.lineNumbers ? "on" : "off",
            minimap: { enabled: entry.minimap === true },
            scrollBeyondLastLine: false,
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            folding: false,
            contextmenu: false,
            automaticLayout: true,
            scrollbar: {
                alwaysConsumeMouseWheel: false,
            },
            padding: { top: PADDING_VERTICAL, bottom: PADDING_VERTICAL },
        });

        editorRef.current = editor;

        // Use onDidContentSizeChange to get correct height including wrapped lines
        const sizeDisposable = editor.onDidContentSizeChange(() => {
            const contentHeight = editor.getContentHeight();
            const height = Math.min(contentHeight, DIALOG_CONTENT_MAX_HEIGHT);
            container.style.height = `${height}px`;
            editor.layout();
        });

        return () => {
            sizeDisposable.dispose();
            editorRef.current = null;
            editor.dispose();
        };
    }, []); // mount/unmount only — updates handled by separate effect

    // Update content and options when entry changes
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const model = editor.getModel();
        if (model) {
            const currentValue = model.getValue();
            if (currentValue !== entry.text) {
                model.setValue(entry.text);
            }
            const currentLang = model.getLanguageId();
            const targetLang = entry.language || "plaintext";
            if (currentLang !== targetLang) {
                monaco.editor.setModelLanguage(model, targetLang);
            }
        }

        editor.updateOptions({
            wordWrap: entry.wordWrap !== false ? "on" : "off",
            lineNumbers: entry.lineNumbers ? "on" : "off",
            minimap: { enabled: entry.minimap === true },
        });

        // Height is recalculated automatically via onDidContentSizeChange
    }, [entry.text, entry.language, entry.wordWrap, entry.lineNumbers, entry.minimap]);

    const handleOpenInEditor = useCallback(() => {
        const title = typeof entry.title === "string" ? entry.title : "Text";
        pagesModel.addEditorPage("monaco", entry.language || "plaintext", title, entry.text);
    }, [entry.text, entry.language, entry.title]);

    return (
        <TextOutputRoot>
            <DialogHeader title={entry.title} />
            <div className="text-editor-container" ref={containerRef} />
            <div className="text-hover-actions">
                <Button size="small" type="icon" onClick={handleOpenInEditor} title="Open in Text editor">
                    <OpenLinkIcon />
                </Button>
            </div>
        </TextOutputRoot>
    );
}
