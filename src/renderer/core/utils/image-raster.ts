/** Pure raster and Blob conversion helpers shared by editor actions and UIKit. */

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to load image for export"));
        image.src = src;
    });
}

/** Rasterise an already-loaded image at its natural size. */
export async function imageElementToPngBlob(image: HTMLImageElement): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to obtain a 2D canvas context");
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to encode PNG");
    return blob;
}

/** Load `src` and rasterise it to a PNG blob at natural size. */
export async function rasterToPngBlob(src: string): Promise<Blob> {
    return imageElementToPngBlob(await loadImage(src));
}

export async function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Failed to load image"));
        image.src = src;
    });
}

export interface RasterizedPng {
    blob: Blob;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
}

export async function rasterToPngBlobWithDimensions(src: string, maxDimension: number): Promise<RasterizedPng> {
    const image = await loadImage(src);
    const originalWidth = image.naturalWidth;
    const originalHeight = image.naturalHeight;
    if (originalWidth <= 0 || originalHeight <= 0) throw new Error("Loaded image has no raster dimensions");
    const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to obtain a 2D canvas context");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to encode PNG");
    return { blob, width, height, originalWidth, originalHeight };
}

export async function blobToBuffer(blob: Blob): Promise<Buffer> {
    return Buffer.from(await blob.arrayBuffer());
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
                reject(new Error("Unexpected FileReader result type"));
                return;
            }
            resolve(result);
        };
        reader.onerror = () => reject(new Error("Failed to read image blob"));
        reader.readAsDataURL(blob);
    });
}
