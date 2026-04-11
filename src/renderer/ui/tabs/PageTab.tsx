import styled from "@emotion/styled";
import clsx from "clsx";

import color from "../../theme/color";
import { pagesModel } from "../../api/pages";
import { appWindow } from "../../api/window";
import { settings } from "../../api/settings";
import type { PageModel } from "../../api/pages/PageModel";
import { Button } from "../../components/basic/Button";
import {
    CircleIcon,
    CloseIcon,
    CopyIcon,
    DuplicateIcon,
    FolderOpenIcon,
    GroupIcon,
    KeyOffIcon,
    LockIcon,
    RenameIcon,
    SaveIcon,
    UnlockIcon,
    VolumeIcon,
    VolumeMutedIcon,
} from "../../theme/icons";
import { LanguageIcon } from "../../components/icons/LanguageIcon";
import { TComponentModel, useComponentModel } from "../../core/state/model";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import { ContextMenuEvent } from "../../api/events/events";
import { monacoLanguages } from "../../core/utils/monaco-languages";
import { useDrag, useDrop } from "react-dnd";
import { useMemo } from "react";
import { api } from "../../../ipc/renderer/api";
import {
    isTextFileModel,
    TextFileModel,
} from "../../editors/text";
import { Tooltip } from "../../components/basic/Tooltip";
import { PageDragData } from "../../../shared/types";
import { parseObject } from "../../core/utils/parse-utils";
import { ui } from "../../api/ui";
import { useOptionalState } from "../../core/state/state";

export const minTabWidth = 80;
const ICON_SLOT = 20; // padding(2) + icon(16) + padding(2)
const TAB_PADDING = 4; // 2px left + 2px right
export const pinnedTabWidth = 2 * ICON_SLOT + TAB_PADDING; // language + modified dot
export const pinnedTabEncryptedWidth = 3 * ICON_SLOT + TAB_PADDING; // language + encryption + modified dot

const PageTabRoot = styled.div({
    display: "flex",
    alignItems: "center",
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    border: `1px solid transparent`,
    borderBottom: "none",
    padding: "4px 2px 3px 2px",
    minHeight: 22,
    WebkitAppRegion: "no-drag",
    userSelect: "none",
    width: 200,
    minWidth: minTabWidth,
    flexShrink: 1,
    overflow: "hidden",
    "& .title-label": {
        flex: "1 1 auto",
        fontSize: 13,
        color: color.text.light,
        flexShrink: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "&.temp .title-label": {
        fontStyle: "italic",
    },
    "&.deleted .title-label": {
        color: color.misc.red,
    },
    "&.deleted .modified-icon": {
        color: color.misc.red,
    },
    "& .close-button": {
        flexShrink: 0,
        visibility: "hidden",
    },
    "& .sound-button": {
        flexShrink: 0,
        visibility: "hidden",
        "&.sound-active": {
            visibility: "visible",
        },
    },
    "&.isActive": {
        backgroundColor: color.background.default,
        borderColor: color.border.default,
        color: color.text.default,
        "&:not(.deleted) .title-label": {
            color: color.text.default,
        },
        "& .close-button": {
            visibility: "visible",
        },
    },
    "&:hover": {
        borderColor: color.border.default,
        "& .close-button": {
            visibility: "visible",
        },
        "& .sound-button": {
            visibility: "visible",
        },
    },
    "&.isDraggOver": {
        backgroundColor: color.background.default,
    },
    "& .modified-icon": {
        display: "none",
    },
    "&.modified .close-button": {
        visibility: "visible",
    },
    "&.modified:not(:hover)": {
        "& .modified-icon": {
            display: "inline-block",
        },
        "& .close-icon": {
            display: "none",
        },
    },
    "& .encryption-icon": {
        paddingBottom: 4,
        marginRight: 2,
    },
    "& .empty-language": {
        width: 6,
        height: 14,
        flexShrink: 0,
        "&.withIcon": {
            width: 15,
            margin: "0 4px 0 4px",
            "& svg, & img": {
                width: 15,
                height: 15,
            }
        },
    },
    "&:not(.isActive) > button": {
        cursor: "default",
    },
    "&.pinned": {
        width: pinnedTabWidth,
        minWidth: pinnedTabWidth,
        flexShrink: 0,
        position: "sticky",
        zIndex: 1,
        backgroundColor: color.background.dark,
        "&.isActive, &.isDraggOver": {
            backgroundColor: color.background.default,
        },
        "& .title-label": {
            flex: "0 0 auto",
        },
        "& .close-button": {
            visibility: "visible",
            pointerEvents: "none",
        },
        "& .close-icon": {
            display: "none",
        },
    },
    "&.pinned.grouped .close-button": {
        pointerEvents: "auto",
    },
    "&.pinned.grouped .close-icon": {
        display: "inline-block",
    },
    "&.pinned.modified .modified-icon": {
        display: "inline-block",
    },
    "&.pinned-encrypted": {
        width: pinnedTabEncryptedWidth,
        minWidth: pinnedTabEncryptedWidth,
    },
    "& .pinned-tooltip-trigger": {
        position: "absolute",
        inset: 0,
    },
    "&.pinned > *:not(.pinned-tooltip-trigger)": {
        position: "relative",
        zIndex: 1,
    },
});

interface PageTabProps {
    model: PageModel;
    pinnedLeft?: number;
}

class PageTabModel extends TComponentModel<null, PageTabProps> {
    isActive = false;
    isGrouped = false;

    private setActiveLanuage = (langId: string) => {
        const currentActive = settings.get("tab-recent-languages");
        const newActive = [
            langId,
            ...currentActive.filter((l) => l !== langId),
        ];
        settings.set("tab-recent-languages", newActive);
    };

    getLanguageMenuItems = (): MenuItem[] => {
        const editor = this.props.model.mainEditor;
        if (!editor) return [];
        const currLang = editor.state.get().language;
        const activeLanguages = settings.get("tab-recent-languages");
        const menuItems: MenuItem[] = monacoLanguages
            .map((lang) => ({
                id: lang.id,
                label: lang.aliases[0] || lang.id,
                icon: <LanguageIcon language={lang.id} />,
                onClick: () => {
                    editor.changeLanguage(lang.id);
                    this.setActiveLanuage(lang.id);
                },
                selected: currLang === lang.id,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        const firstItem = menuItems.find((item) => item.id === "plaintext");
        const activeItems = menuItems.filter(
            (item) =>
                item.id !== "plaintext" && activeLanguages.includes(item.id)
        );
        activeItems.sort((a, b) => {
            return (
                activeLanguages.indexOf(a.id) - activeLanguages.indexOf(b.id)
            );
        });
        const inactiveItems = menuItems.filter(
            (item) =>
                item.id !== "plaintext" && !activeLanguages.includes(item.id)
        );

        return [
            ...(firstItem ? [firstItem] : []),
            ...activeItems,
            ...inactiveItems,
        ];
    };

    handleContextMenu = (e: React.MouseEvent) => {
        const page = this.props.model;
        const editor = page.mainEditor;
        const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "page-tab");
        const isPinned = page.pinned;
        const pinUnpinItem: MenuItem = {
            label: isPinned ? "Unpin Tab" : "Pin Tab",
            onClick: () => {
                if (isPinned) {
                    pagesModel.unpinTab(page.id);
                } else {
                    pagesModel.pinTab(page.id);
                }
            },
        };
        const menuItems: MenuItem[] = [];
        if (isPinned) {
            menuItems.push(pinUnpinItem);
        }
        if (!isPinned) {
            menuItems.push({
                label: "Close Tab",
                onClick: () => {
                    page.close();
                },
                startGroup: !isPinned && menuItems.length > 0,
            });
        }
        menuItems.push({
            label: "Close Other Tabs",
            disabled: pagesModel.state.get().pages.length <= 1,
            onClick: () => {
                pagesModel.closeOtherPages(page.id);
            },
            startGroup: isPinned,
        });
        if (!isPinned) {
            menuItems.push(
                {
                    label: "Close Tabs to the Right",
                    disabled: pagesModel.isLastPage(page.id),
                    onClick: () => {
                        pagesModel.closeToTheRight(page.id);
                    },
                },
                {
                    label: "Open in New Window",
                    onClick: () => {
                        api.addDragEvent(this.getDragData());
                    },
                },
            );
        }
        menuItems.push({
            label: "Duplicate Tab",
            icon: <DuplicateIcon />,
            onClick: () => {
                pagesModel.duplicatePage(page.id);
            },
            startGroup: isPinned,
        });
        if (!isPinned) {
            menuItems.push({
                ...pinUnpinItem,
                startGroup: true,
            });
        }
        menuItems.push(
            {
                startGroup: true,
                label: "Save",
                icon: <SaveIcon />,
                onClick: () => {
                    if (editor instanceof TextFileModel) {
                        editor.saveFile(false);
                    }
                },
                disabled: !(editor instanceof TextFileModel),
            },
            {
                label: "Save As...",
                icon: <SaveIcon />,
                onClick: () => {
                    if (editor instanceof TextFileModel) {
                        editor.saveFile(true);
                    }
                },
                disabled: !(editor instanceof TextFileModel),
            },
            {
                label: "Rename",
                icon: <RenameIcon />,
                onClick: this.renameTab,
                disabled: !editor || !isTextFileModel(editor),
            },
            {
                label: "Show in File Explorer",
                icon: <FolderOpenIcon />,
                onClick: () => {
                    api.showItemInFolder(
                        (editor?.state.get() as any).filePath
                    );
                },
                disabled: !(editor?.state.get() as any)?.filePath,
            },
            {
                label: "Copy File Path",
                icon: <CopyIcon />,
                onClick: () => {
                    navigator.clipboard.writeText(
                        (editor?.state.get() as any).filePath
                    );
                },
                disabled: !(editor?.state.get() as any)?.filePath,
            },
            {
                label: "Decrypt",
                icon: <UnlockIcon />,
                onClick: () => {
                    if (editor && isTextFileModel(editor)) {
                        editor.showEncryptionDialog();
                    }
                },
                disabled: !(
                    editor && isTextFileModel(editor) &&
                    editor.encrypted
                ),
                startGroup: true,
            },
            {
                label:
                    editor && isTextFileModel(editor) &&
                    !editor.withEncryption
                        ? "Encrypt"
                        : "Change Password",
                icon: <LockIcon />,
                onClick: () => {
                    if (editor && isTextFileModel(editor)) {
                        editor.showEncryptionDialog();
                    }
                },
                disabled:
                    !editor || !isTextFileModel(editor) ||
                    editor.encrypted,
            },
            {
                label: "Make Unencrypted",
                icon: <KeyOffIcon />,
                onClick: () => {
                    if (editor && isTextFileModel(editor)) {
                        editor.makeUnencrypted();
                    }
                },
                disabled:
                    !editor || !isTextFileModel(editor) ||
                    !editor.decrypted,
            },
        );
        ctxEvent.items.push(...menuItems);
    };

    private getDragData = (drop = false): PageDragData => {
        const page = this.props.model;
        const editor = page.mainEditor;
        return {
            sourceWindowIndex: drop ? undefined : appWindow.windowIndex,
            targetWindowIndex: drop ? appWindow.windowIndex : undefined,
            page: {
                id: page.id,
                pinned: page.pinned,
                modified: page.modified,
                hasSidebar: page.hasSidebar,
                editor: editor?.getRestoreData() ?? {},
            },
        };
    };

    private renameTab = async () => {
        const editor = this.props.model.mainEditor;
        if (editor && isTextFileModel(editor)) {
            const pageTitle = editor.state.get().title;
            const inputResult = await ui.input("Enter new file name:", {
                title: "Rename File",
                value: pageTitle,
                buttons: ["Rename", "Cancel"],
                selectAll: true,
            });
            if (inputResult?.button === "Rename" && inputResult.value) {
                const newName = inputResult.value;
                await editor.renameFile(newName);
            }
        }
    }

    handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData(
            "application/persephone-tab",
            JSON.stringify(this.getDragData())
        );
        e.dataTransfer.effectAllowed = "move";
    };

    handleDragEnd = (e: React.DragEvent) => {
        const droppedOutside =
            e.clientX < 0 ||
            e.clientX > window.innerWidth ||
            e.clientY < 0 ||
            e.clientY > window.innerHeight;
        if (droppedOutside) {
            const dropData: PageDragData = this.getDragData();
            dropData.dropPosition = { x: e.screenX, y: e.screenY };
            api.addDragEvent(dropData);
        }
    };

    handleDrop = (e: React.DragEvent) => {
        const dataStr = e.dataTransfer?.getData("application/persephone-tab");
        const data = parseObject(dataStr);
        if (
            data &&
            data.sourceWindowIndex !== undefined &&
            data.sourceWindowIndex !== appWindow.windowIndex
        ) {
            api.addDragEvent(this.getDragData(true));
            e.preventDefault();
            e.stopPropagation();
        }
    };

    closeClick = () => {
        const page = this.props.model;
        if (this.isGrouped) {
            pagesModel.ungroup(page.id);
            pagesModel.fixCompareMode();
            pagesModel.showPage(page.id);
        } else {
            page.close();
        }
    };

    handleClick = (e: React.MouseEvent) => {
        const pageId = this.props.model.id;
        if (e.ctrlKey) {
            const activeId = pagesModel.activePage?.id;
            if (activeId !== pageId) {
                pagesModel.groupTabs(activeId, pageId, true);
            }
        }

        pagesModel.showPage(pageId);
    };

    encryptionClick = () => {
        const editor = this.props.model.mainEditor;
        if (editor && isTextFileModel(editor)) {
            if (editor.encrypted) {
                editor.showEncryptionDialog();
            } else if (editor.decrypted) {
                editor.encryptWithCurrentPassword();
            }
        }
    };
}

export function PageTab(props: PageTabProps) {
    const tabModel = useComponentModel(props, PageTabModel, null);
    const page = props.model;
    const editor = page.mainEditor;
    tabModel.isGrouped = pagesModel.isGrouped(page.id);
    tabModel.isActive =
        pagesModel.activePage === page || pagesModel.groupedPage === page;

    const { pinned, mainEditorId: _mainEditorId } = page.state.use((s) => ({ pinned: s.pinned, mainEditorId: s.mainEditorId }));

    const editorState = editor?.state ?? null;
    const { title, modified, language, filePath, deleted, temp, _anyTabAudible, _pageMuted } =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useOptionalState(editorState as any, (s: any) => ({
            title: s.title,
            modified: s.modified,
            language: s.language,
            filePath: s.filePath,
            deleted: s.deleted ?? false,
            password: s.password,
            encrypted: s.encrypted ?? false,
            temp: s.temp ?? false,
            _iconHint: s.favicon ?? "",
            _anyTabAudible: s._anyTabAudible ?? false,
            _pageMuted: s.pageMuted ?? false,
        }), { title: "Empty", modified: false, language: "", filePath: "", deleted: false, temp: false, _anyTabAudible: false, _pageMuted: false });

    const id = page.id;

    const [{ isDragging }, drag] = useDrag({
        type: "COLUMN_DRAG",
        item: { key: id },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
        canDrag: () => true,
    });

    const [{ isOver }, drop] = useDrop({
        accept: ["COLUMN_DRAG", "FREEZE_DRAG"],
        drop({ key: dropKey }: { key: string }) {
            pagesModel.moveTab(dropKey, id);
        },
        collect: (monitor) => ({
            isOver: monitor.isOver(),
            canDrop: monitor.canDrop(),
        }),
        canDrop: () => true,
    });

    const activeLanguages = settings.use("tab-recent-languages");
    const languageMenuItems = useMemo(
        () => tabModel.getLanguageMenuItems(),
        [language, activeLanguages]
    );

    const encrypted = editor && isTextFileModel(editor) && editor.encrypted;
    const decrypted = editor && isTextFileModel(editor) && editor.decrypted;
    const isPinnedEncrypted = pinned && (encrypted || decrypted);

    return (
        <PageTabRoot
            ref={(node) => {
                drag(node);
                drop(node);
            }}
            className={clsx("page-tab", {
                isActive: tabModel.isActive,
                modified,
                isDraggOver: isOver,
                temp,
                deleted,
                pinned,
                grouped: tabModel.isGrouped,
                "pinned-encrypted": isPinnedEncrypted,
            })}
            style={pinned && props.pinnedLeft !== undefined ? { left: props.pinnedLeft } : undefined}
            onClick={tabModel.handleClick}
            onContextMenu={tabModel.handleContextMenu}
            draggable={!pinned}
            onDragStart={pinned ? undefined : tabModel.handleDragStart}
            onDragEnd={pinned ? undefined : tabModel.handleDragEnd}
            onDrop={pinned ? undefined : tabModel.handleDrop}
        >
            {pinned && filePath && (
                <span className="pinned-tooltip-trigger" data-tooltip-id={id} />
            )}
            {editor?.noLanguage ? (
                <span
                    className={clsx("empty-language", {
                        withIcon: editor.getIcon,
                    })}
                >
                    {editor.getIcon ? editor.getIcon() : null}
                </span>
            ) : (
                <WithPopupMenu items={languageMenuItems}>
                    {(setOpen) => (
                        <Button
                            size="small"
                            type="icon"
                            onClick={(e) => {
                                if (!tabModel.isActive && e.ctrlKey) {
                                    tabModel.handleClick(e);
                                    return;
                                }
                                pagesModel.showPage(page.id);
                                if (tabModel.isActive) {
                                    setOpen(e.currentTarget);
                                }
                            }}
                            title={language}
                        >
                            <LanguageIcon
                                language={language}
                                fileName={title}
                            />
                        </Button>
                    )}
                </WithPopupMenu>
            )}
            <span className="title-label" data-tooltip-id={pinned ? undefined : id}>
                {(encrypted || decrypted) && (
                    <span
                        className="encryption-icon"
                        onClick={tabModel.encryptionClick}
                        title={encrypted ? "Decrypt File" : "Encrypt File"}
                    >
                        {encrypted ? "🔒" : "🔓"}
                    </span>
                )}
                {!pinned && title}
            </span>
            {(_anyTabAudible || _pageMuted || (editor as any)?.toggleMuteAll) && (
                <Button
                    size="small"
                    type="icon"
                    className={clsx("sound-button", { "sound-active": _anyTabAudible || _pageMuted })}
                    onClick={(e) => {
                        e.stopPropagation();
                        (editor as any)?.toggleMuteAll?.();
                    }}
                    title={_pageMuted ? "Unmute Page" : "Mute Page"}
                    background={tabModel.isActive ? "default" : "dark"}
                >
                    {_pageMuted ? <VolumeMutedIcon /> : <VolumeIcon />}
                </Button>
            )}
            <Button
                size="small"
                type="icon"
                onClick={tabModel.closeClick}
                title={tabModel.isGrouped ? "Ungroup" : "Close Page"}
                className="close-button"
                background={tabModel.isActive ? "default" : "dark"}
            >
                {tabModel.isGrouped ? (
                    <GroupIcon className="close-icon" />
                ) : (
                    <CloseIcon className="close-icon" />
                )}
                <CircleIcon className="modified-icon" />
            </Button>
            {filePath && (
                <Tooltip id={id} place="bottom" delayShow={1500}>
                    {filePath}
                </Tooltip>
            )}
        </PageTabRoot>
    );
}
