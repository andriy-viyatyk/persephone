import styled from "@emotion/styled";
import { useState } from "react";

import { showDialog } from "./Dialogs";
import { Dialog, DialogContent } from "./Dialog";
import color from "../../theme/color";
import { TDialogModel } from "../../core/state/model";
import { DefaultView, ViewPropsRO, Views } from "../../core/state/view";
import { FolderOpenIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { TComponentState } from "../../core/state/state";
import { api } from "../../../ipc/renderer/api";
import { settings } from "../../api/settings";
import { copyExampleScripts } from "../../api/library-service";

const nodefs = require("fs") as typeof import("fs");

const LibrarySetupDialogContent = styled(DialogContent)({
    minWidth: 400,
    maxWidth: 600,
    "& .setup-body": {
        padding: "16px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },
    "& .setup-label": {
        fontSize: 14,
        color: color.text.default,
    },
    "& .folder-row": {
        display: "flex",
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
    },
    "& .folder-input": {
        flex: "1 1 auto",
        height: 26,
        padding: "0 6px",
        fontSize: 13,
        fontFamily: "monospace",
        color: color.text.default,
        backgroundColor: color.background.dark,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        outline: "none",
        "&:focus": {
            borderColor: color.border.active,
        },
    },
    "& .browse-button": {
        flexShrink: 0,
        padding: "4px 12px",
        fontSize: 13,
    },
    "& .checkbox-row": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: color.text.default,
        cursor: "pointer",
        userSelect: "none",
    },
    "& .checkbox-hint": {
        fontSize: 11,
        color: color.text.light,
        marginLeft: 22,
    },
    "& .setup-buttons": {
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        columnGap: 8,
        padding: 8,
    },
    "& .dialog-button": {
        minWidth: 60,
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "4px 12px",
        "&:hover": {
            borderColor: color.border.active,
        },
    },
});

const librarySetupDialogId = Symbol("librarySetupDialog");

interface LibrarySetupDialogProps {
    title?: string;
}

const defaultProps: LibrarySetupDialogProps = {
    title: "Link Script Library",
};

class LibrarySetupDialogModel extends TDialogModel<LibrarySetupDialogProps, string | undefined> {
    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            this.close(undefined);
        }
    };
}

function LibrarySetupDialog({ model }: ViewPropsRO<LibrarySetupDialogModel>) {
    const state = model.state.use();
    const [folderPath, setFolderPath] = useState("");
    const [copyExamples, setCopyExamples] = useState(true);
    const [linking, setLinking] = useState(false);

    const handleBrowse = async () => {
        const result = await api.showOpenFolderDialog({
            title: "Select Script Library Folder",
        });
        if (result && result.length > 0) {
            setFolderPath(result[0]);
        }
    };

    const handleLink = async () => {
        const trimmed = folderPath.trim();
        if (!trimmed) return;

        setLinking(true);
        try {
            // Create folder if it doesn't exist
            if (!nodefs.existsSync(trimmed)) {
                nodefs.mkdirSync(trimmed, { recursive: true });
            }

            // Copy example scripts if requested
            if (copyExamples) {
                await copyExampleScripts(trimmed);
            }

            // Save setting
            settings.set("script-library.path", trimmed);
            model.close(trimmed);
        } catch (err: any) {
            const { ui } = await import("../../api/ui");
            ui.notify(`Failed to link library: ${err.message}`, "error");
            setLinking(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && folderPath.trim()) {
            e.preventDefault();
            handleLink();
        }
    };

    return (
        <Dialog onKeyDown={model.handleKeyDown} autoFocus={false}>
            <LibrarySetupDialogContent
                title={
                    <>
                        <FolderOpenIcon color={color.icon.default} /> {state.title}
                    </>
                }
                onClose={() => model.close(undefined)}
            >
                <div className="setup-body" onKeyDown={handleKeyDown}>
                    <div className="setup-label">Folder:</div>
                    <div className="folder-row">
                        <input
                            className="folder-input"
                            value={folderPath}
                            onChange={(e) => setFolderPath(e.target.value)}
                            placeholder="Select or type a folder path..."
                            autoFocus
                        />
                        <Button className="browse-button" onClick={handleBrowse}>
                            Browse...
                        </Button>
                    </div>
                    <label className="checkbox-row" >
                        <input
                            type="checkbox"
                            checked={copyExamples}
                            onChange={(e) => setCopyExamples(e.target.checked)}
                        />
                        Copy example scripts
                    </label>
                    <div className="checkbox-hint">
                        Won't overwrite existing files
                    </div>
                </div>
                <div className="setup-buttons">
                    <Button
                        className="dialog-button"
                        onClick={handleLink}
                        disabled={!folderPath.trim() || linking}
                    >
                        {linking ? "Linking..." : "Link"}
                    </Button>
                    <Button
                        className="dialog-button"
                        onClick={() => model.close(undefined)}
                    >
                        Cancel
                    </Button>
                </div>
            </LibrarySetupDialogContent>
        </Dialog>
    );
}

Views.registerView(librarySetupDialogId, LibrarySetupDialog as DefaultView);

export function showLibrarySetupDialog(props?: LibrarySetupDialogProps): Promise<string | undefined> {
    const modelState = {
        ...defaultProps,
        ...props,
    };

    const model = new LibrarySetupDialogModel(new TComponentState(modelState));
    return showDialog({
        viewId: librarySetupDialogId,
        model,
    }) as Promise<string | undefined>;
}
