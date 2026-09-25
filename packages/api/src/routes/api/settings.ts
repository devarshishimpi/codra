import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "../../ports";
import { requirePermission } from "../../middleware/authorize";
import { jsonError } from "../../http";
import {
  reviewConcurrencyLevels,
  reviewMaxCommentsOptions,
  reviewMaxFilesRange,
  reviewSettingsSchema,
} from "@codraoss/schema";

const reviewSettingsPatchSchema = z
  .strictObject({
    concurrencyLevel: z.enum(reviewConcurrencyLevels).optional(),
    maxComments: z
      .number()
      .int()
      .refine(
        (value) =>
          (reviewMaxCommentsOptions as readonly number[]).includes(value),
        "Invalid max comments value.",
      )
      .optional(),
    maxFiles: z
      .number()
      .int()
      .min(reviewMaxFilesRange.min)
      .max(reviewMaxFilesRange.max)
      .optional(),
  })
  .refine(
    (settings) => Object.values(settings).some((value) => value !== undefined),
    "At least one setting must be provided.",
  );

export function createSettingsRouter() {
  const app = new Hono<ApiEnv>();

  app.get("/", async (c) => {
    const denied = await requirePermission(c, "settings.read");
    if (denied) return denied;
    const settings =
      await c.env.deps.repositories.appSettings.getReviewSettings(c.env as any);
    return c.json({ settings });
  });

  app.patch("/", async (c) => {
    const denied = await requirePermission(c, "settings.write");
    if (denied) return denied;
    const body = await c.req.json().catch(() => null);
    const parsed = reviewSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid review settings.", 400);
    }

    const current = await c.env.deps.repositories.appSettings.getReviewSettings(
      c.env as any,
    );
    const next = reviewSettingsSchema.parse({ ...current, ...parsed.data });
    await c.env.deps.repositories.appSettings.updateReviewSettings(
      c.env as any,
      next,
    );
    return c.json({ ok: true, settings: next });
  });

  return app;
}
