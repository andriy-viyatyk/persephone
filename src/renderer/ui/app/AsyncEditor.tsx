import styled from "@emotion/styled";
import { EditorViewModule } from "../../editors/types";
import { EditorModel } from "../../editors/base";
import type { IContentHost } from "../../editors/base/IContentHost";
import { useEffect, useState } from "react";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { EditorErrorBoundary } from "../../components/basic/EditorErrorBoundary";

const ProgressRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
});

// Module cache to avoid reloading and prevent height jumps during editor switches
const moduleCache = new Map<string, EditorViewModule>();

export interface AsyncEditorProps {
    getEditorModule: () => Promise<EditorViewModule>;
    model: EditorModel | IContentHost;
    /** Unique identifier for caching the loaded module (e.g., editor type) */
    cacheKey?: string;
}

export function AsyncEditor({ getEditorModule, model, cacheKey }: AsyncEditorProps) {
    // Check cache first for instant render (only if cacheKey provided)
    const cachedModule = cacheKey ? moduleCache.get(cacheKey) : undefined;
    const [EditorModule, setEditorModule] = useState<EditorViewModule | null>(
        cachedModule ?? null
    );

    useEffect(() => {
        // Skip if already cached
        if (cacheKey) {
            const cached = moduleCache.get(cacheKey);
            if (cached) {
                if (EditorModule !== cached) {
                    setEditorModule(cached);
                }
                return;
            }
        }

        getEditorModule().then((module) => {
            if (cacheKey) {
                moduleCache.set(cacheKey, module);
            }
            setEditorModule(module);
        });
    }, [getEditorModule, cacheKey]);

    if (!EditorModule) {
        return (
            <ProgressRoot>
                <CircularProgress size={16}/>
            </ProgressRoot>
        );
    }

    return (
        <EditorErrorBoundary>
            <EditorModule.Editor model={model} />
        </EditorErrorBoundary>
    );
}

export type AsyncEditorComponent = typeof AsyncEditor;
