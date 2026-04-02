import styled from "@emotion/styled";

import { pagesModel } from "../../api/pages";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    ChevronDownIcon,
    PlusIcon,
} from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import { MenuItem } from "../../components/overlay/PopupMenu";
import { TComponentModel, useComponentModel } from "../../core/state/model";
import { useMemo } from "react";
import { settings } from "../../api/settings";
import { app } from "../../api/app";
import { DEFAULT_PINNED_EDITORS, getCreatableItems } from "../sidebar/tools-editors-registry";
import { minTabWidth, PageTab, pinnedTabWidth, pinnedTabEncryptedWidth } from "./PageTab";
import color from "../../theme/color";
import { isTextFileModel } from "../../editors/text";

const PageTabsRoot = styled.div({
    display: "flex",
    alignItems: "center",
    alignSelf: "flex-end",
    columnGap: 2,
    paddingTop: 6,
    overflow: "hidden",
    marginLeft: 4,
    "& .tabs-wrapper": {
        display: "flex",
        alignItems: "center",
        columnGap: 2,
        overflowX: "auto",
        overflowY: "hidden",
        scrollBehavior: "smooth",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": {
            display: "none",
        },
    },
    "& .add-page-split": {
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        height: 26,
        marginLeft: 2,
        "& button": {
            height: 26,
            borderRadius: 0,
        },
        "& button.add-page-main": {
            borderRadius: "4px 0 0 4px",
            padding: "0 3px",
        },
        "& button.add-page-dropdown": {
            borderRadius: "0 4px 4px 0",
            padding: "0 1px",
            minWidth: 14,
            "& svg": {
                width: 13,
                height: 13,
                opacity: 0.5,
            },
            "&:hover svg": {
                opacity: 1,
            },
        },
        "& .split-divider": {
            width: 1,
            height: 16,
            backgroundColor: color.border.default,
            flexShrink: 0,
        },
    },
});

const defaultTabsState = {
    showScrollButtons: false,
};

type TabsState = typeof defaultTabsState;

class TabsModel extends TComponentModel<TabsState, object> {
    scrollingDiv: HTMLDivElement | null = null;
    resizeObserver: ResizeObserver | null = null;

    init() {
        this.effect(() => {
            this.checkScrollButtons();
            this.scrollToActive();
        }, () => [pagesModel.state.get().pages.length]);
    }

    dispose() {
        this.scrollingDiv?.removeEventListener('wheel', this.handleWheel);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    setScrollingDiv = (el: HTMLDivElement | null) => {
        this.scrollingDiv = el;
        if (el) {
            el.addEventListener('wheel', this.handleWheel, { passive: false });
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
            }
            this.resizeObserver = new ResizeObserver(this.checkScrollButtons);
            this.resizeObserver.observe(el);
        }
    };

    handleWheel = (event: WheelEvent) => {
        if (!this.scrollingDiv) return;

        if (this.scrollingDiv.scrollWidth > this.scrollingDiv.clientWidth) {
            event.preventDefault();
            this.scrollingDiv.scrollLeft += event.deltaY;
        }
    };

    checkScrollButtons = () => {
        if (!this.scrollingDiv) return;
        const hasOverflow =
            this.scrollingDiv.scrollWidth > this.scrollingDiv.clientWidth;
        this.state.update((s) => {
            s.showScrollButtons = hasOverflow;
        });
    };

    scrollLeft = () => {
        if (!this.scrollingDiv) return;
        this.scrollingDiv.scrollBy({
            left: -minTabWidth,
            behavior: "smooth",
        });
    };

    scrollRight = () => {
        if (!this.scrollingDiv) return;
        this.scrollingDiv.scrollBy({
            left: minTabWidth,
            behavior: "smooth",
        });
    };

    scrollToActive = () => {
        if (!this.scrollingDiv) return;

        const activeTab = this.scrollingDiv.querySelector(".page-tab.isActive");
        if (!activeTab) return;

        activeTab.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
        });
    };
}

export function PageTabs(props: object) {
    const model = useComponentModel(props, TabsModel, defaultTabsState);
    const tabsState = model.state.use();
    const state = pagesModel.state.use();

    const browserProfiles = settings.use("browser-profiles");
    const pinnedIds: string[] = settings.use("pinned-editors") ?? DEFAULT_PINNED_EDITORS;

    const addPageMenuItems = useMemo((): MenuItem[] => {
        const allItems = getCreatableItems(browserProfiles);
        const pinned = pinnedIds
            .map((id) => allItems.find((item) => item.id === id))
            .filter(Boolean);

        return [
            ...pinned.map((item) => ({
                label: item!.label,
                icon: item!.icon,
                onClick: item!.create,
            })),
            {
                label: "Show All…",
                startGroup: true,
                onClick: () => app.window.openMenuBar("tools-editors"),
            },
        ];
    }, [browserProfiles, pinnedIds]);

    return (
        <PageTabsRoot className="page-tabs">
            {tabsState.showScrollButtons && (
                <Button
                    onClick={model.scrollLeft}
                    size="small"
                    background="dark"
                >
                    <ArrowLeftIcon />
                </Button>
            )}
            <div
                className="tabs-wrapper"
                ref={model.setScrollingDiv}
            >
                {state.pages?.map((page) => {
                    let pinnedLeft: number | undefined;
                    if (page.pinned) {
                        pinnedLeft = 0;
                        for (const p of state.pages) {
                            if (p === page) break;
                            if (p.pinned) {
                                const editor = p.mainEditor;
                                const isEnc = editor && isTextFileModel(editor) && (editor.encrypted || editor.decrypted);
                                pinnedLeft += (isEnc ? pinnedTabEncryptedWidth : pinnedTabWidth) + 2; // 2 = column gap
                            }
                        }
                    }
                    return <PageTab key={page.id} model={page} pinnedLeft={pinnedLeft} />;
                })}
            </div>
            {tabsState.showScrollButtons && (
                <Button
                    onClick={model.scrollRight}
                    size="small"
                    background="dark"
                >
                    <ArrowRightIcon />
                </Button>
            )}
            <div className="add-page-split">
                <Button
                    size="medium"
                    onClick={() => pagesModel.addEmptyPage()}
                    title="Add Page (Ctrl+N)"
                    className="add-page-main"
                    background="dark"
                >
                    <PlusIcon />
                </Button>
                <div className="split-divider" />
                <WithPopupMenu items={addPageMenuItems}>
                    {(setOpen) => (
                        <Button
                            size="medium"
                            onClick={(e) => setOpen(e.currentTarget)}
                            title="New editor page"
                            className="add-page-dropdown"
                            background="dark"
                        >
                            <ChevronDownIcon />
                        </Button>
                    )}
                </WithPopupMenu>
            </div>
        </PageTabsRoot>
    );
}
