import { fpBasename } from "../../core/utils/file-path";
import { forwardRef, useCallback, useEffect, useMemo } from "react";
import { pagesModel } from "../../api/pages";
import { recent } from "../../api/recent";
import { FileListItem, FileList, FileListRef } from "./FileList";
import { MenuItem } from "../../components/overlay/PopupMenu";
import { api } from "../../../ipc/renderer/api";
import {
    FolderOpenIcon,
    NewWindowIcon,
    OpenFileIcon,
    RemoveIcon,
} from "../../theme/icons";

interface RecentFileListProps {
    onClose?: () => void;
}

export const RecentFileList = forwardRef<FileListRef, RecentFileListProps>(
    function RecentFileList(props, ref) {
        useEffect(() => {
            recent.load();
        }, []);

        const files = recent.useFiles();

        const items = useMemo(() => {
            const fileItems: FileListItem[] = files.map((filePath) => ({
                filePath,
                title: fpBasename(filePath),
            }));
            return fileItems;
        }, [files]);

        const onItemClick = useCallback(
            (item: FileListItem) => {
                pagesModel.openFile(item.filePath);
                props.onClose?.();
            },
            [props.onClose]
        );

        const getItemContextMenu = useCallback((item: FileListItem) => {
            const menuItems: MenuItem[] = [
                {
                    label: "Open",
                    icon: <OpenFileIcon />,
                    onClick: () => {
                        pagesModel.openFile(item.filePath);
                        props.onClose?.();
                    },
                },
                {
                    label: "Open in New Window",
                    icon: <NewWindowIcon />,
                    onClick: () => pagesModel.openPathInNewWindow(item.filePath),
                    invisible: item.isFolder,
                },
                {
                    label: "Show in File Explorer",
                    icon: <FolderOpenIcon />,
                    onClick: () => { api.showItemInFolder(item.filePath); },
                },
                {
                    label: "Remove from Recent",
                    icon: <RemoveIcon />,
                    onClick: async () => {
                        await recent.remove(item.filePath);
                    },
                }
            ];
            return menuItems;
        }, []);

        return (
            <FileList
                ref={ref}
                items={items}
                onClick={onItemClick}
                getContextMenu={getItemContextMenu}
            />
        );
    }
);
