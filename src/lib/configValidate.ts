import { varLoader } from "@informatiqal/variables-loader";
import fs from "fs";
import yaml from "js-yaml";
import ajvErrors from "ajv-errors";
import Ajv, { ValidateFunction } from "ajv";

import { Config, Notification } from "../interfaces";
import { randomUUID } from "crypto";
import { Logger } from "winston";

let logger = {} as Logger;

export async function readAndParseConfig() {
  if (!fs.existsSync(".\\config.yaml"))
    throw new Error(`config.yaml not found`);

  let configRaw = fs.readFileSync(".\\config.yaml").toString();
  let config = yaml.load(configRaw) as Config;

  const defaultOptions = {
    getEntityDetails: true,
    enabled: true,
    disableCors: false,
    whitelist: [],
  };

  config.notifications.map((notification) => {
    if (!notification.hasOwnProperty("options")) {
      notification["options"] = defaultOptions;
    } else {
      notification.options = { ...defaultOptions, ...notification.options };
    }
  });

  config = removeDisabled(config);

  if (config.notifications.length == 0)
    logger.warning("0 active notifications");

  // re-set the raw config once the default options are set
  configRaw = JSON.stringify(config);

  logger.debug(configRaw);

  if (config.general.vars) {
    if (!fs.existsSync(config.general.vars))
      throw new Error(
        `Variables files specified but do not exists: ${config.general.vars}`
      );

    configRaw = replaceSpecialVariables(configRaw);

    const configVariables = configRaw
      .match(/(?<!\$)(\${)(.*?)(?=})/g)
      .map((v) => v.substring(2));

    const variablesData = varLoader({
      sources: {
        file: config.general.vars,
      },
      variables: configVariables,
    });

    if (variablesData.missing)
      throw new Error(
        `Missing variable(s) value: ${variablesData.missing
          .map((v) => v)
          .join(", ")}`
      );

    configRaw = replaceVariables(configRaw, variablesData.values);
    config = yaml.load(configRaw) as Config;
  }

  return { config, configRaw };
}

export async function validateConfig() {
  const { config, configRaw } = await readAndParseConfig();

  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    strictRequired: true,
    allowUnionTypes: true,
  });

  ajvErrors(ajv);

  const configSchema = JSON.parse(
    fs.readFileSync("./schemas/config.json").toString()
  );

  const validate: ValidateFunction<unknown> = ajv.compile(configSchema);
  const valid = validate(config);

  const missingEnv = getMissingEnvironment(config);
  if (missingEnv.length > 0) {
    if (!validate.errors) {
      validate.errors = [];
    }

    (validate.errors as any).push({
      message: `Missing Qlik environment(s): ${missingEnv.join(",")}`,
    });
  }

  return { valid, validate, config, configRaw, missingEnv };
}

export async function prepareAndValidateConfig(log: Logger) {
  logger = log;
  const { valid, validate, config, configRaw, missingEnv } =
    await validateConfig();

  if (!valid) {
    const errors = validate.errors.map((e) => e.message).join(", ");
    throw new Error(errors);
  }

  if (missingEnv.length > 0)
    throw new Error(`Missing Qlik environment(s): ${missingEnv.join(",")}`);

  const notifications = {} as { [k: string]: Notification };

  config.notifications.map((notification) => {
    notifications[notification.id] = notification;
  });

  return { notifications, config, configRaw };
}

function replaceVariables(
  text: string,
  vars: { [x: string]: string | number | boolean }
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
      randomUUID().replace(/-/gi, "")
    );

  if (a.includes("NOW"))
    configString = configString.replace(/\${NOW}/gi, () => `${today}${time}`);

  if (a.includes("RANDOM"))
    configString = configString.replace(/\${RANDOM}/gi, function () {
      return [...Array(20)]
        .map(() => Math.random().toString(36)[2])
        .join("")
        .toUpperCase();
    });

  return configString;
}

function getMissingEnvironment(config: Config) {
  const qlikEnv = config.qlik.map((q) => q.name);
  const notificationEnv = [
    ...new Set(config.notifications.map((n) => n.environment)),
  ];

  return notificationEnv
    .map((b1) => (qlikEnv.includes(b1) ? true : b1))
    .filter((b1) => b1 != true);
}

// remove disabled notifications and callbacks
function removeDisabled(config: Config) {
  config.notifications = config.notifications.filter(
    (n) => n.options.enabled == true
  );

  config.notifications = config.notifications.map((n) => {
    n.callbacks = n.callbacks.filter(
      (c) => !c.hasOwnProperty("enabled") || c.enabled == true
    );
    return n;
  });

  //TODO: log warning that notification is removed because of 0 callbacks
  // if there is not active callbacks then remove the notification
  config.notifications = config.notifications.filter(
    (n) => n.callbacks.length > 0
  );

  return config;
}
