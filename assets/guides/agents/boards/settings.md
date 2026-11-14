---
title: "Boards — settings"
audience: agent
summary: "Declare board settings in the manifest (types, multiline, multi-select), read them with persephone.settings, and how the host renders them."
---

# Boards — settings

## Board settings

Declare user-editable settings as an array in `board-manifest.json`. Settings require stable,
non-empty `name` and `author` manifest fields, and each declaration has a unique `id`, a `type`,
and a scalar `default`. Supported types are `string`, `number`, `boolean`, and `enum`; enum
declarations also require non-empty string `options`. A string may use `format: "folderPath"` to
get a folder picker, `format: "multiline"` to get a multi-line Textarea, or
`format: "multiselect"` to get a searchable checkbox list in Persephone's Settings page. Boards
using `multiline` must set `minBridgeVersion: "1.42.0"`; boards using `multiselect` must set
`minBridgeVersion: "1.43.0"` so older Persephone builds exclude the board instead of showing a
plain text field.

For `multiselect`, keep `type: "string"` and provide `options` as strings or objects with a
required string `value` and optional string `label`. Values and supplied labels are trimmed and
must be non-empty; values must be unique after trimming, and the list must contain at least one
valid option. A malformed option list invalidates that setting. String options use the same text
for their value and label. The `default` and persisted value remain strings containing selected
ids separated by commas; `""` means no choices. Every non-empty trimmed token in a default must
match an option. When changed in Settings, known selections are saved in manifest option order,
followed by still-selected unknown stored tokens in their previous order, joined with commas and no
spaces. Unknown stored tokens appear as checked rows labeled with the token; removing their check
removes them from the saved value. `persephone.settings.get()` and `onChange()` continue to use a
scalar string.

The dropdown search matches option labels case-insensitively. Include each option id in its label
so users can find it by id or display name, for example `uk (Українська)`. Setting labels and
descriptions can be translated with the board language-pack keys
`manifest.settings.<id>.label` and `manifest.settings.<id>.description`. Option labels are literal
manifest strings and do not currently use language-pack lookup; language endonyms need no
translation.

```json
{
  "schemaVersion": 1,
  "name": "Weather Board",
  "author": "Example",
  "settings": [
    {
      "id": "units",
      "type": "enum",
      "options": ["celsius", "fahrenheit"],
      "default": "celsius",
      "label": "Temperature units"
    },
    {
      "id": "language-hints",
      "type": "string",
      "format": "multiselect",
      "options": [
        { "value": "app", "label": "app (Persephone UI language)" },
        { "value": "uk", "label": "uk (Українська)" },
        "en"
      ],
      "default": "app,en",
      "label": "Language hints"
    }
  ]
}
```

The declaration creates a panel named after the board under **Editors** when it is a custom
editor, or under **Boards** otherwise. Persephone owns the explicit values in
`<userData>/data/board-settings.json`, namespaced by `author/name`; a reset removes
the stored value and returns the manifest default. The board itself is read-only:

```js
const units = await persephone.settings.get("units");
const stopListening = persephone.settings.onChange(({ id, value }) => {
  if (id === "units") renderUnits(value);
});
```

`get()` returns the stored value or the current manifest default. `onChange()` reports effective
values after the user changes or resets a setting in Persephone. Call the returned function to
unsubscribe. Direct manifest edits require a trust refresh or app restart before the Settings
panel changes.
