import styled from "@emotion/styled";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Excalidraw, FONT_FAMILY, THEME, useHandleLibrary } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { TextFileModel } from "../text/TextEditorModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { EditorError } from "../base/EditorError";
import { Button } from "../../components/basic/Button";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import type { MenuItem } from "../../components/overlay/PopupMenu";
import { SunIcon, MoonIcon, CopyIcon, DownloadIcon, NewWindowIcon, SnipIcon } from "../../theme/icons";
import { DrawViewModel, DrawViewState, defaultDrawViewState } from "./DrawViewModel";
import { exportAsSvgText, exportAsPngBlob, getImageDimensions, IMAGE_OFFSET_X, IMAGE_OFFSET_Y } from "./drawExport";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { isCurrentThemeDark } from "../../theme/themes";
import { settings } from "../../api/settings";
import { fs } from "../../api/fs";
import { ui } from "../../api/ui";
import { api } from "../../../ipc/renderer/api";
import { pagesModel } from "../../api/pages";
import { fpBasename } from "../../core/utils/file-path";
import { browserUrlChanged } from "../../core/state/events";
import { createLibraryAdapter, initDefaultLibraryPath } from "./drawLibrary";

const LIBRARY_RETURN_URL = "https://jsnotepad.excalidraw-library/";

// Set Excalidraw asset path to local fonts (must be set before component mounts)
if (!(window as any).__EXCALIDRAW_ASSET_PATH_SET) {
    (window as any).EXCALIDRAW_ASSET_PATH = "app-asset://excalidraw/";
    (window as any).__EXCALIDRAW_ASSET_PATH_SET = true;
}

// =============================================================================
// Styled Components
// =============================================================================

const DrawViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    overflow: "hidden",
    position: "relative",
    "& .excalidraw-wrapper": {
        flex: "1 1 auto",
        width: "100%",
        height: "100%",
    },
});

// =============================================================================
// Component
// =============================================================================

export interface DrawViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultDrawViewState;

export function DrawView({ model }: DrawViewProps) {
    const vm = useContentViewModel<DrawViewModel>(model, "draw-view");
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

    // Subscribe to VM state
    const pageState: DrawViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    // Sync editor dark mode with app theme changes
    const themeId = settings.use("theme");
    useEffect(() => {
        vm?.syncDarkMode();
    }, [themeId, vm]);

    const excalidrawTheme = pageState.darkMode ? THEME.DARK : THEME.LIGHT;

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            vm?.clearExcalidrawApi();
        };
    }, [vm]);

    // =========================================================================
    // Library persistence
    // =========================================================================

    const libraryAdapter = useMemo(() => createLibraryAdapter(), []);

    // Initialize default library path on first mount
    useEffect(() => { initDefaultLibraryPath(); }, []);

    useHandleLibrary({ excalidrawAPI, adapter: libraryAdapter });

    // Intercept "Browse libraries" <a> click → open in internal browser
    const handleWrapperClick = useCallback((e: React.MouseEvent) => {
        const anchor = (e.target as HTMLElement).closest("a.library-menu-browse-button");
        if (anchor) {
            e.preventDefault();
            const href = anchor.getAttribute("href");
            if (href) {
                pagesModel.openUrlInBrowserTab(href);
            }
        }
    }, []);

    // Listen for browser URL changes → handle Excalidraw library install URLs
    useEffect(() => {
        const sub = browserUrlChanged.subscribe((event) => {
            if (!event || event.handled || !apiRef.current) return;
            const { url } = event;
            if (!url.startsWith(LIBRARY_RETURN_URL)) return;

            const hashIndex = url.indexOf("#");
            if (hashIndex === -1) return;
            const params = new URLSearchParams(url.slice(hashIndex + 1));
            const libraryUrl = params.get("addLibrary");
            if (!libraryUrl) return;

            event.handled = true;
            pagesModel.showPage(model.id);

            const decoded = decodeURIComponent(libraryUrl);
            fetch(decoded)
                .then((res) => res.blob())
                .then((blob) => {
                    apiRef.current?.updateLibrary({
                        libraryItems: blob as any,
                        merge: true,
                        prompt: true,
                        openLibraryMenu: true,
                    });
                })
                .catch((err) => {
                    ui.notify(`Failed to install library: ${(err as Error).message}`, "error");
                });
        });
        return () => sub.unsubscribe();
    }, [model.id]);

    const handleChange = useCallback(
        (elements: readonly any[], appState: any, files: any) => {
            if (!vm) return;
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                vm.updateFromExcalidraw(elements, appState, files);
            }, 500);
        },
        [vm],
    );

    // =========================================================================
    // Export helpers
    // =========================================================================

    const getDefaultName = useCallback((ext: string): string => {
        const filePath = model.state.get().filePath;
        if (filePath) {
            const base = fpBasename(filePath).replace(/\.excalidraw$/i, "");
            return `${base}.${ext}`;
        }
        return `drawing.${ext}`;
    }, [model]);

    const hasElements = useCallback((): boolean => {
        if (!apiRef.current) return false;
        if (apiRef.current.getSceneElements().length === 0) {
            ui.notify("Nothing to export — the drawing is empty", "warning");
            return false;
        }
        return true;
    }, []);

    const handleCopyToClipboard = useCallback(async () => {
        if (!apiRef.current || !hasElements()) return;
        const blob = await exportAsPngBlob(apiRef.current);
        await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
    }, [hasElements]);

    const handleScreenSnip = useCallback(async () => {
        if (!apiRef.current) return;
        const dataUrl = await api.startScreenSnip();
        if (!dataUrl) return;

        const dims = await getImageDimensions(dataUrl);
        const fileId = crypto.randomUUID();

        apiRef.current.addFiles([{
            id: fileId as any,
            dataURL: dataUrl as any,
            mimeType: "image/png" as any,
            created: Date.now(),
        }]);

        // Cap to 1200px on the longer side
        const maxDim = 1200;
        const longer = Math.max(dims.width, dims.height);
        const scale = longer > maxDim ? maxDim / longer : 1;
        const w = Math.round(dims.width * scale);
        const h = Math.round(dims.height * scale);

        const newElements = convertToExcalidrawElements([{
            type: "image",
            x: IMAGE_OFFSET_X,
            y: IMAGE_OFFSET_Y,
            width: w,
            height: h,
            fileId: fileId as any,
            status: "saved",
        } as any]);

        const existing = apiRef.current.getSceneElements();
        apiRef.current.updateScene({
            elements: [...existing, ...newElements],
        });
    }, []);

    const saveMenuItems = useMemo((): MenuItem[] => [
        {
            label: "Save as SVG",
            onClick: async () => {
                if (!apiRef.current || !hasElements()) return;
                try {
                    const svgText = await exportAsSvgText(apiRef.current);
                    const savePath = await fs.showSaveDialog({
                        title: "Save as SVG",
                        defaultPath: getDefaultName("svg"),
                        filters: [{ name: "SVG", extensions: ["svg"] }],
                    });
                    if (savePath) await fs.write(savePath, svgText);
                } catch (e) {
                    ui.notify(`Export failed: ${(e as Error).message}`, "error");
                }
            },
        },
        {
            label: "Save as PNG",
            onClick: async () => {
                if (!apiRef.current || !hasElements()) return;
                try {
                    const blob = await exportAsPngBlob(apiRef.current);
                    const buffer = Buffer.from(await blob.arrayBuffer());
                    const savePath = await fs.showSaveDialog({
                        title: "Save as PNG",
                        defaultPath: getDefaultName("png"),
                        filters: [{ name: "PNG", extensions: ["png"] }],
                    });
                    if (savePath) await fs.saveBinaryFile(savePath, buffer);
                } catch (e) {
                    ui.notify(`Export failed: ${(e as Error).message}`, "error");
                }
            },
        },
    ], [getDefaultName, hasElements]);

    const openMenuItems = useMemo((): MenuItem[] => [
        {
            label: "Open as SVG",
            onClick: async () => {
                if (!apiRef.current || !hasElements()) return;
                try {
                    const svgText = await exportAsSvgText(apiRef.current);
                    pagesModel.addEditorPage("svg-view", "xml", getDefaultName("svg"), svgText);
                } catch (e) {
                    ui.notify(`Export failed: ${(e as Error).message}`, "error");
                }
            },
        },
        {
            label: "Open as Image",
            onClick: async () => {
                if (!apiRef.current || !hasElements()) return;
                try {
                    const blob = await exportAsPngBlob(apiRef.current);
                    const blobUrl = URL.createObjectURL(blob);
                    pagesModel.openImageInNewTab(blobUrl);
                } catch (e) {
                    ui.notify(`Export failed: ${(e as Error).message}`, "error");
                }
            },
        },
    ], [getDefaultName, hasElements]);

    // =========================================================================
    // Render
    // =========================================================================

    if (!vm) return null;

    const { loading, error, darkMode } = pageState;

    if (error) return <EditorError>{error}</EditorError>;
    if (loading) return <CircularProgress />;

    return (
        <DrawViewRoot>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <Button
                            type="icon"
                            size="small"
                            title={darkMode ? "Switch to Light Theme" : "Switch to Dark Theme"}
                            onClick={vm.toggleDarkMode}
                        >
                            {darkMode ? <SunIcon /> : <MoonIcon />}
                        </Button>
                        <Button
                            type="icon"
                            size="small"
                            title="Copy Image to Clipboard"
                            onClick={handleCopyToClipboard}
                        >
                            <CopyIcon />
                        </Button>
                        <WithPopupMenu items={saveMenuItems}>
                            {(setOpen) => (
                                <Button
                                    type="icon"
                                    size="small"
                                    title="Save as file"
                                    onClick={(e) => setOpen(e.currentTarget)}
                                >
                                    <DownloadIcon />
                                </Button>
                            )}
                        </WithPopupMenu>
                        <WithPopupMenu items={openMenuItems}>
                            {(setOpen) => (
                                <Button
                                    type="icon"
                                    size="small"
                                    title="Open in new tab"
                                    onClick={(e) => setOpen(e.currentTarget)}
                                >
                                    <NewWindowIcon />
                                </Button>
                            )}
                        </WithPopupMenu>
                        <Button
                            type="icon"
                            size="small"
                            title="Screen Snip"
                            onClick={handleScreenSnip}
                        >
                            <SnipIcon />
                        </Button>
                    </>,
                    model.editorToolbarRefLast!
                )}
            <div className="excalidraw-wrapper" onContextMenu={(e) => e.stopPropagation()} onClick={handleWrapperClick}>
                <Excalidraw
                    excalidrawAPI={(excApi) => { apiRef.current = excApi; setExcalidrawAPI(excApi); vm?.setExcalidrawApi(excApi); }}
                    libraryReturnUrl={LIBRARY_RETURN_URL}
                    initialData={{
                        elements: vm.elements,
                        appState: {
                            ...vm.appState,
                            currentItemFontFamily: vm.appState.currentItemFontFamily ?? FONT_FAMILY.Helvetica,
                        },
                        files: vm.files,
                    }}
                    theme={excalidrawTheme}
                    onChange={handleChange}
                    UIOptions={{
                        canvasActions: {
                            loadScene: false,
                            saveToActiveFile: false,
                            export: false,
                            toggleTheme: false,
                        },
                    }}
                />
            </div>
        </DrawViewRoot>
    );
}
