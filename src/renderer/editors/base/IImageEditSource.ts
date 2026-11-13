export interface ImageEditPayload {
    dataUrl: string;
    mimeType?: string;
    title: string;
}

/** Model-owned source preparation for the Drawing Editor capability. */
export interface IImageEditSource {
    imageEditPayload(): Promise<ImageEditPayload | undefined>;
}
