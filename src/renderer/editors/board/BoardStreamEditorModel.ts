import { pipeFromPersistedSource } from "../../content/rebuild-pipe";
import { BoardEditorModel } from "./BoardEditorModel";

/** Board editor for boards that consume a live pipe without owning a content host. */
export class BoardStreamEditorModel extends BoardEditorModel {
    override get editorKind() {
        return "stream-host" as const;
    }

    override async resolveStreamPipe() {
        if (this.pipe) return this.pipe;
        this.pipe = await pipeFromPersistedSource(
            this.state.get().sourceLink,
            this.currentFilePath(),
            { unknownScheme: "file" },
        );
        return this.pipe;
    }

    override async ensureContentPath(): Promise<string | undefined> {
        throw new Error("stream-host boards do not expose a materialized content path.");
    }
}
