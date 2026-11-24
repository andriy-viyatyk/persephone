import type { IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import type { DesktopAwarenessService } from "../../desktop-awareness";

const SESSION_MEMBERS: readonly IAiMember[] = [
    { name: "locked", kind: "property", summary: "Whether the current Windows session is locked." },
];

export class MainSessionNode implements IAiVisible {
    constructor(private readonly awareness: DesktopAwarenessService) {}

    get locked(): boolean {
        return this.awareness.locked;
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "MainSession",
            summary: "Current process-wide Windows session lock state.",
            members: SESSION_MEMBERS,
            help: "locked is the current Windows session state; it remains authoritative even if a renderer opened after a lock transition.",
            summarize: () => ({ kind: "MainSession", locked: this.locked }),
        };
    }
}
