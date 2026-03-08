// Decode Base64 content back to text

const text: string = page.content.trim();
return Buffer.from(text, "base64").toString("utf-8");
