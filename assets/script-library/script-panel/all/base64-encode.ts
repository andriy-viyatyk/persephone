// Encode page content (or selection) to Base64

const text: string = page.content;
return Buffer.from(text, "utf-8").toString("base64");
