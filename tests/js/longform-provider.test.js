"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Channel = require("../../core/channel-context");
const Config = require("../../core/growth/config");
const Context = require("../../core/growth/context");
const Lane = require("../../core/growth/lane");
const Longform = require("../../core/growth/longform");
const Provider = require("../../core/llm/longform-provider");
const Store = require("../../core/growth/store");

const ENV_KEYS = ["LONGFORM_LLM", "LONGFORM_LLM_PROVIDER", "LONGFORM_LLM_FALLBACK_PROVIDER", "LONGFORM_LLM_MAX_ATTEMPTS", "LONGFORM_LLM_MAX_RETRY_MS", "GROQ_API_KEY", "GROQ_MODEL", "ANTHROPIC_API_KEY"];

function withEnv(values, run) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  return Promise.resolve().then(run).finally(() => {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  });
}

function headers(retryAfter = null) { return { get: (name) => name.toLowerCase() === "retry-after" ? retryAfter : null }; }
function response(status, value, retryAfter = null) {
  return { ok: status >= 200 && status < 300, status, headers: headers(retryAfter), json: async () => value };
}
function groqBody(json, model = "openai/gpt-oss-120b") {
  return { model, choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 11, completion_tokens: 7 } };
}

test("Groq is explicit, defaults to openai/gpt-oss-120b, and has no implicit paid fallback", async () => {
  await withEnv({ LONGFORM_LLM_PROVIDER: "groq", GROQ_API_KEY: "test-key-never-log" }, async () => {
    const config = Provider.configuration();
    assert.equal(config.enabled, true);
    assert.equal(config.primary.name, "groq");
    assert.equal(config.primary.model, "openai/gpt-oss-120b");
    assert.equal(config.fallback, null);
    assert.equal(Provider.available(), true);
    assert.doesNotMatch(JSON.stringify(config), /test-key-never-log/);
  });
});

test("Groq OpenAI-compatible request returns structured JSON without exposing its key", async () => {
  await withEnv({ LONGFORM_LLM_PROVIDER: "groq", GROQ_API_KEY: "super-secret-groq-key", GROQ_MODEL: "openai/gpt-oss-120b" }, async () => {
    let request;
    const result = await Provider.generateJson({ stage: "outline", system: "system", user: "user", maxTokens: 321 }, {
      dependencies: { fetch: async (url, options) => { request = { url, options }; return response(200, groqBody({ outline: ["a"] })); } },
    });
    assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(request.options.body);
    assert.equal(body.model, "openai/gpt-oss-120b");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.max_completion_tokens, 321);
    assert.deepEqual(result.json, { outline: ["a"] });
    assert.equal(result.provider, "groq");
    assert.doesNotMatch(JSON.stringify(result), /super-secret-groq-key/);
  });
});

test("429 responses use bounded retry and then defer without hammering", async () => {
  await withEnv({ LONGFORM_LLM_PROVIDER: "groq", GROQ_API_KEY: "test-key", LONGFORM_LLM_MAX_ATTEMPTS: "2", LONGFORM_LLM_MAX_RETRY_MS: "5000" }, async () => {
    let calls = 0;
    const waits = [];
    const events = [];
    await assert.rejects(() => Provider.generateJson({ stage: "section:PAYOFF", system: "x", user: "y" }, {
      onEvent: (event) => events.push(event),
      dependencies: {
        fetch: async () => { calls += 1; return response(429, {}, "2"); },
        sleep: async (ms) => waits.push(ms),
      },
    }), (error) => error.code === "RATE_LIMIT" && error.defer === true && error.retryable === true);
    assert.equal(calls, 2);
    assert.deepEqual(waits, [2000]);
    assert.equal(events.filter((event) => event.event === "retry_scheduled").length, 1);
    assert.equal(events.at(-1).event, "deferred");
  });
});

test("a paid fallback runs only when it is explicitly configured", async () => {
  await withEnv({
    LONGFORM_LLM_PROVIDER: "groq",
    LONGFORM_LLM_FALLBACK_PROVIDER: "anthropic",
    LONGFORM_LLM_MAX_ATTEMPTS: "1",
    GROQ_API_KEY: "primary-key",
    ANTHROPIC_API_KEY: "fallback-key",
  }, async () => {
    const events = [];
    const result = await Provider.generateJson({ stage: "outline", system: "system", user: "user" }, {
      onEvent: (event) => events.push(event),
      dependencies: {
        fetch: async () => response(429, {}, "0"),
        anthropicClient: { messages: { create: async () => ({
          model: "fallback-model",
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ recovered: true }) }],
          usage: { input_tokens: 5, output_tokens: 3 },
        }) } },
      },
    });
    assert.equal(result.provider, "anthropic");
    assert.deepEqual(result.json, { recovered: true });
    assert.equal(events.filter((event) => event.event === "fallback_started").length, 1);
    assert.doesNotMatch(JSON.stringify(events), /primary-key|fallback-key/);
  });
});

test("long-form checkpoints a 429-deferred section and resumes without regenerating completed stages", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bto-longform-provider-"));
  const savedRoot = process.env.GROWTH_STATE_ROOT;
  process.env.GROWTH_STATE_ROOT = sandbox;
  try {
    await withEnv({ LONGFORM_LLM_PROVIDER: "groq", GROQ_API_KEY: "checkpoint-secret", LONGFORM_LLM_MAX_ATTEMPTS: "2", LONGFORM_LLM_MAX_RETRY_MS: "1000" }, async () => {
      const channel = Channel.getChannel("behind-the-ordinary");
      const ctx = Context.build(channel);
      const topic = ctx.inventory.find((item) => item.slug === "why-jeans-have-a-tiny-pocket");
      const config = Config.forChannel(channel);
      const pkg = Longform.researchPackage(channel, topic, { write: true, research: false, now: new Date("2026-10-03T12:00:00Z") });
      const plan = Longform.outline(channel, topic, pkg, config);
      const cold = Longform.coldOpens(topic, config, []);
      let calls = 0;
      const firstFetch = async (url, options) => {
        calls += 1;
        if (calls === 1) return response(200, groqBody({ central_question: topic.question, audience_promise: "Explain the pocket.", narrative_angle: "Follow the documented design history.", hook_candidates: [cold.selected.text], retention_beats: ["Reveal the original use."], uncertain_claims: [] }));
        return response(429, {}, "0");
      };
      await assert.rejects(() => Longform.llmScript(channel, topic, pkg, plan, cold, config, { write: true, providerDependencies: { fetch: firstFetch, sleep: async () => {} } }),
        (error) => error.code === "RATE_LIMIT" && error.defer === true);
      const checkpoint = Store.readState(channel, "longform", `generation/${topic.slug}.json`, null);
      assert.equal(checkpoint.status, "DEFERRED");
      assert.ok(checkpoint.blueprint);
      assert.equal(checkpoint.sections[0].section, "COLD_OPEN");
      assert.equal(checkpoint.error.code, "RATE_LIMIT");
      assert.doesNotMatch(JSON.stringify(checkpoint), /checkpoint-secret/);

      const resumedSystems = [];
      const resumeFetch = async (url, options) => {
        const request = JSON.parse(options.body);
        resumedSystems.push(request.messages[0].content);
        const input = JSON.parse(request.messages[1].content);
        const claim = input.claims && input.claims[0];
        return response(200, groqBody({ section: { name: input.section.section, paragraphs: claim ? [{ text: claim.text, claims: [claim.id] }] : [] }, depth_note: "Evidence-limited section." }));
      };
      const resumed = await Longform.llmScript(channel, topic, pkg, plan, cold, config, { write: true, providerDependencies: { fetch: resumeFetch, sleep: async () => {} } });
      assert.ok(["COMPLETE", "QUALITY_REVIEW"].includes(resumed.status));
      assert.equal(resumed.sections.filter((section) => section.section === "COLD_OPEN").length, 1);
      assert.equal(resumedSystems.some((value) => /central_question.*audience_promise.*narrative_angle/.test(value)), false, "blueprint must not be regenerated");
      const events = Store.readState(channel, "longform", "provider-events.json", []);
      assert.ok(events.some((event) => event.event === "deferred" && event.code === "RATE_LIMIT"));
      assert.doesNotMatch(JSON.stringify(events), /checkpoint-secret/);
    });
  } finally {
    if (savedRoot === undefined) delete process.env.GROWTH_STATE_ROOT; else process.env.GROWTH_STATE_ROOT = savedRoot;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("weekly lane keeps a provider-deferred cycle retryable instead of closing the week", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bto-longform-lane-"));
  const savedRoot = process.env.GROWTH_STATE_ROOT;
  process.env.GROWTH_STATE_ROOT = sandbox;
  try {
    await withEnv({ LONGFORM_LLM_PROVIDER: "groq", GROQ_API_KEY: "lane-secret", LONGFORM_LLM_MAX_ATTEMPTS: "1" }, async () => {
      const channel = Channel.getChannel("behind-the-ordinary");
      const now = new Date("2026-10-08T12:00:00Z");
      const result = await Lane.runCycle(channel, {
        force: true,
        dryRun: true,
        research: false,
        llm: true,
        maxCandidates: 1,
        now,
        providerDependencies: { fetch: async () => response(429, {}, "0"), sleep: async () => {} },
      });
      assert.equal(result.cycle.status, "DEFERRED_PROVIDER");
      assert.equal(result.cycle.evaluated.length, 1, "a provider deferral must stop candidate iteration");
      assert.equal(result.cycle.evaluated[0].generationStatus, "DEFERRED");
      assert.ok(result.cycle.evaluated[0].hardFails.some((item) => /do not render or publish/.test(item)));
      assert.equal(Lane.status(channel, now).due, true, "a deferred cycle must remain retryable in the same ISO week");
      assert.doesNotMatch(JSON.stringify(result.cycle), /lane-secret/);
    });
  } finally {
    if (savedRoot === undefined) delete process.env.GROWTH_STATE_ROOT; else process.env.GROWTH_STATE_ROOT = savedRoot;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
