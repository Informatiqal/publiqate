import fetch from "node-fetch";

import { Callback, NotificationData } from "../interfaces";
import { Logger } from "winston";

export const meta = {
  author: "Informatiqal",
  version: "0.1.0",
};

export async function implementation(
  c: Callback,
  n: NotificationData,
  logger: Logger
) {
  let headers = { "Content-Type": "application/json" };

  if (c.details.headers) headers = { ...headers, ...c.details.headers };

  if (
    !c.details.method ||
    c.details.method.toLowerCase() == "get" ||
    c.details.method.toLowerCase() == "delete"
  ) {
    return fetch(c.details.url, {
      method: c.details.method.toLowerCase() == "get" ? "get" : "delete",
      headers,
    })
      .then((r) => ({
        status: r.statusText,
        text: r.text(),
      }))
      .then((response) => {
        // remove the callbacks details
        // to avoid sending any sensitive data
        delete n.config.callback;

        logger.debug(
          JSON.stringify({
            response,
            ...n,
          })
        );
      })
      .catch((e) => {
        logger.error(e);
      });
  }

  if (
    c.details.method.toLowerCase() == "post" ||
    c.details.method.toLowerCase() == "put"
  ) {
    return fetch(c.details.url, {
      method: c.details.method,
      body: JSON.stringify({
        data: n.data,
        entities: n.entity,
      }),
      headers,
    })
      .then((r) => ({
        status: r.statusText,
        text: r.text(),
      }))
      .then((response) => {
        // remove the callbacks details
        // to avoid sending any sensitive data
        delete n.config.callback;

        logger.debug(
          JSON.stringify({
            response,
            ...n,
          })
        );
      })
      .catch((e) => {
        logger.error(e);
      });
  }
}
