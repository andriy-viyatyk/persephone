import type { ILinkData } from "../../../shared/link-data";
import { EditorId } from "../../../shared/editor-ids";
import type { EditorCandidate } from "./editor-catalog";
import { editorCatalog } from "./editor-catalog";
import type { EditorModelInstance as EditorModel } from "./EditorModel";
import { editorRegistry } from "./editorRegistry";
import { guard } from "../../core/utils/guard";
import { fpBasename, fpNormalizeForCompare } from "../../core/utils/file-path";
import type { PageModel } from "../../api/pages/PageModel";
import { createEditorFromFile, createEditorFromFolder } from "../editor-factory";

export interface EditorSwitchStrategy {
    readonly order: number;
    matches(oldEditor: EditorModel, candidate: EditorCandidate): boolean;
    run(page: PageModel, oldEditor: EditorModel, candidate: EditorCandidate): Promise<void>;
}

interface RegisteredStrategy {
    readonly strategy: EditorSwitchStrategy;
    readonly registrationOrder: number;
}

export class EditorSwitchStrategyRegistry {
    private readonly registered: RegisteredStrategy[] = [];

    register(strategy: EditorSwitchStrategy): void {
        if (this.registered.some(({ strategy: registered }) => registered === strategy)) {
            throw new Error("Editor switch strategy is already registered.");
        }
        this.registered.push({ strategy, registrationOrder: this.registered.length });
        this.registered.sort((left, right) =>
            left.strategy.order - right.strategy.order
            || left.registrationOrder - right.registrationOrder,
        );
    }

    firstMatch(oldEditor: EditorModel, candidate: EditorCandidate): EditorSwitchStrategy | undefined {
        return this.registered.find(({ strategy }) => strategy.matches(oldEditor, candidate))?.strategy;
    }
}

export const editorSwitchStrategies = new EditorSwitchStrategyRegistry();

export async function transferEditorById(
    page: PageModel,
    oldEditor: EditorModel,
    candidate: EditorCandidate,
    sourceLink?: ILinkData,
): Promise<void> {
    const next = await editorRegistry.createEditor(candidate.id);
    next.switchFrom(oldEditor);
    if (sourceLink) next.state.update((state) => { state.sourceLink = sourceLink; });
    await next.restore();
    await page.setMainEditor(next);
}

export async function rebuildEditorOverFile(
    page: PageModel,
    oldEditor: EditorModel,
    filePath: string,
    candidate: EditorCandidate,
    sourceLink?: ILinkData,
): Promise<void> {
    const released = await oldEditor.confirmRelease();
    if (!released) return;
    const built = await guard(`Failed to open ${fpBasename(filePath)}`, () =>
        createEditorFromFile(filePath, undefined, candidate.id));
    if (!built) return;
    if (built.contentHost && !candidate.boardRoot) {
        built.contentHost.state.update((state) => {
            (state as { editor?: string }).editor = candidate.id;
        });
    }
    if (sourceLink) {
        (built.contentHost ?? built).state.update((state) => { state.sourceLink = sourceLink; });
    }
    await page.setMainEditor(built);
}

export function assertFolderSwitchCandidate(
    anchorFolder: string,
    candidate: EditorCandidate,
): void {
    if (!editorCatalog.candidatesForFolder(anchorFolder).some(({ id }) => id === candidate.id)) {
        throw new Error(`Folder switch unavailable: "${candidate.id}" is not offered for "${anchorFolder}".`);
    }
}

export function findReusableFolderEditor(
    page: PageModel,
    editorId: string,
    anchorFolder: string,
): EditorModel | undefined {
    const anchorKey = fpNormalizeForCompare(anchorFolder);
    return page.editors.find((editor) => {
        if (editor.editorId !== editorId) return false;
        const editorAnchor = editor.folderAnchor;
        return !!editorAnchor && fpNormalizeForCompare(editorAnchor) === anchorKey;
    });
}

const hostTransferStrategy: EditorSwitchStrategy = {
    order: 400,
    matches: (oldEditor, candidate) =>
        candidate.transition === "host-transfer" && !!oldEditor.contentHost,
    run: transferEditorById,
};

const rebuildOverFileStrategy: EditorSwitchStrategy = {
    order: 500,
    matches: (oldEditor, candidate) =>
        oldEditor.folderAnchor === undefined
        && !candidate.boardRoot
        && candidate.transition !== "install"
        && (candidate.transition === "rebuild" || !oldEditor.contentHost),
    run: async (page, oldEditor, candidate) => {
        const filePath = oldEditor.filePath;
        if (!filePath) return;
        await rebuildEditorOverFile(page, oldEditor, filePath, candidate);
    },
};

const folderFactoryStrategy: EditorSwitchStrategy = {
    order: 200,
    matches: (oldEditor, candidate) =>
        oldEditor.folderAnchor !== undefined
        && candidate.transition !== "install"
        && candidate.id !== EditorId.categoryView,
    run: async (page, oldEditor, candidate) => {
        const anchorFolder = oldEditor.folderAnchor;
        if (anchorFolder === undefined) return;
        assertFolderSwitchCandidate(anchorFolder, candidate);

        const existing = findReusableFolderEditor(page, candidate.id, anchorFolder);
        if (existing) {
            await page.setMainEditor(existing);
            existing.onNavigationReuse?.();
            return;
        }

        let next: EditorModel;
        if (candidate.boardRoot) {
            next = await createEditorFromFolder(candidate.id, anchorFolder);
        } else {
            const module = await editorRegistry.getModule(candidate.id);
            const factory = module.newEditorModelForFolder;
            if (!factory) {
                throw new Error(`Folder switch unavailable: editor "${candidate.id}" has no folder factory.`);
            }
            next = await factory(anchorFolder, page);
            await next.restore();
        }
        await page.setMainEditor(next);
    },
};

export function registerBaseEditorSwitchStrategies(registry: EditorSwitchStrategyRegistry): void {
    registry.register(folderFactoryStrategy);
    registry.register(hostTransferStrategy);
    registry.register(rebuildOverFileStrategy);
}
