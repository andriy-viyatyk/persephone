import { errMessage } from "../../../shared/utils";
import { pagesModel } from "../../api/pages";
import type {
    DiagramEditPayload,
    DiagramEditResult,
    ImageEditPayload,
    CapabilityPageResult,
} from "../../api/types/capabilities";
import {
    buildExcalidrawJsonFromMermaid,
    buildExcalidrawJsonWithImage,
    getImageDimensions,
} from "./drawExport";

function mimeFromDataUrl(dataUrl: string): string {
    return /^data:([^;,]+)/.exec(dataUrl)?.[1] || "image/png";
}

export async function imageEdit(payload: ImageEditPayload): Promise<CapabilityPageResult> {
    const mimeType = payload.mimeType ?? mimeFromDataUrl(payload.dataUrl);
    const dimensions = payload.naturalWidth !== undefined && payload.naturalHeight !== undefined
        ? { width: payload.naturalWidth, height: payload.naturalHeight }
        : await getImageDimensions(payload.dataUrl);
    const json = buildExcalidrawJsonWithImage(
        payload.dataUrl,
        mimeType,
        dimensions.width,
        dimensions.height,
    );
    const page = pagesModel.addEditorPage("draw-view", "json", payload.title, json);
    return { pageId: page.id };
}

export async function diagramEdit(payload: DiagramEditPayload): Promise<DiagramEditResult> {
    let conversion: { json: string; imageOnly: boolean };
    try {
        conversion = await buildExcalidrawJsonFromMermaid(payload.source);
    } catch (error) {
        return {
            status: "conversion-failed",
            message: errMessage(error),
        };
    }

    const page = pagesModel.addEditorPage("draw-view", "json", payload.title, conversion.json);
    return {
        status: "opened",
        pageId: page.id,
        imageOnly: conversion.imageOnly,
    };
}
