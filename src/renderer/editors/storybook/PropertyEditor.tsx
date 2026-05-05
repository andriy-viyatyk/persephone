import React from "react";
import { Panel } from "../../uikit/Panel/Panel";
import { Button } from "../../uikit/Button/Button";
import { Input } from "../../uikit/Input/Input";
import { Label } from "../../uikit/Label/Label";
import { Checkbox } from "../../uikit/Checkbox/Checkbox";
import { Text } from "../../uikit/Text/Text";
import { ICON_PRESETS } from "./iconPresets";
import { PropDef, STORYBOOK_MANAGED_PROPS } from "./storyTypes";
import { StorybookEditorModel } from "./StorybookEditorModel";
import { findStory } from "./storyRegistry";

function PropRow({ def, value, onChange }: {
    def: PropDef;
    value: unknown;
    onChange: (v: unknown) => void;
}) {
    const label = def.label ?? def.name;

    if (def.type === "boolean") {
        return (
            <Checkbox
                checked={Boolean(value)}
                onChange={(v) => onChange(v)}
            >
                {label}
            </Checkbox>
        );
    }

    if (def.type === "string") {
        return (
            <Panel direction="column" gap="xs">
                <Label color="light">{label}</Label>
                <Input
                    value={String(value ?? "")}
                    onChange={(v) => onChange(v)}
                    size="sm"
                    placeholder={def.placeholder}
                />
            </Panel>
        );
    }

    if (def.type === "number") {
        return (
            <Panel direction="column" gap="xs">
                <Label color="light">{label}</Label>
                <Input
                    value={String(value ?? "")}
                    onChange={(v) => {
                        const n = Number(v);
                        if (!isNaN(n)) onChange(n);
                    }}
                    size="sm"
                    type="number"
                    min={def.min}
                    max={def.max}
                    step={def.step}
                />
            </Panel>
        );
    }

    if (def.type === "enum") {
        return (
            <Panel direction="column" gap="xs">
                <Label color="light">{label}</Label>
                <Panel direction="row" wrap gap="xs">
                    {def.options.map((opt) => (
                        <Button
                            key={opt}
                            size="sm"
                            variant={value === opt ? "primary" : "link"}
                            onClick={() => onChange(opt)}
                        >
                            {opt === "" ? <Label italic color="inherit">(empty)</Label> : opt}
                        </Button>
                    ))}
                </Panel>
            </Panel>
        );
    }

    if (def.type === "icon") {
        return (
            <Panel direction="column" gap="xs">
                <Label color="light">{label}</Label>
                <Panel direction="row" wrap gap="xs">
                    {ICON_PRESETS.map((preset) => (
                        <Button
                            key={preset.id}
                            size="sm"
                            variant={value === preset.id ? "primary" : "link"}
                            onClick={() => onChange(preset.id)}
                        >
                            {preset.label}
                        </Button>
                    ))}
                </Panel>
            </Panel>
        );
    }

    return null;
}

export function PropertyEditor({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId, propValues, rightPanelWidth } = model.state.use();
    const story = findStory(selectedStoryId);
    const visibleProps = story?.props.filter((p) => !STORYBOOK_MANAGED_PROPS.has(p.name)) ?? [];

    if (!story || visibleProps.length === 0) {
        return (
            <Panel
                data-type="property-editor"
                direction="column"
                width={rightPanelWidth}
                shrink={false}
                overflowY="auto"
                padding="md"
            >
                <Panel padding="md">
                    <Text size="sm" color="light">No editable props</Text>
                </Panel>
            </Panel>
        );
    }

    return (
        <Panel
            data-type="property-editor"
            direction="column"
            width={rightPanelWidth}
            shrink={false}
            overflowY="auto"
            padding="md"
            gap="md"
        >
            {visibleProps.map((def) => (
                <PropRow
                    key={def.name}
                    def={def}
                    value={propValues[def.name]}
                    onChange={(v) => model.setPropValue(def.name, v)}
                />
            ))}
            <Panel align="start">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={model.resetProps}
                >
                    Reset Props
                </Button>
            </Panel>
        </Panel>
    );
}
