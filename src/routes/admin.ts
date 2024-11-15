import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const adminRouter = express.Router();

adminRouter.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "/static/admin/index.html"));
});

export { adminRouter };
