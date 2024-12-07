import querystring from "node:querystring";
import WebSocket from "ws";
import express, { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  Config,
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
  LogLevels,
  DataAlertListCondition,
} from "../interfaces";
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
let logLevel = logLevels;
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

      // if the notification is not found then ignore it
      if (!notification) {
        logger.debug(
          `Received notification with ID: "${notificationId}". This ID dont exists in the config (anymore?)`
        );

        return;
      }

      // remove duplicate notifications ... if any
      req.body = req.body.filter((value, index, self) => {
        return self.findIndex((v) => v.id === value.id) === index;
      });

      if (notification.type == "DataAlert") {
        processDataAlertNotification(notification, req);
      } else {
        processRepoNotification(notification, req);
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
  generalLogLevel: LogLevels,
  isReload: boolean
) {
  configNotifications = notifications;
  repoClient = apiClient;
  pluginsConfig = config;
  environments = qlikEnvironments;
  // if (generalLogLevel) logLevel = generalLogLevel;

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
  const httpLogLevel = logLevels["http"] || logLevels.plugins;
  pluginLoggers["http"] = createPluginLogger("http", httpLogLevel);
  plugins["http"] = httpPlugin.implementation;
  logger.info(`Built-in plugin "http" loaded with log level "${httpLogLevel}"`);

  // echo plugin
  const echoLogLevel = logLevels["echo"] || logLevels.plugins;
  pluginLoggers["echo"] = createPluginLogger("echo", echoLogLevel);
  plugins["echo"] = echoPlugin.implementation;
  logger.info(`Built-in plugin "echo" loaded with log level "${echoLogLevel}"`);

  // file store plugin
  const fileLogLevel = logLevels["file"] || logLevels.plugins;
  pluginLoggers["file"] = createPluginLogger("file", fileLogLevel);
  plugins["file"] = fileStorage.implementation;
  logger.info(
    `Built-in plugin "file" loaded  with log level "${fileLogLevel}"`
  );
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
                }
              )
            ),
            defaultMeta: {
              service: p.meta.name,
            },
          });

          logger.info(
            `External plugin "${
              p.meta.name
            }" loaded from "${plugin}" with meta ${JSON.stringify(
              p.meta
            )} and log level "${logLevel}"`
          );

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
  let activeCallbacks = b.config.callbacks.filter((c) => {
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

async function processDataAlertNotification(
  notification: Notification,
  req: Request
) {
  if (!notification.filter) {
    logger.error(`No filter specified for notification ${notification.id}`);

    return;
  }

  const app: App[] = await repoClient[notification.environment].apps.getFilter({
    filter: notification.filter,
  });

  if (app.length > 1 || app.length == 0) {
    logger.error(
      `Data alert filter should return only one app. Returned ${app.length}`
    );

    return;
  }

  const updatedProperties = req.body.filter((n) =>
    n.changedProperties.includes("lastReloadTime")
  );

  if (updatedProperties.length != 1) return;

  const qlikEnv = environments.filter(
    (e) => notification.environment == e.name
  )[0];

  const engineUserConnections: {
    [user: string]: {
      conditions: DataAlertCondition[];
      connection: enigmaJS.ISession;
    };
  } = {};

  (notification as NotificationDataAlert)["data-conditions"].map((dc) => {
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
  });

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
      createSocket: (url) =>
        new WebSocket(url, {
          //@ts-ignore
          key,
          cert,
          rejectUnauthorized: false,
          headers: {
            "X-Qlik-User": `UserDirectory=${encodeURIComponent(
              userDir
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
          `${session["publiqateId"]}|Connection established for notification ${notification.id}`
        );

        const doc = await global.openDoc(app[0].details.id);
        qlikCommsLogger.debug(
          `${session["publiqateId"]}|App ${app[0].details.id} open with user ${user}`
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
                    session["publiqateId"]
                  );
                  const conditionResult = await evaluateScalarCondition(
                    doc,
                    scalarCondition,
                    session["publiqateId"]
                  );
                  overallConditionResults =
                    overallConditionResults && conditionResult;
                }

                if (c.type == "list") {
                  const listCondition = c as unknown as DataAlertListCondition;
                  const conditionResult = await evaluateListCondition(
                    doc,
                    listCondition,
                    session["publiqateId"]
                  );

                  overallConditionResults =
                    overallConditionResults && conditionResult;
                }
              })
            );
          })
        );

        logger.info(
          [
            `${session["publiqateId"]}|`,
            `All conditions for app ${app[0].details.id} `,
            `with user ${user} `,
            `for notification ${notification.id} were processed. `,
            `The overall evaluation result is "${overallConditionResults}"`,
          ].join("")
        );

        if (overallConditionResults == true) {
          const notificationData: NotificationData = {
            config: notification,
            environment: environments.filter(
              (e) => e.name == notification.environment
            )[0],
            data: req.body,
            entities: app,
          };

          relay(notificationData);
        }
      } catch (e) {
        logger.error(
          `${session["publiqateId"]}|QIX comms error for notification ${notification.id} and user ${user}`
        );
        logger.error(e);
      }
      session.close().then((r) => {
        qlikCommsLogger.debug(
          `${session["publiqateId"]}|Session for app ${app[0].details.id} opened with user ${user} is closed`
        );
      });
    } catch (e) {
      // try and close the session in case of an issue
      session.close().catch(e);

      logger.error(
        `${session["publiqateId"]}|General QIX comms error for notification ${notification.id} and user ${user}`
      );
      logger.error(e);
    }
  });
}

async function processRepoNotification(
  notification: Notification,
  req: Request
) {
  // if the notification should be for a specific entity property
  // filter the body and exclude data which is not including that property
  // usually this is to exclude notifications which where changed (modifiedDate)
  // but the required property was not changed. Its a Qlik thingy
  if (notification.hasOwnProperty("propertyName")) {
    req.body = req.body.filter((n) =>
      n.changedProperties.includes(
        (notification as NotificationRepo).propertyName
      )
    );
  }

  // after all filtering if there is no data left then
  // just return and do not try to do anything more
  if (req.body.length == 0) return;

  const notificationData: NotificationData = {
    config: notification,
    environment: environments.filter(
      (e) => e.name == notification.environment
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

async function makeQlikSelections(
  doc: EngineAPI.IApp,
  selections: (DataAlertFieldSelection | DataAlertBookmarkApply)[],
  sessionId: string
) {
  qlikCommsLogger.debug(`${sessionId}|Clear all`);
  await doc.clearAll(false);

  return await Promise.all(
    selections.map(async (selection) => {
      if (selection.hasOwnProperty("bookmark")) {
        await doc.applyBookmark(selection["bookmark"]);
        qlikCommsLogger.debug(
          `${sessionId}|Bookmark applied "${selection["bookmark"]}"`
        );
      } else {
        await doc.mSelectInField(
          (selection as DataAlertFieldSelection).field,
          (selection as DataAlertFieldSelection).values
        );

        qlikCommsLogger.debug(
          `${sessionId}|Selections in field "${
            (selection as DataAlertFieldSelection).field
          }" applied: ${(selection as DataAlertFieldSelection).values.join(
            ", "
          )}`
        );
      }
    })
  );
}

async function evaluateScalarCondition(
  doc: EngineAPI.IApp,
  condition: DataAlertScalarCondition,
  sessionId: string
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
    ].join("")
  );

  let comparisonResults = true;

  condition.results.map((c) => {
    let evalPrefix = typeof evalEx == "string" ? `"` : "";
    let valuePrefix = typeof c.value == "string" ? `"` : "";

    if (c.variation) {
      let { upperLimit, lowerLimit } = compareWithVariance(
        c.variation,
        evalEx as number
      );

      const comparisonResult = inRange(c.value, lowerLimit, upperLimit);

      comparisonResults = comparisonResults && comparisonResult;

      logger.debug(
        `${sessionId}|${condition.name}|Evaluation result ${evalPrefix}${evalEx}${evalPrefix} is compared to ${valuePrefix}${c.value}${valuePrefix} (${c.variation}). Result is "${comparisonResult}"`
      );
    } else {
      const comparisonResult = operations[c.operator ? c.operator : "=="](
        evalEx,
        c.value
      );

      comparisonResults = comparisonResults && comparisonResult;

      logger.debug(
        `${sessionId}|${
          condition.name
        }|Evaluation result ${evalPrefix}${evalEx}${evalPrefix} is compared to ${valuePrefix}${
          c.value
        }${valuePrefix} (${
          c.operator ? c.operator : "=="
        }). Result is "${comparisonResult}"`
      );
    }
  });

  logger.debug(
    `${sessionId}|${condition.name}|Conditions processed. The result is "${comparisonResults}"`
  );

  return comparisonResults;
}

async function evaluateListCondition(
  doc: EngineAPI.IApp,
  condition: DataAlertListCondition,
  sessionId: string
) {
  logger.debug(
    `${sessionId}|${condition.name}|Searching for matching values in "${
      condition.fieldName
    }". Searched values are: ${condition.values.join(",")}`
  );

  const searchResult = await Promise.all(
    condition.values.map(async (v) => {
      try {
        const sessionObj = await doc.mCreateSessionListbox(condition.fieldName);
        const searchResult = await sessionObj.obj.searchListObjectFor(
          "/qListObjectDef",
          v.toString()
        );
        const layout =
          (await sessionObj.obj.getLayout()) as EngineAPI.IGenericListLayout;

        // something went wrong with the search
        if (searchResult == false) return false;

        await doc
          .destroySessionObject(sessionObj.props.qInfo.qId)
          .catch((e) => {});

        return layout.qListObject.qSize.qcx > 0 && layout.qListObject.qSize.qcy
          ? true
          : false;
      } catch (e) {
        logger.error(
          `${sessionId}|${condition.name}|Error while performing value search. ${e}`
        );
        return false;
      }
    })
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
    `${sessionId}|${condition.name}|Condition processed. The result is "${result}"`
  );

  return result;
}

const inRange = (num, min, max) => num >= min && num <= max;

const parseNum = (str: string) => +str.replace(/[^.\d]/g, "");

const operations = {
  ">": function (a, b) {
    return a > b;
  },
  "<": function (a, b) {
    return a < b;
  },
  ">=": function (a, b) {
    return a >= b;
  },
  "<=": function (a, b) {
    return a <= b;
  },
  "==": function (a, b) {
    return a == b;
  },
  "=": function (a, b) {
    return a == b;
  },
  "!=": function (a, b) {
    return a != b;
  },
  "<>": function (a, b) {
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

export { notificationsRouter };
