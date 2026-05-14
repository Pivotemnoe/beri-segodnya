import { resetDb, dbPath } from "../storage/jsonStore.mjs";

resetDb();
console.log(`Database reset: ${dbPath()}`);
