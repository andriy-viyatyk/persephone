import styled from "@emotion/styled";
import color from "../../theme/color";
import { Popper } from "../../components/overlay/Popper";
import { Button } from "../../components/basic/Button";
import { CloseIcon, FolderOpenIcon } from "../../theme/icons";
import { downloadsStore } from "../../store/downloads-store";
import { DownloadEntry } from "../../../ipc/api-param-types";

function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

const PopupContent = styled.div({
    width: 320,
    display: "flex",
    flexDirection: "column",

    "& .downloads-header": {
        display: "flex",
        alignItems: "center",
        padding: "8px 12px",
        borderBottom: `1px solid ${color.border.light}`,
        "& .downloads-title": {
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: color.text.default,
        },
    },

    "& .downloads-list": {
        overflow: "auto",
        maxHeight: 400,
    },

    "& .download-item": {
        display: "flex",
        flexDirection: "column",
        padding: "8px 12px",
        gap: 4,
        borderBottom: `1px solid ${color.border.light}`,
        "&:last-child": {
            borderBottom: "none",
        },
    },

    "& .download-row": {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },

    "& .download-filename": {
        flex: 1,
        fontSize: 13,
        color: color.text.default,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    "& .download-status": {
        fontSize: 12,
        color: color.text.light,
        whiteSpace: "nowrap",
    },

    "& .download-progress-bar": {
        height: 3,
        borderRadius: 2,
        backgroundColor: color.border.light,
        overflow: "hidden",
        "& .download-progress-fill": {
            height: "100%",
            borderRadius: 2,
            backgroundColor: color.border.active,
            transition: "width 0.3s ease",
        },
    },

    "& .download-actions": {
        display: "flex",
        gap: 4,
        "& button": {
            fontSize: 12,
            padding: "1px 6px",
        },
    },

    "& .download-error": {
        fontSize: 12,
        color: color.error.text,
    },

    "& .downloads-empty": {
        padding: "24px 12px",
        textAlign: "center",
        fontSize: 13,
        color: color.text.light,
    },
});

interface BrowserDownloadsPopupProps {
    anchorEl: HTMLElement | null;
    onClose: () => void;
}

export function BrowserDownloadsPopup({ anchorEl, onClose }: BrowserDownloadsPopupProps) {
    const downloads = downloadsStore.state.use((s) => s.downloads);
    const hasCompleted = downloads.some((d) => d.status !== "downloading");

    return (
        <Popper
            open={!!anchorEl}
            elementRef={anchorEl}
            placement="bottom-end"
            offset={[0, 4]}
            onClose={onClose}
        >
            <PopupContent>
                <div className="downloads-header">
                    <span className="downloads-title">Downloads</span>
                    {hasCompleted && (
                        <Button
                            size="small"
                            type="flat"
                            onClick={downloadsStore.clearCompleted}
                        >
                            Clear
                        </Button>
                    )}
                </div>
                <div className="downloads-list">
                    {downloads.length === 0 ? (
                        <div className="downloads-empty">No downloads</div>
                    ) : (
                        downloads.map((dl) => (
                            <DownloadItem key={dl.id} entry={dl} />
                        ))
                    )}
                </div>
            </PopupContent>
        </Popper>
    );
}

function DownloadItem({ entry }: { entry: DownloadEntry }) {
    const { id, filename, status, receivedBytes, totalBytes, error } = entry;
    const isDownloading = status === "downloading";
    const progress = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;

    const statusText = isDownloading
        ? `${formatBytes(receivedBytes)} / ${totalBytes > 0 ? formatBytes(totalBytes) : "?"}`
        : status === "completed"
          ? formatBytes(totalBytes)
          : status === "cancelled"
            ? "Cancelled"
            : "Failed";

    return (
        <div className="download-item" title={entry.savePath || filename}>
            <div className="download-row">
                <span className="download-filename">{filename}</span>
                <span className="download-status">{statusText}</span>
            </div>
            {isDownloading && (
                <div className="download-progress-bar">
                    <div
                        className="download-progress-fill"
                        style={{ width: `${progress * 100}%` }}
                    />
                </div>
            )}
            {error && status === "failed" && (
                <div className="download-error">{error}</div>
            )}
            <div className="download-actions">
                {isDownloading && (
                    <Button
                        size="small"
                        type="flat"
                        onClick={() => downloadsStore.cancelDownload(id)}
                    >
                        Cancel
                    </Button>
                )}
                {status === "completed" && (
                    <>
                        <Button
                            size="small"
                            type="flat"
                            onClick={() => downloadsStore.openDownload(id)}
                        >
                            Open
                        </Button>
                        <Button
                            size="small"
                            type="icon"
                            title="Show in Folder"
                            onClick={() => downloadsStore.showInFolder(id)}
                        >
                            <FolderOpenIcon />
                        </Button>
                    </>
                )}
                {(status === "failed" || status === "cancelled") && (
                    <Button
                        size="small"
                        type="icon"
                        title="Dismiss"
                        onClick={() => downloadsStore.clearCompleted()}
                    >
                        <CloseIcon />
                    </Button>
                )}
            </div>
        </div>
    );
}
