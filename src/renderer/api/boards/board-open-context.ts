import { TraitKey } from "../../core/traits/traits";
import type { BoardSourceContext } from "../../../shared/board-source-context";

export type EditorOpenContext =
    | { mode: "register-session"; sourceUrl: string; sessionHandle: string }
    | { mode: "enqueue-source"; sourceUrl: string; sessionHandle?: string; sourceContext?: BoardSourceContext };

export interface IOpenContextTrait {
    acceptOpenContext(context: EditorOpenContext): void;
}

export const OPEN_CONTEXT_TRAIT = new TraitKey<IOpenContextTrait>("open-context");
