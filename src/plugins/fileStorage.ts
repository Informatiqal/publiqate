import { Callback, NotificationData } from "../interfaces";
import winston from "winston";
import fs from "fs";
import path from "path";

export const meta = {
  author: "Informatiqal",
  version: "0.1.0",
};

export async function implementation(
  c: Callback,
  notification: NotificationData,
  logger: winston.Logger
) {
  const n = JSON.parse(JSON.stringify(notification));
  delete n.config.callback;

  const folder = path.dirname(c.details.path);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  fs.appendFileSync(c.details.path, `${JSON.stringify(n)}\n`);
}
