import { useMemo } from "react";
import styled from "@emotion/styled";
import { settings } from "../../api/settings";
import { app } from "../../api/app";
import { RawLinkEvent } from "../../api/events/events";
import {
    TreeProviderView,
    type TreeProviderViewRef,
    type TreeProviderViewSavedState,
} from "../../components/tree-provider/TreeProviderView";
import { FileTreeProvider } from "../../content/tree-providers/FileTreeProvider";
import { FolderOpenIcon } from "../../theme/icons";
import color from "../../theme/color";
const ScriptLibraryPanelRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    height: "100%",

    "& .library-placeholder": {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        height: "100%",
        padding: 16,
    },

    "& .library-placeholder-hint": {
        fontSize: 11,
        color: color.text.light,
        textAlign: "center",
        lineHeight: 1.5,
        maxWidth: 200,
    },

    "& .library-action-button": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        fontSize: 12,
        color: color.text.default,
        backgroundColor: color.background.dark,
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        cursor: "pointer",
        "&:hover": {
            borderColor: color.text.light,
        },
        "& svg": {
            width: 14,
            height: 14,
            flexShrink: 0,
        },
    },
});

interface ScriptLibraryPanelProps {
    onClose?: () => void;
    explorerRef?: (ref: TreeProviderViewRef | null) => void;
    expandState?: TreeProviderViewSavedState;
    onExpandStateChange?: (state: TreeProviderViewSavedState) => void;
}

export function ScriptLibraryPanel(props: ScriptLibraryPanelProps) {
    const libraryPath = settings.use("script-library.path");

    const handleSelectFolder = async () => {
        const { showLibrarySetupDialog } = await import("../dialogs/LibrarySetupDialog");
        showLibrarySetupDialog();
    };

    if (!libraryPath) {
        return (
            <ScriptLibraryPanelRoot>
                <div className="library-placeholder">
                    <button className="library-action-button" onClick={handleSelectFolder}>
                        <FolderOpenIcon />
                        Select Folder
                    </button>
                    <div className="library-placeholder-hint">
                        Select an existing folder with scripts or create a new one to store your saved scripts and reusable modules
                    </div>
                </div>
            </ScriptLibraryPanelRoot>
        );
    }

    const provider = useMemo(() => new FileTreeProvider(libraryPath), [libraryPath]);

    return (
        <ScriptLibraryPanelRoot>
            <TreeProviderView
                ref={props.explorerRef}
                key={libraryPath}
                provider={provider}
                initialState={props.expandState}
                onStateChange={props.onExpandStateChange}
                onItemClick={(item) => {
                    if (!item.isDirectory) {
                        app.events.openRawLink.sendAsync(new RawLinkEvent(item.href));
                        props.onClose?.();
                    }
                }}
            />
        </ScriptLibraryPanelRoot>
    );
}
