import styled from "@emotion/styled";
import { useEffect, useSyncExternalStore } from "react";
import { TextFileModel } from "../text/TextPageModel";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { EditorError } from "../base/EditorError";
import { useContentViewModel } from "../base/useContentViewModel";
import { GraphViewModel, GraphViewState, defaultGraphViewState } from "./GraphViewModel";
import color from "../../theme/color";

// ============================================================================
// Styled Components
// ============================================================================

const GraphViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    overflow: "hidden",
    position: "relative",
    "& .graph-loading": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "1 1 auto",
        backgroundColor: color.graph.background,
    },
    "& .graph-canvas": {
        width: "100%",
        height: "100%",
        flex: "1 1 auto",
        backgroundColor: color.graph.background,
    },
});

// ============================================================================
// GraphView Component
// ============================================================================

interface GraphViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultGraphViewState;

function GraphView({ model }: GraphViewProps) {
    const vm = useContentViewModel<GraphViewModel>(model, "graph-view");

    const pageState: GraphViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    // Refresh resolved canvas colors when component re-renders (theme changes cause re-render)
    useEffect(() => {
        vm?.refreshColors();
    });

    if (!vm) return null;

    const { error, loading, graphData } = pageState;

    return (
        <GraphViewRoot>
            {error && <EditorError>{error}</EditorError>}
            {loading ? (
                <div className="graph-loading">
                    <CircularProgress />
                </div>
            ) : (
                <canvas
                    className="graph-canvas"
                    ref={(el) => vm.renderer.setCanvas(el)}
                    onClick={vm.renderer.onClick}
                    onMouseMove={vm.renderer.onMouseMove}
                />
            )}
        </GraphViewRoot>
    );
}

export { GraphView };
export type { GraphViewProps };
