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
import { adminRouter, adminEmitter } from "./routes/admin";
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

adminEmitter.on("reloadConfig", async () => {
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

// async function prepareAndValidateConfig() {
//   if (!fs.existsSync(".\\config.yaml"))
//     throw new Error(`config.yaml not found`);

//   let configRaw = readFileSync(".\\config.yaml").toString();
//   config = yaml.load(configRaw) as Config;

//   if (config.general.vars) {
//     if (!fs.existsSync(config.general.vars))
//       throw new Error(
//         `Variables files specified but do not exists: ${config.general.vars}`
//       );

//     const configVariables = configRaw
//       .match(/(?<!\$)(\${)(.*?)(?=})/g)
//       .map((v) => v.substring(2));

//     const variablesData = varLoader({
//       sources: {
//         file: config.general.vars,
//       },
//       variables: configVariables,
//     });

//     if (variablesData.missing)
//       throw new Error(
//         `Missing variable(s) value: ${variablesData.missing
//           .map((v) => v)
//           .join(", ")}`
//       );

//     configRaw = replaceVariables(configRaw, variablesData.values);
//     config = yaml.load(configRaw) as Config;
//   }

//   const ajv = new Ajv({
//     allErrors: true,
//     strict: true,
//     strictRequired: true,
//     allowUnionTypes: true,
//   });

//   ajvErrors(ajv);

//   const configSchema = JSON.parse(
//     fs.readFileSync("./schemas/config.json").toString()
//   );

//   const validate: ValidateFunction<unknown> = ajv.compile(configSchema);

//   const valid = validate(config);

//   if (!valid) {
//     const errors = validate.errors.map((e) => e.message).join(", ");
//     throw new Error(errors);
//   }

//   config.notifications.map((notification) => {
//     notifications[notification.id] = notification;
//   });
// }

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

  const adminApp = express();
  adminApp.use(express.urlencoded({ extended: true }));
  adminApp.use(express.json());
  adminApp.use("/static", express.static(path.join(__dirname, "./static")));
  adminApp.use("/admin", adminRouter);

  const adminPort = 8099;
  adminApp.listen(adminPort, () => {
    adminLogger.info(`Admin web server is running on port ${adminPort}`);
  });
}

// function replaceVariables(
//   text: string,
//   vars: { [x: string]: string | number | boolean }
// ) {
//   Object.entries(vars).forEach(([varName, varValue]) => {
//     try {
//       const v = "\\$\\{" + varName + "\\}";
//       const re = new RegExp(v, "g");

//       // this.runbookVariablesValues[varName] = varValue;
//       text = text.replace(re, varValue.toString());
//     } catch (e) {
//       this.logger.error(e.message, 9999);
//     }
//   });

//   return text;
// }

run();
