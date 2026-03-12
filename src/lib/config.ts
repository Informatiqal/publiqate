import { varLoader } from "@informatiqal/variables-loader";
import fs from "fs";
import yaml from "js-yaml";
import ajvErrors from "ajv-errors";
import Ajv, { ValidateFunction } from "ajv";

import { Config, Notifications } from "../interfaces/interfaces";
import { Logger } from "winston";
import { QlikConfig } from "../interfaces/qlik";
import { GeneralConfig, GeneralConfig30 } from "../interfaces/general";

let logger = {} as Logger;

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictRequired: true,
  allowUnionTypes: true,
});

ajvErrors(ajv);
let isConfigValid = true;

export async function loadConfig(log: Logger) {
  logger = log;

  const configs = await readAndParseConfigs();
  if (!isConfigValid) return { isConfigValid, configDetail: {} as Config };

  checkMissingEnvironment(configs.qlik.config, configs.notifications.config);

  configs.notifications.config = setNotificationsDefaultOptions(
    configs.notifications.config,
    {
      ...{
        disableCors: true,
        getEntityDetails: true,
        whitelist: [],
      },
      ...configs.general.config.notifications,
    },
  );

  checkDuplicateNotificationNames(configs.notifications.config);

  configs.notifications.config = removeDisabledNotifications(
    configs.notifications.config,
  );

  // once the duplicates are removed (if any) set the raw config with the existing config
  configs.notifications.configRaw = JSON.stringify(
    configs.notifications.config,
  );

  if (configs.notifications.config.length == 0)
    logger.warning("0 active notifications");

  let fullRawConfig = JSON.stringify({
    general: configs.general.config,
    qlik: configs.qlik.config,
    notifications: configs.notifications.config,
  });

  // fullRawConfig = replaceSpecialVariables(fullRawConfig);

  let finalConfig = {} as Config;
  if (configs.general.config.vars) {
    let varsFiles: string[] = [];

    if (!Array.isArray(configs.general.config.vars)) {
      varsFiles.push(configs.general.config.vars);
    } else {
      varsFiles = configs.general.config.vars;
    }

    varsFiles.map((v) => {
      if (!fs.existsSync(v)) {
        const index = varsFiles.findIndex((e) => e == v);
        if (index > -1) varsFiles.splice(index, 1);
        logger.error(
          `Variables files specified but do not exists: ${v}. Skipping it.`,
        );
        // return { isConfigValid: false, configDetails: {} as Config };
      }
    });

    const configVariables = fullRawConfig
      .match(/(?<!\$)(\${)(.*?)(?=})/g)
      .map((v) => v.substring(2));

    let varValues = {};
    let varMissing = [];

    // load all variable files
    varsFiles.map((v) => {
      const a = varLoader({
        sources: {
          file: v,
        },
        ignore: ["TODAY", "GUID", "NOW", "NOW_SPLIT", "RANDOM"],
        variables: configVariables,
      });

      varValues = { ...varValues, ...a.values };
      Object.keys(a.values).map((v) => {
        if (varMissing.includes(v)) {
          const index = varMissing.findIndex((e) => e == v);
          if (index > -1) varMissing.splice(index, 1);
        }
      });
    });

    if (varMissing.length > 0) {
      isConfigValid = false;
      logger.error(
        `Missing variable(s) value: ${varMissing.map((v) => v).join(", ")}`,
      );

      return { isConfigValid, configDetails: {} as Config };
    }

    fullRawConfig = replaceVariables(fullRawConfig, varValues)
      .replace(/\\\\/g, "/")
      .replace(/\\/g, "/");
    finalConfig = JSON.parse(fullRawConfig);
    let n = {};
    // configs.notifications.config.map((notification) => {
    finalConfig.notifications.map((notification) => {
      n[notification.name] = notification;
    });
    finalConfig.notificationsObj = n;
  }

  return { isConfigValid, configDetails: finalConfig };
}

export async function readAndParseConfigs() {
  if (!fs.existsSync(".\\configs\\general.yaml")) {
    isConfigValid = false;
    logger.error("configs\\general.yaml not found");
  }

  if (!fs.existsSync(".\\configs\\qlik.yaml")) {
    isConfigValid = false;
    logger.error("configs\\qlik.yaml not found");
  }

  if (!fs.existsSync(".\\configs\\notifications.yaml")) {
    isConfigValid = false;
    logger.error("configs\\notifications.yaml not found");
  }

  //TODO: allow notifications to be specified in multiple files
  // const notificationsFiles = fs.readdirSync(".\\configs").filter((f) => {
  //   const a = new RegExp(/^notifications(.*).yaml/gi);
  //   return a.test(f);
  // });

  // if (notificationsFiles.length == 0) {
  //   isConfigValid = false;
  //   logger.error("No notifications files were found in configs folder");
  // }

  if (!isConfigValid) return;

  const [general, qlik, notifications] = await Promise.all([
    loadConfigFile<GeneralConfig>("general"),
    loadConfigFile<QlikConfig>("qlik"),
    loadConfigFile<Notifications>("notifications"),
  ]);

  if (!general.valid || !qlik.valid || !notifications.valid) {
    isConfigValid = false;
    return;
  }

  notifications.config = notifications.config.map((n) => {
    n.nameOriginal = n.name;
    n.name = Buffer.from(n.name).toString("base64url");

    return n;
  });

  notifications.configRaw = JSON.stringify(notifications.config);

  return {
    general,
    qlik,
    notifications,
  };
}

async function loadConfigFile<T>(configType: string): Promise<{
  config: T;
  configRaw: string;
  valid: boolean;
}> {
  const configRaw = fs.readFileSync(`./configs/${configType}.yaml`).toString();
  const config = yaml.load(configRaw) as T;
  const configSchema = JSON.parse(
    fs.readFileSync(`./schemas/${configType}.json`).toString(),
  );

  const validate: ValidateFunction<unknown> = ajv.compile(configSchema);
  const valid = validate(config);
  if (!valid) {
    isConfigValid = false;
    const validationErrorsString = validate.errors
      .map((e) => e.message)
      .join(", ");
    logger.error(
      `Schema validation error(s) for "${configType}" config: ${validationErrorsString}`,
    );
  }

  return { config, configRaw, valid };
}

function setNotificationsDefaultOptions(
  notificationConfig: Notifications,
  globalOptions: GeneralConfig30,
) {
  const defaultNotificationOptions = {
    ...{
      getEntityDetails: true,
      disableCors: true,
      enabled: true,
      whitelist: [],
    },
  };

  const notifications = notificationConfig.map((n) => {
    n.options = {
      ...defaultNotificationOptions,
      ...globalOptions,
      ...(n.options || {}),
    };

    return n;
  });

  return notifications;
}

function replaceVariables(
  text: string,
  vars: { [x: string]: string | number | boolean },
) {
  Object.entries(vars).forEach(([varName, varValue]) => {
    try {
      const v = "\\$\\{" + varName + "\\}";
      const re = new RegExp(v, "g");

      text = text.replace(re, varValue.toString());
    } catch (e) {
      throw new Error(e.message);
    }
  });

  return text;
}

// check for missing Qlik environments - specified in notifications but not found in qlik config
function checkMissingEnvironment(
  qlikConfig: QlikConfig,
  notificationsConfig: Notifications,
) {
  const qlikEnv = qlikConfig.map((q) => q.name);
  const notificationEnv = [
    ...new Set(notificationsConfig.map((n) => n.environment)),
  ];

  const missingEnv = notificationEnv
    .map((b1) => (qlikEnv.includes(b1) ? true : b1))
    .filter((b1) => b1 != true);

  if (missingEnv.length > 0) {
    isConfigValid = false;
    logger.error(
      `Defined Qlik environment(s) are missing: ${missingEnv.join(", ")}`,
    );
  }
}

// duplicated notifications IDs are not allowed
function checkDuplicateNotificationNames(notificationsConfig: Notifications) {
  const result = notificationsConfig
    .map((n) => n.name)
    .reduce((obj: { [k: string]: number }, notificationId) => {
      obj[notificationId] = obj[notificationId] ? obj[notificationId] + 1 : 1;

      return obj;
    }, {});

  let duplicateId = [];

  Object.entries(result).map(([key, value]) => {
    if (value > 1) duplicateId.push(Buffer.from(key, "base64url").toString());
  });

  if (duplicateId.length > 0) {
    isConfigValid = false;
    logger.error(
      `Found duplicated notification names: ${duplicateId.join(", ")}`,
    );
  }
}

// remove disabled notifications and callbacks
function removeDisabledNotifications(notificationsConfig: Notifications) {
  let notifications = notificationsConfig.filter(
    (n) => n.options && n.options.enabled == true,
  );

  notifications = notifications.map((n) => {
    if (n.callbacks) {
      n.callbacks = n.callbacks.filter(
        (c) => !c.hasOwnProperty("enabled") || c.enabled == true,
      );
      return n;
    }
  });

  notifications = notifications.filter((n) => n != undefined);

  //log notifications that will not be used (removed)
  try {
    [...new Set(notifications.filter((n) => n.callbacks.length == 0))].map(
      (n) =>
        logger.warning(
          `Notification "${n.name}" wont be used because all its callbacks are disabled or dont have callbacks defined`,
        ),
    );
  } catch (e) {}

  // if there is not active callbacks then remove the notification
  notifications = notifications.filter((n) => n.callbacks.length > 0);

  return notifications;
}
