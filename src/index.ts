import express, { Request, Response } from "express";
import https from "https";
import { v4 as uuidv4 } from "uuid";
import bodyParser from "body-parser";
import { readFileSync } from "fs";
import yaml from "js-yaml";
import { QlikRepoApi } from "qlik-repo-api";

import { logger } from "./lib/logger";
import { generalRouter } from "./routes/general";
import { notificationsRouter, initNotifications } from "./routes/notifications";

import { Config, Notification } from "./interfaces";

var exceptionOccurred = false;

// process.on("uncaughtException", function (err) {
//   console.log("Caught exception: " + err);
//   exceptionOccurred = true;
//   process.exit();
// });

// process.on("exit", function (code) {
//   if (exceptionOccurred) console.log("Exception occurred");
//   else console.log("Kill signal received");
// });

// process.on("SIGINT", function () {
//   console.log("SIGINT");
//   process.exit();
// });

let config = {} as Config;
let notifications = {} as { [k: string]: Notification };
let repoClient = {} as QlikRepoApi.client;

const app = express();
app.use(bodyParser.urlencoded());
app.use(bodyParser.json());

async function prepareConfig() {
  config = yaml.load(readFileSync(".\\config.yaml")) as Config;

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

async function createQlikNotifications() {
  const changeTypes = {
    undefined: 0,
    add: 1,
    update: 2,
    delete: 3,
  };

  await Promise.all(
    Object.entries(notifications).map(([id, notification]) => {
      const notificationData = {
        name: notification.type,
        uri: `${config.general.uri}:${config.general.port}/notifications/callback/${id}`,
      };

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
      });
    })
  );
}

async function run() {
  await prepareConfig();
  await prepareRepoClient();
  await initNotifications(notifications, repoClient, config.plugins);

  await createQlikNotifications();

  app.use("/", generalRouter);
  app.use("/notifications", notificationsRouter);
  app.all("*", (req, res) => {
    res.status(404).send();
  });

  app.listen(config.general.port, () => {
    logger.info(`Web server is running on port ${config.general.port}`);
  });
}

run();
