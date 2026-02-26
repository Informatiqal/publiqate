import querystring from "node:querystring";
import WebSocket from "ws";
import express, { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  Plugin,
  Notification,
  NotificationData,
  QlikComm,
  NotificationRepo,
  NotificationDataAlert,
  DataAlertCondition,
  DataAlertFieldSelection,
  DataAlertScalarCondition,
  DataAlertBookmarkApply,
  DataAlertListCondition,
} from "../interfaces/interfaces";
import { QlikRepoApi } from "qlik-repo-api";
import * as enigma from "enigma.js";
import { docMixin } from "enigma-mixin";
import * as enigmaSchema from "enigma.js/schemas/12.1657.0.json" assert { type: "json" };

import {
  logger,
  createPluginLogger,
  fileTransport,
  logLevels,
  qlikCommsLogger,
} from "../lib/logger";
import * as httpPlugin from "../plugins/http";
import * as echoPlugin from "../plugins/echo";
import * as fileStorage from "../plugins/fileStorage";
import winston from "winston";
import { App } from "qlik-repo-api/dist/App";
import { readFileSync } from "fs";
import { GeneralConfig, GeneralConfig15 } from "../interfaces/general";
import { randomUUID } from "node:crypto";

let configGeneral = {} as GeneralConfig;
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
    logger: winston.Logger,
  ) => Promise<any>;
} = {};
// let logLevel = logLevels;
let environments = [] as unknown as QlikComm[];

const notificationsRouter = express.Router();

function checkWhitelisting(req: Request, res: Response, next: NextFunction) {
  const notificationId = querystring.unescape(req.params["notificationId"]);

  const defaultNotificationOptions = {
    ...{
      getEntityDetails: true,
      disableCors: true,
      enabled: true,
      whitelist: [],
    },
  };

  const notification = configNotifications[notificationId];
  notification.options = {
    ...defaultNotificationOptions,
    ...configGeneral.notifications,
    ...notification.options,
  };

  if (!notification) {
    if (
      configGeneral.deregisterMissing &&
      configGeneral.deregisterMissing == true
    ) {
      //
    }
    // if the notification is not found then ignore it
    logger.debug(
      `Request received for notification "${notificationId}" but such notification was not found in the config. Ignoring it.`,
    );

    try {
      res.status(404).send();
    } catch (e) {}
  } else {
    if (notification.options.enabled == false) {
      // if the notification is not found then ignore it
      logger.debug(
        `Received notification with ID: "${notificationId}". The ID exists in the config but its disabled`,
      );

      try {
        res.status(404).send();
      } catch (e) {}
    } else {
      req["publiqateNotification"] = notification;

      const regEx = new RegExp(
        /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/gim,
      );

      const regExResult = regEx.exec(req.headers.origin);
      const origin = regExResult[1] ? regExResult[1] : "";

      const envOrigin = environments.filter(
        (e) => notification.environment == e.name,
      )[0].host;

      let allowedOrigins = [...envOrigin];
      if (notification.options && notification.options.whitelist) {
        allowedOrigins = [
          ...allowedOrigins,
          ...notification.options.whitelist.map((o) => o.toLowerCase()),
        ];
      }

      if (notification.options && notification.options.disableCors == true) {
        try {
          // respond back to Qlik that the notification is received
          res.status(200).send();
        } catch (e) {}

        next();
      } else if (!allowedOrigins.includes(origin)) {
        logger.debug(
          `Received notification with ID: "${notificationId}". The notification exists and it is enabled but the origin dont match with the configured origins`,
        );

        try {
          res.status(403).send();
        } catch (e) {}
      } else {
        try {
          // respond back to Qlik that the notification is received
          res.status(200).send();
        } catch (e) {}

        next();
      }
    }
  }
}

function initRoutes() {
  notificationsRouter.post(
    "/callback/:notificationId",
    checkWhitelisting,
    async (req: Request, _: Response) => {
      // const notificationId = querystring.unescape(req.params["notificationId"]);
      const notification = req["publiqateNotification"] as NotificationRepo;

      if (Object.keys(req.body).length == 0) {
        logger.info(
          `Received notification with ID: "${notification.nameOriginal}" but the its body is empty`,
        );
        return;
      }

      // remove duplicate notifications ... if any
      req.body = req.body.filter(
        (value: { id: string; objectID: string }, index: number, self: any) => {
          // return self.findIndex((v) => v.id === value.id) === index;
          if (value.objectID)
            return (
              self.findIndex(
                (v: { objectID: string }) => v.objectID === value.objectID,
              ) === index
            );

          if (value.id)
            return (
              self.findIndex((v: { id: string }) => v.id === value.id) === index
            );
        },
      );

      //TODO: issue with the schema to types lib?
      if ((notification as any).type == "DataAlert") {
        processDataAlertNotification(notification, req);
      } else {
        processRepoNotification(notification, req);
      }
    },
  );

  notificationsRouter.post("/health", async (_: Request, res: Response) => {
    res.status(200).send();
  });
}

export async function initNotifications(
  notifications: {
    [k: string]: Notification;
  },
  apiClient: { [k: string]: QlikRepoApi.client },
  qlikEnvironments: QlikComm[],
  // qlikHost: string,
  generalConfig: GeneralConfig,
  isReload: boolean,
  builtInPLugins: GeneralConfig15,
) {
  configNotifications = notifications;
  repoClient = apiClient;
  pluginsConfig = generalConfig.plugins || [];
  environments = qlikEnvironments;
  configGeneral = generalConfig;
  // if (generalLogLevel) logLevel = generalLogLevel;

  // clear all existing (if any) loggers
  Object.entries(pluginLoggers).map(([_, logger]) => {
    logger.close();
  });
  pluginLoggers = {};
  plugins = {};

  await loadPlugins(builtInPLugins);

  if (isReload == false) initRoutes();
}

function loadBuiltinPlugins(builtInPLugins: GeneralConfig15) {
  // http plugin
  if (builtInPLugins.http == true) {
    const httpLogLevel = logLevels["http"] || logLevels.plugins;
    pluginLoggers["http"] = createPluginLogger("http", httpLogLevel);
    plugins["http"] = httpPlugin.implementation;

    logger.info(
      `Built-in plugin "http" loaded with log level "${httpLogLevel}"`,
    );
  } else {
    logger.debug(`Built-in plugin "http" is disabled`);
  }

  // echo plugin
  if (builtInPLugins.echo == true) {
    const echoLogLevel = logLevels["echo"] || logLevels.plugins;
    pluginLoggers["echo"] = createPluginLogger("echo", echoLogLevel);
    plugins["echo"] = echoPlugin.implementation;

    logger.info(
      `Built-in plugin "echo" loaded with log level "${echoLogLevel}"`,
    );
  } else {
    logger.debug(`Built-in plugin "echo" is disabled`);
  }

  // file store plugin
  if (builtInPLugins.file == true) {
    const fileLogLevel = logLevels["file"] || logLevels.plugins;
    pluginLoggers["file"] = createPluginLogger("file", fileLogLevel);
    plugins["file"] = fileStorage.implementation;

    logger.info(
      `Built-in plugin "file" loaded  with log level "${fileLogLevel}"`,
    );
  } else {
    logger.debug(`Built-in plugin "file" is disabled`);
  }
}

async function loadPlugins(builtInPLugins: GeneralConfig15) {
  loadBuiltinPlugins(builtInPLugins);

  if (pluginsConfig && pluginsConfig.length > 0) {
    await Promise.all(
      pluginsConfig.map(async (plugin) => {
        try {
          const p: Plugin = await import(`file:///${plugin}`);

          if (!p.meta)
            throw new Error(
              `Plugin meta property not exported. Loading plugin from ${plugin}`,
            );

          if (!p.meta.name)
            throw new Error(
              `Plugin "meta.name" property not defined. Loading plugin from ${plugin}`,
            );

          // Duplicate plugins are not permitted
          if (plugins[p.meta.name])
            throw new Error(
              `Plugin with name "${p.meta.name}" is already registered. Duplicate plugins are not allowed`,
            );

          if (plugins[p.meta.name])
            throw new Error(
              `Plugin with name "${p.meta.name}" already registered. Loading plugin from ${plugin}`,
            );

          plugins[p.meta.name] = p.implementation;

          const logLevel = logLevels[p.meta.name] || logLevels.plugins;

          const localLogger = winston.createLogger({
            transports: [new winston.transports.Console(), fileTransport],
            levels: winston.config.syslog.levels,
            level: logLevel,
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.printf(
                ({ timestamp, level, message, service }) => {
                  return `${timestamp}\t${level.toUpperCase()}\t${service}\t${message}`;
                },
              ),
            ),
            defaultMeta: {
              service: p.meta.name,
            },
          });

          logger.info(
            `External plugin "${
              p.meta.name
            }" loaded from "${plugin}" with meta ${JSON.stringify(
              p.meta,
            )} and log level "${logLevel}"`,
          );

          pluginLoggers[p.meta.name] = localLogger;
        } catch (e) {
          logger.error(`Error while loading plugin from ${plugin}`);
          throw new Error(e);
        }
      }),
    );
  }
}

async function relay(b: NotificationData) {
  const b1 = JSON.parse(replaceSpecialVariables(JSON.stringify(b)));
  let activeCallbacks = b1.config.callbacks.filter(
    (c: { enabled: boolean }) => {
      if (c.hasOwnProperty("enabled") && c.enabled == true) return true;
      if (!c.hasOwnProperty("enabled")) return true;

      return false;
    },
  );

  return Promise.all(
    activeCallbacks.map((c: { type: string }) =>
      plugins[c.type](c, b1, pluginLoggers[c.type]),
    ),
  ).catch((e) => {
    logger.error(e.message);
  });
}

async function processDataAlertNotification(
  notification: Notification,
  req: Request,
) {
  if (!notification.filter) {
    logger.error(
      `No filter specified for notification ${notification.nameOriginal}`,
    );

    return;
  }

  const app: App[] = await repoClient[notification.environment].apps.getFilter({
    filter: notification.filter,
  });

  if (app.length > 1 || app.length == 0) {
    logger.error(
      `Data alert filter should return only one app. Returned ${app.length}`,
    );

    return;
  }

  const updatedProperties = req.body.filter(
    (n: { changedProperties: string[] }) =>
      n.changedProperties.includes("lastReloadTime"),
  );

  if (updatedProperties.length != 1) return;

  const qlikEnv = environments.filter(
    (e) => notification.environment == e.name,
  )[0];

  const engineUserConnections: {
    [user: string]: {
      conditions: DataAlertCondition[];
      connection: enigmaJS.ISession;
    };
  } = {};

  (notification as NotificationDataAlert)["data-conditions"].map(
    (dc: DataAlertCondition) => {
      // if no options or options.user is missing
      // then set to INTERNAL\sa_scheduler as a default connection user
      const user = !dc.options
        ? "INTERNAL\\sa_scheduler"
        : !dc.options.user
          ? "INTERNAL\\sa_scheduler"
          : dc.options.user;

      if (!engineUserConnections[user])
        engineUserConnections[user] = {
          conditions: [],
          connection: {} as enigmaJS.ISession,
        };

      engineUserConnections[user].conditions.push(dc);
    },
  );

  const cert = readFileSync(`${qlikEnv.certs}\\client.pem`);
  const key = readFileSync(`${qlikEnv.certs}\\client_key.pem`);

  // prepare the Engine connections/sessions
  Object.keys(engineUserConnections).map(async (user) => {
    const [userDir, userName] = user.split("\\");

    const enigmaConfig: enigmaJS.IConfig = {
      Promise: Promise,
      schema: enigmaSchema,
      mixins: [...docMixin],
      url: `wss://${qlikEnv.host}:4747/${
        app[0].details.id
      }/identity/${+new Date()}`,
      createSocket: (url: string) =>
        new WebSocket(url, {
          //@ts-ignore
          key,
          cert,
          rejectUnauthorized: false,
          headers: {
            "X-Qlik-User": `UserDirectory=${encodeURIComponent(
              userDir,
            )};UserId=${encodeURIComponent(userName)}`,
          },
        }),
    };

    const enigmaClass = (enigma as any).default as IEnigmaClass;
    const session = enigmaClass.create(enigmaConfig);

    engineUserConnections[user].connection = session;
  });

  Object.entries(engineUserConnections).map(async ([user, details]) => {
    const session = engineUserConnections[user].connection;
    const conditions = details.conditions;

    try {
      try {
        session["publiqateId"] = uuidv4();
        const global = (await session.open()) as EngineAPI.IGlobal;
        qlikCommsLogger.debug(
          `${session["publiqateId"]}|Connection established for notification ${notification.nameOriginal}`,
        );

        const doc = await global.openDoc(app[0].details.id);
        qlikCommsLogger.debug(
          `${session["publiqateId"]}|App ${app[0].details.id} open with user ${user}`,
        );

        let overallConditionResults = true;

        await Promise.all(
          conditions.map(async (condition) => {
            await Promise.all(
              condition.conditions.map(async (c) => {
                if (c.type == "scalar") {
                  const scalarCondition =
                    c as unknown as DataAlertScalarCondition;
                  await makeQlikSelections(
                    doc,
                    condition.selections || [],
                    session["publiqateId"],
                  );
                  const conditionResult = await evaluateScalarCondition(
                    doc,
                    scalarCondition,
                    session["publiqateId"],
                  );
                  overallConditionResults =
                    overallConditionResults && conditionResult;
                }

                if (c.type == "list") {
                  const listCondition = c as unknown as DataAlertListCondition;
                  const conditionResult = await evaluateListCondition(
                    doc,
                    listCondition,
                    session["publiqateId"],
                  );

                  overallConditionResults =
                    overallConditionResults && conditionResult;
                }
              }),
            );
          }),
        );

        logger.info(
          [
            `${session["publiqateId"]}|`,
            `All conditions for app ${app[0].details.id} `,
            `with user ${user} `,
            `for notification ${notification.nameOriginal} were processed. `,
            `The overall evaluation result is "${overallConditionResults}"`,
          ].join(""),
        );

        if (overallConditionResults == true) {
          const notificationData: NotificationData = {
            config: notification,
            environment: environments.filter(
              (e) => e.name == notification.environment,
            )[0],
            data: req.body,
            entities: app,
          };

          relay(notificationData);
        }
      } catch (e) {
        logger.error(
          `${session["publiqateId"]}|QIX comms error for notification ${notification.nameOriginal} and user ${user}`,
        );
        logger.error(e);
      }
      session.close().then(() => {
        qlikCommsLogger.debug(
          `${session["publiqateId"]}|Session for app ${app[0].details.id} opened with user ${user} is closed`,
        );
      });
    } catch (e) {
      // try and close the session in case of an issue
      session.close().catch(e);

      logger.error(
        `${session["publiqateId"]}|General QIX comms error for notification ${notification.nameOriginal} and user ${user}`,
      );
      logger.error(e);
    }
  });
}

async function processRepoNotification(
  notification: Notification,
  req: Request,
) {
  // if the notification should be for a specific entity property
  // filter the body and exclude data which is not including that property
  // usually this is to exclude notifications which where changed (modifiedDate)
  // but the required property was not changed. Its a Qlik thingy
  if (notification.hasOwnProperty("propertyName")) {
    req.body = req.body.filter((n: { changedProperties: string[] }) =>
      n.changedProperties.includes(
        (notification as NotificationRepo).propertyName,
      ),
    );
  }

  // after all filtering if there is no data left then
  // just return and do not try to do anything more
  if (req.body.length == 0) return;

  const notificationData: NotificationData = {
    config: notification,
    environment: environments.filter(
      (e) => e.name == notification.environment,
    )[0],
    data: req.body,
    entities: [],
  };

  if ((notification as NotificationRepo).options.getEntityDetails == false) {
    relay(notificationData);
    return;
  }

  try {
    const objectType = `${req.body[0].objectType
      .split("")[0]
      .toLowerCase()}${req.body[0].objectType.substring(
      1,
      req.body[0].objectType.length,
    )}s`;

    const entities = await Promise.all(
      req.body.map((entity: { objectID: string }) => {
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
      }),
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

async function makeQlikSelections(
  doc: EngineAPI.IApp,
  selections: (DataAlertFieldSelection | DataAlertBookmarkApply)[],
  sessionId: string,
) {
  qlikCommsLogger.debug(`${sessionId}|Clear all`);
  await doc.clearAll(false);

  return await Promise.all(
    selections.map(async (selection) => {
      if (selection.hasOwnProperty("bookmark")) {
        await doc.applyBookmark(selection["bookmark"]);
        qlikCommsLogger.debug(
          `${sessionId}|Bookmark applied "${selection["bookmark"]}"`,
        );
      } else {
        await doc.mSelectInField(
          (selection as DataAlertFieldSelection).field,
          (selection as DataAlertFieldSelection).values,
        );

        qlikCommsLogger.debug(
          `${sessionId}|Selections in field "${
            (selection as DataAlertFieldSelection).field
          }" applied: ${(selection as DataAlertFieldSelection).values.join(
            ", ",
          )}`,
        );
      }
    }),
  );
}

async function evaluateScalarCondition(
  doc: EngineAPI.IApp,
  condition: DataAlertScalarCondition,
  sessionId: string,
) {
  const evalExResult = await doc.evaluateEx(condition.expression);

  let evalEx: string | number = 0;

  if (
    evalExResult.hasOwnProperty("qIsNumeric") &&
    evalExResult.qIsNumeric == true
  ) {
    evalEx = evalExResult.qNumber;
  } else {
    evalEx = `"${evalExResult.qText}"`;
  }

  //TODO: print more debug messages?
  logger.debug(
    [
      `${sessionId}|`,
      `${condition.name}|`,
      `Condition evaluated. `,
      `Result is ${evalEx}`,
    ].join(""),
  );

  let comparisonResults = true;

  condition.results.map((c) => {
    let evalPrefix = typeof evalEx == "string" ? `"` : "";
    let valuePrefix = typeof c.value == "string" ? `"` : "";

    if (c.variation) {
      let { upperLimit, lowerLimit } = compareWithVariance(
        c.variation,
        evalEx as number,
      );

      const comparisonResult = inRange(c.value, lowerLimit, upperLimit);

      comparisonResults = comparisonResults && comparisonResult;

      logger.debug(
        `${sessionId}|${condition.name}|Evaluation result ${evalPrefix}${evalEx}${evalPrefix} is compared to ${valuePrefix}${c.value}${valuePrefix} (${c.variation}). Result is "${comparisonResult}"`,
      );
    } else {
      const comparisonResult = operations[c.operator ? c.operator : "=="](
        evalEx,
        c.value,
      );

      comparisonResults = comparisonResults && comparisonResult;

      logger.debug(
        `${sessionId}|${
          condition.name
        }|Evaluation result ${evalPrefix}${evalEx}${evalPrefix} is compared to ${valuePrefix}${
          c.value
        }${valuePrefix} (${
          c.operator ? c.operator : "=="
        }). Result is "${comparisonResult}"`,
      );
    }
  });

  logger.debug(
    `${sessionId}|${condition.name}|Conditions processed. The result is "${comparisonResults}"`,
  );

  return comparisonResults;
}

async function evaluateListCondition(
  doc: EngineAPI.IApp,
  condition: DataAlertListCondition,
  sessionId: string,
) {
  logger.debug(
    `${sessionId}|${condition.name}|Searching for matching values in "${
      condition.fieldName
    }". Searched values are: ${condition.values.join(",")}`,
  );

  const searchResult = await Promise.all(
    condition.values.map(async (v) => {
      try {
        const sessionObj = await doc.mCreateSessionListbox(condition.fieldName);
        const searchResult = await sessionObj.obj.searchListObjectFor(
          "/qListObjectDef",
          v.toString(),
        );
        const layout =
          (await sessionObj.obj.getLayout()) as EngineAPI.IGenericListLayout;

        // something went wrong with the search
        if (searchResult == false) return false;

        await doc
          .destroySessionObject(sessionObj.props.qInfo.qId)
          .catch(() => {});

        return layout.qListObject.qSize.qcx > 0 && layout.qListObject.qSize.qcy
          ? true
          : false;
      } catch (e) {
        logger.error(
          `${sessionId}|${condition.name}|Error while performing value search. ${e}`,
        );
        return false;
      }
    }),
  );

  let result = true;

  if (
    !condition.hasOwnProperty("operations") ||
    (condition.hasOwnProperty("operations") && condition.operation == "present")
  )
    result = searchResult.every((v) => v === true);

  if (
    condition.hasOwnProperty("operations") &&
    condition.operation == "missing"
  )
    result = searchResult.every((v) => v === false);

  logger.debug(
    `${sessionId}|${condition.name}|Condition processed. The result is "${result}"`,
  );

  return result;
}

const inRange = (
  num: number | string,
  min: number | string,
  max: number | string,
) => num >= min && num <= max;

const parseNum = (str: string) => +str.replace(/[^.\d]/g, "");

const operations = {
  ">": function (a: number | string, b: number | string) {
    return a > b;
  },
  "<": function (a: number | string, b: number | string) {
    return a < b;
  },
  ">=": function (a: number | string, b: number | string) {
    return a >= b;
  },
  "<=": function (a: number | string, b: number | string) {
    return a <= b;
  },
  "==": function (a: number | string, b: number | string) {
    return a == b;
  },
  "=": function (a: number | string, b: number | string) {
    return a == b;
  },
  "!=": function (a: number | string, b: number | string) {
    return a != b;
  },
  "<>": function (a: number | string, b: number | string) {
    return a != b;
  },
};

function compareWithVariance(variance: string, resultValue: number) {
  let comparisonValue = parseNum(variance);
  let upperLimit: number = 0;
  let lowerLimit: number = 0;

  if (variance.includes("%")) {
    comparisonValue = comparisonValue / 100;

    if (variance.includes("+-") || variance.includes("-+")) {
      upperLimit = resultValue * comparisonValue + resultValue;
      lowerLimit = resultValue - resultValue * comparisonValue;

      return { upperLimit, lowerLimit };
    }

    if (!variance.includes("+") && !variance.includes("-")) {
      upperLimit = resultValue * comparisonValue + resultValue;
      lowerLimit = upperLimit;

      return { upperLimit, lowerLimit };
    }

    if (variance.includes("+") && !variance.includes("-")) {
      upperLimit = resultValue * comparisonValue + resultValue;
      lowerLimit = upperLimit;

      return { upperLimit, lowerLimit };
    }

    if (!variance.includes("+") && variance.includes("-")) {
      lowerLimit = resultValue - resultValue * comparisonValue;
      upperLimit = lowerLimit;

      return { upperLimit, lowerLimit };
    }
  }

  if (!variance.includes("%")) {
    if (variance.includes("+-") || variance.includes("-+")) {
      upperLimit = resultValue + comparisonValue;
      lowerLimit = resultValue - comparisonValue;

      return { upperLimit, lowerLimit };
    }

    if (!variance.includes("+") && !variance.includes("-")) {
      upperLimit = resultValue + comparisonValue;
      lowerLimit = upperLimit;

      return { upperLimit, lowerLimit };
    }

    if (variance.includes("+") && !variance.includes("-")) {
      upperLimit = resultValue + comparisonValue;
      lowerLimit = upperLimit;

      return { upperLimit, lowerLimit };
    }

    if (!variance.includes("+") && variance.includes("-")) {
      lowerLimit = resultValue - comparisonValue;
      upperLimit = lowerLimit;

      return { upperLimit, lowerLimit };
    }
  }
}

// replace the special variables -  GUID, TODAY, NOW, RANDOM
function replaceSpecialVariables(configString: string): string {
  const date = new Date();
  const today = date.toISOString().split("T")[0].replace(/-/gi, "");
  const time = date
    .toISOString()
    .split("T")[1]
    .split(".")[0]
    .replace(/:/gi, "");

  let a = configString.match(/(?<=\${)(.*?)(?=})/g);

  // nothing to replace. no need to proceed return the config as it is
  if (!a) return configString;

  if (a.includes("TODAY"))
    configString = configString.replace(/\${TODAY}/gi, today);

  if (a.includes("GUID"))
    configString = configString.replace(/\${GUID}/gi, () =>
      randomUUID().replace(/-/gi, ""),
    );

  if (a.includes("NOW"))
    configString = configString.replace(/\${NOW}/gi, () => `${today}${time}`);

  if (a.includes("NOW_SPLIT"))
    configString = configString.replace(
      /\${NOW_SPLIT}/gi,
      () => `${today}_${time}`,
    );

  if (a.includes("RANDOM"))
    configString = configString.replace(/\${RANDOM}/gi, function () {
      return [...Array(20)]
        .map(() => Math.random().toString(36)[2])
        .join("")
        .toUpperCase();
    });

  return configString;
}

export { notificationsRouter };
