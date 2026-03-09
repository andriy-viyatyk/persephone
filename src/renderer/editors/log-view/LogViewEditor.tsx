import styled from "@emotion/styled";
import { useSyncExternalStore } from "react";
import { TextFileModel } from "../text/TextPageModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { LogViewModel, LogViewState, defaultLogViewState } from "./LogViewModel";
import color from "../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const LogViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    overflow: "hidden",
    "& .log-view-placeholder": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "1 1 auto",
        color: color.text.light,
        fontSize: 14,
    },
    "& .log-view-error": {
        whiteSpace: "pre-wrap",
        margin: "auto",
        padding: 24,
        color: color.misc.yellow,
    },
});

// =============================================================================
// Component
// =============================================================================

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultLogViewState;

export function LogViewEditor({ model }: { model: TextFileModel }) {
    const vm = useContentViewModel<LogViewModel>(model, "log-view");

    const state: LogViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    if (!vm) return null;

    return (
        <LogViewRoot>
            {state.error ? (
                <div className="log-view-error">{state.error}</div>
            ) : (
                <div className="log-view-placeholder">
                    Log View — {state.entryCount} entries
                </div>
            )}
        </LogViewRoot>
    );
}
