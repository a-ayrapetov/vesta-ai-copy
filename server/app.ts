import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { Server } from "http";
import path from "path";
import { registerRoutes } from "./routes";
import { log } from "./vite";
import { anonymousSession } from "./middleware/session";

/**
 * Builds the API app (middleware, routes, error handler) without listening.
 * index.ts adds Vite or static serving and listens; tests listen on a random port.
 */
export async function createApp(): Promise<{ app: Express; server: Server }> {
  const app = express();
  // CHANGED: 50mb -> 25mb. Fits two 10 MB base64 images (try-on) plus history;
  // per-field limits live in validation.ts.
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: false, limit: "25mb" }));
  // Anonymous session id backs the pre-auth cart
  app.use(anonymousSession);

  // Serve DeepFashion-MultiModal images as static files
  const deepFashionImagesPath = path.join(
    process.env.DEEPFASHION_ROOT ||
      path.join(process.cwd(), "server", "data", "DeepFashion-MultiModal"),
    "images",
  );
  app.use("/data/deepfashion/images", express.static(deepFashionImagesPath));

  // Local uploads (wardrobe / future product assets) when STORAGE_MODE=local
  if ((process.env.STORAGE_MODE || "local") === "local") {
    const uploadsRoot =
      process.env.STORAGE_LOCAL_ROOT || path.join(process.cwd(), "uploads");
    app.use("/uploads", express.static(uploadsRoot));
  }

  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (reqPath.startsWith("/api")) {
        let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
        // Avoid dumping large chat/image payloads into the console
        if (capturedJsonResponse && reqPath !== "/api/chat" && reqPath !== "/api/virtual-try-on") {
          const snippet = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${snippet.length > 120 ? snippet.slice(0, 119) + "…" : snippet}`;
        }

        log(logLine);
      }
    });

    next();
  });

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  return { app, server };
}
