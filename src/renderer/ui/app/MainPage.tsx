import styled from "@emotion/styled";
import color from "../../theme/color";
import { FlexSpace } from "../../components/layout/Elements";
import { Button } from "../../components/basic/Button";
import {
    CloseIcon,
    JsNotepadIcon,
    WindowMaximizeIcon,
    WindowMinimizeIcon,
    WindowRestoreIcon,
} from "../../theme/icons";
import { app } from "../../api/app";
import { showMcpRequestLog } from "../../api/mcp-handler";
import { Pages } from "./Pages";
import { PageTabs } from "../tabs/PageTabs";
import clsx from "clsx";
import { MenuBar } from "../sidebar/MenuBar";

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
    "& .mcp-indicator": {
        position: "absolute",
        bottom: 1,
        right: 4,
        fontSize: 9,
        lineHeight: 1,
        color: color.text.light,
        opacity: 0.6,
        display: "flex",
        alignItems: "center",
        gap: 3,
        WebkitAppRegion: "no-drag",
        pointerEvents: "auto",
        cursor: "pointer",
        "&:hover": {
            opacity: 1,
        },
        "& .mcp-dot": {
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: color.misc.green,
        },
        "& .mcp-count": {
            marginLeft: 1,
            fontSize: 11,
            color: color.misc.green,
        },
    },
});

export function MainPage() {
    const state = app.window.use();

    return (
        <AppRoot>
            <div className="app-header">
                <Button
                    onClick={() => app.window.toggleMenuBar()}
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
                    onClick={() => app.window.resetZoom()}
                    title="Reset Zoom"
                >
                    {Math.round(Math.pow(1.2, state.zoomLevel) * 100)}%
                </Button>
                <Button
                    onClick={() => app.window.minimize()}
                    className="system-button"
                    background="dark"
                >
                    <WindowMinimizeIcon />
                </Button>
                <Button
                    onClick={() => app.window.toggleWindow()}
                    className="system-button"
                    background="dark"
                >
                    {state.isMaximized ? (
                        <WindowRestoreIcon />
                    ) : (
                        <WindowMaximizeIcon />
                    )}
                </Button>
                <Button
                    onClick={() => app.window.close()}
                    className="system-button close-button"
                    background="dark"
                >
                    <CloseIcon />
                </Button>
                {state.mcpRunning && (
                    <span
                        className="mcp-indicator"
                        title={state.mcpClientCount > 0
                            ? `MCP is active, ${state.mcpClientCount} active connection${state.mcpClientCount !== 1 ? "s" : ""} — click to view request log`
                            : "MCP server is running — click to view request log"
                        }
                        onClick={() => showMcpRequestLog()}
                    >
                        {state.mcpClientCount > 0
                            ? <><span className="mcp-count">{state.mcpClientCount}</span> MCP</>
                            : <><span className="mcp-dot" /> MCP</>
                        }
                    </span>
                )}
            </div>
            <div className="app-content">
                <div className="pages-container">
                    <Pages />
                </div>
                <MenuBar
                    open={state.menuBarOpen}
                    onClose={() => app.window.toggleMenuBar()}
                />
            </div>
        </AppRoot>
    );
}
