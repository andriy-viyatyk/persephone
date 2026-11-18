const args = process.argv.slice(2);
process.stdout.write(`@@RESULT@@${JSON.stringify({ args })}\n`);
