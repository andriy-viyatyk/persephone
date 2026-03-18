import styled from "@emotion/styled";
import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BaseImageView } from "../image";
import type { BaseImageViewRef } from "../image";
import { TextFileModel } from "../text/TextPageModel";
import { Button } from "../../components/basic/Button";
import { CopyIcon, SunIcon, MoonIcon } from "../../theme/icons";
import { DrawIcon } from "../../theme/language-icons";
import { pagesModel } from "../../api/pages";
import { buildExcalidrawJsonWithImage, getImageDimensions } from "../draw/drawExport";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { EditorError } from "../base/EditorError";
import color from "../../theme/color";
import { useContentViewModel } from "../base/useContentViewModel";
import { MermaidViewModel, MermaidViewState, defaultMermaidViewState } from "./MermaidViewModel";

// ============================================================================
// Styled Components
// ============================================================================

const MermaidViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    overflow: "hidden",
    position: "relative",
    "& .mermaid-loading": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "1 1 auto",
        backgroundColor: color.background.default,
    },
    "& .mermaid-loading-overlay": {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.background.overlay,
        zIndex: 1,
    },
});

// ============================================================================
// MermaidView Component - content-view for Mermaid diagrams
// ============================================================================

interface MermaidViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultMermaidViewState;

function MermaidView({ model }: MermaidViewProps) {
    const vm = useContentViewModel<MermaidViewModel>(model, "mermaid-view");
    const imageRef = useRef<BaseImageViewRef>(null);

    // Subscribe to VM state (unconditional — Rules of Hooks)
    const pageState: MermaidViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    if (!vm) return null;

    const { svgUrl, error, loading, lightMode } = pageState;

    return (
        <MermaidViewRoot>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <Button
                            type="icon"
                            size="small"
                            title={lightMode ? "Switch to Dark Theme" : "Switch to Light Theme"}
                            onClick={vm.toggleLightMode}
                        >
                            {lightMode ? <MoonIcon /> : <SunIcon />}
                        </Button>
                        <Button
                            type="icon"
                            size="small"
                            title="Open in Drawing Editor"
                            disabled={!svgUrl}
                            onClick={async () => {
                                if (!svgUrl) return;
                                // svgUrl is data:image/svg+xml,<percent-encoded> — decode to raw SVG, re-encode as base64
                                const svgText = decodeURIComponent(svgUrl.replace("data:image/svg+xml,", ""));
                                const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgText, "utf-8").toString("base64")}`;
                                const dims = await getImageDimensions(dataUrl);
                                const json = buildExcalidrawJsonWithImage(dataUrl, "image/svg+xml", dims.width, dims.height);
                                const title = model.state.get().title.replace(/\.\w+$/, "") + ".excalidraw";
                                pagesModel.addEditorPage("draw-view", "json", title, json);
                            }}
                        >
                            <DrawIcon />
                        </Button>
                        <Button
                            type="icon"
                            size="small"
                            title="Copy Image to Clipboard (Ctrl+C)"
                            onClick={() => imageRef.current?.copyToClipboard()}
                            disabled={!svgUrl}
                        >
                            <CopyIcon />
                        </Button>
                    </>,
                    model.editorToolbarRefLast!
                )}
            {error && <EditorError>{error}</EditorError>}
            {loading && svgUrl && (
                <div className="mermaid-loading-overlay">
                    <CircularProgress />
                </div>
            )}
            {loading && !svgUrl ? (
                <div className="mermaid-loading">
                    <CircularProgress />
                </div>
            ) : svgUrl ? (
                <BaseImageView
                    ref={imageRef}
                    src={svgUrl}
                    alt="Mermaid Diagram"
                />
            ) : null}
        </MermaidViewRoot>
    );
}

export { MermaidView };
export type { MermaidViewProps };
