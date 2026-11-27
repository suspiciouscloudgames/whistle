process.stdin.resume();
process.stdin.once("end", () => process.emit("SIGTERM"));
await import("./serve.mjs");
