# EPIC-015: ITreeProvider — Browsable Source Abstraction

**Status:** Future
**Priority:** Medium
**Created:** 2026-03-28

## Goal

Introduce `ITreeProvider` interface to abstract browsable data sources (directories, ZIP archives, FTP servers, etc.) and migrate the NavigationPanel and FileExplorer to use it. This completes the content delivery architecture started in EPIC-012 by adding the "browse" counterpart to the existing "read/write" pipe system.

## Motivation

EPIC-012 introduced `IProvider` (reads/writes one resource) and `IContentPipe` (provider + transformers). But browsing — listing children, navigating directories, renaming/moving files within a source — is still handled by scattered `app.fs` calls with hardcoded archive path detection.

`ITreeProvider` enumerates children and provides tree operations (list, rename, delete, move). It complements `IProvider` the same way a file explorer complements a text editor.

## High-Level Design

From EPIC-012 design doc:

```typescript
interface ITreeProvider {
    readonly type: string;
    readonly displayName: string;
    readonly sourceUrl: string;
    list(path: string): Promise<ITreeEntry[]>;
    stat(path: string): Promise<ITreeStat>;
    resolveLink(path: string): string;  // → raw link string for openLink
    rename?(oldPath: string, newPath: string): Promise<void>;
    delete?(path: string): Promise<void>;
    move?(oldPath: string, newPath: string): Promise<void>;
}
```

### Planned Implementations

| TreeProvider | Source | Notes |
|---|---|---|
| `FileSystemTreeProvider` | Local directory | Replaces current file explorer fs logic |
| `ZipTreeProvider` | ZIP archive | Replaces current archive NavPanel logic |

## Scope (Initial Checklist)

- [ ] Define `ITreeProvider` interface and types (`io.tree.d.ts`)
- [ ] Implement `FileSystemTreeProvider`
- [ ] Implement `ZipTreeProvider`
- [ ] Migrate NavigationPanel to use ITreeProvider
- [ ] Migrate FileExplorer to use ITreeProvider
- [ ] `navigatePageTo` — route through `app.events.openLink()` with `pageId` in metadata
- [ ] `TextFileIOModel.renameFile` — delegate to ITreeProvider
- [ ] Derive ITreeProvider from pipe provider when not explicitly linked
- [ ] Multi-file drag-drop → virtual SelectedTreeView
- [ ] Expose tree providers in script `io` namespace

## References

- **EPIC-012 design:** ITreeProvider section in [EPIC-012.md](EPIC-012.md) (lines 353-428)
- **Review findings:** Task 5 in [US-288 review report](../tasks/US-288-review-epic-012/review-report.md#task-5-itreeprovider-investigation--refactoring)
