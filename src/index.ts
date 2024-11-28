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

import { Config, Notification } from "./interfaces";
import { adminRouter } from "./routes/admin";
import { apiRouter, apiEmitter, setCookieSecret } from "./routes/api";
import { prepareAndValidateConfig } from "./lib/configValidate";

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

const { values, positionals } = parseArgs({
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

apiEmitter.on("reloadConfig", async () => {
  logger.info("Reloading config started");

  notifications = {};

  let configDetails = await prepareAndValidateConfig(logger);

  config = configDetails.config;
  notifications = configDetails.notifications;

  // if we need to change the log level
  setDefaultLevel(config.general.logLevel);

  await initNotifications(
    notifications,
    repoClient,
    config.plugins,
    config.qlik,
    config.general.logLevel,
    true
  );

  await createQlikNotifications(port);

  //NOTE: shall we allow Qlik config to be changed on the fly?
  //await prepareRepoClients();

  logger.info("Reloading config finished");
});

let config = {} as Config;
let notifications = {} as { [k: string]: Notification };
let repoClient = {} as { [k: string]: QlikRepoApi.client };
let port = 0;

async function prepareRepoClients() {
  config.qlik.map((q) => {
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
  ];

  const callbackURLProtocol = config.general.certs ? "https" : "http";
  const callbackBaseURL = `${callbackURLProtocol}://${config.general.uri}:${port}`;

  await Promise.all(
    Object.entries(notifications).map(([id, notification]) => {
      if (!notificationTypes.includes(notification.type))
        throw new Error(
          `Notification type "${notification.type}" is not valid value`
        );

      if (!changeTypes[notification.changeType.toLowerCase()])
        throw new Error(
          `changeType "${notification.changeType}" is not valid value`
        );

      const notificationData = {
        name: notification.type,
        uri: `${callbackBaseURL}/notifications/callback/${id}`,
      };

      notificationData["changeType"] =
        changeTypes[notification.changeType.toLowerCase()];

      if (notification.condition)
        notificationData["condition"] = notification.condition;

      if (notification.filter) notificationData["filter"] = notification.filter;

      if (notification.propertyName)
        notificationData["propertyname"] = notification.propertyName;

      return repoClient[notification.environment].notification
        .create(notificationData)
        .then((e) => {
          logger.info(
            `Notification "${notification.name}" registered. ID: ${id}`
          );

          logger.debug(`Create notification response from Qlik: ${e}`);
        });
    })
  );
}

async function run() {
  logger.info("Starting...");

  let configDetails = await prepareAndValidateConfig(logger);

  config = configDetails.config;
  notifications = configDetails.notifications;

  setDefaultLevel(config.general.logLevel);

  // if port is defined in the config - use it
  // if not then if certs are defined the default port is 8443
  // if not then defaults to 8080
  port = config.general?.port
    ? config.general?.port
    : config.general.certs
    ? 8443
    : 8080;

  await prepareRepoClients();

  await initNotifications(
    notifications,
    repoClient,
    config.plugins,
    config.qlik,
    config.general.logLevel,
    false
  );

  await createQlikNotifications(port);

  startWebServer(port);
}

function startWebServer(port: number) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(function (req, res, next) {
    req.headers.origin = req.headers.origin || req.headers.host;
    next();
  });

  app.use("/", generalRouter);
  app.use("/notifications", notificationsRouter);
  app.all("*", (req, res) => {
    res.status(404).send();
  });

  // if certs config property exists then start HTTPS server
  // else start HTTP server
  if (config.general.certs) {
    const privateKey = fs.readFileSync(
      `${config.general.certs}/key.pem`,
      "utf8"
    );
    const certificate = fs.readFileSync(
      `${config.general.certs}/cert.pem`,
      "utf8"
    );
    const httpsServer = https.createServer(
      {
        key: privateKey,
        cert: certificate,
      },
      app
    );

    logger.debug(`Certificates loaded from ${config.general.certs}`);

    httpsServer.listen(port, () => {
      logger.info(`Core web server is running on port ${port} -> HTTPS`);
    });
  } else {
    app.listen(port, () => {
      logger.info(`Core web server is running on port ${port}`);
    });
  }

  // Admin https server below
  const adminApp = express();
  adminApp.use(express.urlencoded({ extended: true }));
  adminApp.use(express.json());
  adminApp.use("/static", express.static(path.join(__dirname, "./static")));
  adminApp.use("/admin", adminRouter);
  adminApp.use("/api", apiRouter);

  setCookieSecret(config.general.admin.cookie);

  const adminPort = config.general.admin.port || 8099;

  const adminPrivateKey = fs.readFileSync(
    `${config.general.admin.certs}/key.pem`,
    "utf8"
  );
  const adminCertificate = fs.readFileSync(
    `${config.general.admin.certs}/cert.pem`,
    "utf8"
  );
  const httpsAdminServer = https.createServer(
    {
      key: adminPrivateKey,
      cert: adminCertificate,
    },
    adminApp
  );

  logger.debug(`Admin Certificates loaded from ${config.general.certs}`);

  httpsAdminServer.listen(adminPort, () => {
    adminLogger.info(`Admin HTTPS web server is running on port ${adminPort}`);
  });
}

run();
