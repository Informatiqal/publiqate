import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import { EventEmitter } from "node:events";
import { adminLogger } from "../lib/logger";
import { validateConfig } from "../lib/configValidate";
import { CookieSecret } from "../interfaces";

const apiEmitter = new EventEmitter();

const apiRouter = express.Router();

let cookieSecret: CookieSecret = {
  name: "",
  value: "",
};

apiRouter.use(cookieParser());
apiRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.cookies[cookieSecret.name]) {
    res.status(403).send();
  } else {
    if (req.cookies[cookieSecret.name] != cookieSecret.value) {
      res.status(403).send();
    } else {
      next();
    }
  }
});

apiRouter.get("/reload-config", (req: Request, res: Response) => {
  adminLogger.info("Received config reload");
  apiEmitter.emit("reloadConfig");
  res.status(200).send("");
});

apiRouter.get("/verify-config", async (req: Request, res: Response) => {
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

function setCookieSecret(cookeConfig: CookieSecret) {
  cookieSecret = cookeConfig;
}

export { apiRouter, apiEmitter, setCookieSecret };