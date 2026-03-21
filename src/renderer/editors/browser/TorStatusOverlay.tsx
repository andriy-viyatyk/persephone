/**
 * Tor status overlay — shown over browser content while Tor is connecting,
 * on error, or when the user clicks the Tor indicator in the URL bar.
 */
import { useEffect, useRef } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { TorIcon } from "../../theme/language-icons";
import { TOR_BROWSER_COLOR } from "../../theme/palette-colors";
import { CloseIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import type { BrowserPageModel } from "./BrowserPageModel";

interface TorStatusOverlayProps {
    model: BrowserPageModel;
    torStatus: "disconnected" | "connecting" | "connected" | "error";
    torLog: string;
}

function TorStatusOverlayComponent({ model, torStatus, torLog }: TorStatusOverlayProps) {
    const logRef = useRef<HTMLPreElement>(null);

    // Auto-scroll log to bottom
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [torLog]);

    const canClose = torStatus === "connected";
    const showReconnect = torStatus === "disconnected" || torStatus === "error";
    const showSpinner = torStatus === "connecting";

    return (
        <TorOverlayRoot>
            {canClose && (
                <button
                    className="close-btn"
                    onClick={() => model.toggleTorOverlay()}
                    title="Close"
                >
                    <CloseIcon />
                </button>
            )}

            <div className="status-area">
                <div className="status-icon">
                    {showSpinner ? (
                        <span style={{ color: TOR_BROWSER_COLOR }}>
                            <CircularProgress size={24} />
                        </span>
                    ) : (
                        <TorIcon />
                    )}
                </div>
                <div className="status-text">
                    {torStatus === "connecting" && "Connecting to Tor network..."}
                    {torStatus === "connected" && "Connected to Tor"}
                    {torStatus === "error" && "Failed to connect to Tor"}
                    {torStatus === "disconnected" && "Tor is not connected"}
                </div>
                {showReconnect && (
                    <Button
                        className="reconnect-btn"
                        onClick={() => model.reconnectTor()}
                    >
                        Reconnect
                    </Button>
                )}
            </div>

            {torLog && (
                <pre className="log-area" ref={logRef}>
                    {torLog}
                </pre>
            )}
        </TorOverlayRoot>
    );
}

const TorOverlayRoot = styled.div({
    position: "absolute",
    inset: 0,
    zIndex: 5,
    background: color.background.dark,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    overflow: "hidden",

    "& .close-btn": {
        position: "absolute",
        top: 8,
        right: 8,
        background: "none",
        border: "none",
        color: color.icon.light,
        cursor: "pointer",
        padding: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        "&:hover": {
            background: color.background.overlay,
        },
        "& svg": {
            width: 16,
            height: 16,
        },
    },

    "& .status-area": {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        paddingTop: 60,
    },

    "& .status-icon": {
        "& svg": {
            width: 40,
            height: 40,
        },
    },

    "& .status-text": {
        fontSize: 14,
        color: color.text.light,
    },

    "& .reconnect-btn": {
        marginTop: 8,
    },

    "& .log-area": {
        marginTop: 20,
        padding: "8px 16px",
        width: "100%",
        maxWidth: 600,
        flex: 1,
        overflow: "auto",
        fontSize: 11,
        lineHeight: 1.5,
        color: color.text.dark,
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    },
});

export { TorStatusOverlayComponent as TorStatusOverlay };
