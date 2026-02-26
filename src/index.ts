import { parseArgs } from "node:util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import express from "express";
import https from "https";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { QlikRepoApi } from "qlik-repo-api";

import { logger, flushLogs, setDefaultLevel, adminLogger } from "./lib/logger";
import { generalRouter } from "./routes/general";
import { notificationsRouter, initNotifications } from "./routes/notifications";

import {
  BuiltInPlugins,
  NotificationRepo,
  Config,
  Notification,
} from "./interfaces/interfaces";
import { adminRouter } from "./routes/admin";
import { apiRouter, apiEmitter, setCookieSecret } from "./routes/api";
import { loadConfig } from "./lib/config";
import { GeneralConfig21 } from "./interfaces/general";
import * as db from "./lib/store";

process.setMaxListeners(100);

process.on("uncaughtException", (e) => {
  logger.crit(e.message);
  flushLogs();
  new Promise((resolve) => setTimeout(resolve, 2000)).then(() => {
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason) => {
  logger.crit(reason);
  flushLogs();
  new Promise((resolve) => setTimeout(resolve, 2000)).then(() => {
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT. Stopping");
  flushLogs();
  new Promise((resolve) => setTimeout(resolve, 2000)).then(() => {
    process.exit(1);
  });
});

process.on("SIGQUIT", () => {
  logger.info("SIGQUIT. Stopping");
  flushLogs();
  new Promise((resolve) => setTimeout(resolve, 2000)).then(() => {
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM. Stopping");
  flushLogs();
  new Promise((resolve) => setTimeout(resolve, 2000)).then(() => {
    process.exit(1);
  });
});

const args = process.argv;
const options = {
  uuid: {
    type: "boolean",
  },
};

const { values } = parseArgs({
  args,
  //@ts-ignore
  options,
  allowPositionals: true,
});

if (values["uuid"]) {
  const id = uuidv4();
  console.log(id);
  process.exit(0);
}

let configAll = {} as Config;
let notifications = {} as { [k: string]: Notification };
let repoClient = {} as { [k: string]: QlikRepoApi.client };
let port = 0;
const builtInPlugins: BuiltInPlugins = {
  echo: true,
  http: true,
  file: true,
};

apiEmitter.on("reloadConfig", async () => {
  logger.info("Reloading config started");
  notifications = {};
  let { configDetails } = await loadConfig(logger);
  configAll = configDetails;
  notifications = configDetails.notificationsObj;
  // if we need to change the log level
  setDefaultLevel(configAll.general.logLevel);
  await initNotifications(
    notifications,
    repoClient,
    configAll.qlik,
    configAll.general,
    true,
    { ...builtInPlugins, ...configAll.general.builtInPlugins },
  );
  await createQlikNotifications(port);
  //NOTE: shall we allow Qlik config to be changed on the fly?
  // await prepareRepoClients();
  logger.info("Reloading config finished");
});

apiEmitter.on("deleteNotification", async (notificationId) => {
  try {
    const notification = notifications[notificationId];

    if (notification) {
      const repo = repoClient[notification.environment];

      await repo.notification
        .remove({
          handle: (notification as NotificationRepo).handle,
        })
        .then(() => {
          logger.info(
            `Notification "${notification.nameOriginal}" with handle ${(notification as NotificationRepo).handle} was de-registered`,
          );

          // once the notification is removed from Qlik
          // then remove it from the list with the notifications as well
          delete notifications[notificationId];

          db.removeHandle(notificationId);
        })
        .catch((e) => {
          logger.error(
            `Failed to de-register notification ${notificationId}. Error: ${e}`,
          );
        });
    } else {
      // just in case the handle is present in the DB
      try {
        db.removeHandle(notificationId);
      } catch (e) {}
    }
  } catch (e) {
    logger.error(e);
  }
});

async function prepareRepoClients() {
  configAll.qlik.map((q) => {
    const cert = readFileSync(`${q.certs}\\client.pem`);
    const key = readFileSync(`${q.certs}\\client_key.pem`);
    let authentication = {
      user_dir: "INTERNAL",
      user_name: "sa_scheduler",
    };
    if (q.userDir && q.userName) {
      authentication = {
        user_dir: q.userDir,
        user_name: q.userName,
      };
    }
    repoClient[q.name] = new QlikRepoApi.client({
      host: q.host,
      port: 4242,
      authentication,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        cert: cert,
        key: key,
      }),
    });
  });
}

async function createQlikNotifications(port: number) {
  const changeTypes = {
    undefined: 0,
    add: 1,
    update: 2,
    delete: 3,
  };

  const notificationTypes = [
    "App",
    "AnalyticConnection",
    "ContentLibrary",
    "DataConnection",
    "Extension",
    "ExecutionResult",
    "ReloadTask",
    "Stream",
    "User",
    "UserSyncTask",
    "SystemRule",
    "Tag",
    "CustomPropertyDefinition",
    "EngineService",
    "OdagService",
    "PrintingService",
    "ProxyService",
    "RepositoryService",
    "SchedulerService",
    "ServerNodeConfiguration",
    "VirtualProxyConfig",
    "DataAlert",
  ];

  const callbackURLProtocol = configAll.general.certs ? "https" : "http";
  const callbackBaseURL = `${callbackURLProtocol}://${configAll.general.uri}:${port}`;

  await Promise.all(
    Object.entries(notifications).map(([id, notification]) => {
      if (!notificationTypes.includes(notification.type))
        throw new Error(
          `Notification type "${notification.type}" is not valid value`,
        );

      if (notification.type != "DataAlert") {
        if (!changeTypes[notification.changeType.toLowerCase()])
          throw new Error(
            `changeType "${notification.changeType}" is not valid value`,
          );
      }

      const notificationData = {
        name: "",
        changetype: "",
        uri: `${callbackBaseURL}/notifications/callback/${id}`,
      };

      if (notification.type != "DataAlert") {
        if (notification.hasOwnProperty("condition"))
          notificationData["condition"] = notification["condition"];

        if (notification.hasOwnProperty("propertyName"))
          notificationData["propertyname"] = notification["propertyName"];

        notificationData.name = notification.type;
        notificationData.changetype =
          changeTypes[notification.changeType.toLowerCase()];
      } else {
        if (!notification.hasOwnProperty("filter"))
          logger.crit(
            `DataAlert notification should have filter property. Notification ID: ${notification.nameOriginal}`,
          );

        notificationData.name = "App";
        notificationData.changetype = "2";
      }

      if (notification.filter) notificationData["filter"] = notification.filter;

      return (
        repoClient[notification.environment].notification
          // have to ignore that one. The DataAlert is not valid Repo value
          // its replaced with App above anyway
          //@ts-ignore
          .create(notificationData)
          .then(async (e) => {
            await db.addHandle(id, notification.nameOriginal, e);
            notifications[id]["handle"] = e;
            logger.info(
              `Notification "${notification.nameOriginal}" registered with Qlik handle: ${e}`,
            );
          })
          .catch((e) => {
            logger.crit(
              `Error while creating notification "${notification.nameOriginal}"`,
            );
            logger.crit(`${e.message}`);
            process.exit(1);
          })
      );
    }),
  );
}

async function run() {
  logger.info("Starting core web server ...");

  await db.init();

  // let configDetails = await prepareAndValidateConfig(logger);
  let { configDetails, isConfigValid } = await loadConfig(logger);
  if (!isConfigValid) {
    throw new Error("Exiting due to config load/validation issue(s)");
  }

  configAll = configDetails;

  logger.info("Config files were read and validated successfully");

  notifications = configAll.notificationsObj;

  setDefaultLevel(configAll.general.logLevel);

  // if port is defined in the config - use it
  // if not then if certs are defined the default port is 8443
  // if not then defaults to 8080
  port = configAll.general?.port
    ? configAll.general?.port
    : configAll.general.certs
      ? 8443
      : 8080;

  await prepareRepoClients();

  await initNotifications(
    notifications,
    repoClient,
    configAll.qlik,
    configAll.general,
    false,
    { ...builtInPlugins, ...configAll.general.builtInPlugins },
  );

  await createQlikNotifications(port);

  startWebServer(port);
}

function startWebServer(port: number) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(function (req, _, next) {
    req.headers.origin = req.headers.origin || req.headers.host;
    next();
  });

  app.use("/", generalRouter);
  app.use("/notifications", notificationsRouter);
  app.all(/(.*)/, (_, res) => {
    res.status(404).send();
  });

  // if certs config property exists then start HTTPS server
  // else start HTTP server
  if (configAll.general.certs) {
    const privateKey = fs.readFileSync(
      `${configAll.general.certs}/key.pem`,
      "utf8",
    );
    const certificate = fs.readFileSync(
      `${configAll.general.certs}/cert.pem`,
      "utf8",
    );
    const httpsServer = https.createServer(
      {
        key: privateKey,
        cert: certificate,
      },
      app,
    );

    logger.debug(`Certificates loaded from ${configAll.general.certs}`);

    httpsServer.listen(port, () => {
      logger.info(`Core web server is running on port ${port} -> HTTPS`);
    });
  } else {
    app.listen(port, () => {
      logger.info(`Core web server is running on port ${port}`);
    });
  }

  if (configAll.general.admin !== false) {
    try {
      adminLogger.info("Starting admin web server ...");
      // Admin https server below
      const adminApp = express();
      adminApp.use(express.urlencoded({ extended: true }));
      adminApp.use(express.json());
      adminApp.use("/static", express.static(path.join(__dirname, "./static")));
      adminApp.use("/admin", adminRouter);
      adminApp.use("/api", apiRouter);

      setCookieSecret((configAll.general.admin as GeneralConfig21).cookie);

      const adminPort =
        (configAll.general.admin as GeneralConfig21).port || 8099;

      const adminPrivateKey = fs.readFileSync(
        `${(configAll.general.admin as GeneralConfig21).certs}/key.pem`,
        "utf8",
      );
      const adminCertificate = fs.readFileSync(
        `${(configAll.general.admin as GeneralConfig21).certs}/cert.pem`,
        "utf8",
      );
      const httpsAdminServer = https.createServer(
        {
          key: adminPrivateKey,
          cert: adminCertificate,
        },
        adminApp,
      );

      adminLogger.debug(
        `Admin Certificates loaded from ${(configAll.general.admin as GeneralConfig21).certs}`,
      );

      httpsAdminServer.listen(adminPort, () => {
        adminLogger.info(
          `Admin HTTPS web server is running on port ${adminPort}`,
        );
      });
    } catch (e) {
      adminLogger.error("Admin UI and API failed to load");
      adminLogger.error(e);
    }
  } else {
    adminLogger.info("Admin UI and API endpoints are disabled in the config");
  }
}

run();
