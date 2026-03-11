[← API Reference](./index.md)

# app.fs

File system operations, dialogs, and OS integration.

```javascript
const text = await app.fs.read("C:/data/file.txt");
await app.fs.write("C:/data/out.txt", text);
```

## Archive Paths

All `app.fs` read/write/stat/list methods transparently support **archive paths** — paths that point to files *inside* ZIP archives. Archive paths use the `!` character as a separator between the archive file and the inner path:

```
<archive-file>!<inner-path>
```

For example:

| Archive path | Archive file | Inner path |
|---|---|---|
| `D:/temp/doc.zip!word/document.xml` | `D:/temp/doc.zip` | `word/document.xml` |
| `C:/data/bundle.zip!config.json` | `C:/data/bundle.zip` | `config.json` |
| `C:/data/backup.zip!logs/2026/jan.log` | `C:/data/backup.zip` | `logs/2026/jan.log` |

```javascript
// Read a file from inside a ZIP archive
const xml = await app.fs.read("D:/temp/doc.zip!word/document.xml");

// Write to a file inside an archive (creates the entry if it doesn't exist)
await app.fs.write("D:/temp/doc.zip!data/output.json", jsonContent);

// Check if a file exists inside an archive
const found = await app.fs.exists("C:/data/bundle.zip!config.json");

// List files in an archive directory
const entries = await app.fs.listDir("C:/data/bundle.zip!src");

// Get metadata for a file inside an archive
const info = await app.fs.stat("C:/data/bundle.zip!README.md");
```

The following methods support archive paths: `read`, `readFile`, `readBinary`, `write`, `writeBinary`, `exists`, `delete`, `stat`, `listDir`, and `listDirWithTypes`. The routing is automatic — you simply pass an archive path and `app.fs` handles the rest.

Write operations read the full archive, modify the entry, and write it back. For best performance, batch multiple writes to the same archive.

## File I/O

### read(filePath, encoding?) → `Promise<string>`

Read a text file with auto-detected encoding. Simplest way to read files in scripts.

```javascript
const content = await app.fs.read("C:/data/config.json");
const data = JSON.parse(content);
```

### readFile(filePath, encoding?) → `Promise<ITextFile>`

Read a text file, returning both content and detected encoding.

```javascript
const { content, encoding } = await app.fs.readFile("C:/data/file.txt");
console.log(`Encoding: ${encoding}`); // e.g. "utf-8", "utf-16le"
```

### readBinary(filePath) → `Promise<Buffer>`

Read a file as binary data.

```javascript
const buffer = await app.fs.readBinary("C:/data/image.png");
console.log(`Size: ${buffer.length} bytes`);
```

### write(filePath, content, encoding?) → `Promise<void>`

Write text content to a file. Creates parent directories if needed. Default encoding: `"utf-8"`.

```javascript
await app.fs.write("C:/data/output.txt", "Hello world");
await app.fs.write("C:/data/output.txt", content, "utf-16le");
```

### writeBinary(filePath, data) → `Promise<void>`

Write binary data to a file. Creates parent directories if needed.

### exists(filePath) → `Promise<boolean>`

Check if a file or directory exists.

```javascript
if (await app.fs.exists("C:/data/config.json")) {
    const config = await app.fs.read("C:/data/config.json");
}
```

### delete(filePath) → `Promise<void>`

Delete a file. No-op if the file doesn't exist.

### rename(oldPath, newPath) → `Promise<void>`

Rename or move a file.

```javascript
await app.fs.rename("C:/data/draft.txt", "C:/data/final.txt");

// Also works as a move operation
await app.fs.rename("C:/inbox/file.csv", "C:/archive/file.csv");
```

### copyFile(srcPath, destPath) → `Promise<void>`

Copy a file to a new location. Overwrites the destination if it already exists.

```javascript
await app.fs.copyFile("C:/data/template.json", "C:/data/config.json");
```

### stat(filePath) → `Promise<IFileStat>`

Get file or directory metadata. Returns an object with `size` (bytes), `mtime` (last modified ISO string), `exists` (boolean), and `isDirectory` (boolean).

```javascript
const info = await app.fs.stat("C:/data/report.csv");
if (info.exists) {
    console.log(`Size: ${info.size} bytes`);
    console.log(`Modified: ${info.mtime}`);
    console.log(`Is directory: ${info.isDirectory}`);
}
```

## Directory Operations

### listDir(dirPath, pattern?) → `Promise<string[]>`

List files and directories inside a folder. Returns entry names only, not full paths. Returns an empty array if the directory does not exist.

The optional `pattern` argument filters results by extension string (e.g. `".json"`) or a `RegExp`.

```javascript
// List everything in a folder
const entries = await app.fs.listDir("C:/data/exports");
console.log(entries); // ["report.csv", "summary.json", "archive"]

// Filter by extension
const jsonFiles = await app.fs.listDir("C:/data/exports", ".json");
// ["summary.json"]

// Filter by RegExp
const logs = await app.fs.listDir("C:/logs", /\d{4}-\d{2}-\d{2}\.log/);
```

To get full paths, combine with the directory path:

```javascript
const dir = "C:/data/exports";
const files = await app.fs.listDir(dir, ".csv");
for (const name of files) {
    const content = await app.fs.read(`${dir}/${name}`);
    console.log(name, content.length);
}
```

### listDirWithTypes(dirPath) → `Promise<IDirEntry[]>`

List files and directories inside a folder, including type information. Each entry has `name` (string) and `isDirectory` (boolean). Returns an empty array if the directory does not exist.

```javascript
const entries = await app.fs.listDirWithTypes("C:/data/exports");
for (const entry of entries) {
    if (entry.isDirectory) {
        console.log(`[DIR]  ${entry.name}`);
    } else {
        console.log(`[FILE] ${entry.name}`);
    }
}
```

### removeDir(dirPath, recursive?) → `Promise<void>`

Remove a directory. By default, the directory must be empty. Pass `true` for `recursive` to remove the directory and all its contents.

```javascript
// Remove an empty directory
await app.fs.removeDir("C:/data/temp");

// Remove a directory and everything inside it
await app.fs.removeDir("C:/data/old-exports", true);
```

### mkdir(dirPath) → `Promise<void>`

Create a directory. Parent directories are created automatically if they do not exist. No-op if the directory already exists.

```javascript
await app.fs.mkdir("C:/data/exports/monthly");

// Safe to call even if the folder exists
await app.fs.mkdir("C:/data/exports");
```

Combine with `write` to ensure a destination folder exists before writing files:

```javascript
const outDir = "C:/data/reports/2026";
await app.fs.mkdir(outDir);
await app.fs.write(`${outDir}/summary.txt`, reportContent);
```

## Path Resolution

### resolveDataPath(relativePath) → `string`

Resolve a path within the per-window app data folder.

```javascript
const settingsPath = app.fs.resolveDataPath("settings.json");
```

### resolveCachePath(relativePath) → `string`

Resolve a path within the per-window cache folder.

### commonFolder(name) → `Promise<string>`

Get the path to a standard OS folder.

Available folder names: `"documents"`, `"downloads"`, `"desktop"`, `"userData"`, `"home"`, `"temp"`, `"pictures"`, `"music"`, `"videos"`, `"appData"`, `"exe"`.

```javascript
const downloads = await app.fs.commonFolder("downloads");
await app.fs.write(`${downloads}/report.txt`, reportText);

const home = await app.fs.commonFolder("home");
console.log(home); // "C:\Users\YourName"
```

## Dialogs

### showOpenDialog(options?) → `Promise<string[] | null>`

Show the native Open File dialog. Returns selected paths, or `null` if cancelled.

Options:
- `title?: string` — dialog title
- `defaultPath?: string` — initial directory or file path
- `filters?: IFileFilter[]` — file type filters
- `multiSelect?: boolean` — allow selecting multiple files

```javascript
const files = await app.fs.showOpenDialog({
    title: "Select JSON files",
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiSelect: true
});
if (files) {
    for (const f of files) {
        const content = await app.fs.read(f);
        console.log(f, content.length);
    }
}
```

### showSaveDialog(options?) → `Promise<string | null>`

Show the native Save File dialog. Returns the selected path, or `null` if cancelled.

Options:
- `title?: string`
- `defaultPath?: string` — suggested file name or path
- `filters?: IFileFilter[]`

```javascript
const savePath = await app.fs.showSaveDialog({
    defaultPath: "report.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }]
});
if (savePath) {
    await app.fs.write(savePath, csvContent);
}
```

### showFolderDialog(options?) → `Promise<string[] | null>`

Show the native Select Folder dialog. Returns selected folder paths, or `null` if cancelled.

Options:
- `title?: string`
- `defaultPath?: string`

## OS Integration

### showInExplorer(filePath)

Show a file in the OS file explorer (selects it in the parent folder).

```javascript
app.fs.showInExplorer("C:/data/report.txt");
```

### showFolder(folderPath)

Open a folder in the OS file explorer.

```javascript
app.fs.showFolder("C:/data");
```
