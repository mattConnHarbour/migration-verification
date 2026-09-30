import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function startBrowserHarness(fixtures) {
  const server = await createServer({
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    plugins: [{
      name: "verification-fixtures",
      configureServer(viteServer) {
        viteServer.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
          const fixture = fixtures[pathname];
          if (!fixture) return next();
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          response.end(fixture);
        });
      },
    }],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite did not expose its listening port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
  };
}

export async function waitUntilReady(page, timeoutMs) {
  try {
    await page.waitForFunction(() => {
      const state = window.__verification;
      if (state?.error) throw new Error(state.error);
      return state?.ready === true;
    }, null, { timeout: timeoutMs });
  } catch (error) {
    const state = await page.evaluate(() => ({
      verification: window.__verification,
      title: document.title,
      body: document.body.innerText.slice(0, 1000),
      pages: document.querySelectorAll(".superdoc-page").length,
    })).catch(() => null);
    throw new Error(`Browser renderer did not become ready: ${JSON.stringify(state)}`, { cause: error });
  }
  await page.locator(".superdoc-page").first().waitFor({ state: "visible", timeout: timeoutMs });
}
