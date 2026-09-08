import type { IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";

const GENERIC_EDITOR_MEMBERS: readonly IAiMember[] = [
    { name: "id", kind: "property", summary: "The concrete current editor id." },
    { name: "name", kind: "property", summary: "The editor's registry display name." },
];

const GENERIC_EDITOR_HELP = "The current editor exposes no scripting operations or shipped guide mapping yet. Its id and name identify the editor so a later editor facade can be selected when available.";

export class GenericEditorFacade implements IAiVisible {
    constructor(
        readonly id: string,
        readonly name: string,
    ) {}

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Editor",
            summary: "Generic editor identity facade.",
            members: GENERIC_EDITOR_MEMBERS,
            help: GENERIC_EDITOR_HELP,
            summarize: () => ({ kind: "Editor", id: this.id, name: this.name }),
        };
    }
}
