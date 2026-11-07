/**
 * Drives the real Express app over HTTP against a real Postgres (DATABASE_URL).
 * Run `npm run db:push` first. Skipped, with a visible reason, when no database is set.
 * No Claude calls: ANTHROPIC_API_KEY is blanked so /api/chat uses the local fallback.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";

const hasDb = Boolean(process.env.DATABASE_URL);
if (!hasDb) console.warn("SKIP api.integration: DATABASE_URL not set");

describe.skipIf(!hasDb)("API (real server, real database)", () => {
  let server: Server;
  let base: string;
  let storage: typeof import("../storage").storage;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = "";
    process.env.CHAT_RATE_LIMIT_PER_MIN = "3";
    const { createApp } = await import("../app");
    ({ storage } = await import("../storage"));
    ({ server } = await createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { closeDb } = await import("../db");
    await closeDb();
  });

  /** A browser: keeps the vesta_sid cookie the server hands out. */
  function browser() {
    let cookie = "";
    return async (path: string, init: RequestInit = {}) => {
      const res = await fetch(base + path, {
        redirect: "manual",
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers || {}),
        },
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return res;
    };
  }

  const message = (content: string) => ({
    id: String(Date.now()),
    role: "user",
    content,
    timestamp: new Date().toISOString(),
  });

  describe("chat history belongs to the browser that wrote it", () => {
    it("is invisible, unreadable and unwritable from another browser", async () => {
      const alice = browser();
      const bob = browser();

      const saved = await alice("/api/chat/history", {
        method: "POST",
        body: JSON.stringify({ messages: [message("alice private")] }),
      });
      expect(saved.status).toBe(200);
      const { chatHistoryId } = await saved.json();

      const aliceList = await (await alice("/api/chat/histories/1")).json();
      expect(aliceList.map((h: { id: number }) => h.id)).toContain(chatHistoryId);

      const bobList = await (await bob("/api/chat/histories/1")).json();
      expect(bobList.map((h: { id: number }) => h.id)).not.toContain(chatHistoryId);

      expect((await bob(`/api/chat/history/${chatHistoryId}`)).status).toBe(404);

      const overwrite = await bob(`/api/chat/history/${chatHistoryId}`, {
        method: "PUT",
        body: JSON.stringify({ messages: [message("bob was here")] }),
      });
      expect(overwrite.status).toBe(404);

      const reread = await (await alice(`/api/chat/history/${chatHistoryId}`)).json();
      expect(reread.messages[0].content).toBe("alice private");
    });
  });

  describe("merchant redirect", () => {
    it("redirects to a stored web link", async () => {
      const product = await storage.upsertProduct({
        externalId: "test-safe-link",
        merchant: "TestShop",
        title: "Safe link product",
        description: "",
        imageUrl: "https://images.example.com/a.jpg",
        affiliateUrl: "https://shop.example.com/a?aff=vesta",
        priceCents: 1000,
        currency: "USD",
        category: "top",
        audience: "any",
        colors: [],
        styleTags: [],
        isActive: true,
        raw: {},
      });
      const res = await browser()(`/api/go/${product.id}?source=test`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://shop.example.com/a?aff=vesta");
    });

    it("refuses to redirect to a non-web link even if one got into the database", async () => {
      const product = await storage.upsertProduct({
        externalId: "test-unsafe-link",
        merchant: "TestShop",
        title: "Bad link product",
        description: "",
        imageUrl: "https://images.example.com/b.jpg",
        affiliateUrl: "javascript:alert(1)",
        priceCents: 1000,
        currency: "USD",
        category: "top",
        audience: "any",
        colors: [],
        styleTags: [],
        isActive: true,
        raw: {},
      });
      const res = await browser()(`/api/go/${product.id}`);
      expect(res.status).toBe(422);
      expect(res.headers.get("location")).toBeNull();
    });
  });

  describe("chat input limits", () => {
    it("rejects an unsupported image type with 400", async () => {
      const res = await browser()("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "what goes with this", imageData: "data:image/bmp;base64,AAAA" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/not supported\. Use JPEG, PNG, GIF or WebP/);
    });

    it("rejects a body over the server limit with 413", async () => {
      const res = await browser()("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "x", imageData: "A".repeat(26 * 1024 * 1024) }),
      });
      expect(res.status).toBe(413);
    });

    it("throttles one client IP on the paid chat route and says when to retry", async () => {
      // Invalid and oversized requests above never reach the limiter, so the count starts here.
      const carol = browser();
      const ask = () => carol("/api/chat", { method: "POST", body: JSON.stringify({ message: "casual outfit" }) });
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await ask()).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
      const blocked = await ask();
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    });
  });
});
