import type { IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import type { DesktopAwarenessService } from "../../desktop-awareness";

const SESSION_MEMBERS: readonly IAiMember[] = [
    { name: "locked", kind: "property", summary: "Whether the current desktop session is locked." },
];

export class MainSessionNode implements IAiVisible {
    constructor(private readonly awareness: DesktopAwarenessService) {}

    get locked(): boolean {
        return this.awareness.locked;
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "MainSession",
            summary: "Current process-wide desktop session lock state.",
            members: SESSION_MEMBERS,
            help: "locked is the current session state; it remains authoritative even if a renderer opened after a lock transition. Lock event delivery depends on the desktop session.",
            summarize: () => ({ kind: "MainSession", locked: this.locked }),
        };
    }
}
