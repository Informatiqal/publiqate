import * as winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const fileTransport: DailyRotateFile = new DailyRotateFile({
  filename: "./log/application-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "14d",
  level: "info",
});

const logger = winston.createLogger({
  transports: [new winston.transports.Console(), fileTransport],
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

const pluginLogger = winston.createLogger({
  transports: [new winston.transports.Console(), fileTransport],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp}\t${level.toUpperCase()}\t${service}\t${message}`;
    })
  ),
  defaultMeta: {
    service: "PLUGIN",
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

export { logger, pluginLogger };