/** Resolve expansion using controlled state, model state, then initial defaults. */
export function resolveExpandedValue(
    value: string | number,
    controlled: Readonly<Record<string | number, boolean>> | undefined,
    stateExpanded: Readonly<Record<string | number, boolean>>,
    defaultExpandedValues: Readonly<Record<string | number, boolean>> | undefined,
    defaultExpandAll: boolean,
): boolean {
    if (controlled !== undefined) return controlled[value] ?? false;
    const fromState = stateExpanded[value];
    if (fromState !== undefined) return fromState;
    const fromHint = defaultExpandedValues?.[value];
    return fromHint !== undefined ? fromHint : defaultExpandAll;
}

/** Return a copy of `current` with the proposed keys applied. */
export function applyExpandedChanges(
    current: Readonly<Record<string | number, boolean>>,
    changes: Readonly<Record<string | number, boolean>>,
): Record<string | number, boolean> {
    return { ...current, ...changes };
}
