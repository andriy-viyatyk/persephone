import type { EditorStateBase } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import { TextFileModel } from "../content-host/TextFileModel";
import { ui } from "../../api/ui";
import { debounce, errMessage } from "../../../shared/utils";
// Import directly from types.ts (not the api/board-vars barrel) — the barrel re-exports
// board-vars-bridge.ts, which imports this folder's open-env-vars.ts, so going through the
// barrel here would create a circular module dependency.
import {
    DEFAULT_PROFILE,
    parseBoardVarsText,
    type BoardVarsFile,
    validateBoardVarsFile,
} from "../../api/board-vars/types";
import type { ILinkData } from "../../../shared/link-data";
import { DialogButton } from "../../ui/dialogs/dialog-buttons";
import { t } from "../../../shared/i18n/t";
import { EditorId } from "../../../shared/editor-ids";

/** HS1 host-slot shape — the two per-window selection fields ride
 *  `host.editorSettings["env-vars-view"]`. Survives EnvVars↔Monaco switches AND app restarts. */
interface EnvVarsViewSettings {
    selectedNamespace?: string;
    selectedProfile?: string;
}

export interface EnvVarsEditorState extends EditorStateBase {
    // HS1 — ride host.editorSettings["env-vars-view"]:
    selectedNamespace: string;
    selectedProfile: string;
    // View-derived — recomputed from host content by loadData:
    data: BoardVarsFile;
    status: "ok" | "locked" | "error";
    errorMessage: string | undefined;
}

export const defaultEnvVarsEditorState: EnvVarsEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
    selectedNamespace: "",
    selectedProfile: "",
    data: {},
    status: "ok",
    errorMessage: undefined,
};

export class EnvVarsEditor extends TextHostEditorModel<EnvVarsEditorState> {
    readonly editorId = EditorId.envVarsView;
    protected readonly displayName = "Environment Variables";

    // TD4 — ref-equality marker for serialization skip.
    private lastSerializedData: BoardVarsFile | null = null;

    private onDataChangedDebounced = debounce(() => this.onDataChanged(), 300);

    protected untitledName(): string {
        return "untitled.env.json";
    }

    adoptHost(host: TextFileModel): void {
        super.adoptHost(host);

        // TD4 + TD5 — re-parse on external content changes; the base's echo
        // guard prevents the loop from our own serialize-back writes.
        this.subscribeHostContent((content) => this.loadData(content));

        // HS1 — seed the 2 selection fields from host slot (sync, no flicker)
        // and mirror back. Slice-subscribe over a composite key so the
        // mirror fires on any of the 2 slot fields but NOT on data / status mutations.
        this.mirrorHostSettings<EnvVarsViewSettings>(
            (saved) => {
                this.state.update((s) => {
                    if (saved.selectedNamespace !== undefined) s.selectedNamespace = saved.selectedNamespace;
                    if (saved.selectedProfile !== undefined) s.selectedProfile = saved.selectedProfile;
                });
            },
            (s) => ({
                selectedNamespace: s.selectedNamespace,
                selectedProfile: s.selectedProfile,
            }),
            (s) => `${s.selectedNamespace}|${s.selectedProfile}`,
        );

        // TD4 — state subscription → debounced serialize-back.
        this.registerHostSubscription(this.state.subscribe(
            () => this.onDataChangedDebounced(),
            (state) => ({ data: state.data, status: state.status }),
        ));

        this.loadData(host.state.get().content ?? "");

        const envNamespace = (this.sourceLink as ILinkData | undefined)?.envNamespace;
        if (envNamespace) this.focusNamespace(envNamespace);
    }

    // ── Data loading ────────────────────────────────────────────────────

    loadData = (content: string): void => {
        const host = this._host;
        if (host?.encrypted && !host.decrypted) {
            this.state.update((s) => {
                s.status = "locked";
            });
            return;
        }

        if (!content || content.trim() === "") {
            this.state.update((s) => {
                s.data = {};
                s.status = "ok";
                s.errorMessage = undefined;
                s.selectedNamespace = "";
                s.selectedProfile = "";
            });
            this.lastSerializedData = this.state.get().data;
            return;
        }

        try {
            const parsed = parseBoardVarsText(content);
            validateBoardVarsFile(parsed);
            const data = parsed;
            this.state.update((s) => {
                s.data = data;
                s.status = "ok";
                s.errorMessage = undefined;
                if (!s.selectedNamespace || !(s.selectedNamespace in data)) {
                    s.selectedNamespace = Object.keys(data).sort()[0] ?? "";
                }
                const profiles = Object.keys(data[s.selectedNamespace] ?? {});
                if (!s.selectedProfile || !profiles.includes(s.selectedProfile)) {
                    s.selectedProfile = profiles[0] ?? "";
                }
            });
            this.lastSerializedData = data;
        } catch (e: unknown) {
            const message = errMessage(e);
            this.state.update((s) => {
                s.status = "error";
                s.errorMessage = message;
            });
        }
    };

    // ── Serialization: state → file content ─────────────────

    private onDataChanged = (): void => {
        const { data, status } = this.state.get();
        // Don't serialize over a locked/unparseable file — preserves the raw content for
        // inspection / hand-edit (the tab's "+" switcher can open it as Text Editor).
        if (status !== "ok") return;
        if (!this._host) return;
        if (data === this.lastSerializedData) return;
        this.lastSerializedData = data;
        const content = JSON.stringify(data, null, 4);
        this.writeToHost(content, true);
    };

    // ── Namespace focus: `persephone.var.show` ─────────────────

    focusNamespace = (namespace: string): void => {
        this.state.update((s) => {
            s.selectedNamespace = namespace;
            const profiles = Object.keys(s.data[namespace] ?? {});
            s.selectedProfile = profiles[0] ?? DEFAULT_PROFILE;
        });
    };

    // ── Selection ─────────────────────────────────────────────────────

    setSelectedNamespace = (namespace: string): void => {
        this.state.update((s) => {
            s.selectedNamespace = namespace;
            const profiles = Object.keys(s.data[namespace] ?? {});
            s.selectedProfile = profiles[0] ?? "";
        });
    };

    setSelectedProfile = (profile: string): void => {
        this.state.update((s) => {
            s.selectedProfile = profile;
        });
    };

    // ── Variable (key) CRUD ───────────────────────────────────────────────

    /** Replace an entire profile's validated key→value record atomically. `trySetProfileRows`
     *  owns row validation and delegates here only after the rows pass. */
    setProfileData = (namespace: string, profile: string, record: Record<string, string>): void => {
        this.state.update((s) => {
            (s.data[namespace] ??= {});
            s.data[namespace][profile] = record;
        });
    };

    trySetProfileRows(
        namespace: string,
        profile: string,
        rows: readonly { name: string; value: string }[],
    ): string | undefined {
        const counts = new Map<string, number>();
        let hasEmpty = false;
        for (const row of rows) {
            const name = row.name.trim();
            if (!name) {
                hasEmpty = true;
                continue;
            }
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
        const reasons: string[] = [];
        if (hasEmpty) reasons.push(t("board.emptyVariableNames"));
        if (duplicates.length) {
            reasons.push(t("board.duplicateVariableName", {
                count: duplicates.length,
                names: duplicates.map((name) => `"${name}"`).join(", "),
            } as never));
        }
        if (reasons.length) return t("board.envNotSaved", { reasons: reasons.join("; ") });

        const record: Record<string, string> = {};
        for (const row of rows) record[row.name.trim()] = row.value;
        this.setProfileData(namespace, profile, record);
        return undefined;
    }

    // ── Profile CRUD ───────────────────────────────────────────────────

    addProfile = (namespace: string, name: string): boolean => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        const ns = this.state.get().data[namespace];
        if (ns && Object.prototype.hasOwnProperty.call(ns, trimmed)) return false;
        this.state.update((s) => {
            (s.data[namespace] ??= {});
            (s.data[namespace][trimmed] ??= {});
        });
        return true;
    };

    deleteProfile = async (namespace: string, profile: string, skipConfirm = false): Promise<void> => {
        if (!skipConfirm) {
            const keyCount = Object.keys(this.state.get().data[namespace]?.[profile] ?? {}).length;
            const result = await ui.confirm(
                keyCount > 0 ? t("board.deleteProfileConfirmation", { profile, count: keyCount } as never)
                    : t("board.deleteProfileConfirmationNoVariables", { profile }),
                { title: t("board.deleteProfileConfirmationTitle"), buttons: [DialogButton.delete, DialogButton.cancel] },
            );
            if (result !== DialogButton.delete) return;
        }
        this.state.update((s) => {
            if (s.data[namespace]) delete s.data[namespace][profile];
            if (s.selectedNamespace === namespace && s.selectedProfile === profile) {
                const remaining = Object.keys(s.data[namespace] ?? {});
                s.selectedProfile = remaining[0] ?? "";
            }
        });
    };

    // ── Namespace CRUD ───────────────────────────────────────────────────

    addNamespace = (name: string): boolean => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        const { data } = this.state.get();
        if (Object.prototype.hasOwnProperty.call(data, trimmed)) return false;
        this.state.update((s) => {
            (s.data[trimmed] ??= {});
            s.selectedNamespace = trimmed;
            s.selectedProfile = "";
        });
        return true;
    };

    deleteNamespace = async (namespace: string, skipConfirm = false): Promise<void> => {
        if (!skipConfirm) {
            const profileCount = Object.keys(this.state.get().data[namespace] ?? {}).length;
            const result = await ui.confirm(
                profileCount > 0 ? t("board.deleteNamespaceConfirmation", { namespace, count: profileCount } as never)
                    : t("board.deleteNamespaceConfirmationNoProfiles", { namespace }),
                { title: t("board.deleteNamespaceConfirmationTitle"), buttons: [DialogButton.delete, DialogButton.cancel] },
            );
            if (result !== DialogButton.delete) return;
        }
        this.state.update((s) => {
            delete s.data[namespace];
            if (s.selectedNamespace === namespace) {
                const remaining = Object.keys(s.data).sort();
                s.selectedNamespace = remaining[0] ?? "";
                s.selectedProfile = s.selectedNamespace
                    ? Object.keys(s.data[s.selectedNamespace] ?? {})[0] ?? ""
                    : "";
            }
        });
    };

    // ── Save / release / dispose ────────────────────────────────────────

    /** Delegate to host — edits flow through the host, so `host.modified` is the source of
     *  truth (mirrors LinkEditor.modified). Without this override, `page.modified` / `pages`
     *  would report a dirty env-vars editor as unmodified, and the close-loop save prompt would
     *  be skipped. */
    get modified(): boolean {
        return this._host ? this._host.modified : super.modified;
    }

    async saveState(): Promise<void> {
        // Flush pending debounced save before host's saveState
        this.onDataChanged();
        await super.saveState();
    }

    async dispose(): Promise<void> {
        // Flush pending debounced save
        this.onDataChanged();
        await super.dispose();
    }
}
