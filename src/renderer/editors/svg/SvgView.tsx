import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BaseImageView } from "../shared/BaseImageView";
import type { BaseImageViewRef } from "../shared/BaseImageView";
import { TextFileModel } from "../text/TextEditorModel";
import { CopyIcon } from "../../theme/icons";
import { DrawIcon } from "../../theme/language-icons";
import { pagesModel } from "../../api/pages";
import { buildExcalidrawJsonWithImage, getImageDimensions } from "../draw/drawExport";
import { useContentViewModel } from "../base/useContentViewModel";
import { IconButton } from "../../uikit";
import { SvgViewModel, defaultSvgViewState } from "./SvgViewModel";

// ============================================================================
// SvgView Component - content-view for SVG files
// ============================================================================

interface SvgViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultSvgViewState;

/**
 * SVG Preview component that renders SVG content as an image.
 * Uses BaseImageView for zoom/pan functionality.
 * Reads from page.content (not file) so it shows unsaved changes.
 */
function SvgView({ model }: SvgViewProps) {
    const vm = useContentViewModel<SvgViewModel>(model, "svg-view");
    const content = model.state.use((s) => s.content);
    const imageRef = useRef<BaseImageViewRef>(null);

    // Subscribe to VM state (unconditional — Rules of Hooks)
    useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    if (!vm) return null;

    // Build data URL from SVG content
    const src = `data:image/svg+xml,${encodeURIComponent(content)}`;

    return (
        <>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <IconButton
                            size="sm"
                            title="Open in Drawing Editor"
                            onClick={async () => {
                                const svgContent = model.state.get().content;
                                if (!svgContent.trim()) return;
                                const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent, "utf-8").toString("base64")}`;
                                const dims = await getImageDimensions(dataUrl);
                                const json = buildExcalidrawJsonWithImage(dataUrl, "image/svg+xml", dims.width, dims.height);
                                const title = model.state.get().title.replace(/\.svg$/i, "") + ".excalidraw";
                                pagesModel.addEditorPage("draw-view", "json", title, json);
                            }}
                            icon={<DrawIcon />}
                        />
                        <IconButton
                            size="sm"
                            title="Copy Image to Clipboard (Ctrl+C)"
                            onClick={() => imageRef.current?.copyToClipboard()}
                            icon={<CopyIcon />}
                        />
                    </>,
                    model.editorToolbarRefLast!
                )}
            <BaseImageView ref={imageRef} src={src} alt="SVG Preview" />
        </>
    );
}

export { SvgView };
export type { SvgViewProps };
