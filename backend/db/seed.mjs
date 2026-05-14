import { resetDb, dbPath } from "../storage/jsonStore.mjs";

resetDb();
console.log(`Seed data written: ${dbPath()}`);
