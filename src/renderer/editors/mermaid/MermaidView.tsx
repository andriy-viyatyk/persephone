import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BaseImageView } from "../shared/BaseImageView";
import type { BaseImageViewRef } from "../shared/BaseImageView";
import { TextFileModel } from "../text/TextEditorModel";
import { CopyIcon, SunIcon, MoonIcon } from "../../theme/icons";
import { DrawIcon } from "../../theme/language-icons";
import { pagesModel } from "../../api/pages";
import { buildExcalidrawJsonWithImage, getImageDimensions } from "../draw/drawExport";
import { useContentViewModel } from "../base/useContentViewModel";
import { Panel, Text, IconButton, Spinner } from "../../uikit";
import { MermaidViewModel, MermaidViewState, defaultMermaidViewState } from "./MermaidViewModel";

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
        <Panel direction="column" flex overflow="hidden" position="relative" height={0}>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <IconButton
                            size="sm"
                            title={lightMode ? "Switch to Dark Theme" : "Switch to Light Theme"}
                            onClick={vm.toggleLightMode}
                            icon={lightMode ? <MoonIcon /> : <SunIcon />}
                        />
                        <IconButton
                            size="sm"
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
                            icon={<DrawIcon />}
                        />
                        <IconButton
                            size="sm"
                            title="Copy Image to Clipboard (Ctrl+C)"
                            onClick={() => imageRef.current?.copyToClipboard()}
                            disabled={!svgUrl}
                            icon={<CopyIcon />}
                        />
                    </>,
                    model.editorToolbarRefLast!
                )}
            {error && (
                <Panel flex align="center" justify="center" padding="xxxl">
                    <Text color="warning" preWrap>{error}</Text>
                </Panel>
            )}
            {loading && svgUrl && (
                <Panel
                    position="absolute"
                    inset={0}
                    zIndex={1}
                    align="center"
                    justify="center"
                    background="overlay"
                >
                    <Spinner />
                </Panel>
            )}
            {loading && !svgUrl ? (
                <Panel flex align="center" justify="center" background="default">
                    <Spinner />
                </Panel>
            ) : svgUrl ? (
                <BaseImageView
                    ref={imageRef}
                    src={svgUrl}
                    alt="Mermaid Diagram"
                />
            ) : null}
        </Panel>
    );
}

export { MermaidView };
export type { MermaidViewProps };
