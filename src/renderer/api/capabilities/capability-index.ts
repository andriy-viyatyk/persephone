import { api } from "../../../ipc/renderer/api";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import { MainSnapshotMirror } from "../../core/state/MainSnapshotMirror";

export type CapabilityIndex = Awaited<ReturnType<typeof api.getCapabilityIndex>>;

export class CapabilityIndexMirror extends MainSnapshotMirror<CapabilityIndex | null> {
    constructor() { super(null); }

    protected fetch(): Promise<CapabilityIndex> { return api.getCapabilityIndex(); }
    protected override revisionOf(index: CapabilityIndex | null): number { return index?.revision ?? -1; }

    protected subscribeToMain(): void {
        this.attach(rendererEvents["eCapabilityIndexSnapshot"], (index) => this.apply(index));
        this.attach(rendererEvents["eCapabilityIndexChanged"], (revision) => this.noteRevision(revision));
    }

    registrations(): CapabilityIndex["legacyRegistrations"] {
        return this.snapshot?.legacyRegistrations ?? [];
    }
}
