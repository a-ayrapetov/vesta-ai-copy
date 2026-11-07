import { createApp } from "./app";
import { setupVite, serveStatic, log } from "./vite";
import { objectStorage } from "./services/objectStorage";

(async () => {
  if ((process.env.STORAGE_MODE || "local") === "local") {
    await objectStorage.ensureReady();
    log(`object storage ready (mode=${objectStorage.mode})`);
  }

  const { app, server } = await createApp();

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || "localhost";
  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
})();
