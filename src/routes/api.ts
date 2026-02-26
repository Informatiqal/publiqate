import querystring from "node:querystring";
import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import { EventEmitter } from "node:events";
import { adminLogger, logger } from "../lib/logger";
import { loadConfig } from "../lib/config";
import { CookieSecret } from "../interfaces/interfaces";

const apiEmitter = new EventEmitter();

const apiRouter = express.Router();

let cookieSecret: CookieSecret = {
  name: "",
  value: "",
};

apiRouter.use(cookieParser());
apiRouter.use(
  async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    if (!req.cookies[cookieSecret.name]) {
      return res.status(403).send();
    } else {
      if (req.cookies[cookieSecret.name] != cookieSecret.value) {
        return res.status(403).send();
      } else {
        next();
      }
    }
  },
);

//@ts-ignore
apiRouter.get("/config/reload", async (_: Request, res: Response) => {
  const { isConfigValid } = await loadConfig(adminLogger);

  adminLogger.info("Received config reload");

  if (!isConfigValid) {
    adminLogger.warning(`Config reload aborted due to load/validation errors`);

    return res.status(400).send();
  }

  apiEmitter.emit("reloadConfig");
  res.status(200).send();
});

apiRouter.get("/config/verify", async (_: Request, res: Response) => {
  adminLogger.info(`Config verification starts`);
  const { isConfigValid } = await loadConfig(adminLogger);
  adminLogger.info(
    `Config verification completed. Config validation is "${isConfigValid}"`,
  );

  res.status(200).send({ isConfigValid });
});

apiRouter.delete(
  "/notification/:notificationId",
  async (req: Request, res: Response) => {
    const notificationId = querystring.unescape(req.params["notificationId"]);

    apiEmitter.emit("deleteNotification", notificationId);
    res.status(204).send();
  },
);

apiRouter.get("/notification/list", async (_: Request, res: Response) => {
  try {
    const { configDetails } = await loadConfig(adminLogger);

    const ids = Object.keys(configDetails.notificationsObj);

    res.contentType("application/json");
    res.status(200).send(ids);
  } catch (e) {
    logger.error(e);
    res.status(500).send();
  }
});

function setCookieSecret(cookeConfig: CookieSecret) {
  cookieSecret = cookeConfig;
}

export { apiRouter, apiEmitter, setCookieSecret };
