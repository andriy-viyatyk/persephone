---
title: "Grouping, Session, and Watching"
audience: both
summary: "How do page groups, session restore, and file watching work?"
---

# Grouping, Session, and Watching

## Tab Grouping (Side-by-Side View)

You can display two files side-by-side by grouping their tabs.

### Creating a Group

- Hold **Ctrl** and **click** on a tab to group it with the currently active tab
- Both files appear side-by-side in the editor area

### Ungrouping

- Click the **close** button on either grouped tab's indicator to ungroup them
- The tabs return to normal individual view

### Compare Mode

When two text files are grouped, a **Compare** button appears in the toolbar. Click it to enter diff view:

- Side-by-side comparison using Monaco's diff editor
- Additions, deletions, and modifications are highlighted
- Navigate between changes


## Session Restore

persephone automatically saves your session when you close the application. On next launch:

- All previously open tabs are restored
- Editor content, scroll positions, and state are preserved
- Unsaved changes are recovered
- Grid filters, sorting, and search state are restored

## File Watching

When a file that is open in persephone is modified by another application:

- The editor detects the change automatically
- If you haven't made local edits, the content refreshes silently
- The file status updates in real time (including deletion detection)

If you rename or move an open file from Persephone's Explorer, its tab follows the file to its
new location and keeps any unsaved edits. Renames made outside Persephone are followed when the
file watcher can see both the old and new paths. A file that is deleted still shows as deleted.
