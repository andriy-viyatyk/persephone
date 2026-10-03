---
title: "Site Extensions"
audience: user
summary: "Understand browser site extensions, review their access, and manage which scripts run on your sites."
---

# Site Extensions

A site extension is a script that runs on matching websites in Persephone's Browser. An agent may
build one when you want a reusable model of a web app: it can help the agent work with structured
page information instead of repeatedly reading browser snapshots. Extensions are optional; browser
pages work without them. For the authoring workflow, see the [agent guide](./agents/site-extensions.md).

## Trust a site extension

When an extension is ready to run on a page, a bar appears above the browser page. It names the
extension and the hostnames where it can run. Choose **Trust** only if you want to allow it, or
choose **Not now** to leave it untrusted. Trust means the script runs in the signed-in site's page
with the capabilities available to that site session. Only trust scripts you understand and want
to run. An agent may accept this prompt only when you ask it to trust the extension.

The trust decision applies to the extension's listed hosts. If that host list changes, Persephone
asks again before the extension runs on the changed set. The prompt also appears again if you change
the site extensions folder in Settings.

## Choose the extensions folder

Open **Settings → Browser → Site Extensions** to see the current folder. **Browse...** selects a
different folder; **Use default** returns to the default data folder. Changing folders drops all
site extension trust, so each extension in the selected folder must be trusted again. A page that
already ran an extension keeps its current code until you reload or navigate away.

The section shows how many extensions are installed and trusted. Select **Open site extensions**
to go to the management list in **Tools & Editors → Site extensions**.

## Manage extensions

In **Tools & Editors → Site extensions**, use the filter to search by extension name or host. For
each entry you can:

- Turn an extension on or off with its switch. Disabling it prevents future runs; it does not stop
  code already running in an open page.
- Choose **revoke trust** to require a new Trust decision before it can run again.
- Choose **open folder** to inspect its files, or remove it from Persephone. Removal asks you to
  confirm.

Status badges help identify entries that need attention:

| Badge | Meaning |
|---|---|
| **valid** | The extension has a usable manifest and can be considered for its listed hosts. It still needs trust to run. |
| **invalid** | The manifest or script entry has a problem; the extension will not run. |
| **conflict** | Another extension claims the same host; neither extension runs on that host until the conflict is resolved. |
| **folder missing** | The extension folder was removed outside Persephone; remove the leftover entry or revoke its trust. |

After you change trust or enablement, a notice explains that pages which already ran the extension
keep their current code and model until you reload or navigate. Reload those pages to apply the
change.

## Private browser pages

Site extensions never run in **Incognito** or **Browser (Tor)** pages. Use a regular browser page
for a site extension.

