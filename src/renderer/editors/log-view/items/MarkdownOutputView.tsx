import { useCallback } from "react";
import { MarkdownOutputEntry } from "../logTypes";
import { DialogHeader } from "./DialogHeader";
import { MarkdownBlock } from "../../markdown/MarkdownBlock";
import { IconButton, Panel } from "../../../uikit";
import { OpenLinkIcon } from "../../../theme/icons";
import { pagesModel } from "../../../api/pages";

// =============================================================================
// Component
// =============================================================================

interface MarkdownOutputViewProps {
    entry: MarkdownOutputEntry;
}

export function MarkdownOutputView({ entry }: MarkdownOutputViewProps) {
    const handleOpenInEditor = useCallback(() => {
        const title = typeof entry.title === "string" ? entry.title : "Markdown";
        pagesModel.addEditorPage("md-view", "markdown", title, entry.text);
    }, [entry.text, entry.title]);

    return (
        <Panel
            name="log-markdown-output"
            direction="column"
            position="relative"
            width="100%"
            revealChildrenOnHover
        >
            <DialogHeader title={entry.title} />
            <Panel name="log-markdown-content" paddingY="sm">
                <MarkdownBlock content={entry.text} compact />
            </Panel>
            <Panel
                name="log-markdown-hover-actions"
                position="absolute"
                top={4}
                right={4}
                zIndex={1}
            >
                <IconButton
                    name="log-markdown-open-in-editor"
                    hideUntilParentHover
                    size="sm"
                    icon={<OpenLinkIcon />}
                    title="Open in Markdown editor"
                    onClick={handleOpenInEditor}
                />
            </Panel>
        </Panel>
    );
}
