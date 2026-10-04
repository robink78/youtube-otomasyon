const DEFAULT_REPOSITORY = "eyazan/youtube-otomasyon";
const DEFAULT_CRON = "35 16 * * *";
const DEFAULT_DEADLINE = "16:30";
const EVENT_TYPE = "production-sla-watchdog";

function publicConfig(env) {
  return {
    repository: env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    cron: env.WATCHDOG_CRON || DEFAULT_CRON,
    deadlineUtc: env.PRODUCTION_DEADLINE_UTC || DEFAULT_DEADLINE,
    version: env.WATCHDOG_VERSION || "development",
    commit: env.WATCHDOG_COMMIT || "unknown",
  };
}

function dispatchError(response, body) {
  const requestId = response.headers && typeof response.headers.get === "function"
    ? response.headers.get("x-github-request-id") : null;
  const details = {
    status: response.status,
    statusText: response.statusText || null,
    requestId,
    body: String(body || "").slice(0, 1000),
  };
  const error = new Error(`GitHub repository_dispatch failed: ${JSON.stringify(details)}`);
  error.details = details;
  return error;
}

export async function dispatchWatchdog(env, fetchImpl = fetch) {
  if (!env.WATCHDOG_GITHUB_TOKEN) throw new Error("WATCHDOG_GITHUB_TOKEN is not configured");
  const config = publicConfig(env);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) {
    throw new Error(`GITHUB_REPOSITORY is invalid: ${config.repository}`);
  }
  const firedAt = new Date().toISOString();
  console.log(JSON.stringify({ event: "watchdog_dispatch_started", repository: config.repository,
    eventType: EVENT_TYPE, firedAt, version: config.version, commit: config.commit }));
  const response = await fetchImpl(`https://api.github.com/repos/${config.repository}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.WATCHDOG_GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "youtube-otomasyon-production-watchdog",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      event_type: EVENT_TYPE,
      client_payload: { source: "cloudflare-cron", fired_at: firedAt,
        worker_version: config.version, worker_commit: config.commit },
    }),
  });
  if (response.status !== 204) {
    let body = "";
    try { body = await response.text(); } catch (error) { body = `[response body unavailable: ${error.message}]`; }
    throw dispatchError(response, body);
  }
  const result = { ok: true, repository: config.repository, status: response.status,
    eventType: EVENT_TYPE, firedAt, version: config.version, commit: config.commit };
  console.log(JSON.stringify({ event: "watchdog_dispatch_succeeded", ...result }));
  return result;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchWatchdog(env).catch((error) => {
      console.error(JSON.stringify({ event: "watchdog_dispatch_failed", message: error.message,
        details: error.details || null, ...publicConfig(env) }));
      throw error;
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/health") return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const body = {
      ok: true,
      scheduler: "cloudflare-cron",
      eventType: EVENT_TYPE,
      tokenConfigured: !!env.WATCHDOG_GITHUB_TOKEN,
      ...publicConfig(env),
    };
    return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" },
    });
  },
};
