import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Button } from "../../uikit/Button/Button";
import { Input } from "../../uikit/Input/Input";
import { Label } from "../../uikit/Label/Label";
import { Checkbox } from "../../uikit/Checkbox/Checkbox";
import { Flex, VStack } from "../../uikit/Flex/Flex";
import { spacing, gap } from "../../uikit/tokens";
import { ICON_PRESETS } from "./iconPresets";
import { PropDef, STORYBOOK_MANAGED_PROPS } from "./storyTypes";
import { StorybookEditorModel } from "./StorybookEditorModel";
import { findStory } from "./storyRegistry";

const Root = styled.div({
    width: 280,
    flexShrink: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    borderLeft: `1px solid ${color.border.default}`,
    padding: spacing.md,
    gap: spacing.md,
});

const EmptyMessage = styled.div({
    color: color.text.light,
    fontSize: 12,
    padding: spacing.md,
});

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
            <VStack gap={gap.xs}>
                <Label>{label}</Label>
                <Input
                    value={String(value ?? "")}
                    onChange={(v) => onChange(v)}
                    size="sm"
                    placeholder={def.placeholder}
                />
            </VStack>
        );
    }

    if (def.type === "number") {
        return (
            <VStack gap={gap.xs}>
                <Label>{label}</Label>
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
            </VStack>
        );
    }

    if (def.type === "enum") {
        return (
            <VStack gap={gap.xs}>
                <Label>{label}</Label>
                <Flex wrap={true} gap={gap.xs}>
                    {def.options.map((opt) => (
                        <Button
                            key={opt}
                            size="sm"
                            variant={value === opt ? "primary" : "link"}
                            onClick={() => onChange(opt)}
                        >
                            {opt}
                        </Button>
                    ))}
                </Flex>
            </VStack>
        );
    }

    if (def.type === "icon") {
        return (
            <VStack gap={gap.xs}>
                <Label>{label}</Label>
                <Flex wrap={true} gap={gap.xs}>
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
                </Flex>
            </VStack>
        );
    }

    return null;
}

export function PropertyEditor({ model }: { model: StorybookEditorModel }) {
    const { selectedStoryId, propValues } = model.state.use();
    const story = findStory(selectedStoryId);
    const visibleProps = story?.props.filter((p) => !STORYBOOK_MANAGED_PROPS.has(p.name)) ?? [];

    if (!story || visibleProps.length === 0) {
        return (
            <Root data-type="property-editor">
                <EmptyMessage>No editable props</EmptyMessage>
            </Root>
        );
    }

    return (
        <Root data-type="property-editor">
            {visibleProps.map((def) => (
                <PropRow
                    key={def.name}
                    def={def}
                    value={propValues[def.name]}
                    onChange={(v) => model.setPropValue(def.name, v)}
                />
            ))}
            <Button
                variant="ghost"
                size="sm"
                onClick={model.resetProps}
                style={{ marginTop: spacing.md, alignSelf: "flex-start" }}
            >
                Reset Props
            </Button>
        </Root>
    );
}
