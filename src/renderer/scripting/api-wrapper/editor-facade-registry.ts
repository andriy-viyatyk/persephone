import type { EditorModelInstance as EditorModel } from "../../editors/base/EditorModel";
import type { IAiCallContext } from "../ai-vision/root";
import type { IAiVisible } from "ai-vision";
import { GenericEditorFacade } from "./GenericEditorFacade";

type RegisteredEditorFacadeFactory = (
    editor: EditorModel,
    id: string,
    name: string,
    callContext?: IAiCallContext,
) => IEditorFacade;

export type IEditorFacade = IAiVisible & { readonly id: string };

interface EditorFacadeRegistration {
    idOrPrefix: string;
    factory: RegisteredEditorFacadeFactory;
    guard?: (id: string) => boolean;
}

const exactFactories = new Map<string, RegisteredEditorFacadeFactory>();
const familyFactories: EditorFacadeRegistration[] = [];

export function registerEditorFacade<TEditor extends EditorModel>(
    idOrPrefix: string,
    factory: (
        editor: TEditor,
        id: string,
        name: string,
        callContext?: IAiCallContext,
    ) => IEditorFacade,
    guard?: (id: string) => boolean,
): void {
    // The registration declares the id-to-model pairing. The registry cannot validate that
    // pairing at runtime without importing editor classes, which would make editor loading static.
    const registeredFactory = factory as unknown as RegisteredEditorFacadeFactory;
    if (guard) {
        familyFactories.push({ idOrPrefix, factory: registeredFactory, guard });
    } else {
        exactFactories.set(idOrPrefix, registeredFactory);
    }
}

export const editorFacadeRegistry = {
    create(
        id: string,
        editor: EditorModel | null,
        name: string,
        callContext?: IAiCallContext,
    ): IEditorFacade {
        if (editor) {
            const exact = exactFactories.get(id);
            if (exact) return exact(editor, id, name, callContext);
            const family = familyFactories.find(entry =>
                id.startsWith(entry.idOrPrefix) && entry.guard?.(id));
            if (family) return family.factory(editor, id, name, callContext);
        }
        return new GenericEditorFacade(id, name);
    },
};

