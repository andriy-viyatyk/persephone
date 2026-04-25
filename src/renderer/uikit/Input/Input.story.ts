import { Input } from "./Input";
import { Story } from "../../editors/storybook/storyTypes";

export const inputStory: Story = {
    id: "input",
    name: "Input",
    section: "Bootstrap",
    component: Input as any,
    props: [
        { name: "value", type: "string", default: "Hello", placeholder: "Enter text" },
        { name: "placeholder", type: "string", default: "Placeholder text" },
        { name: "size", type: "enum", options: ["sm", "md"], default: "md" },
        { name: "disabled", type: "boolean", default: false },
        { name: "readOnly", type: "boolean", default: false },
    ],
    defaultProps: {
        onChange: () => {},
    },
};
