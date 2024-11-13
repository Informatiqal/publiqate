import { varLoader } from "@informatiqal/variables-loader";
import fs from "fs";
import yaml from "js-yaml";
import ajvErrors from "ajv-errors";
import Ajv, { ValidateFunction } from "ajv";

import { Config, Notification } from "../interfaces";

export async function readAndParseConfig() {
  if (!fs.existsSync(".\\config.yaml"))
    throw new Error(`config.yaml not found`);

  let configRaw = fs.readFileSync(".\\config.yaml").toString();
  let config = yaml.load(configRaw) as Config;

  if (config.general.vars) {
    if (!fs.existsSync(config.general.vars))
      throw new Error(
        `Variables files specified but do not exists: ${config.general.vars}`
      );

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

  return { valid, validate, config, configRaw };
}

export async function prepareAndValidateConfig() {
  const { valid, validate, config, configRaw } = await validateConfig();

  if (!valid) {
    const errors = validate.errors.map((e) => e.message).join(", ");
    throw new Error(errors);
  }
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

      // this.runbookVariablesValues[varName] = varValue;
      text = text.replace(re, varValue.toString());
    } catch (e) {
      this.logger.error(e.message, 9999);
    }
  });

  return text;
}
