import { createGuideIndex, type GuideIndex, type GuideTreeNode } from "../../shared/guides";
import { RendererGuideSource } from "./guide-source";

const rendererGuideIndex = createGuideIndex(new RendererGuideSource());

/** The single renderer-owned guide index shared by content and guide-browser consumers. */
export function getGuideIndex(): GuideIndex {
    return rendererGuideIndex;
}

export function getGuidePage(path: string) {
    return rendererGuideIndex.getPage(path);
}

export function getGuideTree() {
    return rendererGuideIndex.getTree();
}

export type { GuideIndex, GuideTreeNode };
