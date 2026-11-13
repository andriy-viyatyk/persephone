import type { WebContents } from "electron";

export async function capturePageRegion(webContents: WebContents, rect: { x: number; y: number; width: number; height: number }): Promise<Uint8Array> {
    const zoomFactor = webContents.getZoomFactor();
    const image = await webContents.capturePage({
        x: Math.round(rect.x * zoomFactor), y: Math.round(rect.y * zoomFactor),
        width: Math.round(rect.width * zoomFactor), height: Math.round(rect.height * zoomFactor),
    });
    return image.toPNG();
}
