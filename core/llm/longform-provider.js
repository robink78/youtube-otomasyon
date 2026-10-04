"use strict";

// One provider boundary for long-form writing. Providers return the same JSON
// contract; fallback is used only when LONGFORM_LLM_FALLBACK_PROVIDER explicitly
// names it. Events contain provider/model/status metadata and never credentials
// or raw response bodies.

const fs = require("fs");
const path = require("path");
const { ROOT } = require("../channel-context");

class LongformProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "LongformProviderError";
    this.code = code;
    this.provider = options.provider || null;
    this.status = options.status || null;
    this.retryable = !!options.retryable;
    this.defer = !!options.defer;
    this.retryAfterMs = options.retryAfterMs || null;
    this.stage = options.stage || null;
  }
}

function envValue(name) {
  if (Object.prototype.hasOwnProperty.call(process.env, name) && String(process.env[name]).trim()) return String(process.env[name]).trim();
  if (process.env.NODE_TEST_CONTEXT) return "";
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && match[1] === name) return match[2].trim();
    }
  } catch (error) { /* optional .env */ }
  return "";
}

function providerSpec(name) {
  if (name === "groq") return {
    name,
    model: envValue("GROQ_MODEL") || "openai/gpt-oss-120b",
    keyName: "GROQ_API_KEY",
    configured: !!envValue("GROQ_API_KEY"),
  };
  if (name === "anthropic") return {
    name,
    model: envValue("LONGFORM_MODEL") || envValue("ANTHROPIC_MODEL") || "claude-opus-5",
    keyName: "ANTHROPIC_API_KEY",
    configured: !!envValue("ANTHROPIC_API_KEY"),
  };
  return { name, model: null, keyName: null, configured: false };
}

function configuration() {
  let primaryName = envValue("LONGFORM_LLM_PROVIDER").toLowerCase();
  // Backward compatibility for the existing lane: it keeps working only when
  // explicitly enabled. A new installation selects Groq with the provider env.
  if (!primaryName && envValue("LONGFORM_LLM") === "1" && envValue("ANTHROPIC_API_KEY")) primaryName = "anthropic";
  const fallbackName = envValue("LONGFORM_LLM_FALLBACK_PROVIDER").toLowerCase();
  return {
    enabled: envValue("LONGFORM_LLM") !== "0" && !!primaryName,
    primary: providerSpec(primaryName),
    fallback: fallbackName && fallbackName !== primaryName ? providerSpec(fallbackName) : null,
  };
}

function available() {
  const config = configuration();
  return config.enabled && ["groq", "anthropic"].includes(config.primary.name) && config.primary.configured;
}

function retryAfterMs(headers) {
  if (!headers || typeof headers.get !== "function") return null;
  const raw = headers.get("retry-after");
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.ceil(Number(raw) * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function classifyHttp(provider, status, headers, stage) {
  if (status === 429) return new LongformProviderError("RATE_LIMIT", `${provider} rate limit reached; long-form generation deferred`, { provider, status, stage, retryable: true, defer: true, retryAfterMs: retryAfterMs(headers) });
  if (status === 401 || status === 403) return new LongformProviderError("AUTH", `${provider} authentication failed`, { provider, status, stage });
  if (status === 408 || status === 409 || status === 425 || status >= 500) return new LongformProviderError("TRANSIENT", `${provider} temporarily unavailable (HTTP ${status})`, { provider, status, stage, retryable: true, defer: true, retryAfterMs: retryAfterMs(headers) });
  return new LongformProviderError("REQUEST", `${provider} request failed (HTTP ${status})`, { provider, status, stage });
}

function parseJsonText(text, provider, stage) {
  const value = String(text || "");
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first < 0 || last < first) throw new LongformProviderError("INVALID_JSON", `${provider} returned no JSON object`, { provider, stage });
  try { return JSON.parse(value.slice(first, last + 1)); }
  catch (error) { throw new LongformProviderError("INVALID_JSON", `${provider} returned invalid JSON`, { provider, stage }); }
}

async function groq(input, dependencies = {}) {
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new LongformProviderError("RUNTIME", "fetch is unavailable for Groq", { provider: "groq", stage: input.stage });
  let response;
  try {
    response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${envValue("GROQ_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
        response_format: { type: "json_object" },
        temperature: 0.25,
        max_completion_tokens: input.maxTokens || 4096,
      }),
    });
  } catch (error) {
    throw new LongformProviderError("NETWORK", "groq network request failed; long-form generation deferred", { provider: "groq", stage: input.stage, retryable: true, defer: true });
  }
  if (!response.ok) throw classifyHttp("groq", response.status, response.headers, input.stage);
  let body;
  try { body = await response.json(); }
  catch (error) { throw new LongformProviderError("INVALID_RESPONSE", "groq returned an unreadable response", { provider: "groq", stage: input.stage }); }
  const message = body && body.choices && body.choices[0] && body.choices[0].message;
  const json = parseJsonText(message && message.content, "groq", input.stage);
  return {
    json,
    provider: "groq",
    model: body.model || input.model,
    usage: { input_tokens: body.usage && body.usage.prompt_tokens || 0, output_tokens: body.usage && body.usage.completion_tokens || 0 },
  };
}

async function anthropic(input, dependencies = {}) {
  const client = dependencies.anthropicClient || (() => {
    const Anthropic = dependencies.Anthropic || require("@anthropic-ai/sdk");
    return new Anthropic({ apiKey: envValue("ANTHROPIC_API_KEY") });
  })();
  let response;
  try {
    response = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens || 4096,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
  } catch (error) {
    const status = error && (error.status || error.statusCode);
    if (status) throw classifyHttp("anthropic", status, error.headers, input.stage);
    throw new LongformProviderError("NETWORK", "anthropic request failed; long-form generation deferred", { provider: "anthropic", stage: input.stage, retryable: true, defer: true });
  }
  if (response.stop_reason === "refusal") throw new LongformProviderError("REFUSAL", "anthropic refused the long-form request", { provider: "anthropic", stage: input.stage });
  if (response.stop_reason === "max_tokens") throw new LongformProviderError("TRUNCATED", "anthropic response reached its token limit", { provider: "anthropic", stage: input.stage, retryable: true, defer: true });
  const text = (response.content || []).filter((block) => block.type === "text").map((block) => block.text).join("");
  return { json: parseJsonText(text, "anthropic", input.stage), provider: "anthropic", model: response.model || input.model, usage: response.usage || { input_tokens: 0, output_tokens: 0 } };
}

async function once(spec, input, dependencies) {
  if (!spec || !["groq", "anthropic"].includes(spec.name)) throw new LongformProviderError("UNSUPPORTED_PROVIDER", `unsupported long-form provider: ${spec && spec.name || "none"}`, { provider: spec && spec.name, stage: input.stage });
  if (!spec.configured) throw new LongformProviderError("MISSING_SECRET", `missing ${spec.keyName} for long-form provider ${spec.name}`, { provider: spec.name, stage: input.stage });
  const request = { ...input, model: spec.model };
  return spec.name === "groq" ? groq(request, dependencies) : anthropic(request, dependencies);
}

function delayFor(error, attempt) {
  const configuredMax = Number(envValue("LONGFORM_LLM_MAX_RETRY_MS"));
  const maximum = Number.isFinite(configuredMax) && configuredMax >= 1000 ? configuredMax : 30000;
  const exponential = Math.min(maximum, 1000 * 2 ** attempt);
  return Math.min(maximum, Math.max(exponential, error.retryAfterMs || 0));
}

async function withRetry(spec, input, dependencies = {}, onEvent = () => {}) {
  const attempts = Math.max(1, Math.min(4, Number(envValue("LONGFORM_LLM_MAX_ATTEMPTS")) || 2));
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    onEvent({ event: "request", provider: spec.name, model: spec.model, stage: input.stage, attempt: attempt + 1 });
    try {
      const result = await once(spec, input, dependencies);
      onEvent({ event: "success", provider: result.provider, model: result.model, stage: input.stage, attempt: attempt + 1, usage: result.usage });
      return result;
    } catch (error) {
      const safe = error instanceof LongformProviderError ? error : new LongformProviderError("UNKNOWN", `${spec.name} long-form request failed`, { provider: spec.name, stage: input.stage });
      onEvent({ event: safe.defer ? "deferred" : "failed", provider: spec.name, model: spec.model, stage: input.stage, attempt: attempt + 1, code: safe.code, status: safe.status, retryable: safe.retryable, retryAfterMs: safe.retryAfterMs });
      if (!safe.retryable || attempt + 1 >= attempts) throw safe;
      const delay = delayFor(safe, attempt);
      onEvent({ event: "retry_scheduled", provider: spec.name, model: spec.model, stage: input.stage, attempt: attempt + 2, delayMs: delay, code: safe.code });
      await sleep(delay);
    }
  }
  throw new LongformProviderError("UNKNOWN", "long-form provider exhausted attempts", { provider: spec.name, stage: input.stage, defer: true });
}

async function generateJson(input, options = {}) {
  const config = options.config || configuration();
  const onEvent = options.onEvent || (() => {});
  try {
    return await withRetry(config.primary, input, options.dependencies || {}, onEvent);
  } catch (primaryError) {
    if (!config.fallback) throw primaryError;
    if (!config.fallback.configured) {
      onEvent({ event: "fallback_unavailable", provider: config.fallback.name, model: config.fallback.model, stage: input.stage, code: "MISSING_SECRET" });
      throw primaryError;
    }
    onEvent({ event: "fallback_started", provider: config.fallback.name, model: config.fallback.model, stage: input.stage, primaryProvider: config.primary.name, primaryCode: primaryError.code || "UNKNOWN" });
    return withRetry(config.fallback, input, options.dependencies || {}, onEvent);
  }
}

module.exports = {
  LongformProviderError, envValue, providerSpec, configuration, available, retryAfterMs, classifyHttp,
  parseJsonText, groq, anthropic, delayFor, withRetry, generateJson,
};
