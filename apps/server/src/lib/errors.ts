import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { reportError } from "./telemetry";

export class AppError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code ?? null }, err.status);
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err);
  reportError(err);
  return c.json({ error: "Internal server error" }, 500);
}
