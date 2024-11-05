import fetch from "node-fetch";

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
  let headers = { "Content-Type": "application/json" };

  if (c.details.headers) headers = { ...headers, ...c.details.headers };

  if (
    !c.details.method ||
    c.details.method.toLowerCase() == "get" ||
    c.details.method.toLowerCase() == "delete"
  ) {
    try {
      fetch(c.details.url, {
        method: c.details.method.toLowerCase() == "get" ? "get" : "delete",
        headers,
      });
    } catch (e) {
      //
    }
  }

  if (
    c.details.method.toLowerCase() == "post" ||
    c.details.method.toLowerCase() == "put"
  ) {
    try {
      fetch(c.details.url, {
        method: c.details.method,
        body: JSON.stringify(n),
        headers,
      });
    } catch (e) {
      //
    }
  }
}
