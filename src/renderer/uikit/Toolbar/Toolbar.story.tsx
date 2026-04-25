import React from "react";
import { Toolbar } from "./Toolbar";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Spacer } from "../Spacer/Spacer";
import { Text } from "../Text/Text";
import { resolveIconPreset } from "../../editors/storybook/iconPresets";
import { Story } from "../../editors/storybook/storyTypes";

const ToolbarDemo = (props: any) => {
    const [picked, setPicked] = React.useState("default");
    return (
        <Toolbar {...props}>
            <Text variant="caption">Demo:</Text>
            <Button>Action</Button>
            <IconButton icon={resolveIconPreset("save")} aria-label="Save" />
            <Spacer />
            <SegmentedControl
                items={[
                    { value: "default", label: "Default" },
                    { value: "light",   label: "Light"   },
                    { value: "dark",    label: "Dark"    },
                ]}
                value={picked}
                onChange={setPicked}
                size="sm"
                background={props.background}
            />
        </Toolbar>
    );
};

export const toolbarStory: Story = {
    id: "toolbar",
    name: "Toolbar",
    section: "Layout",
    component: ToolbarDemo,
    props: [
        { name: "orientation",  type: "enum",    options: ["horizontal", "vertical"], default: "horizontal" },
        { name: "background",   type: "enum",    options: ["default", "light", "dark"], default: "dark" },
        { name: "borderTop",    type: "boolean", default: false },
        { name: "borderBottom", type: "boolean", default: false },
        { name: "disabled",     type: "boolean", default: false },
    ],
};
