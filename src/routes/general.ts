import express, { Request, Response } from "express";

const generalRouter = express.Router();

generalRouter.get("/health", (req: Request, res: Response) => {
  res.status(200).send();
});

export { generalRouter };
