import { useEffect, useState } from "react";
import { IEditorState, EditorType } from "../../../shared/types";
import { getDefaultEditorModelState, EditorModel } from "../base";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { PersephoneIcon } from "../../theme/icons";
import { Panel, Text, Button, Divider } from "../../uikit";
import { app } from "../../api/app";
import { shell } from "../../api/shell";
import type { IRuntimeVersions, IUpdateInfo } from "../../api/types/shell";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import { EventEndpoint } from "../../../ipc/api-types";
import type { UpdateCheckResult } from "../../../ipc/api-param-types";

// ============================================================================
// AboutEditorModel (Page Model)
// ============================================================================

export const ABOUT_PAGE_ID = "about-page";

interface AboutEditorModelState extends IEditorState {}

const getDefaultAboutPageModelState = (): AboutEditorModelState => ({
    ...getDefaultEditorModelState(),
    id: ABOUT_PAGE_ID,
    type: "aboutPage",
    title: "About",
});

class AboutEditorModel extends EditorModel<AboutEditorModelState, void> {
    noLanguage = true;
    skipSave = true;

    getRestoreData() {
        return JSON.parse(JSON.stringify(this.state.get()));
    }

    async restore() {
        this.state.update((s) => {
            s.title = "About";
        });
    }
}

// ============================================================================
// AboutPage Component
// ============================================================================

interface AboutEditorProps {
    model: AboutEditorModel;
}

function mapUpdateResult(result: UpdateCheckResult): IUpdateInfo {
    const ri = result.releaseInfo;
    return {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        updateAvailable: result.updateAvailable,
        releaseUrl: ri?.htmlUrl ?? null,
        releaseVersion: ri?.version ?? null,
        publishedAt: ri?.publishedAt ?? null,
        releaseNotes: ri?.body ?? null,
        error: result.error,
    };
}

function AboutPage(_props: AboutEditorProps) {
    const [runtimeVersions, setRuntimeVersions] = useState<IRuntimeVersions | null>(null);
    const [updateResult, setUpdateResult] = useState<IUpdateInfo | null>(null);
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        shell.version.runtimeVersions().then(setRuntimeVersions);

        const subscription = rendererEvents[EventEndpoint.eUpdateAvailable].subscribe(
            (result: UpdateCheckResult) => {
                setUpdateResult(mapUpdateResult(result));
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const handleCheckForUpdates = async () => {
        setChecking(true);
        try {
            const result = await shell.version.checkForUpdates(true);
            setUpdateResult(result);
        } finally {
            setChecking(false);
        }
    };

    const renderUpdateStatus = () => {
        if (checking) {
            return <Text size="md" color="light">Checking for updates...</Text>;
        }
        if (!updateResult) {
            return null;
        }
        if (updateResult.updateAvailable && updateResult.releaseVersion && updateResult.releaseUrl) {
            const { releaseVersion, releaseUrl } = updateResult;
            return (
                <>
                    <Text size="md" color="warning">
                        New version {releaseVersion} available!
                    </Text>
                    <Panel justify="center" wrap gap="lg">
                        <Button variant="link" size="sm" onClick={() => shell.openExternal(releaseUrl)}>
                            Download
                        </Button>
                        <Button
                            variant="link"
                            size="sm"
                            onClick={() => shell.openExternal("https://github.com/andriy-viyatyk/persephone/blob/main/docs/whats-new.md")}
                        >
                            What's New
                        </Button>
                    </Panel>
                </>
            );
        }
        return <Text size="md" color="success">You're up to date!</Text>;
    };

    return (
        <Panel direction="column" align="center" justify="center" padding="xxxl" flex overflow="auto">
            <Panel
                direction="column"
                align="center"
                padding="xxxl"
                background="light"
                rounded="xl"
                width="100%"
                maxWidth={400}
                gap="xl"
            >
                <Panel width={64} height={64} align="center" justify="center">
                    <PersephoneIcon width={64} height={64} />
                </Panel>

                <Panel direction="column" align="center" gap="xs">
                    <Text size="xxl" bold>Persephone</Text>
                    <Text color="light">Version {app.version || "..."}</Text>
                </Panel>

                <Divider />

                <Panel direction="column" gap="lg" width="100%">
                    <Panel justify="between">
                        <Text size="md" color="light">Electron</Text>
                        <Text size="md">{runtimeVersions?.electron || "..."}</Text>
                    </Panel>
                    <Panel justify="between">
                        <Text size="md" color="light">Node.js</Text>
                        <Text size="md">{runtimeVersions?.node || "..."}</Text>
                    </Panel>
                    <Panel justify="between">
                        <Text size="md" color="light">Chromium</Text>
                        <Text size="md">{runtimeVersions?.chrome || "..."}</Text>
                    </Panel>
                </Panel>

                <Divider />

                <Panel direction="column" align="center" gap="lg" width="100%">
                    <Button variant="primary" onClick={handleCheckForUpdates} disabled={checking}>
                        {checking ? "Checking..." : "Check for Updates"}
                    </Button>
                    {renderUpdateStatus()}
                </Panel>

                <Divider />

                <Panel justify="center" wrap gap="lg" width="100%">
                    <Button
                        variant="link"
                        size="sm"
                        onClick={() => shell.openExternal("https://github.com/andriy-viyatyk/persephone")}
                    >
                        GitHub Repository
                    </Button>
                    <Button
                        variant="link"
                        size="sm"
                        onClick={() => shell.openExternal("https://github.com/andriy-viyatyk/persephone/issues")}
                    >
                        Report Issue
                    </Button>
                </Panel>
            </Panel>
        </Panel>
    );
}

// ============================================================================
// Editor Module
// ============================================================================

const aboutEditorModule: EditorModule = {
    Editor: AboutPage,
    newEditorModel: async () => {
        return new AboutEditorModel(new TComponentState(getDefaultAboutPageModelState()));
    },
    newEmptyEditorModel: async (editorType: EditorType): Promise<EditorModel | null> => {
        if (editorType === "aboutPage") {
            return new AboutEditorModel(new TComponentState(getDefaultAboutPageModelState()));
        }
        return null;
    },
    newEditorModelFromState: async (state: Partial<IEditorState>): Promise<EditorModel> => {
        const initialState: AboutEditorModelState = {
            ...getDefaultAboutPageModelState(),
            ...state,
        };
        return new AboutEditorModel(new TComponentState(initialState));
    },
};

export default aboutEditorModule;

// Named exports
export { AboutPage, AboutEditorModel };
export type { AboutEditorProps, AboutEditorModelState };
