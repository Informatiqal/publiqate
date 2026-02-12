import { JSONFilePreset } from "lowdb/node";
import { Low } from "lowdb";
import { logger } from "./logger";
import path from "node:path";

interface DBData {
  [k: string]: {
    name: string;
    handle: string;
  };
}

let db = {} as Low<DBData>;

export async function init() {
  const dbPath = path.resolve(`${process.cwd()}`, ".\\configs", "db.json");
  const dbInit = await JSONFilePreset<DBData>(dbPath, {});

  db = dbInit;
  await db.write();

  logger.info(`DB initialized/loaded "${dbPath}"`);
}

export async function removeHandle(id: string) {
  delete db.data[id];

  await db.write();
}

export async function addHandle(id: string, name: string, handle: string) {
  if (!db.data[id]) {
    db.data[id] = { name, handle };
    await db.write();
  }
}

export async function getHandleFromId(id: string) {
  if (!db.data[id]) return undefined;

  return db.data[id].handle;
}
