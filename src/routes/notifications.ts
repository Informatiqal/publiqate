import express, { Request, Response } from "express";
import cors from "cors";
import { Config, Plugin, Notification, NotificationData } from "../interfaces";
import { QlikRepoApi } from "qlik-repo-api";

import { flushLogs, logger, createPluginLogger } from "../lib/logger";
import * as httpPlugin from "../plugins/http";
import * as echoPlugin from "../plugins/echo";
import * as fileStorage from "../plugins/fileStorage";
import winston from "winston";

let configNotifications = {} as { [k: string]: Notification };
let repoClient = {} as QlikRepoApi.client;
let pluginsConfig = [] as Config["plugins"];
let pluginLoggers: {
  [k: string]: winston.Logger;
} = {};
let plugins: {
  [k: string]: (
    c: any,
    d: NotificationData,
    logger: winston.Logger
  ) => Promise<any>;
} = {};
let logLevel = "info";

const corsOptions = {
  origin: "",
};

const notificationsRouter = express.Router();

function initRoutes() {
  notificationsRouter.get(
    "/callback",
    // cors(corsOptions),
    (req: Request, res: Response) => {
      res.status(200).send("Blah");
    }
  );

  notificationsRouter.post(
    "/callback/:notificationId",
    // cors(corsOptions),
    async (req: Request, res: Response) => {
      const notificationId = req.params["notificationId"];
      const notification = configNotifications[notificationId];

      try {
        // respond back to Qlik that the notification is received
        res.status(200).send();
      } catch (e) {}

      // if the notification is not found then remove it
      // its one of ours but seems that it no longer exists
      // and its not needed anymore
      if (!notification) {
        try {
          repoClient.notification.remove({
            handle: notificationId,
          });
        } catch (e) {
          //
        }

        return;
      }

      // remove duplicate notifications ... if any
      req.body = req.body.filter((value, index, self) => {
        return self.findIndex((v) => v.id === value.id) === index;
      });

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
          req.body.map((entity) => {
            if (objectType == "executionResults") {
              return repoClient[objectType]
                .get({
                  id: entity.objectID,
                })
                .then((execResult) => {
                  return repoClient.tasks.get({
                    id: execResult.details.taskID,
                  });
                });
            } else {
              return repoClient[objectType].get({
                id: entity.objectID,
              });
            }
          })
        )
          .then((ent) => ent.map((e) => e.details))
          .catch((e) => {
            logger.error(e);
            return [];
          });

        notificationData.entity = entities || [];

        relay(notificationData);
      } catch (e) {
        logger.error(`${JSON.stringify(notificationData)}`);
        logger.error(e);
      }
    }
  );
}

export async function initNotifications(
  notifications: {
    [k: string]: Notification;
  },
  apiClient: QlikRepoApi.client,
  config: Config["plugins"],
  qlikHost: string,
  generalLogLevel: string,
  isReload: boolean
) {
  configNotifications = notifications;
  repoClient = apiClient;
  pluginsConfig = config;
  corsOptions.origin = qlikHost;
  if (generalLogLevel) logLevel = generalLogLevel;

  pluginLoggers = {};
  plugins = {};
  await loadPlugins();

  if (isReload == false) initRoutes();
}

function loadBuiltinPlugins() {
  // http plugin
  pluginLoggers["http"] = createPluginLogger("http", logLevel);
  plugins["http"] = httpPlugin.implementation;
  logger.info(`Built-in plugin "http" loaded`);

  // echo plugin
  pluginLoggers["echo"] = createPluginLogger("echo", logLevel);
  plugins["echo"] = echoPlugin.implementation;
  logger.info(`Built-in plugin "echo" loaded`);

  // file store plugin
  pluginLoggers["file"] = createPluginLogger("file", logLevel);
  plugins["file"] = fileStorage.implementation;
  logger.info(`Built-in plugin "file" loaded`);
}

async function loadPlugins() {
  loadBuiltinPlugins();

  if (pluginsConfig && pluginsConfig.length > 0) {
    await Promise.all(
      pluginsConfig.map(async (plugin) => {
        try {
          const p: Plugin = await import(`file:///${plugin.path}`);

          plugins[plugin.name] = p.implementation;
          logger.info(
            `External plugin "${plugin.name}" loaded from "${plugin.path}"`
          );

          const localLogger = { ...logger } as winston.Logger;
          localLogger.defaultMeta = {
            service: plugin.name,
          };
          pluginLoggers[plugin.name] = localLogger;
        } catch (e) {
          logger.error(`Error while loading plugin from ${plugin.path}`);
          throw new Error(e);
        }
      })
    );
  }
}

function relay(b: NotificationData) {
  return Promise.all(
    b.config.callback.map((c) => plugins[c.type](c, b, pluginLoggers[c.type]))
  ).catch((e) => {
    logger.error(e.message);
  });
}

export { notificationsRouter };
