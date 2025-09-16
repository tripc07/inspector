import { test } from "@playwright/test";

test("inspector UI - capture console + proxy /health", async ({
  page,
  context,
}) => {
  const consoleLogs: Array<{ type: string; text: string }> = [];
  page.on("console", (msg) => {
    try {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    } catch {
      // ignore
    }
  });

  const requests: Array<{ url: string; method: string; status?: number }> = [];
  context.on("request", (req) => {
    if (
      req.url().includes("/health") ||
      req.url().includes("/sse") ||
      req.url().includes("/mcp") ||
      req.url().includes("/stdio")
    ) {
      requests.push({ url: req.url(), method: req.method() });
    }
  });
  context.on("response", (res) => {
    const url = res.url();
    if (
      url.includes("/health") ||
      url.includes("/sse") ||
      url.includes("/mcp") ||
      url.includes("/stdio")
    ) {
      const idx = requests.findIndex(
        (r) => r.url === url && r.method === res.request().method(),
      );
      const status = res.status();
      if (idx !== -1) requests[idx].status = status;
      else requests.push({ url, method: res.request().method(), status });
    }
  });

  // Open the Inspector UI
  await page.goto("http://localhost:6274", { waitUntil: "networkidle" });

  // Attempt a direct proxy health fetch from the browser environment
  let healthResult: any = null;
  let healthError: string | null = null;
  try {
    healthResult = await page.evaluate(async () => {
      try {
        const resp = await fetch("http://localhost:6277/health", {
          credentials: "omit",
        });
        const body = await resp.text();
        return {
          status: resp.status,
          headers: Object.fromEntries(resp.headers.entries()),
          body,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });
  } catch (e) {
    healthError = String(e);
  }

  // Give the UI a moment to attempt connection flows and emit console logs
  await page.waitForTimeout(2000);

  // Print a machine-friendly marker and JSON payload so the runner can capture it
  // (The CI/runner output will contain this line with the diagnostics.)
  // eslint-disable-next-line no-console
  console.log(
    "DIAG_INSPECTOR_UI_RESULT: " +
      JSON.stringify({
        consoleLogs,
        requests,
        healthResult,
        healthError,
      }),
  );
});
