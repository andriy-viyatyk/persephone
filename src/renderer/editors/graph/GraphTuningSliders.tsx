import { useState, useCallback } from "react";
import styled from "@emotion/styled";
import { GraphViewModel } from "./GraphViewModel";
import { ForceGraphRenderer } from "./ForceGraphRenderer";
import color from "../../theme/color";

interface GraphTuningSlidersProps {
    vm: GraphViewModel;
}

const defaults = ForceGraphRenderer.defaultForceParams;

const sliders = [
    { key: "charge" as const, label: "Charge", min: -200, max: 0, step: 1, default: defaults.charge },
    { key: "linkDistance" as const, label: "Distance", min: 10, max: 200, step: 1, default: defaults.linkDistance },
    { key: "collide" as const, label: "Collide", min: 0, max: 1, step: 0.05, default: defaults.collide },
];

const GraphTuningSlidersRoot = styled.div({
    padding: "6px 8px",
    borderTop: `1px solid ${color.border.default}`,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    "& .tuning-slider-row": {
        display: "flex",
        alignItems: "center",
        gap: 6,
    },
    "& .tuning-slider-label": {
        fontSize: 11,
        color: color.graph.labelText,
        width: 52,
        flexShrink: 0,
    },
    "& .tuning-slider-input": {
        flex: 1,
        height: 4,
        appearance: "none",
        background: color.border.default,
        borderRadius: 2,
        outline: "none",
        cursor: "pointer",
        "&::-webkit-slider-thumb": {
            appearance: "none",
            width: 12,
            height: 12,
            marginTop: -4,
            borderRadius: "50%",
            background: color.graph.nodeHighlight,
            cursor: "pointer",
        },
        "&::-webkit-slider-runnable-track": {
            height: 4,
            borderRadius: 2,
        },
    },
    "& .tuning-slider-value": {
        fontSize: 11,
        color: color.graph.labelText,
        width: 32,
        textAlign: "right",
        flexShrink: 0,
    },
    "& .tuning-reset-row": {
        display: "flex",
        justifyContent: "flex-end",
        marginTop: 2,
    },
    "& .tuning-reset-btn": {
        padding: "1px 8px",
        fontSize: 11,
        cursor: "pointer",
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        backgroundColor: "transparent",
        color: color.graph.labelText,
        "&:hover": {
            borderColor: color.graph.nodeHighlight,
        },
    },
});

function GraphTuningSliders({ vm }: GraphTuningSlidersProps) {
    const [values, setValues] = useState(() => {
        const current = vm.renderer.forceParams;
        return {
            charge: current.charge,
            linkDistance: current.linkDistance,
            collide: current.collide,
        };
    });

    const onChange = useCallback((key: keyof typeof values, raw: string) => {
        const value = parseFloat(raw);
        setValues((prev) => ({ ...prev, [key]: value }));
        vm.updateForceParams({ [key]: value });
    }, [vm]);

    const onReset = useCallback(() => {
        setValues({
            charge: defaults.charge,
            linkDistance: defaults.linkDistance,
            collide: defaults.collide,
        });
        vm.resetForceParams();
    }, [vm]);

    return (
        <GraphTuningSlidersRoot>
            {sliders.map((s) => (
                <div key={s.key} className="tuning-slider-row">
                    <span className="tuning-slider-label">{s.label}</span>
                    <input
                        className="tuning-slider-input"
                        type="range"
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        value={values[s.key]}
                        onChange={(e) => onChange(s.key, e.target.value)}
                    />
                    <span className="tuning-slider-value">{values[s.key]}</span>
                </div>
            ))}
            <div className="tuning-reset-row">
                <button className="tuning-reset-btn" onClick={onReset}>Reset</button>
            </div>
        </GraphTuningSlidersRoot>
    );
}

export { GraphTuningSliders };
