import { useCallback, useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { MermaidOutputEntry } from "../logTypes";
import { DialogHeader } from "./DialogHeader";
import { Button } from "../../../components/basic/Button";
import { CopyIcon, OpenLinkIcon } from "../../../theme/icons";
import { pagesModel } from "../../../api/pages";
import { isTextFileModel } from "../../text/TextPageModel";
import { renderMermaidSvg, svgToDataUrl } from "../../mermaid/render-mermaid";
import { settings } from "../../../api/settings";
import { isCurrentThemeDark } from "../../../theme/themes";
import color from "../../../theme/color";

// =============================================================================
// Helpers
// =============================================================================

async function copyImageToClipboard(img: HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
    );
    if (!blob) return;
    await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
    ]);
}

// =============================================================================
// Styled Components
// =============================================================================

const MermaidOutputRoot = styled.div({
    position: "relative",
    width: "100%",

    "& .mermaid-content": {
        padding: "4px 0",
        textAlign: "center",
        "& img": {
            maxWidth: "100%",
            height: "auto",
        },
    },

    "& .mermaid-loading": {
        padding: "2em",
        color: color.text.light,
        fontSize: 13,
    },

    "& .mermaid-error": {
        padding: "1em",
        color: color.misc.red,
        fontSize: 13,
    },

    "& .mermaid-hover-actions": {
        position: "absolute",
        top: 4,
        right: 4,
        display: "flex",
        gap: 4,
        opacity: 0,
        transition: "opacity 0.15s",
        zIndex: 1,
    },

    "&:hover .mermaid-hover-actions": {
        opacity: 1,
    },
});

// =============================================================================
// Component
// =============================================================================

interface MermaidOutputViewProps {
    entry: MermaidOutputEntry;
}

export function MermaidOutputView({ entry }: MermaidOutputViewProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [svgUrl, setSvgUrl] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);

    // Subscribe to theme changes for mermaid rendering
    settings.use("theme");
    const lightMode = !isCurrentThemeDark();

    useEffect(() => {
        let cancelled = false;
        setSvgUrl(null);
        setError("");

        renderMermaidSvg(entry.text, lightMode)
            .then((svg) => {
                if (!cancelled) {
                    setSvgUrl(svgToDataUrl(svg, undefined, !lightMode));
                    setError("");
                }
            })
            .catch((e) => {
                if (!cancelled) {
                    setError(e.message || "Failed to render diagram");
                    setSvgUrl(null);
                }
            });

        return () => { cancelled = true; };
    }, [entry.text, lightMode]);

    const handleCopy = useCallback(() => {
        if (!imgRef.current) return;
        copyImageToClipboard(imgRef.current);
        setCopied(true);
        setTimeout(() => setCopied(false), 750);
    }, []);

    const handleOpenInEditor = useCallback(() => {
        const title = typeof entry.title === "string" ? entry.title : "Mermaid Diagram";
        const page = pagesModel.addEditorPage("mermaid-view", "mermaid", title);
        if (isTextFileModel(page)) {
            page.changeContent(entry.text);
        }
    }, [entry.text, entry.title]);

    return (
        <MermaidOutputRoot>
            <DialogHeader title={entry.title} />
            <div className="mermaid-content">
                {error ? (
                    <div className="mermaid-error">{error}</div>
                ) : !svgUrl ? (
                    <div className="mermaid-loading">Rendering...</div>
                ) : (
                    <img ref={imgRef} src={svgUrl} alt="Mermaid Diagram" />
                )}
            </div>
            <div className="mermaid-hover-actions">
                <Button size="small" type="icon" onClick={handleOpenInEditor} title="Open in Mermaid editor">
                    <OpenLinkIcon />
                </Button>
                <Button
                    size="small"
                    type="icon"
                    onClick={handleCopy}
                    title="Copy image to clipboard"
                    disabled={!svgUrl}
                >
                    <CopyIcon />
                </Button>
            </div>
        </MermaidOutputRoot>
    );
}
