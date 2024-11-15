import express, { Request, Response } from "express";
import { EventEmitter } from "node:events";
import { adminLogger } from "../lib/logger";
import { validateConfig } from "../lib/configValidate";

const apiEmitter = new EventEmitter();

const apiRouter = express.Router();

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

export { apiRouter, apiEmitter };
