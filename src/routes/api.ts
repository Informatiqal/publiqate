import querystring from "node:querystring";
import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import { EventEmitter } from "node:events";
import { adminLogger, logger } from "../lib/logger";
import {
  prepareAndValidateConfig,
  validateConfig,
} from "../lib/configValidate";
import { CookieSecret } from "../interfaces";

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
  }
);

//@ts-ignore
apiRouter.get("/config/reload", async (req: Request, res: Response) => {
  const { valid, validate } = await validateConfig();

  adminLogger.info("Received config reload");

  if (valid == false || (validate.errors && validate.errors?.length > 0)) {
    adminLogger.warning(
      `Config reload aborted. Config errors: ${JSON.stringify({
        valid,
        errors: validate?.errors || [],
      })}`
    );

    return res.status(400).json({ valid, errors: validate?.errors || [] });
  }

  apiEmitter.emit("reloadConfig");
  res.status(200).send();
});

apiRouter.get("/config/verify", async (req: Request, res: Response) => {
  const { valid, validate } = await validateConfig();
  adminLogger.info(
    `Verification complete with ${
      validate?.errors ? validate.errors.length : 0
    } error(s) found`
  );

  if (validate.errors)
    adminLogger.warning(
      `Config validation errors: ${validate.errors
        .map((e) => e.message)
        .join(", ")}`
    );

  res.status(200).send({ valid, errors: validate?.errors || [] });
});

apiRouter.delete(
  "/notification/:notificationId",
  async (req: Request, res: Response) => {
    const notificationId = querystring.unescape(req.params["notificationId"]);

    apiEmitter.emit("deleteNotification", notificationId);
    res.status(204).send();
  }
);

apiRouter.get("/notification/list", async (req: Request, res: Response) => {
  try {
    const config = await prepareAndValidateConfig(logger);

    const ids = Object.keys(config.notifications);

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
