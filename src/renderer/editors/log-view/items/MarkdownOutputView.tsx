import { useCallback } from "react";
import styled from "@emotion/styled";
import { MarkdownOutputEntry } from "../logTypes";
import { DialogHeader } from "./DialogHeader";
import { MarkdownBlock } from "../../markdown/MarkdownBlock";
import { Button } from "../../../components/basic/Button";
import { OpenLinkIcon } from "../../../theme/icons";
import { pagesModel } from "../../../api/pages";
import { isTextFileModel } from "../../text/TextPageModel";

// =============================================================================
// Styled Components
// =============================================================================

const MarkdownOutputRoot = styled.div({
    position: "relative",
    width: "100%",

    "& .markdown-content": {
        padding: "4px 0",
    },

    "& .markdown-hover-actions": {
        position: "absolute",
        top: 4,
        right: 4,
        opacity: 0,
        transition: "opacity 0.15s",
        zIndex: 1,
    },

    "&:hover .markdown-hover-actions": {
        opacity: 1,
    },
});

// =============================================================================
// Component
// =============================================================================

interface MarkdownOutputViewProps {
    entry: MarkdownOutputEntry;
}

export function MarkdownOutputView({ entry }: MarkdownOutputViewProps) {
    const handleOpenInEditor = useCallback(() => {
        const title = typeof entry.title === "string" ? entry.title : "Markdown";
        const page = pagesModel.addEditorPage("md-view", "markdown", title);
        if (isTextFileModel(page)) {
            page.changeContent(entry.text);
        }
    }, [entry.text, entry.title]);

    return (
        <MarkdownOutputRoot>
            <DialogHeader title={entry.title} />
            <div className="markdown-content">
                <MarkdownBlock content={entry.text} compact />
            </div>
            <div className="markdown-hover-actions">
                <Button size="small" type="icon" onClick={handleOpenInEditor} title="Open in Markdown editor">
                    <OpenLinkIcon />
                </Button>
            </div>
        </MarkdownOutputRoot>
    );
}
