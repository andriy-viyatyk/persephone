import styled from "@emotion/styled";
import { ProgressOutputEntry } from "../logTypes";
import { StyledTextView } from "../StyledTextView";
import { CircularProgress } from "../../../components/basic/CircularProgress";
import color from "../../../theme/color";

// =============================================================================
// Constants
// =============================================================================

const SPINNER_SIZE = 16;

// =============================================================================
// Styled Components
// =============================================================================

const ProgressRoot = styled.div({
    padding: "2px 0",

    "& .progress-label-row": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        lineHeight: "18px",
        marginBottom: 2,
    },

    "& .progress-track": {
        width: 160,
        height: 6,
        borderRadius: 3,
        background: color.background.dark,
        overflow: "hidden",
    },

    "& .progress-fill": {
        height: "100%",
        borderRadius: 3,
        background: color.misc.blue,
        transition: "width 0.2s ease",
    },

    "& .progress-fill.completed": {
        background: color.misc.green,
    },

    "& .progress-info": {
        fontSize: 11,
        color: color.text.light,
        marginTop: 1,
    },
});

// =============================================================================
// Component
// =============================================================================

interface ProgressOutputViewProps {
    entry: ProgressOutputEntry;
}

export function ProgressOutputView({ entry }: ProgressOutputViewProps) {
    const { label, value, max = 100, completed } = entry;
    const indeterminate = value == null && !completed;
    const percent = completed ? 100 : (value != null ? Math.min(100, (value / max) * 100) : 0);

    return (
        <ProgressRoot>
            {(label || indeterminate) && (
                <div className="progress-label-row">
                    {indeterminate && <CircularProgress size={SPINNER_SIZE} />}
                    {label && <StyledTextView text={label} />}
                </div>
            )}
            {!indeterminate && (
                <div className="progress-track">
                    <div
                        className={`progress-fill${completed ? " completed" : ""}`}
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}
            {value != null && !completed && (
                <div className="progress-info">{value} / {max}</div>
            )}
        </ProgressRoot>
    );
}
