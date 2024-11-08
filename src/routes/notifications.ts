import express, { Request, Response } from "express";
import { Config, Plugin, Notification, NotificationData } from "../interfaces";
import { QlikRepoApi } from "qlik-repo-api";

import { flushLogs, logger, pluginLogger } from "../lib/logger";
import * as httpPlugin from "../plugins/http";
import * as echoPlugin from "../plugins/echo";
import winston from "winston";

let configNotifications = {} as { [k: string]: Notification };
let repoClient = {} as QlikRepoApi.client;
let pluginsConfig = {} as Config["plugins"];
let plugins: {
  [k: string]: (c: any, d: NotificationData, logger: winston.Logger) => void;
} = {};

const notificationsRouter = express.Router();

notificationsRouter.get("/callback", (req: Request, res: Response) => {
  res.status(200).send("Blah");
});

notificationsRouter.post(
  "/callback/:notificationId",
  async (req: Request, res: Response) => {
    const notificationId = req.params["notificationId"];
    const notification = configNotifications[notificationId];

    // if the notification is not found then remove it
    // its one of ours but seems that it no longer exists
    // and its not needed anymore
    if (!notification) {
      try {
        repoClient.notification.remove({
          handle: notificationId,
        });
      } catch (e) {
        let a = 1;
      }

      return;
    }

    const notificationData: NotificationData = {
      config: notification,
      data: req.body,
      entity: [],
    };

    if (notification.getEntityDetails == false) {
      relay(notificationData);
      return;
    }

    try {
      const objectType = `${req.body[0].objectType
        .split("")[0]
        .toLowerCase()}${req.body[0].objectType.substring(
        1,
        req.body[0].objectType.length
      )}s`;

      const entities = await Promise.all(
        req.body.map((entity) =>
          repoClient[`${objectType}`].get({
            id: entity.objectID,
          })
        )
      ).then((ent) => ent.map((e) => e.details));

      notificationData.entity = entities;

      relay(notificationData);
    } catch (e) {
      logger.error(
        `Error while retrieving entity information. Below is the available notification data and the actual error message`
      );
      logger.error(`${JSON.stringify(notificationData)}`);
      logger.error(e.message);
    }
  }
);

export async function initNotifications(
  notifications: {
    [k: string]: Notification;
  },
  apiClient: QlikRepoApi.client,
  config: Config["plugins"]
) {
  configNotifications = notifications;
  repoClient = apiClient;
  pluginsConfig = config;

  await loadPlugins();
}

async function loadPlugins() {
  plugins["http"] = httpPlugin.implementation;
  logger.info(`Built-in plugin "http" loaded`);

  plugins["echo"] = echoPlugin.implementation;
  logger.info(`Built-in plugin "echo" loaded`);

  if (pluginsConfig && pluginsConfig.length > 0) {
    await Promise.all(
      pluginsConfig.map(async (plugin) => {
        try {
          const p: Plugin = await import(`file:///${plugin.path}`);

          plugins[plugin.name] = p.implementation;
          logger.info(
            `External plugin "${plugin.name}" loaded from "${plugin.path}"`
          );
        } catch (e) {
          logger.error(`Error while loading plugin from ${plugin.path}`);
          logger.error(e);
          flushLogs();
          await new Promise((resolve) => setTimeout(resolve, 2000)).then(() => {
            process.exit(1);
          });
        }
      })
    );
  }
}

async function relay(b: NotificationData) {
  await Promise.all(
    b.config.callback.map((c: any) => {
      plugins[c.type](c, b, pluginLogger);
    })
  );
}

export { notificationsRouter };
