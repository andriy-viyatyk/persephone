persephone.service.onRequest((message) => ({ op: message?.op ?? null }));
persephone.service.onChannel((channel) => channel.close());

setTimeout(() => process.exit(23), 500);
