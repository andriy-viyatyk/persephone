import { TraitKey } from "../../core/traits/traits";
import type { TextFileModel } from "../text/TextEditorModel";

export interface IContentHostTrait {
    extractContentHost(): TextFileModel;
}

export const CONTENT_HOST_TRAIT = new TraitKey<IContentHostTrait>("content-host");
