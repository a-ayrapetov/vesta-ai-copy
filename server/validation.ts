import { z } from "zod";
import { messageSchema } from "@shared/schema";

/**
 * Claude API accepts up to 10 MB per base64-encoded image, JPEG/PNG/GIF/WebP only
 * (https://platform.claude.com/docs/en/build-with-claude/vision, read 2026-11-07).
 */
export const MAX_IMAGE_BASE64_CHARS = 10 * 1024 * 1024;
export const MAX_MESSAGE_CHARS = 4000;
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const imageDataSchema = z.string().superRefine((value, ctx) => {
  const commaAt = value.indexOf(",");
  const isDataUrl = value.startsWith("data:") && commaAt !== -1;
  const base64 = isDataUrl ? value.slice(commaAt + 1) : value;

  if (isDataUrl) {
    const mediaType = value.slice(5, commaAt).split(";")[0];
    if (!SUPPORTED_IMAGE_TYPES.includes(mediaType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Image type ${mediaType || "unknown"} is not supported. Use JPEG, PNG, GIF or WebP.`,
      });
    }
  }
  if (base64.length > MAX_IMAGE_BASE64_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Image is too large. Please use a photo under about 7 MB.",
    });
  }
});

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(messageSchema).max(100).optional(),
  imageData: imageDataSchema.optional(),
});
