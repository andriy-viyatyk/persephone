import { createGuideIndex, type GuideIndex, type GuideTreeNode } from "../../shared/guides";
import { createMountedGuideSource } from "../../shared/guides/mounted-source";
import { RendererGuideSource } from "./guide-source";
import { resolveRendererBoardGuideMounts } from "./board-guide-mounts";

// The app's own corpus plus one mount per trusted board that ships a `guides` folder (US-1406).
// Mounts are re-resolved as the index scans, so trusting, updating or removing a board changes the
// tree and search results without an app restart.
const rendererGuideIndex = createGuideIndex(createMountedGuideSource(
    new RendererGuideSource(),
    resolveRendererBoardGuideMounts,
));

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
