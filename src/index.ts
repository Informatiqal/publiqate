import { parseArgs } from "node:util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

import express from "express";
import cors from "cors";
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

if (values["verify"]) {
  //TODO: provide config path and here will verify it. No commitments
}

apiEmitter.on("reloadConfig", async () => {
  logger.info("Reloading config started");

  notifications = {};

  let configDetails = await prepareAndValidateConfig();

  config = configDetails.config;
  notifications = configDetails.notifications;

  // if we need to change the log level
  setDefaultLevel(config.general.logLevel);

  await initNotifications(
    notifications,
    repoClient,
    config.plugins,
    config.qlik.host,
    config.general.logLevel,
    true
  );

  await createQlikNotifications(port);

  //NOTE: shall we allow Qlik config to be changed on the fly?
  //await prepareRepoClient();

  logger.info("Reloading config finished");
});

let config = {} as Config;
let notifications = {} as { [k: string]: Notification };
let repoClient = {} as QlikRepoApi.client;
let port = 0;

async function prepareRepoClient() {
  const cert = readFileSync(`${config.qlik.certs}\\client.pem`);
  const key = readFileSync(`${config.qlik.certs}\\client_key.pem`);

  repoClient = new QlikRepoApi.client({
    host: config.qlik.host,
    port: 4242,
    authentication: {
      user_dir: config.qlik.userDir,
      user_name: config.qlik.userName,
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
      cert: cert,
      key: key,
    }),
  });
}

async function createQlikNotifications(port: number) {
  const changeTypes = {
    undefined: 0,
    add: 1,
    update: 2,
    delete: 3,
  };

  const callbackURLProtocol = config.general.certs ? "https" : "http";
  const callbackBaseURL = `${callbackURLProtocol}://${config.general.uri}:${port}`;

  await Promise.all(
    Object.entries(notifications).map(([id, notification]) => {
      const notificationData = {
        name: notification.type,
        uri: `${callbackBaseURL}/notifications/callback/${id}`,
      };

      //TODO: validations should be performed here

      notificationData["changeType"] =
        changeTypes[notification.changeType.toLowerCase()];

      if (notification.condition)
        notificationData["condition"] = notification.condition;

      if (notification.filter) notificationData["filter"] = notification.filter;

      if (!notification.hasOwnProperty("getEntityDetails"))
        notification.getEntityDetails = true;

      return repoClient.notification.create(notificationData).then((e) => {
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

  let configDetails = await prepareAndValidateConfig();

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

  await prepareRepoClient();

  await initNotifications(
    notifications,
    repoClient,
    config.plugins,
    config.qlik.host,
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

  app.options(
    "/notifications/callback"
    // cors({
    //   origin: config.qlik.host,
    // })
  );
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
