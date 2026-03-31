# US-311: Explorer Auto-Refresh

**Status:** Planned
**Epic:** EPIC-015 (Phase 5 — Polishing)

## Goal

Automatically refresh the Explorer tree when files/folders are created, deleted, or renamed outside the app. Currently users must manually click "Refresh" to see external changes.

## Background

### Proven pattern: library-service.ts

`library-service.ts` already uses a single recursive `fs.watch()` on the Script Library folder:

```typescript
// library-service.ts:196-204
this.watcher = nodefs.watch(libraryPath, { recursive: true }, () => {
    this.onChangeDebounced(libraryPath);  // 300ms debounce
});
```

On Windows, `fs.watch({ recursive: true })` uses `ReadDirectoryChangesW` — one OS handle for the entire subtree. Efficient and reliable.

### Current refresh flow

`TreeProviderViewModel.buildTree()` already:
1. Captures expanded paths from `treeViewRef.getExpandMap()`
2. Re-reads root directory via `provider.list(rootPath)`
3. Reloads children for all previously expanded paths
4. Preserves expand state across rebuild

So the infrastructure for refresh-with-state-preservation exists. We just need a trigger.

### Where FileTreeProvider is created

| Location | Usage |
|---|---|
| `PageNavigator.tsx:69` | Per-page Explorer panel (stored in NavigationData) |
| `MenuBar.tsx:199` | Sidebar user-added folders (cached in providerMap) |
| `ScriptLibraryPanel.tsx:90` | Script Library panel (useMemo) |

## Implementation Plan

### Step 1: Add `watch()` to FileTreeProvider

Add an optional `watch(callback)` method to `FileTreeProvider` that creates a recursive `fs.watch()` on `sourceUrl`:

```typescript
// FileTreeProvider.ts
watch(callback: () => void): { unsubscribe: () => void } {
    try {
        const watcher = nodefs.watch(this.sourceUrl, { recursive: true }, debounced);
        return { unsubscribe: () => watcher.close() };
    } catch {
        return { unsubscribe: () => {} };  // graceful degradation
    }
}
```

- 500ms debounce (slightly longer than the 300ms file watcher — directory changes often come in bursts, e.g. `git checkout`)
- Graceful degradation on failure (return no-op subscription)
- No changes to `ITreeProvider` interface — this is `FileTreeProvider`-specific

**File:** `src/renderer/content/tree-providers/FileTreeProvider.ts`

### Step 2: Subscribe in TreeProviderViewModel

In `TreeProviderViewModel`, subscribe to `provider.watch()` (if available) during initialization, and call `buildTree()` on change:

```typescript
// TreeProviderViewModel init or setProps
init() {
    const provider = this.props.provider as any;
    if (typeof provider.watch === 'function') {
        this.watchSubscription = provider.watch(() => this.buildTree());
    }
}

dispose() {
    this.watchSubscription?.unsubscribe();
}
```

Key points:
- Check `provider.watch` existence with `typeof` — only FileTreeProvider has it
- Unsubscribe on dispose (component unmount) and on provider change
- On provider change in `setProps`, unsubscribe old and subscribe new

**File:** `src/renderer/components/tree-provider/TreeProviderViewModel.tsx`

### Step 3: Handle provider change and unmount

When `setProps` detects a provider change (`this.oldProps?.provider !== this.props.provider`):
1. Unsubscribe old watch
2. Subscribe to new provider's watch
3. Rebuild tree (already done)

On `dispose()`: unsubscribe watch.

**File:** `src/renderer/components/tree-provider/TreeProviderViewModel.tsx`

## Files Changed

| File | Change |
|---|---|
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Add `watch()` method with recursive `fs.watch` + debounce |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | Subscribe to `provider.watch()` in init, cleanup on dispose/provider change |

## Files NOT Changed

- `ITreeProvider` interface — `watch()` is FileTreeProvider-specific, not part of the interface
- `NavigationData.ts` — no changes needed, it just stores the provider reference
- `PageNavigator.tsx` — no changes, TreeProviderView handles watching internally
- `MenuBar.tsx` / `ScriptLibraryPanel.tsx` — no changes, same reason
- `ZipTreeProvider.ts` — archives don't change externally

## Concerns

### 1. Multiple watchers on overlapping paths

If the sidebar has folder `D:\projects` and a page's Explorer shows `D:\projects\persephone`, two watchers overlap. This is harmless — each watcher is on a different `FileTreeProvider` instance and each triggers its own `buildTree()`. No deduplication needed.

### 2. Very large directories

`fs.watch({ recursive: true })` on a massive directory (e.g., `C:\`) could be expensive. But users explicitly choose which folders to browse — this is the same scope as the current manual refresh. No artificial limit needed.

### 3. Network drives / external volumes

`fs.watch()` may not work on network drives. The graceful degradation (try/catch → no-op subscription) handles this — users just don't get auto-refresh and continue using manual refresh.

### 4. Debounce timing

500ms is chosen to batch rapid changes (git operations, build tools). Could be adjusted if too slow/fast. library-service uses 300ms for reference.

## Acceptance Criteria

- [ ] Explorer tree auto-refreshes when files/folders created/deleted/renamed externally
- [ ] Expanded folder state preserved across auto-refresh
- [ ] Works in PageNavigator Explorer panel
- [ ] Works in Sidebar user-added folders
- [ ] Works in Script Library panel
- [ ] No errors on network drives or unmounted volumes (graceful degradation)
- [ ] Watcher properly cleaned up on page close / sidebar hide
