export type LaunchInput =
    | { kind: "file"; path: string }
    | { kind: "url"; url: string }
    | { kind: "diff"; firstPath: string; secondPath: string };
