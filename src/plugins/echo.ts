import { Callback, NotificationData } from "../interfaces";
import winston from "winston";

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
  delete n.config.callback;

  logger.info(JSON.stringify(n));
}
