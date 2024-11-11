import { parseArgs } from "node:util";
import fs from "fs";

import Ajv, { ValidateFunction } from "ajv";
import ajvErrors from "ajv-errors";
import express from "express";
import cors from "cors";
import https from "https";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import yaml from "js-yaml";
import { QlikRepoApi } from "qlik-repo-api";

import { logger, flushLogs, setDefaultLevel } from "./lib/logger";
import { generalRouter } from "./routes/general";
import { notificationsRouter, initNotifications } from "./routes/notifications";

import { Config, Notification } from "./interfaces";

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

const configSchema = JSON.parse(
  fs.readFileSync("./schemas/config.json").toString()
);

let config = {} as Config;
let notifications = {} as { [k: string]: Notification };
let repoClient = {} as QlikRepoApi.client;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

async function prepareConfig() {
  config = yaml.load(readFileSync(".\\config.yaml")) as Config;

  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    strictRequired: true,
    allowUnionTypes: true,
  });

  ajvErrors(ajv);

  const validate: ValidateFunction<unknown> = ajv.compile(configSchema);

  const valid = validate(config);

  if (!valid) {
    const errors = validate.errors.map((e) => e.message).join(", ");
    throw new Error(errors);
  }

  config.notifications.map((notification) => {
    notifications[notification.id] = notification;
  });
}

async function prepareRepoClient() {
  const cert = readFileSync(`${config.qlik.cert}`);
  const key = readFileSync(`${config.qlik.key}`);

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

  await prepareConfig();

  setDefaultLevel(config.general.logLevel);

  const port = config.general?.port || 8443;

  await prepareRepoClient();
  await initNotifications(
    notifications,
    repoClient,
    config.plugins,
    config.qlik.host,
    config.general.logLevel
  );

  await createQlikNotifications(port);

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
      logger.info(`HTTPS web server is running on port ${port}`);
    });
  } else {
    app.listen(port, () => {
      logger.info(`Web server is running on port ${port}`);
    });
  }
}

run();
