import React, { useState } from "react";
import { Notification, NotificationSeverity } from "./Notification";
import { Panel } from "../Panel/Panel";
import { Button } from "../Button/Button";
import { Text } from "../Text/Text";
import { Story } from "../../editors/storybook/storyTypes";

interface DemoProps {
    type?: NotificationSeverity;
    message?: string;
    bodyClickable?: boolean;
    showCloseButton?: boolean;
}

function NotificationDemo({
    type = "info",
    message = "Something happened that you should know about.",
    bodyClickable = false,
    showCloseButton = true,
}: DemoProps) {
    const [version, setVersion] = useState(0);
    const [log, setLog] = useState<string[]>([]);

    const addLog = (entry: string) => {
        setLog((prev) => [entry, ...prev].slice(0, 6));
    };

    return (
        <Panel direction="column" gap="md" width="100%" padding="md">
            <Panel direction="row" gap="md" align="center">
                <Button onClick={() => setVersion((v) => v + 1)}>Replay animation</Button>
                <Text size="xs" color="light">
                    Click to remount the Notification and see the slide-in animation.
                </Text>
            </Panel>

            <Panel direction="row" justify="end" position="relative" minHeight={80}>
                <Notification
                    key={version}
                    type={type}
                    message={message}
                    onClick={
                        bodyClickable
                            ? () => addLog("body clicked → onClose('clicked')")
                            : undefined
                    }
                    onClose={
                        showCloseButton
                            ? () => addLog("close X clicked → onClose()")
                            : undefined
                    }
                />
            </Panel>

            <Panel direction="column" gap="xs">
                <Text size="xs" color="light">Click log (latest first):</Text>
                {log.length === 0 ? (
                    <Text size="sm" color="light" italic>(no clicks yet)</Text>
                ) : (
                    log.map((entry, i) => (
                        <Text key={i} size="sm">{entry}</Text>
                    ))
                )}
            </Panel>
        </Panel>
    );
}

export const notificationStory: Story = {
    id: "notification",
    name: "Notification",
    section: "Overlay",
    component: NotificationDemo as React.ComponentType<Record<string, unknown>>,
    props: [
        { name: "type", type: "enum", options: ["info", "success", "warning", "error"], default: "info" },
        { name: "message", type: "string", default: "Something happened that you should know about." },
        { name: "bodyClickable", type: "boolean", default: false, label: "Body clickable" },
        { name: "showCloseButton", type: "boolean", default: true, label: "Show close button" },
    ],
};
