import type { IAiMember, IAiVisible, IAiVisionDescriptor } from "ai-vision";
import { unseenMode } from "../../unseen-mode";

const UNSEEN_MODE_MEMBERS: readonly IAiMember[] = [
    { name: "enabled", kind: "property", summary: "Whether process-wide unseen mode is currently enabled." },
    { name: "managedCount", kind: "property", summary: "Number of live WebContents this mode changed to unthrottled; zero after disable restores them." },
    { name: "enable", kind: "method", signature: "enable()", summary: "Enable unseen mode: embedded browser pages and frames report visible while minimized and suppress hidden visibilitychange events. Standalone popups keep real visibility." },
    { name: "disable", kind: "method", signature: "disable()", summary: "Disable unseen mode, restore embedded browser pages' real visibility and changed throttling. Standalone popups keep real visibility." },
];

const UNSEEN_MODE_HELP = `
main.unseenMode is a process-wide, temporary runtime setting. It keeps animation frames and timers
running at foreground cadence for eligible WebContents. Embedded browser guest pages and their
frames report visible while minimized, suppress hidden visibilitychange events, and restore real
visibility when the mode is disabled. Standalone popup windows remain outside this behavior and
report their real visibility. This can use more power. The setting lasts until disabled or Persephone quits and is not persisted.
It does not grant OS focus, reveal a minimized or hidden window to a person, or make locked-screen
clipboard, native dialog, or hotkey operations work. enabled reports the current state. managedCount
counts live WebContents changed by this service; contents that were already unthrottled are excluded.
enable() and disable() are idempotent and return the resulting enabled state.
`;

export class MainUnseenModeNode implements IAiVisible {
    get enabled(): boolean { return unseenMode.enabled; }
    get managedCount(): number { return unseenMode.managedCount; }

    enable(): { enabled: true } { return unseenMode.enable(); }
    disable(): { enabled: false } { return unseenMode.disable(); }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "MainUnseenMode",
            summary: "Temporary process-wide control for animation and timer throttling while unseen.",
            members: UNSEEN_MODE_MEMBERS,
            help: UNSEEN_MODE_HELP,
            summarize: () => ({ kind: "MainUnseenMode", enabled: this.enabled, managedCount: this.managedCount }),
        };
    }
}
