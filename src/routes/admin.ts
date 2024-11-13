import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "node:events";
import { adminLogger } from "../lib/logger";
import { validateConfig } from "../lib/configValidate";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const adminEmitter = new EventEmitter();

const adminRouter = express.Router();

adminRouter.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "/static/admin/index.html"));
});

adminRouter.get("/api/reload-config", (req: Request, res: Response) => {
  adminLogger.info("Received config reload");
  adminEmitter.emit("reloadConfig");
  res.status(200).send("");
});

adminRouter.get("/api/verify-config", async (req: Request, res: Response) => {
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

export { adminRouter, adminEmitter };
