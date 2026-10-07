export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog and the manual
    // limit pins without pulling node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { installLimitOverrideSource } = await import("open-sse/providers/limitOverride.js");
    await installLimitOverrideSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    const { startHealthScheduler } = await import("@/lib/health/scheduler.js");
    startHealthScheduler();
  }
}
