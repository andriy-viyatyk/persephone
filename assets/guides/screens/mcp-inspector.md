---
title: "MCP Inspector"
audience: both
summary: "Connect to an MCP server and inspect its connection details, tools, resources, prompts, and request history."
screen: "mcp-inspector"
editorId: "mcp-view"
---

# MCP Inspector

The MCP Inspector is a dedicated editor for connecting to and exercising an MCP (Model Context
Protocol) server. Open it from the `+` editor menu when it is pinned, from the **Tools & Editors**
panel, or with `app.pages.showMcpInspectorPage({ url })`. It supports HTTP and stdio transports.

## Layout

## How to open and connect

Choose **HTTP** and enter the server URL, commonly a loopback endpoint such as
`http://127.0.0.1:7865/mcp`, or choose **Stdio** and enter the command and arguments. Click
**Connect**; pressing Enter in a connection field also starts a connection. Saved connections can
be selected to fill the connection bar. While connecting, the transport and inputs are disabled.
Once connected, the button becomes **Disconnect**.

For Persephone's own server, first enable MCP in Settings or the settings file, then connect to
the configured loopback URL. The [Settings guide](./settings.md) explains the chicken-and-egg
case; [MCP Server Setup](../mcp-setup.md) covers client configuration and server setup.

## Connection state and server capabilities

The inspector shows a neutral, warning, success, or error status while disconnected, connecting,
connected, or failed. A failed connection leaves an error message and asks the user to check the
URL or command. A connected server reports its name, optional title, version, description, website,
and instructions in the **Info** panel. Markdown instructions and website links are rendered in
the inspector.

The connected server's capabilities determine which panels appear. **Info** is always available;
**Tools**, **Resources**, and **Prompts** appear when the server advertises the corresponding
capability. **History** is always available after connection and records outgoing requests.

## Tools

The **Tools** panel lists the server's callable tools and their descriptions and input schemas.
Select a tool, fill its arguments, and run it. The result is rendered in the inspector using the
appropriate text, structured-data, Markdown, or image presentation. A tool error is shown with
the request result rather than being mistaken for a connection failure.

## Resources

The **Resources** panel lists static resources and resource templates. Select a resource to read
it. For a template, fill its URI parameters and read the resulting URI. Resource content is
rendered adaptively; relative links in MCP resource content cannot be resolved without a
filesystem base, while absolute links can be followed normally.

## Prompts

The **Prompts** panel lists prompt templates exposed by the server. Select a prompt, provide any
declared arguments, and request the rendered messages. The returned prompt content is displayed
as an inspection result; it does not modify the server or the Persephone page unless the user
chooses a separate action.

## Request history

The **History** panel records outgoing requests with their method, duration, and error status. It
reports the number of recorded requests and offers **Open in Log View** for detailed entries and
**Clear** to reset the history. An empty history is normal before the first request.

## Failure and disconnect guidance

If connection fails, verify the transport, URL, command, arguments, and whether the target service
is running. For loopback services, prefer the literal IPv4 address `127.0.0.1` when the service is
known to bind there. Disconnecting removes the active server state but leaves saved connection
entries available to fill again. A server that closes or becomes unreachable is a connection
failure, not evidence that its tools or resources were absent; reconnect and inspect its Info and
capability panels again.

