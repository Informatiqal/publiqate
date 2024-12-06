import * as winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { LogLevels, LogLevelsDetailed } from "../interfaces";

const fileTransport: DailyRotateFile = new DailyRotateFile({
  filename: "./log/application-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "14d",
  level: "info",
});

let logLevels: LogLevelsDetailed = {
  core: "info",
  admin: "info",
  qlik: "info",
  plugins: "info",
};

function setDefaultLevel(level: LogLevels) {
  if (level && typeof level == "string") {
    logLevels.core = level;
    logLevels.qlik = level;
    logLevels.admin = level;
    logLevels.plugins = level;
  }

  if (level && typeof level == "object") logLevels = { ...logLevels, ...level };

  logger.level = logLevels.core;
  adminLogger.level = logLevels.admin;
  qlikCommsLogger.level = logLevels.qlik;

  logger.info(`CORE logger created with level "${logLevels.core}"`);
  logger.info(`QLIK-COMMS logger created with level "${logLevels.qlik}"`);
  logger.info(`ADMIN logger created with level "${logLevels.admin}"`);
}

const logger = winston.createLogger({
  transports: [new winston.transports.Console(), fileTransport],
  levels: winston.config.syslog.levels,
  level: logLevels.core,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp}\t${level.toUpperCase()}\t${service}\t${message}`;
    })
  ),
  defaultMeta: {
    service: "CORE",
  },
});

const qlikCommsLogger = winston.createLogger({
  transports: [new winston.transports.Console(), fileTransport],
  levels: winston.config.syslog.levels,
  level: logLevels.qlik,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp}\t${level.toUpperCase()}\t${service}\t${message}`;
    })
  ),
  defaultMeta: {
    service: "QLIK-COMMS",
  },
});

const adminLogger = winston.createLogger({
  transports: [new winston.transports.Console(), fileTransport],
  levels: winston.config.syslog.levels,
  level: logLevels.admin,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp}\t${level.toUpperCase()}\t${service}\t${message}`;
    })
  ),
  defaultMeta: {
    service: "ADMIN",
  },
});

export async function flushLogs() {
  let promises = [];

  for (let [, logger] of winston.loggers.loggers) {
    promises.push(
      new Promise((resolve) => {
        logger.on("finish", resolve);
        logger.end();
      })
    );
  }

  Promise.all(promises).then((_) => {
    // process.exit();
  });
}

function createPluginLogger(pluginName: string, logLevel: string) {
  return winston.createLogger({
    transports: [new winston.transports.Console(), fileTransport],
    levels: winston.config.syslog.levels,
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message, service }) => {
        return `${timestamp}\t${level.toUpperCase()}\t${service}\t${message}`;
      })
    ),
    defaultMeta: {
      service: `${pluginName.toUpperCase()}`,
    },
  });
}

export {
  logger,
  createPluginLogger,
  setDefaultLevel,
  adminLogger,
  qlikCommsLogger,
  fileTransport,
  logLevels,
};
