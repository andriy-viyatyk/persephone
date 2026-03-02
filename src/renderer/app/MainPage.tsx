import styled from "@emotion/styled";
import color from "../theme/color";
import { FlexSpace } from "../components/layout/Elements";
import { Button } from "../components/basic/Button";
import {
    CloseIcon,
    JsNotepadIcon,
    WindowMaximizeIcon,
    WindowMinimizeIcon,
    WindowRestoreIcon,
} from "../theme/icons";
import { TComponentModel, useComponentModel } from "../core/state/model";
import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { Pages } from "./Pages";
import { PageTabs } from "../features/tabs/PageTabs";
import clsx from "clsx";
import { MenuBar } from "../features/sidebar/MenuBar";

const AppRoot = styled.div({
    backgroundColor: color.background.default,
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    "& .app-header": {
        display: "flex",
        flexDirection: "row",
        columnGap: 4,
        color: color.text.light,
        alignItems: "center",
        padding: "4px 0 0 8px",
        borderBottom: `1px solid ${color.border.light}`,
        position: "relative",
        backgroundColor: color.background.dark,
        WebkitAppRegion: "drag",
        "& button": {
            WebkitAppRegion: "no-drag", // Exclude buttons from drag region
        },
        "& .app-button": {
            flexShrink: 0,
            alignSelf: "flex-end",
            padding: 0,
            marginBottom: 3,
        },
        "& .system-button": {
            alignSelf: "flex-start",
            paddingTop: 0,
            marginTop: -4,
            height: 28,
            width: 40,
            borderRadius: 0,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: "default",
            "&.darkBackground:hover": {
                backgroundColor: color.background.light,
            },
            "&.close-button:hover": {
                backgroundColor: "#E81123",
                "& svg": {
                    color: "#FFFFFF",
                },
            },
        },
    },
    "& .app-content": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        "& .pages-container": {
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
        },
    },
    "& button.zoom-indicator": {
        fontSize: 12,
        padding: "2px 6px",
        borderRadius: 4,
        backgroundColor: color.background.light,
        display: "none",
        "&.visible": {
            display: "flex",
        },
    },
});

const defaultMainPageState = {
    maximized: false,
    menuBarOpen: false,
    zoomLevel: 0,
};

type MainPageState = typeof defaultMainPageState;

class MainPageModel extends TComponentModel<MainPageState, undefined> {
    init() {
        this.effect(() => {
            const sub = rendererEvents.eWindowMaximized.subscribe(
                (isMaximized) => {
                    this.state.update((s) => {
                        s.maximized = isMaximized;
                    });
                },
            );
            return () => sub.unsubscribe();
        });

        this.effect(() => {
            const sub = rendererEvents.eZoomChanged.subscribe(
                (zoomLevel) => {
                    this.state.update((s) => {
                        s.zoomLevel = zoomLevel;
                    });
                },
            );
            return () => sub.unsubscribe();
        });
    }

    minimizeWindow = () => {
        api.minimizeWindow();
    };

    toggleWindow = () => {
        if (this.state.get().maximized) {
            api.restoreWindow();
        } else {
            api.maximizeWindow();
        }
    };

    closeWindow = () => {
        api.closeWindow();
    };

    toggleMenuBar = () => {
        this.state.update((s) => {
            s.menuBarOpen = !s.menuBarOpen;
        });
    };

    resetZoom = () => {
        api.resetZoom();
    };
}

export function MainPage() {
    const model = useComponentModel(
        undefined,
        MainPageModel,
        defaultMainPageState,
    );
    const state = model.state.use();

    return (
        <AppRoot>
            <div className="app-header">
                <Button
                    onClick={model.toggleMenuBar}
                    type="icon"
                    className="app-button"
                >
                    <JsNotepadIcon />
                </Button>
                <PageTabs />
                <FlexSpace style={{ minWidth: 40 }} />
                <Button
                    size="small"
                    type="icon"
                    className={clsx("zoom-indicator", {
                        visible: state.zoomLevel,
                    })}
                    onClick={model.resetZoom}
                    title="Reset Zoom"
                >
                    {Math.round(Math.pow(1.2, state.zoomLevel) * 100)}%
                </Button>
                <Button
                    onClick={model.minimizeWindow}
                    className="system-button"
                    background="dark"
                >
                    <WindowMinimizeIcon />
                </Button>
                <Button
                    onClick={model.toggleWindow}
                    className="system-button"
                    background="dark"
                >
                    {state.maximized ? (
                        <WindowRestoreIcon />
                    ) : (
                        <WindowMaximizeIcon />
                    )}
                </Button>
                <Button
                    onClick={model.closeWindow}
                    className="system-button close-button"
                    background="dark"
                >
                    <CloseIcon />
                </Button>
            </div>
            <div className="app-content">
                <div className="pages-container">
                    <Pages />
                </div>
                <MenuBar
                    open={state.menuBarOpen}
                    onClose={model.toggleMenuBar}
                />
            </div>
        </AppRoot>
    );
}
