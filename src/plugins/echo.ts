import { Callback, NotificationData } from "../interfaces";
import winston from "winston";

export const meta = {
  author: "Informatiqal",
  version: "0.1.0",
};

export async function implementation(
  c: Callback,
  n: NotificationData,
  logger: winston.Logger
) {
  logger.info(JSON.stringify(n));
}
