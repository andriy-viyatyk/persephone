[← API Reference](./index.md)

# app.fs

File system operations, dialogs, and OS integration.

```javascript
const text = await app.fs.read("C:/data/file.txt");
await app.fs.write("C:/data/out.txt", text);
```

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
