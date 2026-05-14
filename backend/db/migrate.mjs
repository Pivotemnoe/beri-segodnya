import { ensureDb, dbPath } from "../storage/jsonStore.mjs";

ensureDb();
console.log(`JSON storage ready: ${dbPath()}`);
