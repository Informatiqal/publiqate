import querystring from "node:querystring";
import express, { NextFunction, Request, Response } from "express";
import {
  Config,
  Plugin,
  Notification,
  NotificationData,
  QlikComm,
} from "../interfaces";
import { QlikRepoApi } from "qlik-repo-api";

import {
  logger,
  createPluginLogger,
  fileTransport,
  defaultLevel,
} from "../lib/logger";
import * as httpPlugin from "../plugins/http";
import * as echoPlugin from "../plugins/echo";
import * as fileStorage from "../plugins/fileStorage";
import winston from "winston";

let configNotifications = {} as { [k: string]: Notification };
let repoClient = {} as { [k: string]: QlikRepoApi.client };
let pluginsConfig: string[] = [];
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
let environments = [] as unknown as QlikComm[];

const notificationsRouter = express.Router();

function checkWhitelisting(req: Request, res: Response, next: NextFunction) {
  const notificationId = querystring.unescape(req.params["notificationId"]);
  const notification = configNotifications[notificationId];

  if (!notification) {
    next();
  } else {
    if (notification.options.enabled == false) {
      next();
    } else {
      const regEx = new RegExp(
        /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/gim
      );

      const regExResult = regEx.exec(req.headers.origin);
      const origin = regExResult[1] ? regExResult[1] : "";

      const envOrigin = environments.filter(
        (e) => notification.environment == e.name
      )[0].host;

      const allowedOrigins = [
        ...envOrigin,
        ...notification.options.whitelist.map((o) => o.toLowerCase()),
      ];

      if (notification.options.disableCors == true) {
        next();
      } else if (!allowedOrigins.includes(origin)) {
        res.status(403).send();
      } else {
        next();
      }
    }
  }
}

function initRoutes() {
  notificationsRouter.post(
    "/callback/:notificationId",
    checkWhitelisting,
    async (req: Request, res: Response) => {
      const notificationId = querystring.unescape(req.params["notificationId"]);
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
          repoClient[notification.environment].notification
            .remove({
              handle: notificationId,
            })
            .then((r) => {
              logger.info(
                [
                  `Received notification with ID: "${notificationId}". `,
                  `This ID dont exists in the config (anymore?). `,
                  `Because of this the specific notification is de-registered from Qlik`,
                ].join("")
              );
            })
            .catch((e) => {
              logger.warning(
                `Error while deleting notification with ID: ${notificationId}`
              );
              logger.warning(e);
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
        environment: environments.filter(
          (e) => e.name == notification.environment
        )[0],
        data: req.body,
        entities: [],
      };

      if (notification.options.getEntityDetails == false) {
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
              return repoClient[notification.environment][objectType]
                .get({
                  id: entity.objectID,
                })
                .then((execResult) => {
                  return repoClient[notification.environment].tasks.get({
                    id: execResult.details.taskID,
                  });
                });
            } else {
              return repoClient[notification.environment][objectType].get({
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

        notificationData.entities = entities || [];

        relay(notificationData);
      } catch (e) {
        logger.error(`${JSON.stringify(notificationData)}`);
        logger.error(e);
      }
    }
  );

  notificationsRouter.post("/health", async (req: Request, res: Response) => {
    res.status(200).send();
  });
}

export async function initNotifications(
  notifications: {
    [k: string]: Notification;
  },
  apiClient: { [k: string]: QlikRepoApi.client },
  config: Config["plugins"],
  qlikEnvironments: QlikComm[],
  // qlikHost: string,
  generalLogLevel: string,
  isReload: boolean
) {
  configNotifications = notifications;
  repoClient = apiClient;
  pluginsConfig = config;
  environments = qlikEnvironments;
  if (generalLogLevel) logLevel = generalLogLevel;

  // clear all existing (if any) loggers
  Object.entries(pluginLoggers).map(([name, logger]) => {
    logger.close();
  });
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
          const p: Plugin = await import(`file:///${plugin}`);

          if (!p.meta)
            throw new Error(
              `Plugin meta property not exported. Loading plugin from ${plugin}`
            );

          if (!p.meta.name)
            throw new Error(
              `Plugin "meta.name" property not defined. Loading plugin from ${plugin}`
            );

          if (plugins[p.meta.name])
            throw new Error(
              `Plugin with name "${p.meta.name}" already registered. Loading plugin from ${plugin}`
            );

          plugins[p.meta.name] = p.implementation;
          logger.info(
            `External plugin "${
              p.meta.name
            }" loaded from "${plugin}" with meta ${JSON.stringify(p.meta)}`
          );

          const localLogger = winston.createLogger({
            transports: [new winston.transports.Console(), fileTransport],
            levels: winston.config.syslog.levels,
            level: defaultLevel,
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.printf(
                ({ timestamp, level, message, service }) => {
                  return `${timestamp}\t${level.toUpperCase()}\t${service}\t${message}`;
                }
              )
            ),
            defaultMeta: {
              service: p.meta.name,
            },
          });

          pluginLoggers[p.meta.name] = localLogger;
        } catch (e) {
          logger.error(`Error while loading plugin from ${plugin}`);
          throw new Error(e);
        }
      })
    );
  }
}

function relay(b: NotificationData) {
  const activeCallbacks = b.config.callbacks.filter((c) => {
    if (c.hasOwnProperty("enabled") && c.enabled == true) return true;
    if (!c.hasOwnProperty("enabled")) return true;

    return false;
  });

  return Promise.all(
    activeCallbacks.map((c) => plugins[c.type](c, b, pluginLoggers[c.type]))
  ).catch((e) => {
    logger.error(e.message);
  });
}

export { notificationsRouter };
