import { describe, it, expect } from "vitest";
import { chatRequestSchema, MAX_IMAGE_BASE64_CHARS } from "../validation";

const smallPng = "data:image/png;base64," + "A".repeat(1000);

describe("chatRequestSchema", () => {
  it("accepts a plain message", () => {
    expect(chatRequestSchema.safeParse({ message: "casual navy outfit" }).success).toBe(true);
  });

  it("accepts a supported image as a data URL or bare base64", () => {
    expect(chatRequestSchema.safeParse({ message: "x", imageData: smallPng }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ message: "x", imageData: "A".repeat(1000) }).success).toBe(true);
  });

  it("matches Anthropic's 10 MB base64 per-image limit", () => {
    expect(MAX_IMAGE_BASE64_CHARS).toBe(10 * 1024 * 1024);
  });

  it("rejects an image over the limit before it reaches the API", () => {
    const tooBig = "data:image/jpeg;base64," + "A".repeat(MAX_IMAGE_BASE64_CHARS + 1);
    expect(chatRequestSchema.safeParse({ message: "x", imageData: tooBig }).success).toBe(false);
  });

  it("rejects image types Claude does not accept", () => {
    const bmp = "data:image/bmp;base64," + "A".repeat(100);
    expect(chatRequestSchema.safeParse({ message: "x", imageData: bmp }).success).toBe(false);
  });

  it("rejects an empty or oversized message", () => {
    expect(chatRequestSchema.safeParse({ message: "" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "a".repeat(4001) }).success).toBe(false);
  });
});
