import { resolveBoardIcon } from "./board-icon-cache";
import { BoardIcon } from "../../theme/icons";

function boardGlyphImage(): HTMLImageElement {
    const builder = BoardIcon.createElement;
    if (!builder) throw new Error("BoardIcon does not expose a DOM builder");
    const svg = builder({ width: 256, height: 256 });
    const source = new XMLSerializer().serializeToString(svg);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    return image;
}

export async function renderBoardIconDataUrl(root: string): Promise<string> {
    const iconPath = await resolveBoardIcon(root);
    let image: HTMLImageElement;
    if (iconPath) {
        image = new Image();
        image.src = iconPath;
        try { await image.decode(); } catch { image = boardGlyphImage(); }
    } else {
        image = boardGlyphImage();
    }
    if (!image.complete || !image.naturalWidth) await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable for board icon rendering.");
    context.clearRect(0, 0, 256, 256);
    const scale = Math.min(256 / image.naturalWidth, 256 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
    return canvas.toDataURL("image/png");
}
