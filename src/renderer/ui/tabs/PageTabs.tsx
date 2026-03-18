import styled from "@emotion/styled";

import { pagesModel } from "../../api/pages";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    ChevronDownIcon,
    GlobeIcon,
    PlusIcon,
} from "../../theme/icons";
import { IncognitoIcon, GraphIcon, GridIcon, JavascriptIcon, TypescriptIcon, LinkIcon, NotebookIcon, TodoIcon, DrawIcon } from "../../theme/language-icons";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import { Button } from "../../components/basic/Button";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import { MenuItem } from "../../components/overlay/PopupMenu";
import { TComponentModel, useComponentModel } from "../../core/state/model";
import { useMemo } from "react";
import { settings } from "../../api/settings";
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
    const defaultProfileName = settings.use("browser-default-profile");
    const defaultBrowserColor = browserProfiles.find((p) => p.name === defaultProfileName)?.color || DEFAULT_BROWSER_COLOR;

    const addPageMenuItems = useMemo((): MenuItem[] => {
        const browserProfileSubmenu: MenuItem[] = [
            {
                label: "Incognito",
                icon: <IncognitoIcon />,
                onClick: async () => {
                    pagesModel.showBrowserPage({ incognito: true });
                },
            },
            ...browserProfiles.map((profile) => ({
                label: profile.name,
                icon: <GlobeIcon color={profile.color} />,
                onClick: async () => {
                    pagesModel.showBrowserPage({ profileName: profile.name });
                },
            })),
            {
                label: "Manage profiles...",
                startGroup: true,
                onClick: async () => {
                    pagesModel.showSettingsPage();
                },
            },
        ];

        return [
            {
                label: "Script (JS)",
                icon: <JavascriptIcon />,
                onClick: () => pagesModel.addEditorPage("monaco", "javascript", "untitled.js"),
            },
            {
                label: "Script (TS)",
                icon: <TypescriptIcon />,
                onClick: () => pagesModel.addEditorPage("monaco", "typescript", "untitled.ts"),
            },
            {
                label: "Grid (JSON)",
                icon: <GridIcon />,
                onClick: () => pagesModel.addEditorPage("grid-json", "json", "untitled.grid.json"),
            },
            {
                label: "Grid (CSV)",
                icon: <GridIcon />,
                onClick: () => pagesModel.addEditorPage("grid-csv", "csv", "untitled.grid.csv"),
            },
            {
                label: "Notebook",
                icon: <NotebookIcon />,
                onClick: () => pagesModel.addEditorPage("notebook-view", "json", "untitled.note.json"),
            },
            {
                label: "Todo",
                icon: <TodoIcon />,
                onClick: () => pagesModel.addEditorPage("todo-view", "json", "untitled.todo.json"),
            },
            {
                label: "Links",
                icon: <LinkIcon />,
                onClick: () => pagesModel.addEditorPage("link-view", "json", "untitled.link.json"),
            },
            {
                label: "Force Graph",
                icon: <GraphIcon />,
                onClick: () => pagesModel.addEditorPage("graph-view", "json", "untitled.fg.json"),
            },
            {
                label: "Drawing",
                icon: <DrawIcon />,
                onClick: () => pagesModel.addEditorPage("draw-view", "json", "untitled.excalidraw"),
            },
            {
                label: "Browser",
                icon: <GlobeIcon color={defaultBrowserColor} />,
                onClick: async () => {
                    pagesModel.showBrowserPage();
                },
            },
            {
                label: "Browser profile...",
                icon: <GlobeIcon color={defaultBrowserColor} />,
                items: browserProfileSubmenu,
            },
        ];
    }, [browserProfiles, defaultBrowserColor]);

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
                    const pageState = page.state.get();
                    let pinnedLeft: number | undefined;
                    if (pageState.pinned) {
                        pinnedLeft = 0;
                        for (const p of state.pages) {
                            if (p === page) break;
                            const ps = p.state.get();
                            if (ps.pinned) {
                                const isEnc = isTextFileModel(p) && (p.encripted || p.decripted);
                                pinnedLeft += (isEnc ? pinnedTabEncryptedWidth : pinnedTabWidth) + 2; // 2 = column gap
                            }
                        }
                    }
                    return <PageTab key={pageState.id} model={page} pinnedLeft={pinnedLeft} />;
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
