"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_path = require("node:path");
const node_fs = require("node:fs");
const node_crypto = require("node:crypto");
const node_os = require("node:os");
const node_child_process = require("node:child_process");
const node_events = require("node:events");
const node_util = require("node:util");
const node_http = require("node:http");
const initSqlJs = require("sql.js");
const promises = require("node:stream/promises");
const node_stream = require("node:stream");
const electronUpdater = require("electron-updater");
const DEFAULT_AGENTS = [
  { id: "brain", name: "KeepMind", emoji: "🧠", persona: "You are the user's second brain — a persistent, learning memory engine. You know everything they connected: apps, memory tiers, entities, insights. Be warm, concise and insightful. Prefer grounding answers in memory (use get_memory / save_memory). Write what matters to long-term memory. Answer in the user's language.", builtin: true }
];
function defaultConfig() {
  return {
    onboardingDone: false,
    ai: { provider: "local", model: "qwen2.5-3b" },
    localLlm: {},
    github: {},
    mcpServers: [
      { id: "whatsapp", name: "WhatsApp", kind: "whatsapp", enabled: false, sessionDir: node_path.join(electron.app.getPath("userData"), "wa-session") },
      { id: "telegram", name: "Telegram", kind: "telegram", enabled: false, sessionDir: node_path.join(electron.app.getPath("userData"), "tg-session") },
      { id: "postgres", name: "Postgres (read-only)", kind: "postgres", enabled: false }
    ],
    agents: DEFAULT_AGENTS,
    hooks: { lan: false },
    // Self-learning defaults: nightly sleep, morning summary, weekly
    // librarian hygiene, weekly evolution review, nightly note enrichment.
    automations: [
      {
        id: "sleep-nightly",
        name: "Nightly sleep cycle",
        instruction: "Review the day and distill durable memory.",
        kind: "sleep",
        schedule: "daily",
        time: "23:00",
        enabled: true,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      {
        id: "summary-morning",
        name: "Morning summary",
        instruction: "Recap yesterday and brief the day.",
        kind: "summary",
        schedule: "daily",
        time: "08:00",
        enabled: true,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      {
        id: "librarian-weekly",
        name: "Weekly librarian",
        instruction: "Weekly vault hygiene: consolidate old logs, dedupe long-term memory, refresh entity pages.",
        kind: "librarian",
        schedule: "weekly",
        weekday: 1,
        time: "09:00",
        enabled: true,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      {
        id: "evolve-weekly",
        name: "Weekly evolution",
        instruction: "Review the brain's own reports and propose upgrades to sleep questions, memory structure and automations.",
        kind: "evolve",
        schedule: "weekly",
        weekday: 0,
        time: "18:00",
        enabled: true,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      {
        id: "enrich-nightly",
        name: "Nightly note enrichment",
        instruction: "Enrich recent notes with summaries, topic tags and entity wikilinks.",
        kind: "enrich",
        schedule: "daily",
        time: "02:30",
        enabled: true,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    ],
    auth: {},
    pro: { active: false },
    pendingApprovals: []
  };
}
const SECRET_PREFIX = "enc:";
const LOCAL_PREFIX = "enc2:";
let secretKeyCache = null;
function secretKey(dir) {
  if (secretKeyCache) return secretKeyCache;
  try {
    const keyFile = node_path.join(dir, ".secret-key");
    if (node_fs.existsSync(keyFile)) {
      const k2 = Buffer.from(node_fs.readFileSync(keyFile, "utf8").trim(), "hex");
      if (k2.length === 32) {
        secretKeyCache = k2;
        return k2;
      }
    }
    const k = node_crypto.randomBytes(32);
    node_fs.writeFileSync(keyFile, k.toString("hex"), { mode: 384 });
    node_fs.chmodSync(keyFile, 384);
    secretKeyCache = k;
    return k;
  } catch {
    return null;
  }
}
function sealLocal(v, key) {
  const iv = node_crypto.randomBytes(12);
  const c = node_crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(v, "utf8"), c.final()]);
  return LOCAL_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function unsealLocal(v, key) {
  const raw = Buffer.from(v.slice(LOCAL_PREFIX.length), "base64");
  const d = node_crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
function sealValue(v, key) {
  if (typeof v !== "string" || !v || v.startsWith(SECRET_PREFIX) || v.startsWith(LOCAL_PREFIX)) return v;
  if (key) {
    try {
      return sealLocal(v, key);
    } catch {
    }
  }
  if (electron.safeStorage.isEncryptionAvailable()) {
    try {
      return SECRET_PREFIX + electron.safeStorage.encryptString(v).toString("base64");
    } catch {
    }
  }
  return v;
}
function unsealValue(v, key) {
  if (typeof v !== "string") return v;
  if (v.startsWith(LOCAL_PREFIX) && key) {
    try {
      return unsealLocal(v, key);
    } catch {
      return void 0;
    }
  }
  if (v.startsWith(LOCAL_PREFIX)) return void 0;
  if (v.startsWith(SECRET_PREFIX)) {
    try {
      return electron.safeStorage.decryptString(Buffer.from(v.slice(SECRET_PREFIX.length), "base64"));
    } catch {
      return void 0;
    }
  }
  return v;
}
function sealConfig(c, key) {
  const out = JSON.parse(JSON.stringify(c));
  out.ai.apiKey = sealValue(out.ai.apiKey, key);
  out.github.accessToken = sealValue(out.github.accessToken, key);
  out.github.refreshToken = sealValue(out.github.refreshToken, key);
  out.auth.sessionToken = sealValue(out.auth.sessionToken, key);
  out.auth.googleClientSecret = sealValue(out.auth.googleClientSecret, key);
  out.pro.key = sealValue(out.pro.key, key);
  for (const s of out.mcpServers ?? []) {
    if (s.env) for (const k of Object.keys(s.env)) s.env[k] = sealValue(s.env[k], key);
  }
  return out;
}
function unsealConfig(c, key) {
  const out = JSON.parse(JSON.stringify(c));
  out.ai.apiKey = unsealValue(out.ai.apiKey, key);
  out.github.accessToken = unsealValue(out.github.accessToken, key);
  out.github.refreshToken = unsealValue(out.github.refreshToken, key);
  out.auth.sessionToken = unsealValue(out.auth.sessionToken, key);
  out.auth.googleClientSecret = unsealValue(out.auth.googleClientSecret, key);
  out.pro.key = unsealValue(out.pro.key, key);
  for (const s of out.mcpServers ?? []) {
    if (s.env) for (const k of Object.keys(s.env)) s.env[k] = unsealValue(s.env[k], key);
  }
  return out;
}
class Store {
  config;
  file;
  constructor() {
    const dir = node_path.join(electron.app.getPath("userData"), "second-brain");
    node_fs.mkdirSync(dir, { recursive: true });
    this.file = node_path.join(dir, "config.json");
    this.migrateLegacy(dir);
    this.config = this.load();
  }
  // One-time migration for installs that ran before the KeepMind rename:
  // those builds stored everything under the "second-brain" userData dir.
  // If we have no config yet, adopt the legacy config, auth db and memory.
  migrateLegacy(dir) {
    if (node_fs.existsSync(this.file)) return;
    const legacy = node_path.join(electron.app.getPath("userData"), "..", "second-brain", "second-brain");
    if (legacy === dir || !node_fs.existsSync(node_path.join(legacy, "config.json"))) return;
    try {
      node_fs.copyFileSync(node_path.join(legacy, "config.json"), this.file);
      const legacyAuth = node_path.join(legacy, "auth.db");
      if (node_fs.existsSync(legacyAuth)) node_fs.copyFileSync(legacyAuth, node_path.join(dir, "auth.db"));
      const legacyMemory = node_path.join(legacy, "memory");
      if (node_fs.existsSync(legacyMemory)) node_fs.cpSync(legacyMemory, node_path.join(dir, "memory"), { recursive: true });
    } catch {
    }
  }
  load() {
    try {
      if (node_fs.existsSync(this.file)) {
        const raw = JSON.parse(node_fs.readFileSync(this.file, "utf8"));
        const merged = { ...defaultConfig(), ...raw };
        merged.ai = { ...defaultConfig().ai, ...raw.ai };
        merged.localLlm = { ...defaultConfig().localLlm, ...raw.localLlm };
        merged.github = { ...defaultConfig().github, ...raw.github };
        merged.agents = DEFAULT_AGENTS;
        const defaults = defaultConfig().automations;
        const existing = raw.automations ?? [];
        const have = new Set(existing.map((a) => a.id));
        merged.automations = [...existing, ...defaults.filter((d) => !have.has(d.id))];
        merged.pendingApprovals = raw.pendingApprovals ?? [];
        merged.auth = { ...defaultConfig().auth, ...raw.auth };
        merged.pro = { ...defaultConfig().pro, ...raw.pro };
        merged.hooks = { ...defaultConfig().hooks, ...raw.hooks };
        return unsealConfig(merged, secretKey(node_path.dirname(this.file)));
      }
    } catch {
    }
    return defaultConfig();
  }
  get() {
    return this.config;
  }
  set(patch) {
    this.config = { ...this.config, ...patch };
    node_fs.writeFileSync(this.file, JSON.stringify(sealConfig(this.config, secretKey(node_path.dirname(this.file))), null, 2), "utf8");
    return this.config;
  }
  updateAi(patch) {
    return this.set({ ai: { ...this.config.ai, ...patch } });
  }
  updateLocalLlm(patch) {
    return this.set({ localLlm: { ...this.config.localLlm, ...patch } });
  }
  updateGithub(patch) {
    return this.set({ github: { ...this.config.github, ...patch } });
  }
  updateMcpServer(id, patch) {
    const mcpServers = this.config.mcpServers.map((s) => s.id === id ? { ...s, ...patch } : s);
    return this.set({ mcpServers });
  }
  get memoryDir() {
    return this.config.memoryDir ?? node_path.join(electron.app.getPath("userData"), "second-brain", "memory");
  }
  get isConfigured() {
    const aiOk = this.config.ai.provider === "local" || !!this.config.ai.apiKey;
    return !!(this.config.github.repoUrl && aiOk);
  }
}
function resolveInside(root, ...parts) {
  const base = node_path.resolve(root);
  const p = node_path.resolve(base, ...parts);
  if (p !== base && !p.startsWith(base + node_path.sep)) {
    throw new Error(`path escapes root: ${parts.join("/")}`);
  }
  return p;
}
const FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
function stripForbiddenKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!FORBIDDEN_KEYS.has(k)) out[k] = v;
  }
  return out;
}
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const SECRET_PATTERNS = [
  ["openai/generic api key", /\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b/],
  ["github token", /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,}|ghu_[A-Za-z0-9]{30,}|ghs_[A-Za-z0-9]{30,}|ghr_[A-Za-z0-9]{30,})\b/],
  ["slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["aws key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer token", /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/gi],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["stripe key", /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/],
  ["google api key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["password assignment", /(?:password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi]
];
const REDACTED = "⟨redacted:secret⟩";
function redactSecrets(text) {
  if (!text) return text;
  let out = text;
  for (const [, re] of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}
function isLocalProvider(provider) {
  return provider === "local" || provider === "ollama";
}
function scrubForProvider(aiCfg, messages) {
  if (isLocalProvider(aiCfg.provider)) return messages;
  return messages.map((m) => ({ ...m, content: redactSecrets(m.content) }));
}
function effectiveConfig(ai, localEndpoint) {
  if (ai.provider === "local") {
    return {
      provider: "openai",
      baseUrl: localEndpoint ?? "http://127.0.0.1:8765/v1",
      apiKey: "local",
      model: ai.model
    };
  }
  return ai;
}
const MODELS = {
  local: ["qwen2.5-3b", "smollm2-1.7b", "llama3.2-3b", "qwen2.5-7b"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  "claude-oauth": ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
  codex: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-5.6-sol"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  grok: ["grok-4", "grok-3", "grok-3-mini"],
  ollama: ["llama3.1", "qwen2.5", "mistral"]
};
function pickModel(provider, cfg) {
  const list = provider === "codex" ? codexModels() : MODELS[provider];
  if (cfg.model && list?.includes(cfg.model)) return cfg.model;
  return list?.[0] ?? cfg.model ?? "";
}
function listProviders() {
  const names = {
    local: "Local (built-in, offline)",
    anthropic: "Claude API key",
    "claude-oauth": "Claude (Pro/Max sign-in)",
    openai: "OpenAI API key",
    codex: "Codex / ChatGPT sign-in",
    gemini: "Google Gemini API key",
    grok: "Grok (xAI API key)",
    ollama: "Ollama (local)"
  };
  return Object.keys(MODELS).map((id) => ({
    id,
    name: names[id],
    models: id === "codex" ? codexModels() : MODELS[id],
    needsKey: !["ollama", "local", "codex"].includes(id)
  }));
}
async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
async function callAnthropic(cfg, messages, tools) {
  const { system, rest } = splitSystem(messages);
  const body = {
    model: pickModel("anthropic", cfg),
    max_tokens: 4096,
    messages: rest.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }))
  };
  if (system) body.system = system;
  if (tools.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  const data = await post("https://api.anthropic.com/v1/messages", body, {
    "x-api-key": cfg.apiKey,
    "anthropic-version": "2023-06-01"
  });
  const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") ?? "";
  const toolCalls = (data.content ?? []).filter((b) => b.type === "tool_use").map((b) => ({
    id: b.id,
    name: b.name,
    arguments: b.input ?? {}
  }));
  return { text, toolCalls };
}
async function callOpenAI(cfg, messages, tools) {
  const body = {
    model: pickModel(cfg.provider in MODELS ? cfg.provider : "openai", cfg),
    messages: messages.map((m) => ({ role: m.role === "tool" ? "tool" : m.role, content: m.content, name: m.name })),
    ...tools.length ? {
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: "auto"
    } : {}
  };
  const base = cfg.baseUrl ?? "https://api.openai.com/v1";
  const data = await post(`${base.replace(/\/$/, "")}/chat/completions`, body, {
    Authorization: `Bearer ${cfg.apiKey}`
  });
  const msg = data.choices?.[0]?.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: safeJson(tc.function.arguments)
  }));
  return { text: msg.content ?? "", toolCalls };
}
async function callGemini(cfg, messages, tools) {
  const { system, rest } = splitSystem(messages);
  const contents = rest.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const body = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
    ...tools.length ? {
      tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
    } : {}
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const model = pickModel("gemini", cfg);
  const data = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`,
    body
  );
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => p.text).map((p) => p.text).join("");
  const toolCalls = parts.filter((p) => p.functionCall).map((p) => ({
    id: `call_${Math.random().toString(36).slice(2)}`,
    name: p.functionCall.name,
    arguments: p.functionCall.args ?? {}
  }));
  return { text, toolCalls };
}
async function callOllama(cfg, messages, tools) {
  const base = cfg.baseUrl ?? "http://localhost:11434";
  const data = await post(`${base.replace(/\/$/, "")}/api/chat`, {
    model: cfg.model ?? MODELS.ollama[0],
    messages: messages.map((m) => ({ role: m.role === "tool" ? "tool" : m.role, content: m.content })),
    stream: false,
    ...tools.length ? {
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
    } : {}
  });
  const msg = data.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
    id: tc.id ?? `call_${Math.random().toString(36).slice(2)}`,
    name: tc.function?.name ?? tc.name,
    arguments: tc.function?.arguments ?? tc.arguments ?? {}
  }));
  return { text: msg.content ?? "", toolCalls };
}
const CODEX_AUTH_FILE = node_path.join(node_os.homedir(), ".codex", "auth.json");
const CODEX_MODELS_CACHE = node_path.join(node_os.homedir(), ".codex", "models_cache.json");
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
let codexModelsMemo = null;
function codexModels() {
  if (codexModelsMemo && Date.now() - codexModelsMemo.at < 5 * 6e4) return codexModelsMemo.list;
  let list = MODELS.codex;
  try {
    const raw = JSON.parse(node_fs.readFileSync(CODEX_MODELS_CACHE, "utf8"));
    const slugs = (raw.models ?? []).filter((m) => m.supported_in_api && m.visibility === "list").sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((m) => m.slug).filter(Boolean);
    if (slugs.length) list = slugs;
  } catch {
  }
  codexModelsMemo = { at: Date.now(), list };
  return list;
}
function readCodexAuth() {
  try {
    if (!node_fs.existsSync(CODEX_AUTH_FILE)) return null;
    return JSON.parse(node_fs.readFileSync(CODEX_AUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}
function codexStatus() {
  const a = readCodexAuth();
  if (!a?.tokens?.access_token) return { loggedIn: false };
  let email;
  try {
    const payload = JSON.parse(Buffer.from(a.tokens.access_token.split(".")[1], "base64url").toString());
    email = payload?.email ?? payload?.["https://api.openai.com/profile"]?.email;
  } catch {
  }
  return { loggedIn: true, accountId: a.tokens.account_id, email };
}
async function refreshCodexToken(auth) {
  const rt = auth.tokens?.refresh_token;
  if (!rt) return false;
  try {
    const res = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: rt
      })
    });
    const data = await res.json();
    if (!data.access_token) return false;
    auth.tokens = { ...auth.tokens, access_token: data.access_token, refresh_token: data.refresh_token ?? rt };
    auth.last_refresh = (/* @__PURE__ */ new Date()).toISOString();
    node_fs.writeFileSync(CODEX_AUTH_FILE, JSON.stringify(auth, null, 2));
    return true;
  } catch {
    return false;
  }
}
async function callCodex(cfg, messages, tools, retried = false) {
  const auth = readCodexAuth();
  const token = auth?.tokens?.access_token;
  if (!token) {
    throw new Error("Codex not signed in — install the Codex CLI and run `codex login` first (credentials are read from ~/.codex/auth.json)");
  }
  const { system, rest } = splitSystem(messages);
  const body = {
    model: pickModel("codex", cfg),
    instructions: system || "You are a helpful assistant.",
    input: rest.map((m) => ({
      type: "message",
      role: m.role === "assistant" ? "assistant" : "user",
      content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }]
    })),
    tools: tools.length ? tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict: false
    })) : void 0,
    tool_choice: tools.length ? "auto" : void 0,
    parallel_tool_calls: false,
    store: false,
    stream: true
    // the Codex backend requires streaming
  };
  const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "chatgpt-account-id": auth.tokens.account_id ?? "",
      "OpenAI-Beta": "responses=experimental",
      "originator": "codex_cli_rs",
      "accept": "text/event-stream"
    },
    body: JSON.stringify(body)
  });
  if (res.status === 401 && !retried && auth) {
    if (await refreshCodexToken(auth)) return callCodex(cfg, messages, tools, true);
  }
  if (!res.ok) throw new Error(`Codex API -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (!res.body) throw new Error("Codex API returned no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const toolCalls = [];
  const seenCalls = /* @__PURE__ */ new Set();
  const handleEvent = (ev) => {
    if (ev?.type === "response.output_text.delta" && ev.delta) text += ev.delta;
    else if (ev?.type === "response.output_item.done" && ev.item?.type === "function_call") {
      const id = ev.item.call_id ?? ev.item.id;
      if (!seenCalls.has(id)) {
        seenCalls.add(id);
        toolCalls.push({ id, name: ev.item.name, arguments: safeJson(ev.item.arguments) });
      }
    } else if (ev?.type === "response.completed") {
      for (const item of ev.response?.output ?? []) {
        if (item.type === "message") {
          for (const c of item.content ?? []) if (c.type === "output_text" && !text.includes(c.text)) text += c.text;
        } else if (item.type === "function_call" && !seenCalls.has(item.call_id ?? item.id)) {
          const id = item.call_id ?? item.id;
          seenCalls.add(id);
          toolCalls.push({ id, name: item.name, arguments: safeJson(item.arguments) });
        }
      }
    } else if (ev?.type === "response.failed" || ev?.type === "error") {
      throw new Error(`Codex stream error: ${JSON.stringify(ev).slice(0, 200)}`);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          handleEvent(JSON.parse(payload));
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
  return { text, toolCalls };
}
async function callClaudeOAuth(cfg, messages, tools) {
  const { system, rest } = splitSystem(messages);
  const body = {
    model: pickModel("claude-oauth", cfg),
    max_tokens: 4096,
    messages: rest.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }))
  };
  if (system) body.system = system;
  if (tools.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  const data = await post("https://api.anthropic.com/v1/messages", body, {
    "Authorization": `Bearer ${cfg.apiKey}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20"
  });
  const text = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") ?? "";
  const toolCalls = (data.content ?? []).filter((b) => b.type === "tool_use").map((b) => ({
    id: b.id,
    name: b.name,
    arguments: b.input ?? {}
  }));
  return { text, toolCalls };
}
function splitSystem(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  return { system, rest: messages.filter((m) => m.role !== "system") };
}
function safeJson(s) {
  if (typeof s === "object") return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
async function chat(aiCfg, messages, tools = [], localEndpoint) {
  const cfg = effectiveConfig(aiCfg, localEndpoint);
  messages = scrubForProvider(aiCfg, messages);
  switch (cfg.provider) {
    case "anthropic":
      if (!cfg.apiKey) throw new Error("Anthropic API key missing");
      return callAnthropic(cfg, messages, tools);
    case "claude-oauth":
      if (!cfg.apiKey) throw new Error("Claude token missing — run `claude setup-token` and paste it");
      return callClaudeOAuth(cfg, messages, tools);
    case "codex":
      return callCodex(cfg, messages, tools);
    case "grok": {
      if (!cfg.apiKey) throw new Error("xAI API key missing (console.x.ai)");
      return callOpenAI({ ...cfg, baseUrl: cfg.baseUrl ?? "https://api.x.ai/v1" }, messages, tools);
    }
    case "openai":
      if (!cfg.apiKey) throw new Error("OpenAI API key missing");
      return callOpenAI(cfg, messages, tools);
    case "gemini":
      if (!cfg.apiKey) throw new Error("Gemini API key missing");
      return callGemini(cfg, messages, tools);
    case "ollama":
      return callOllama(cfg, messages, tools);
    default:
      throw new Error(`Unknown provider: ${cfg.provider}`);
  }
}
const API = "https://api.github.com";
const WEB = "https://github.com";
const CLIENT_ID = process.env.SECOND_BRAIN_GH_CLIENT_ID ?? "Ov23liBpws7Gw3TAaJCx";
const SCOPES = "repo read:user";
async function startDeviceFlow() {
  const res = await fetch(`${WEB}/login/device/code`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES })
  });
  if (!res.ok) throw new Error(`GitHub device flow failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function pollDeviceFlow(deviceCode) {
  const res = await fetch(`${WEB}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      device_code: deviceCode.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });
  const data = await res.json();
  if (data.access_token) {
    const user = await apiGet("/user", data.access_token);
    return { status: "success", accessToken: data.access_token, login: user.login };
  }
  if (data.error === "authorization_pending") return { status: "pending" };
  if (data.error === "slow_down") return { status: "slow_down" };
  throw new Error(`GitHub auth error: ${data.error_description ?? data.error}`);
}
async function apiGet(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}
async function apiSend(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...body ? { "Content-Type": "application/json" } : {}
    },
    body: body ? JSON.stringify(body) : void 0
  });
  if (!res.ok) throw new Error(`GitHub API ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}
async function listUserRepos(token) {
  const items = await apiGet("/user/repos?per_page=100&sort=updated&type=owner", token);
  return items.map((r) => ({
    full_name: r.full_name,
    name: r.name,
    owner: r.owner?.login ?? "",
    html_url: r.html_url,
    private: !!r.private,
    default_branch: r.default_branch ?? "main",
    description: r.description ?? void 0,
    updated_at: r.updated_at ?? ""
  }));
}
async function getRepo(token, owner, repo) {
  return apiGet(`/repos/${owner}/${repo}`, token);
}
async function createRepo(token, name, description, privateRepo = true) {
  const repo = await apiSend("POST", "/user/repos", token, {
    name,
    description,
    private: privateRepo,
    auto_init: true,
    has_issues: false,
    has_projects: false,
    has_wiki: false
  });
  return repo;
}
function repoCoords(cfg) {
  const [owner, repo] = cfg.repoOwner && cfg.repoName ? [cfg.repoOwner, cfg.repoName] : (cfg.repoUrl ?? "").replace(/\.git$/, "").split("/").slice(-2);
  return { owner, repo, branch: cfg.defaultBranch ?? "main" };
}
async function pushFile(cfg, path, content, message) {
  if (!cfg.accessToken) throw new Error("GitHub not connected");
  const { owner, repo, branch } = repoCoords(cfg);
  const encoded = encodeURIComponent(path);
  const apiPath = `/repos/${owner}/${repo}/contents/${encoded}`;
  let sha;
  try {
    const existing = await apiGet(`${apiPath}?ref=${branch}`, cfg.accessToken);
    sha = existing.sha;
  } catch {
  }
  await apiSend("PUT", apiPath, cfg.accessToken, {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...sha ? { sha } : {}
  });
}
async function listRepoFiles(cfg, dir = "") {
  if (!cfg.accessToken || !cfg.repoOwner || !cfg.repoName) return [];
  try {
    const items = await apiGet(`/repos/${cfg.repoOwner}/${cfg.repoName}/contents/${dir}`, cfg.accessToken);
    return items.map((i) => i.path);
  } catch {
    return [];
  }
}
async function listTree(cfg, prefix = "memory/") {
  if (!cfg.accessToken) return [];
  try {
    const { owner, repo } = repoCoords(cfg);
    const tree = await apiGet(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, cfg.accessToken);
    return (tree.tree ?? []).filter((t) => t.type === "blob" && t.path?.startsWith(prefix)).map((t) => ({ path: t.path.slice(prefix.length), sha: t.sha }));
  } catch {
    return [];
  }
}
async function deleteMemoryFile(cfg, relPath, root = "memory/") {
  if (!cfg.accessToken) throw new Error("GitHub not connected");
  const { owner, repo, branch } = repoCoords(cfg);
  const apiPath = `/repos/${owner}/${repo}/contents/${root}${encodeURIComponent(relPath)}`;
  let sha;
  try {
    const existing = await apiGet(`${apiPath}?ref=${branch}`, cfg.accessToken);
    sha = existing.sha;
  } catch {
    return;
  }
  await apiSend("DELETE", apiPath, cfg.accessToken, { message: "sync: remove memory file", sha, branch });
}
async function fetchMemoryFile(cfg, relPath, root = "memory/") {
  if (!cfg.accessToken) return null;
  try {
    const { owner, repo, branch } = repoCoords(cfg);
    const data = await apiGet(`/repos/${owner}/${repo}/contents/${root}${encodeURIComponent(relPath)}?ref=${branch}`, cfg.accessToken);
    const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
    return { content, sha: data.sha };
  } catch {
    return null;
  }
}
const STOP = /* @__PURE__ */ new Set([
  // english
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "this",
  "that",
  "you",
  "your",
  "we",
  "our",
  "they",
  "their",
  "he",
  "she",
  "i",
  "me",
  "my",
  "not",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "about",
  "as",
  "at",
  "by",
  "from",
  "into",
  "over",
  "after",
  "before",
  "between",
  "under",
  "then",
  "than",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "both",
  "each",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "so",
  "too",
  "very",
  "just",
  "also",
  "what",
  "which",
  "who",
  "whom",
  "these",
  "those",
  "am",
  "if",
  "but",
  "out",
  // time
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "today",
  "tomorrow",
  "yesterday",
  "week",
  "month",
  "year",
  "daily",
  "weekly",
  // product / tech noise
  "second",
  "brain",
  "github",
  "markdown",
  "mcp",
  "json",
  "html",
  "css",
  "api",
  "pdf",
  "todo",
  "note",
  "llm",
  "ai",
  "app",
  "app",
  "user",
  "users",
  "file",
  "files",
  "data",
  "memory",
  "agent",
  "agents"
]);
const ENTITY_RE = /\b([A-Z][\p{L}\p{N}]*(?:[\s-][A-Z][\p{L}\p{N}]*){0,3})\b/gu;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
function slug$2(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function computeBacklinks(memory) {
  const links = /* @__PURE__ */ new Map();
  for (const rel of memory.allRelFiles()) {
    if (rel.startsWith("entities/")) continue;
    const content = memory.read(rel);
    if (!content) continue;
    for (const m of content.matchAll(WIKILINK_RE)) {
      const target = m[1].split("|")[0].trim();
      const key = slug$2(target);
      if (!key) continue;
      if (!links.has(key)) links.set(key, /* @__PURE__ */ new Set());
      links.get(key).add(rel);
    }
  }
  return links;
}
function extractCandidates(memory) {
  const hits = /* @__PURE__ */ new Map();
  const bump = (name, file) => {
    const clean = name.trim();
    if (clean.length < 3 || clean.split(/\s+/).every((w) => STOP.has(w.toLowerCase()))) return;
    const key = clean.toLowerCase();
    if (!hits.has(key)) hits.set(key, { name: clean, files: /* @__PURE__ */ new Set(), count: 0 });
    const h = hits.get(key);
    h.files.add(file);
    h.count++;
  };
  const files = [];
  for (const f of memory.shortTermFiles().slice(-7)) files.push(`short-term/${f}`);
  for (const f of memory.list("inbox").slice(-5)) files.push(`inbox/${f}`);
  for (const f of memory.list("notes")) files.push(`notes/${f}`);
  for (const f of memory.list("tasks").slice(0, 30)) files.push(`tasks/${f}`);
  for (const f of memory.list("entities")) files.push(`entities/${f}`);
  for (const rel of files) {
    const content = memory.read(rel);
    if (!content) continue;
    for (const m of content.matchAll(WIKILINK_RE)) bump(m[1], rel);
    for (const m of content.matchAll(ENTITY_RE)) bump(m[1], rel);
  }
  return hits;
}
async function llmDescribe(candidates, complete) {
  const out = /* @__PURE__ */ new Map();
  if (!candidates.length) return out;
  try {
    const prompt = `From this list of entity candidates extracted from a personal knowledge base, return ONLY lines in the exact format "Name | one-line description (max 15 words)". Skip generic words, keep real people, projects, companies, products, places. No commentary, no markdown.

Candidates:
${candidates.slice(0, 40).join("\n")}`;
    const res = await complete(prompt);
    for (const line of res.split("\n")) {
      const [name, desc] = line.split("|").map((s) => s.trim());
      if (name && desc) out.set(name.toLowerCase(), desc);
    }
  } catch {
  }
  return out;
}
async function refreshEntities(memory, complete) {
  const hits = extractCandidates(memory);
  const kept = [...hits.values()].filter((h) => h.count >= 2 || memory.read(`entities/${slug$2(h.name)}.md`) != null).sort((a, b) => b.count - a.count).slice(0, 60);
  const descriptions = complete ? await llmDescribe(kept.map((k) => k.name), complete) : /* @__PURE__ */ new Map();
  const backlinks = computeBacklinks(memory);
  const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  let created = 0, updated = 0;
  for (const h of kept) {
    const file = `entities/${slug$2(h.name)}.md`;
    const existed = memory.read(file) != null;
    const desc = descriptions.get(h.name.toLowerCase());
    const sources = [...h.files].sort().slice(0, 25);
    const linkedFrom = [...backlinks.get(slug$2(h.name)) ?? []].filter((f) => f !== file).sort().slice(0, 25);
    const body = [
      `# ${h.name}
`,
      `> entity · first seen ${today2} · mentioned ${h.count}× in scanned memory
`,
      desc ? `
${desc}
` : "",
      `
## Sources
`,
      ...sources.map((s) => `- ${s}`),
      linkedFrom.length ? `
## Linked from
` + linkedFrom.map((s) => `- ${s}`).join("\n") + "\n" : "",
      `
## Notes

_(agents and the user can add durable context here)_
`
    ].join("\n");
    memory.write(file, body);
    existed ? updated++ : created++;
  }
  const index = [
    "# Entities\n",
    `_auto-generated ${today2} — ${kept.length} entities, sorted by mentions_
`,
    "",
    ...kept.map((h) => `- [[${h.name}]] — ${h.count} mentions`)
  ].join("\n");
  memory.write("entities/index.md", index + "\n");
  return { created, updated, total: kept.length };
}
class Memory {
  constructor(dir, gh) {
    this.dir = dir;
    this.gh = gh;
    node_fs.mkdirSync(this.dir, { recursive: true });
    this.journalFile = node_path.join(this.dir, "ops", "activity.jsonl");
    this.loadJournal();
    for (const sub of ["short-term", "medium-term", "long-term", "sleep", "inbox", "insights", "summaries", "agents", "notes", "tasks", "daily", "meetings", "entities", "review", "skills", "crm", "crm/people", "crm/companies", "crm/interactions", "ops"]) {
      node_fs.mkdirSync(node_path.join(this.dir, sub), { recursive: true });
    }
  }
  // Called after every local write/append — used by GitSync to mark dirty paths
  onWrite = null;
  // Who is writing right now — Brain methods set this so the activity
  // journal can attribute each change (sleep cycle, chat, ui, automation…)
  activitySource = "system";
  quiet = false;
  journal = [];
  journalFile;
  journalAppends = 0;
  // Containment guard: every memory path must resolve inside the memory
  // dir — blocks `..` traversal from LLM tool args, sync filenames, etc.
  path(...parts) {
    return resolveInside(this.dir, ...parts);
  }
  write(relative, content) {
    const p = this.path(relative);
    node_fs.mkdirSync(node_path.join(p, ".."), { recursive: true });
    node_fs.writeFileSync(p, content, "utf8");
    if (!this.quiet) {
      this.onWrite?.(relative);
      this.journalPush("write", relative);
    }
  }
  append(relative, content) {
    const p = this.path(relative);
    node_fs.mkdirSync(node_path.join(p, ".."), { recursive: true });
    node_fs.appendFileSync(p, content, "utf8");
    if (!this.quiet) {
      this.onWrite?.(relative);
      this.journalPush("append", relative);
    }
  }
  // Activity journal — every local mutation is recorded to
  // ops/activity.jsonl (local-only, .jsonl so it never syncs to GitHub)
  // and kept in a ring buffer for the UI feed.
  journalPush(op, rel) {
    const entry = { ts: Date.now(), op, path: rel, source: this.activitySource };
    this.journal.push(entry);
    if (this.journal.length > 600) this.journal.splice(0, this.journal.length - 600);
    try {
      node_fs.mkdirSync(node_path.join(this.dir, "ops"), { recursive: true });
      node_fs.appendFileSync(this.journalFile, JSON.stringify(entry) + "\n", "utf8");
      if (++this.journalAppends % 200 === 0 && node_fs.existsSync(this.journalFile) && node_fs.statSync(this.journalFile).size > 3e5) {
        const lines = node_fs.readFileSync(this.journalFile, "utf8").trim().split("\n");
        node_fs.writeFileSync(this.journalFile, lines.slice(-2e3).join("\n") + "\n", "utf8");
      }
    } catch {
    }
  }
  loadJournal() {
    try {
      if (!node_fs.existsSync(this.journalFile)) return;
      const lines = node_fs.readFileSync(this.journalFile, "utf8").trim().split("\n").slice(-600);
      for (const l of lines) {
        try {
          this.journal.push(JSON.parse(l));
        } catch {
        }
      }
    } catch {
    }
  }
  activity(limit = 200) {
    return this.journal.slice(-limit).reverse();
  }
  // Writes/removes that must NOT trigger a sync push (used by GitSync.pull)
  quietWrite(relative, content) {
    this.quiet = true;
    try {
      this.write(relative, content);
    } finally {
      this.quiet = false;
    }
  }
  quietRemove(relative) {
    this.quiet = true;
    try {
      this.remove(relative);
    } finally {
      this.quiet = false;
    }
  }
  allRelFiles() {
    return this.allFiles("");
  }
  read(relative) {
    const p = this.path(relative);
    return node_fs.existsSync(p) ? node_fs.readFileSync(p, "utf8") : null;
  }
  remove(relative) {
    const p = this.path(relative);
    if (node_fs.existsSync(p)) {
      node_fs.unlinkSync(p);
      if (!this.quiet) {
        this.onWrite?.(relative);
        this.journalPush("remove", relative);
      }
    }
  }
  // Short-term files older than `days` are candidates for medium-term consolidation
  shortTermFiles() {
    return this.list("short-term").sort();
  }
  mediumTermFiles() {
    return this.list("medium-term").sort();
  }
  longTermFiles() {
    return this.list("long-term").sort();
  }
  list(dir) {
    const p = this.path(dir);
    return node_fs.existsSync(p) ? node_fs.readdirSync(p).filter((f) => f.endsWith(".md")) : [];
  }
  async syncToGitHub(message) {
    if (!this.gh?.accessToken || !this.gh.repoOwner) return;
    const files = this.allFiles("");
    for (const rel of files.slice(0, 200)) {
      const content = this.read(rel);
      if (content != null) {
        try {
          await pushFile(this.gh, `memory/${rel}`, content, message);
        } catch {
        }
      }
    }
  }
  countFiles(dir) {
    const p = this.path(dir);
    if (!node_fs.existsSync(p)) return 0;
    let n = 0;
    for (const e of node_fs.readdirSync(p, { withFileTypes: true })) {
      if (e.isDirectory()) n += this.countFiles(node_path.join(dir, e.name));
      else if (e.name.endsWith(".md")) n++;
    }
    return n;
  }
  allFiles(dir, prefix = "") {
    const out = [];
    const p = this.path(dir);
    if (!node_fs.existsSync(p)) return out;
    for (const e of node_fs.readdirSync(p, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...this.allFiles(node_path.join(dir, e.name), rel));
      else if (e.name.endsWith(".md")) out.push(rel);
    }
    return out;
  }
}
class Brain {
  memory;
  store;
  mcp = null;
  localLlm = null;
  gitSync = null;
  rag = null;
  laya = null;
  constructor(store2, mcp2, localLlm = null) {
    this.store = store2;
    this.mcp = mcp2;
    this.localLlm = localLlm;
    this.memory = new Memory(store2.memoryDir, store2.get().github.accessToken ? store2.get().github : null);
  }
  setMcp(mcp2) {
    this.mcp = mcp2;
  }
  setLocalLlm(l) {
    this.localLlm = l;
  }
  // Lazily ensure the bundled local model server is up before LLM calls.
  // The app auto-starts it at launch, but the server can crash or the app
  // may have started before the model finished downloading — without this,
  // nightly crons would silently fail on the 'local' provider.
  async ensureProviderReady() {
    const cfg = this.store.get();
    if (cfg.ai.provider !== "local" || !this.localLlm) return;
    try {
      await this.localLlm.ensureRunning(cfg.localLlm.modelId);
    } catch (e) {
      console.warn("[brain] local provider not ready:", e);
    }
  }
  attachSync(sync) {
    this.gitSync = sync;
    this.memory.onWrite = (rel) => sync.markDirty(rel);
  }
  setRag(rag) {
    this.rag = rag;
  }
  setLaya(l) {
    this.laya = l;
  }
  getMemory() {
    return this.memory;
  }
  setActivitySource(src) {
    this.memory.activitySource = src;
  }
  buildSystemContext(agent, recall = "") {
    const cfg = this.store.get();
    const parts = [
      agent.persona,
      "",
      "## Connected sources",
      `- GitHub memory repo: ${cfg.github.repoUrl ?? "not connected"}`,
      `- AI provider: ${cfg.ai.provider} (${cfg.ai.model ?? "default"})`,
      `- MCP servers running: ${this.mcp?.runningServers.join(", ") || "none"}`
    ];
    const facts = this.memory.read("long-term/facts.md");
    if (facts) parts.push("", "## Long-term memory — facts & preferences", facts.slice(0, 3e3));
    const skills = this.memory.read("long-term/skills.md");
    if (skills) parts.push("", "## Learned skills (from nightly sleep cycles)", skills.slice(0, 2500));
    const lessons = this.memory.read("long-term/lessons.md");
    if (lessons) parts.push("", "## Lessons learned", lessons.slice(0, 2e3));
    const medium = this.memory.mediumTermFiles().slice(-2);
    for (const f of medium) {
      const c = this.memory.read(`medium-term/${f}`);
      if (c) parts.push("", `### ${f}`, c.slice(0, 1500));
    }
    const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    for (const d of [yesterday, today2]) {
      const c = this.memory.read(`short-term/${d}.md`) ?? this.memory.read(`inbox/${d}.md`);
      if (c) parts.push("", `## Short-term memory — ${d}`, c.slice(-4e3));
    }
    const insights = this.memory.list("insights").slice(-5);
    for (const f of insights) {
      const c = this.memory.read(`insights/${f}`);
      if (c) parts.push("", `### ${f}`, c.slice(0, 1200));
    }
    if (recall) parts.push("", "## Relevant memories (semantic search)", recall);
    return parts.join("\n");
  }
  toolDefinitions() {
    const tools = [
      {
        name: "save_memory",
        description: "Save an important note/fact/insight to the user's long-term memory (stored in their GitHub repo).",
        parameters: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["title", "content"] }
      },
      {
        name: "get_memory",
        description: "Read a memory file by path (e.g. inbox/digest.md, insights/2026-11-05.md).",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
      },
      {
        name: "list_tasks",
        description: "List open tasks from the planner (tasks/ dir) with id, title, due date and priority. Optionally filter by status.",
        parameters: { type: "object", properties: { status: { type: "string", description: "open (default) or done or all" } } }
      },
      {
        name: "add_task",
        description: "Create a task in the planner. Returns the task id.",
        parameters: { type: "object", properties: {
          title: { type: "string" },
          due: { type: "string", description: "YYYY-MM-DD" },
          priority: { type: "string", description: "low|normal|high" }
        }, required: ["title"] }
      },
      {
        name: "complete_task",
        description: "Mark a task as done by id or title fragment.",
        parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
      }
    ];
    if (this.mcp) {
      for (const { serverId, tool } of this.mcp.allTools()) {
        tools.push({
          name: `mcp_${serverId}_${tool.name}`,
          description: `[${serverId}] ${tool.description}`,
          parameters: tool.inputSchema
        });
      }
    }
    return tools;
  }
  async execTool(name, args) {
    if (name === "save_memory") {
      const title = String(args.title ?? "note");
      const content = String(args.content ?? "");
      let kind = "note";
      const verdict = await this.laya?.choose(
        `${title}

${content.slice(0, 1500)}`,
        "What kind of long-term memory is this?",
        {
          fact: "a durable fact, preference, or piece of knowledge about the user or their work",
          lesson: "a lesson learned — something that went wrong and what to do differently",
          skill: 'a reusable procedure or skill — "how we do X"',
          decision: "a decision that was made and its rationale",
          note: "anything else worth keeping"
        }
      ).catch(() => null);
      if (verdict && verdict.confidence > 0.4) kind = verdict.choice;
      const file = kind === "note" ? `long-term/notes/${slug$1(title)}.md` : `long-term/${kind}s.md`;
      this.memory.append(file, `

## ${title}

${content}
`);
      return `Saved to memory/${file} (long-term · classified as ${kind})`;
    }
    if (name === "get_memory") {
      const c = this.memory.read(String(args.path ?? ""));
      return c ?? "Not found";
    }
    if (name === "list_tasks") {
      const status = String(args.status ?? "open").toLowerCase();
      const tasks = this.readTasks().filter((t) => status === "all" || t.status === status);
      if (!tasks.length) return status === "open" ? "No open tasks." : `No ${status} tasks.`;
      return tasks.map(
        (t) => `- [${t.status === "done" ? "x" : " "}] ${t.id} · ${t.title}${t.due ? ` · due ${t.due}` : ""}${t.priority !== "normal" ? ` · ${t.priority}` : ""}`
      ).join("\n");
    }
    if (name === "add_task") {
      const title = String(args.title ?? "").trim();
      if (!title) return "Task title required";
      const id = `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "")}-${slug$1(title)}-${Math.random().toString(36).slice(2, 6)}`;
      const priority = ["low", "normal", "high"].includes(String(args.priority)) ? String(args.priority) : "normal";
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(args.due ?? "")) ? String(args.due) : "";
      this.memory.write(
        `tasks/${id}.md`,
        `# ${title}
> status: open · priority: ${priority}${due ? ` · due: ${due}` : ""} · created: ${(/* @__PURE__ */ new Date()).toISOString()}

`
      );
      return `Task created: ${id} — "${title}"${due ? ` (due ${due})` : ""}`;
    }
    if (name === "complete_task") {
      const want = String(args.id ?? "").toLowerCase();
      const task = this.readTasks().find((t) => t.id === want || t.title.toLowerCase().includes(want));
      if (!task) return `No task matching "${args.id}"`;
      const p = `tasks/${task.file}`;
      const c = this.memory.read(p) ?? "";
      this.memory.write(p, c.replace(/status:\s*open/i, "status: done"));
      return `Completed: ${task.title}`;
    }
    if (name.startsWith("mcp_") && this.mcp) {
      const rest = name.slice(4);
      const serverId = rest.split("_")[0];
      const toolName = rest.slice(serverId.length + 1);
      return this.mcp.callTool(serverId, toolName, args);
    }
    return `Unknown tool: ${name}`;
  }
  async chat(agentId, userMessage, onDelta) {
    await this.ensureProviderReady();
    await this.gitSync?.pullIfDue().catch(() => {
    });
    const recall = await this.rag?.search(userMessage).catch(() => "") ?? "";
    const cfg = this.store.get();
    const agent = cfg.agents.find((a) => a.id === agentId) ?? cfg.agents[0];
    const messages = [
      { role: "system", content: this.buildSystemContext(agent, recall) },
      { role: "user", content: userMessage }
    ];
    const tools = this.toolDefinitions();
    let finalText = "";
    for (let round = 0; round < 6; round++) {
      const res = await chat(cfg.ai, messages, tools, this.localLlm?.endpoint);
      finalText = res.text;
      if (!res.toolCalls?.length) break;
      messages.push({ role: "assistant", content: res.text || "(tool calls)" });
      for (const tc of res.toolCalls) {
        const result = await this.execTool(tc.name, tc.arguments);
        messages.push({ role: "tool", name: tc.name, content: result });
      }
    }
    if (onDelta) {
      const words = finalText.split(/(\s+)/);
      for (const w of words) {
        onDelta(w);
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    this.memory.append(`short-term/${day}.md`, `

## ${(/* @__PURE__ */ new Date()).toLocaleTimeString()} — ${agent.name}

**You:** ${userMessage}

**${agent.name}:** ${finalText}
`);
    return finalText;
  }
  async streamChat(agentId, userMessage) {
    return this.chat(agentId, userMessage);
  }
  // Deterministic insight engine — no LLM tokens. Surfaces real signals:
  // overdue/due tasks, stale notes, search gaps, pending approvals,
  // activity stats. Facts beat hallucinated fluff for a memory product.
  scriptedInsights() {
    const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const lines = [];
    const open = [];
    for (const f of this.memory.list("tasks")) {
      const c = this.memory.read(`tasks/${f}`) ?? "";
      const title = c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace(".md", "");
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? "";
      if (/status:\s*done/i.test(meta)) continue;
      const due = meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
      const priority = meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase();
      open.push({ title, due, priority });
    }
    const overdue = open.filter((t) => t.due && t.due < today2);
    const dueToday = open.filter((t) => t.due === today2);
    if (overdue.length) lines.push(`⏰ ${overdue.length} task(s) overdue — oldest: "${overdue.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))[0].title}"`);
    if (dueToday.length) lines.push(`📌 ${dueToday.length} task(s) due today`);
    const highOpen = open.filter((t) => t.priority === "high" && (!t.due || t.due >= today2));
    if (highOpen.length) lines.push(`🔥 ${highOpen.length} high-priority task(s) still open`);
    let stale = 0;
    for (const dir of ["notes", "entities"]) {
      for (const f of this.memory.list(dir)) {
        const c = this.memory.read(`${dir}/${f}`) ?? "";
        const fm = c.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
        const exp = fm.match(/(?:valido_ate|expires|review_after|stale_after|valid_until):\s*['"]?(\d{4}-\d{2}-\d{2})/i)?.[1];
        if (exp && exp < today2) stale++;
      }
    }
    if (stale) lines.push(`🕸️ ${stale} note(s) past their validity date — candidates for review or refresh`);
    const gaps = this.memory.read("ops/search-gaps.md") ?? "";
    const gapCount = (gaps.match(/^- /gm) ?? []).length;
    if (gapCount) lines.push(`🔍 ${gapCount} unanswered search(es) logged — the gap-review automation can fill them`);
    const pending = this.store.get().pendingApprovals.length;
    if (pending) lines.push(`⏳ ${pending} automation(s) waiting for your approval`);
    const act = this.memory.activity(500).filter((e) => new Date(e.ts).toISOString().slice(0, 10) === today2);
    if (act.length) {
      const byOp = act.reduce((m, e) => ({ ...m, [e.op]: (m[e.op] ?? 0) + 1 }), {});
      lines.push(`✍️ ${act.length} memory change(s) today (${Object.entries(byOp).map(([k, v]) => `${v} ${k}`).join(", ")})`);
    }
    const entities = this.memory.list("entities").length;
    if (entities) lines.push(`🕸️ Knowledge graph: ${entities} entity page(s) with backlinks`);
    if (!lines.length) lines.push("🌱 Quiet day — no urgent signals. The brain kept consolidating in the background.");
    return lines.slice(0, 6);
  }
  async generateInsights() {
    const lines = this.scriptedInsights();
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    this.memory.write(`insights/${day}.md`, `# Insights — ${day}

${lines.map((l) => `- ${l}`).join("\n")}
`);
    return lines;
  }
  // Deterministic daily summary — counts, due items, carry-over. No LLM.
  async dailySummary() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const today2 = this.memory.read(`short-term/${day}.md`) ?? this.memory.read(`inbox/${day}.md`) ?? "";
    const sections = (today2.match(/^##\s+.+$/gm) ?? []).length;
    const bullets = (today2.match(/^[-*]\s+/gm) ?? []).length;
    const out = [`# Daily summary — ${day}`, ""];
    if (today2.trim()) {
      out.push(`- Captured ${sections} section(s), ${bullets} bullet(s) of activity`);
      const heads = [...today2.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 5);
      if (heads.length) out.push(`- Topics: ${heads.join(" · ")}`);
    } else {
      out.push("- No short-term captures today");
    }
    const open = [];
    for (const f of this.memory.list("tasks")) {
      const c = this.memory.read(`tasks/${f}`) ?? "";
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? "";
      if (/status:\s*done/i.test(meta)) continue;
      open.push({
        title: c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace(".md", ""),
        due: meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1],
        priority: meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase()
      });
    }
    const next = open.filter((t) => !t.due || t.due >= day).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, 3);
    if (next.length) out.push(`- Next up: ${next.map((t) => `"${t.title}"${t.due ? ` (${t.due})` : ""}`).join(" · ")}`);
    const overdue = open.filter((t) => t.due && t.due < day).length;
    if (overdue) out.push(`- ⚠️ ${overdue} overdue task(s) still open`);
    const pending = this.store.get().pendingApprovals.length;
    if (pending) out.push(`- ⏳ ${pending} automation(s) awaiting approval`);
    const focus = next.find((t) => t.priority === "high") ?? next[0];
    out.push("", focus ? `**Suggested focus:** "${focus.title}"${focus.due ? ` — due ${focus.due}` : ""}.` : "**Suggested focus:** review open tasks in the planner.");
    const text = out.join("\n") + "\n";
    this.memory.write(`summaries/${day}.md`, text);
    return text;
  }
  // ── Sleep mode: nightly learning cycle ──
  // 1) Reads recent short-term memory + insights
  // 2) Answers the 5 learning questions and writes a sleep report
  // 3) Extracts durable facts / lessons / skills into long-term memory
  // 4) Consolidates old short-term logs into medium-term weekly files
  // 5) Syncs everything to the GitHub repo
  recentCorpus(maxChars = 2e4) {
    const parts = [];
    const short = this.memory.shortTermFiles().slice(-10);
    for (const f of short) {
      const c = this.memory.read(`short-term/${f}`);
      if (c) parts.push(`### ${f}
${c}`);
    }
    for (const f of this.memory.list("inbox").slice(-5)) {
      const c = this.memory.read(`inbox/${f}`);
      if (c) parts.push(`### inbox/${f}
${c}`);
    }
    const insights = this.memory.list("insights").slice(-5);
    for (const f of insights) {
      const c = this.memory.read(`insights/${f}`);
      if (c) parts.push(`### ${f}
${c}`);
    }
    const gaps = this.memory.read("ops/search-gaps.md");
    if (gaps) parts.push(`### ops/search-gaps.md (unanswered queries)
${gaps.slice(-3e3)}`);
    const corpus = parts.join("\n\n").slice(-maxChars);
    return corpus;
  }
  async sleep() {
    const cfg = this.store.get();
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const corpus = this.recentCorpus();
    if (!corpus.trim()) {
      const report2 = `# Sleep cycle — ${day}

No memory activity to process yet. The brain sleeps peacefully. 💤
`;
      this.memory.write(`sleep/${day}.md`, report2);
      return { report: report2, consolidated: 0 };
    }
    const res = await chat(cfg.ai, [
      {
        role: "system",
        content: `You are the nightly learning cycle of a personal second brain. Review the day's memory below and answer these five questions honestly and concretely:

1. What are we doing that IS WORKING? (double down on these)
2. What IS working but could be IMPROVED?
3. What is NOT working that we need to get BETTER at?
4. What is NOT working that we need to STOP doing entirely?
5. What are we NOT doing that we NEED to START doing?

Rules:
- Ground every point in actual evidence from the memory. No generic advice.
- Be specific: name the activity, the person/project/context, and the concrete next step.
- Write in the user's language, markdown, sections per question with "### 1. Working" ... "### 5. Start".
- End with "### Tonight's commitments" — 3 max concrete actions for tomorrow.`
      },
      { role: "user", content: `Memory to review:

${corpus}` }
    ], [], this.localLlm?.endpoint);
    const report = `# Sleep cycle — ${day}

_Generated ${(/* @__PURE__ */ new Date()).toISOString()}_

${res.text}
`;
    this.memory.write(`sleep/${day}.md`, report);
    try {
      const learn = await chat(cfg.ai, [
        {
          role: "system",
          content: `You consolidate a second brain's nightly learning into durable memory. From the sleep report below, extract THREE sections using EXACT markers:

===FACTS===
(durable facts, preferences, decisions, people, projects worth remembering forever — append-only bullet lines, no dates needed)

===LESSONS===
(mistakes and corrections worth never repeating — what failed and why)

===SKILLS===
(repeatable workflows/processes that worked and should be reused — "how we do X well")

Only include genuinely durable items. Skip anything ephemeral. If a section is empty write "(none)". Write in the user's language.`
        },
        { role: "user", content: report.slice(0, 16e3) }
      ], [], this.localLlm?.endpoint);
      const grab = (marker, next) => {
        const m = learn.text.match(new RegExp(`${marker}([\\s\\S]*?)(?:${next}|$)`));
        return m?.[1]?.trim() ?? "";
      };
      const appendIf = async (file, section, body) => {
        const clean = body.split("\n").filter((l) => l.trim() && l.trim() !== "(none)").join("\n");
        if (!clean) return;
        const existing = this.memory.read(`long-term/${file}`) ?? "";
        if (await this.isSemanticDuplicate(clean, existing)) {
          console.log(`[brain] sleep: skipped duplicate ${file} section`);
          return;
        }
        this.memory.append(`long-term/${file}`, `

## ${day}

${clean}
`);
      };
      await appendIf("facts.md", "", grab("===FACTS===", "===LESSONS==="));
      await appendIf("lessons.md", "", grab("===LESSONS===", "===SKILLS==="));
      await appendIf("skills.md", "", grab("===SKILLS===", "$"));
    } catch (e) {
      console.warn("[brain] sleep: long-term extraction failed:", e);
    }
    try {
      const n = await this.generateFlashcards();
      if (n) console.log(`[brain] sleep: ${n} flashcard(s) added`);
    } catch (e) {
      console.warn("[brain] flashcard generation failed:", e);
    }
    const consolidated = await this.consolidateShortTerm();
    try {
      const r = await refreshEntities(this.memory, this.entityCompleter());
      console.log(`[brain] entities refreshed: ${r.created} new, ${r.updated} updated, ${r.total} total`);
    } catch (e) {
      console.warn("[brain] entity refresh failed:", e);
    }
    try {
      if (this.gitSync) await this.gitSync.syncNow();
      else await this.memory.syncToGitHub(`sleep cycle ${day}`);
    } catch {
    }
    void this.rag?.reindex().catch(() => {
    });
    return { report: res.text, consolidated };
  }
  async consolidateShortTerm() {
    const cutoff = Date.now() - 7 * 864e5;
    const old = this.memory.shortTermFiles().filter((f) => {
      const t = Date.parse(`${f.replace(".md", "")}T00:00:00Z`);
      return !isNaN(t) && t < cutoff;
    });
    if (!old.length) return 0;
    const weeks = /* @__PURE__ */ new Map();
    for (const f of old) {
      const d = /* @__PURE__ */ new Date(`${f.replace(".md", "")}T00:00:00Z`);
      const week = isoWeek(d);
      if (!weeks.has(week)) weeks.set(week, []);
      weeks.get(week).push(f);
    }
    let consolidated = 0;
    for (const [week, files] of weeks) {
      const target = `medium-term/${week}.md`;
      if (this.memory.read(target)) {
        for (const f of files) this.memory.remove(`short-term/${f}`);
        consolidated += files.length;
        continue;
      }
      const parts = files.map((f) => {
        const day = f.replace(".md", "");
        const content = this.memory.read(`short-term/${f}`) ?? "";
        const stats = `${(content.match(/^##\s+/gm) ?? []).length} sections · ${(content.match(/^[-*]\s+/gm) ?? []).length} bullets · ${content.length} chars`;
        return `## ${day}

_${stats}_

${content.trim()}`;
      });
      this.memory.write(target, `# Week ${week}

${parts.join("\n\n")}
`);
      for (const f of files) this.memory.remove(`short-term/${f}`);
      consolidated += files.length;
    }
    return consolidated;
  }
  // Single-shot LLM completion used by the entity layer (descriptions).
  entityCompleter() {
    return async (prompt) => {
      const cfg = this.store.get();
      const res = await chat(cfg.ai, [
        { role: "system", content: "You extract structured data from text. Output only the requested lines — no commentary, no markdown." },
        { role: "user", content: prompt }
      ], [], this.localLlm?.endpoint);
      return res.text;
    };
  }
  // ── Librarian: weekly vault hygiene ──
  // Consolidates old logs, dedupes long-term memory, refreshes entities,
  // and writes a report. Runs as a scheduled automation (kind: 'librarian').
  dedupeLongTerm() {
    let removed = 0;
    for (const file of ["facts.md", "lessons.md", "skills.md"]) {
      const rel = `long-term/${file}`;
      const content = this.memory.read(rel);
      if (!content) continue;
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (/^[-*•]/.test(t) || /^\d+\./.test(t)) {
          const key = t.toLowerCase().replace(/\s+/g, " ");
          if (seen.has(key)) {
            removed++;
            continue;
          }
          seen.add(key);
        }
        out.push(line);
      }
      const next = out.join("\n");
      if (next !== content) this.memory.write(rel, next);
    }
    return removed;
  }
  async librarian() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const consolidated = await this.consolidateShortTerm();
    const deduped = this.dedupeLongTerm();
    let entities = { created: 0, updated: 0, total: 0 };
    try {
      entities = await refreshEntities(this.memory, this.entityCompleter());
    } catch (e) {
      console.warn("[brain] librarian: entity refresh failed:", e);
    }
    try {
      if (this.gitSync) await this.gitSync.syncNow();
    } catch {
    }
    const report = [
      `# Librarian — ${day}`,
      "",
      `- consolidated ${consolidated} short-term log(s) into medium-term`,
      `- removed ${deduped} duplicate long-term line(s)`,
      `- entities: ${entities.created} new, ${entities.updated} updated (${entities.total} total)`,
      ""
    ].join("\n");
    this.memory.write(`insights/librarian-${day}.md`, report);
    return report;
  }
  // ── Evolve: meta-learning cycle ──
  // Reviews the brain's OWN outputs (sleep reports, insights, librarian runs)
  // and asks the LLM how the memory system itself should improve: which
  // questions to ask at night, which files to consolidate, which entities
  // need pages, which automations to add/remove. Writes an evolution report
  // and appends durable proposals to long-term/evolution.md.
  async evolve() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const stats = this.memoryTierStats();
    const corpusParts = [`Memory stats: ${JSON.stringify(stats)}`];
    for (const r of this.memory.list("sleep").sort().slice(-5)) {
      const c = this.memory.read(`sleep/${r}`);
      if (c) corpusParts.push(`### sleep/${r}
${c.slice(0, 3e3)}`);
    }
    for (const f of this.memory.list("insights").sort().slice(-5)) {
      const c = this.memory.read(`insights/${f}`);
      if (c) corpusParts.push(`### insights/${f}
${c.slice(0, 2e3)}`);
    }
    const gaps = this.memory.read("ops/search-gaps.md");
    if (gaps) corpusParts.push(`### unanswered queries (knowledge gaps)
${gaps.slice(-3e3)}`);
    const prior = this.memory.read("long-term/evolution.md");
    if (prior) corpusParts.push(`### prior evolution proposals
${prior.slice(-4e3)}`);
    const corpus = corpusParts.join("\n\n").slice(-24e3);
    const res = await chat(this.store.get().ai, [
      {
        role: "system",
        content: `You are the self-improvement loop of a personal knowledge system called KeepMind. You do NOT review the user's day — you review the SYSTEM itself. From the sleep reports, insights and stats below, propose concrete upgrades to how the brain learns:

1. **Sleep questions** — are the 5 nightly questions surfacing the right signal? What's missing?
2. **Memory structure** — which tiers/files are bloated, empty, or need splitting?
3. **Entities** — which recurring themes lack a page? Which pages are stale?
4. **Automations** — which routines should run more/less often, or new ones to add?
5. **Retrieval** — what keeps getting re-asked that memory fails to surface?

Rules: ground every proposal in evidence from the reports. Be concrete and skeptical — kill weak proposals. Write in the user's language, markdown, max ~500 words.`
      },
      { role: "user", content: corpus }
    ], [], this.localLlm?.endpoint);
    const report = `# Evolution — ${day}

_Generated ${(/* @__PURE__ */ new Date()).toISOString()} · stats: ${JSON.stringify(stats)}_

${res.text}
`;
    this.memory.write(`insights/evolution-${day}.md`, report);
    this.memory.append("long-term/evolution.md", `

## ${day}

${res.text}
`);
    try {
      if (this.gitSync) await this.gitSync.syncNow();
      else await this.memory.syncToGitHub(`evolution ${day}`);
    } catch {
    }
    void this.rag?.reindex().catch(() => {
    });
    return res.text;
  }
  // ── Enrich: note intelligence pass ──
  // Enriches recent notes missing frontmatter — summary, topic tags and
  // [[wikilinks]] to known entities, written as YAML frontmatter at the
  // top of the note (never rewrites user content).
  // Deterministic enrichment — extracts frontmatter with plain parsing,
  // no LLM tokens. Summary = first prose paragraph; tags/links = entity
  // matches + wikilinks found in the text.
  enrichNote(rel, entityNames) {
    const content = this.memory.read(rel) ?? "";
    if (!content.trim()) return false;
    if (/^---\n[\s\S]*?enriched:/m.test(content) || content.includes("## Enrichment")) return false;
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/```[\s\S]*?```/g, " ").replace(/^#{1,6}\s+.+$/gm, " ").replace(/^>\s.*$/gm, " ").replace(/[#>*_`\-[\]|]/g, " ").replace(/\s+/g, " ").trim();
    const summary = body.split(/(?<=[.!?])\s/)[0]?.slice(0, 220).trim() ?? "";
    const mentioned = entityNames.filter((n) => n.length > 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(content));
    const wikilinks = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim());
    const links = [.../* @__PURE__ */ new Set([...mentioned, ...wikilinks])].slice(0, 8);
    const fileTags = rel.replace(/^notes\//, "").replace(/\.md$/, "").toLowerCase().split(/[-_\s]+/).filter((w) => w.length > 2);
    const tags = [.../* @__PURE__ */ new Set([...mentioned.map((n) => n.toLowerCase()), ...fileTags])].slice(0, 6);
    if (!summary && !tags.length) return false;
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fmLines = ["---", `enriched: ${day}`];
    if (summary) fmLines.push(`summary: ${JSON.stringify(summary)}`);
    if (tags.length) fmLines.push(`tags: ${tags.join(", ")}`);
    if (links.length) fmLines.push(`links: ${links.map((l) => `[[${l}]]`).join(", ")}`);
    fmLines.push("---", "");
    const fm = fmLines.join("\n");
    const existing = content.match(/^---\n[\s\S]*?\n---\n?/);
    const next = existing ? fm + content.slice(existing[0].length) : fm + content;
    this.memory.write(rel, next);
    return true;
  }
  async enrich() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const notes = this.memory.list("notes").sort().slice(-30);
    const entityIndex = this.memory.read("entities/index.md") ?? "";
    const entityNames = [...entityIndex.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim()).slice(0, 80);
    let enriched = 0;
    const lines = [];
    for (const f of notes) {
      if (this.enrichNote(`notes/${f}`, entityNames)) {
        enriched++;
        lines.push(`- \`${f}\` — enriched`);
      }
    }
    const report = [
      `# Note enrichment — ${day}`,
      "",
      `Enriched ${enriched} note(s).`,
      ...lines,
      ""
    ].join("\n");
    this.memory.write(`insights/enrich-${day}.md`, report);
    try {
      if (this.gitSync) await this.gitSync.syncNow();
    } catch {
    }
    void this.rag?.reindex().catch(() => {
    });
    return { enriched, report };
  }
  // ── Spaced repetition: flashcards + review sessions ──
  // Sleep distills durable learnings into Q/A cards in review/cards.md.
  // The 'review' automation quizzes the brain against them nightly.
  async generateFlashcards() {
    const src = ["facts.md", "lessons.md", "skills.md"].map((f) => this.memory.read(`long-term/${f}`) ?? "").join("\n").slice(-12e3);
    if (src.trim().length < 200) return 0;
    const res = await chat(this.store.get().ai, [
      {
        role: "system",
        content: `You create spaced-repetition flashcards from a knowledge base's durable learnings. Output UP TO 6 cards, each in EXACTLY this format:

Q: <question that tests recall of one specific fact/lesson/skill>
A: <one-line answer>

Rules: only cards with real retrieval value (decisions, procedures, corrections, preferences). Skip trivia. No numbering, no commentary, no markdown.`
      },
      { role: "user", content: src }
    ], [], this.localLlm?.endpoint);
    const cards = [...res.text.matchAll(/^Q:\s*(.+)\nA:\s*(.+)$/gm)].map((m) => ({ q: m[1].trim(), a: m[2].trim() })).filter((c) => c.q.length > 10 && c.a.length > 3);
    if (!cards.length) return 0;
    const existing = this.memory.read("review/cards.md") ?? "";
    const seen = new Set([...existing.matchAll(/^Q:\s*(.+)$/gm)].map((m) => m[1].trim().toLowerCase()));
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const fresh = cards.filter((c) => !seen.has(c.q.toLowerCase())).slice(0, 6);
    if (!fresh.length) return 0;
    const block = `
### ${day}

` + fresh.map((c) => `Q: ${c.q}
A: ${c.a}`).join("\n\n") + "\n";
    this.memory.append("review/cards.md", block);
    return fresh.length;
  }
  // Review session: sample cards, ask the LLM to answer blind, then grade.
  async review() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const raw = this.memory.read("review/cards.md") ?? "";
    const cards = [...raw.matchAll(/^Q:\s*(.+)\nA:\s*(.+)$/gm)].map((m) => ({ q: m[1].trim(), a: m[2].trim() })).filter((c) => c.q && c.a);
    if (!cards.length) {
      const msg = "# Review — no flashcards yet\n\nRun a sleep cycle first — it generates cards from long-term learnings.\n";
      this.memory.write(`review/session-${day}.md`, msg);
      return msg;
    }
    const sample = cards.sort(() => Math.random() - 0.5).slice(0, 8);
    const questions = sample.map((c, i) => `${i + 1}. ${c.q}`).join("\n");
    const answers = await chat(this.store.get().ai, [
      {
        role: "system",
        content: `You are taking a closed-book quiz on your own knowledge base. Answer each numbered question from memory — concise, one line each, format "N. answer". If unsure, say "don't know" honestly.`
      },
      { role: "user", content: questions }
    ], [], this.localLlm?.endpoint);
    const grade = await chat(this.store.get().ai, [
      {
        role: "system",
        content: `Grade a quiz. For each question show: the model's answer, the correct answer, and PASS/FAIL (PASS = same fact, wording may differ). End with "Score: N/M". Be strict but fair.`
      },
      {
        role: "user",
        content: `QUESTIONS:
${questions}

MODEL ANSWERS:
${answers.text}

CORRECT ANSWERS:
${sample.map((c, i) => `${i + 1}. ${c.a}`).join("\n")}`
      }
    ], [], this.localLlm?.endpoint);
    const report = [
      `# Review session — ${day}`,
      `_${sample.length} cards sampled from ${cards.length} total_`,
      "",
      "## Questions",
      "",
      questions,
      "",
      "## Model answers (blind)",
      "",
      answers.text,
      "",
      "## Grading",
      "",
      grade.text,
      ""
    ].join("\n");
    this.memory.write(`review/session-${day}.md`, report);
    try {
      if (this.gitSync) await this.gitSync.syncNow();
    } catch {
    }
    void this.rag?.reindex().catch(() => {
    });
    return report;
  }
  // ── Security audit: scan memory for leaked secrets ──
  // Deterministic pattern scan (no LLM needed) — reports file+line but
  // NEVER prints the secret value itself.
  async securityAudit() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const PATTERNS = SECRET_PATTERNS;
    const hits = [];
    for (const rel of this.memory.allRelFiles()) {
      const content = this.memory.read(rel);
      if (!content) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const [label, re] of PATTERNS) {
          re.lastIndex = 0;
          if (re.test(lines[i])) {
            hits.push(`- \`${rel}:${i + 1}\` — ${label}`);
            break;
          }
        }
      }
    }
    const report = hits.length ? [`# Security audit — ${day}`, "", `⚠️ **${hits.length} potential secret(s) found in memory:**`, "", ...hits.slice(0, 100), "", "_Values redacted — review and rotate/remove the exposed credentials._", ""] : [`# Security audit — ${day}`, "", "✅ No secret patterns detected in memory files.", ""];
    const text = report.join("\n");
    this.memory.write(`insights/security-${day}.md`, text);
    return text;
  }
  // ── Skills evolution: review + consolidate procedural memory ──
  // Reviews long-term/skills.md and skills/*.md: dedupes, asks the LLM to
  // consolidate, and appends a dated review section with proposals.
  // Never deletes — everything becomes a reviewable proposal.
  async evolveSkills() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const skillsMd = this.memory.read("long-term/skills.md") ?? "";
    const skillFiles = this.memory.list("skills").sort();
    const skillDocs = skillFiles.map((f) => `### skills/${f}
${(this.memory.read(`skills/${f}`) ?? "").slice(0, 3e3)}`);
    if (!skillsMd.trim() && !skillDocs.length) {
      const msg = "# Skills evolution — nothing to review yet\n\nNo skills recorded. They accumulate from sleep cycles and `sb_remember kind=skill`.\n";
      this.memory.write(`insights/skills-${day}.md`, msg);
      return msg;
    }
    let deduped = 0;
    if (skillsMd.trim()) {
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      for (const line of skillsMd.split("\n")) {
        const t = line.trim();
        if (/^[-*•]/.test(t) || /^\d+\./.test(t)) {
          const key = t.toLowerCase().replace(/\s+/g, " ");
          if (seen.has(key)) {
            deduped++;
            continue;
          }
          seen.add(key);
        }
        out.push(line);
      }
      const next = out.join("\n");
      if (next !== skillsMd) this.memory.write("long-term/skills.md", next);
    }
    const corpus = [
      skillsMd.slice(-8e3),
      ...skillDocs.slice(-10)
    ].join("\n\n").slice(-2e4);
    const res = await chat(this.store.get().ai, [
      {
        role: "system",
        content: `You are the skills curator of a personal knowledge system. Review the procedural skills below and output a consolidation report:

1. **Merge** — skills that are duplicates or should be one procedure
2. **Prune** — skills that are stale, wrong, or superseded (say why)
3. **Promote** — skills proven useful ≥2 times that deserve a dedicated page in skills/
4. **Gap** — recurring tasks with NO skill yet that should get one

Rules: be skeptical — fewer, sharper skills beat many vague ones. Ground every call in the text. Markdown, user's language, max ~400 words.`
      },
      { role: "user", content: corpus }
    ], [], this.localLlm?.endpoint);
    const report = [
      `# Skills evolution — ${day}`,
      `_${deduped} duplicate bullet(s) removed from skills.md · ${skillFiles.length} skill page(s)_`,
      "",
      res.text,
      ""
    ].join("\n");
    this.memory.write(`insights/skills-${day}.md`, report);
    this.memory.append("long-term/skills.md", `

## Evolution review ${day}

${res.text}
`);
    try {
      if (this.gitSync) await this.gitSync.syncNow();
    } catch {
    }
    void this.rag?.reindex().catch(() => {
    });
    return report;
  }
  // ── Fast inbox triage (Laya System-1) ──
  // Splits untriaged inbox captures into blocks, classifies each with a
  // ~33ms local decision (no LLM), routes to the right memory dir, and
  // dedupes long-term writes semantically. Fully autonomous and cheap.
  async triageInbox() {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (!this.laya?.status().available) {
      const msg = "# Inbox triage — skipped\n\nLaya decision engine not installed (Settings → Decision engine).\n";
      this.memory.write(`insights/triage-${day}.md`, msg);
      return msg;
    }
    const processed = new Set(
      (this.memory.read("ops/triaged-files.txt") ?? "").split("\n").map((s) => s.trim()).filter(Boolean)
    );
    const pending = this.memory.list("inbox").filter((f) => !processed.has(f)).sort();
    if (!pending.length) {
      const msg = "# Inbox triage — nothing new\n\nAll inbox files already triaged.\n";
      this.memory.write(`insights/triage-${day}.md`, msg);
      return msg;
    }
    const DESTINATIONS = {
      note: "a note worth keeping — reference material, ideas, reading",
      task: "an action item or to-do for the user",
      fact: "a durable fact, preference or knowledge worth long-term memory",
      lesson: "a mistake or correction — what to do differently",
      skill: "a reusable procedure — how to do X well",
      decision: "a decision that was made, with its rationale",
      crm: "information about a person, company or relationship",
      discard: "noise, ephemeral chatter, or duplicates — not worth keeping"
    };
    const routed = {};
    const report = [`# Inbox triage — ${day}`, "", `_${pending.length} file(s) processed · Laya fast decisions_`, ""];
    let blocksSeen = 0, kept = 0, dropped = 0, dups = 0;
    for (const file of pending.slice(0, 10)) {
      const content = this.memory.read(`inbox/${file}`) ?? "";
      if (!content.trim()) {
        processed.add(file);
        continue;
      }
      const blocks = splitBlocks(content).slice(0, 30);
      for (const block of blocks) {
        if (blocksSeen++ >= 60) break;
        const text2 = block.replace(/\s+/g, " ").trim().slice(0, 800);
        if (text2.length < 25) continue;
        const verdict = await this.laya.choose(
          text2,
          "Where should this captured memory go in a second brain?",
          DESTINATIONS
        ).catch(() => null);
        const dest = verdict && verdict.confidence > 0.35 ? verdict.choice : "note";
        if (dest === "discard") {
          dropped++;
          continue;
        }
        if (["fact", "lesson", "skill", "decision"].includes(dest)) {
          const existing = this.memory.read(`long-term/${dest}s.md`)?.slice(-4e3) ?? "";
          if (existing) {
            const p = await this.laya.yesNo(
              `New item: ${text2}

Existing memory:
${existing}`,
              "Is the new item already captured by the existing memory?"
            ).catch(() => null);
            if (p != null && p > 0.72) {
              dups++;
              continue;
            }
          }
        }
        (routed[dest] ??= []).push(text2);
        kept++;
      }
      processed.add(file);
      report.push(`- \`inbox/${file}\` → triaged`);
    }
    const prov = `> source: inbox triage ${day}

`;
    for (const [dest, items] of Object.entries(routed)) {
      if (dest === "task") {
        for (const [i, t] of items.entries()) {
          const title = t.split(/[.\n]/)[0].slice(0, 80) || "triage item";
          const id = `${day.replace(/-/g, "")}-triage-${i}-${Math.random().toString(36).slice(2, 5)}`;
          this.memory.write(
            `tasks/${id}.md`,
            `# ${title}
> status: open · priority: normal · created: ${(/* @__PURE__ */ new Date()).toISOString()}

${prov}${t}
`
          );
        }
      } else if (dest === "note") {
        this.memory.append(
          `notes/triage-${day}.md`,
          items.map((t) => `## ${t.split(/[.\n]/)[0].slice(0, 70)}

${prov}${t}
`).join("\n")
        );
      } else if (dest === "crm") {
        this.memory.append(
          `crm/interactions/triage-${day}.md`,
          `
## ${day}

` + items.map((t) => `- ${t}`).join("\n") + "\n"
        );
      } else {
        this.memory.append(
          `long-term/${dest}s.md`,
          `

## ${day} (inbox triage)

` + items.map((t) => `- ${t}`).join("\n") + "\n"
        );
      }
    }
    report.push("", `- ${blocksSeen} block(s) seen · ${kept} kept · ${dropped} discarded · ${dups} semantic duplicates skipped`);
    const text = report.join("\n") + "\n";
    this.memory.write(`insights/triage-${day}.md`, text);
    this.memory.write("ops/triaged-files.txt", [...processed].sort().join("\n") + "\n");
    try {
      if (this.gitSync) await this.gitSync.syncNow();
    } catch {
    }
    void this.rag?.reindex().catch(() => {
    });
    return text;
  }
  // Semantic dedup gate: is `candidate` already captured in `existing`?
  // Used by sleep extraction and anywhere durable writes need a cheap check.
  async isSemanticDuplicate(candidate, existing) {
    if (!this.laya?.status().available || !existing.trim()) return false;
    const p = await this.laya.yesNo(
      `New item: ${candidate.slice(0, 600)}

Existing memory:
${existing.slice(-4e3)}`,
      "Is the new item already captured by the existing memory?"
    ).catch(() => null);
    return p != null && p > 0.72;
  }
  listSleepReports() {
    return this.memory.list("sleep").sort().reverse().map((f) => ({
      date: f.replace(".md", ""),
      content: this.memory.read(`sleep/${f}`) ?? ""
    }));
  }
  memoryTierStats() {
    return {
      shortTerm: this.memory.shortTermFiles().length,
      mediumTerm: this.memory.mediumTermFiles().length,
      longTerm: this.memory.countFiles("long-term"),
      sleepCycles: this.memory.list("sleep").length
    };
  }
  listInsights() {
    return this.memory.list("insights").sort().reverse().map((f) => ({
      date: f.replace(".md", ""),
      content: this.memory.read(`insights/${f}`) ?? ""
    }));
  }
  listSummaries() {
    return this.memory.list("summaries").sort().reverse().map((f) => ({
      date: f.replace(".md", ""),
      content: this.memory.read(`summaries/${f}`) ?? ""
    }));
  }
  readMemoryFile(rel) {
    try {
      return this.memory.read(rel);
    } catch {
      return null;
    }
  }
  // Planner tasks live in tasks/*.md — same meta-line format Planner writes.
  readTasks() {
    return this.memory.list("tasks").map((f) => {
      const c = this.memory.read(`tasks/${f}`) ?? "";
      const meta = c.match(/^>\s*(.+)$/m)?.[1] ?? "";
      return {
        file: f,
        id: f.replace(/\.md$/, ""),
        title: c.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace(/\.md$/, ""),
        status: /status:\s*done/i.test(meta) ? "done" : "open",
        priority: meta.match(/priority:\s*(\w+)/i)?.[1]?.toLowerCase() ?? "normal",
        due: meta.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? ""
      };
    });
  }
  // One-time import triage: extract markdown checkboxes `- [ ] …` from the
  // whole vault into planner tasks. Deduped by normalized text; runs once
  // (marker in ops/) after a whole-vault import.
  async triageVaultTasks() {
    const marker = "ops/vault-tasks-triaged.md";
    if (this.memory.read(marker)) return { skipped: true };
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    const cbRe = /^\s*[-*+]\s+\[ \]\s+(.{3,200}?)\s*$/gm;
    for (const f of this.memory.allRelFiles()) {
      if (!f.endsWith(".md")) continue;
      const segs = f.split("/");
      if (segs[0] === "tasks" || segs[0] === "ops" || segs.slice(0, -1).some((s) => s.startsWith("."))) continue;
      const c = this.memory.read(f);
      if (!c) continue;
      for (const m of c.matchAll(cbRe)) {
        const title = m[1].replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, "$1").trim();
        const key = title.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ title, src: f });
        if (out.length >= 400) break;
      }
      if (out.length >= 400) break;
    }
    for (const t of out) {
      const id = `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "")}-${slug$1(t.title)}-${Math.random().toString(36).slice(2, 6)}`;
      this.memory.write(
        `tasks/${id}.md`,
        `# ${t.title}
> status: open · priority: normal · created: ${(/* @__PURE__ */ new Date()).toISOString()}

_source: ${t.src}_
`
      );
    }
    this.memory.quietWrite(marker, `# Vault task triage

_imported ${out.length} open checkbox items from vault markdown on ${(/* @__PURE__ */ new Date()).toISOString()}_
`);
    return { imported: out.length };
  }
  // Wikilink graph of the whole vault — powers the 3D neural view.
  // Cached for 60s: scanning ~10k files is too slow per frame.
  graphCache = null;
  memoryGraph() {
    if (this.graphCache && Date.now() - this.graphCache.at < 6e4) return this.graphCache.data;
    const files = this.memory.allRelFiles().filter((f) => f.endsWith(".md") && !f.split("/").slice(0, -1).some((s) => s.startsWith(".")));
    const idOf = (f) => f.replace(/\.md$/, "");
    const byBase = /* @__PURE__ */ new Map();
    const nodes = /* @__PURE__ */ new Map();
    for (const f of files) {
      const id = idOf(f);
      const base = f.split("/").pop().replace(/\.md$/, "");
      byBase.set(base.toLowerCase(), id);
      nodes.set(id, { id, label: base, dir: f.split("/")[0] ?? "", links: 0 });
    }
    const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\]\(([^)\s]+?\.md)(?:#[^)\s]*)?[^)]*\)/g;
    const edgeSet = /* @__PURE__ */ new Set();
    for (const f of files) {
      const src = idOf(f);
      const content = this.memory.read(f);
      if (!content) continue;
      const dir = f.split("/").slice(0, -1).join("/");
      for (const m of content.matchAll(linkRe)) {
        let target = (m[1] ?? m[2] ?? "").split("#")[0];
        try {
          target = decodeURIComponent(target);
        } catch {
        }
        target = target.replace(/\.md$/, "").replace(/^\.\//, "");
        if (!target) continue;
        let tid;
        if (nodes.has(target)) tid = target;
        else {
          const base = target.split("/").pop().toLowerCase();
          tid = byBase.get(base);
          if (!tid && dir) {
            const rel = `${dir}/${target}`;
            if (nodes.has(rel)) tid = rel;
          }
        }
        if (tid && tid !== src && nodes.has(tid)) {
          edgeSet.add(`${src}→${tid}`);
          const n = nodes.get(src);
          n.links++;
        }
      }
    }
    let nodeList = [...nodes.values()];
    if (nodeList.length > 3e3) {
      nodeList = nodeList.sort((a, b) => b.links - a.links).slice(0, 3e3);
    }
    const keep = new Set(nodeList.map((n) => n.id));
    const links = [...edgeSet].map((e) => e.split("→")).filter(([s, t]) => keep.has(s) && keep.has(t)).map(([s, t]) => [s, t]);
    const data = { nodes: nodeList, links, totalFiles: files.length };
    this.graphCache = { at: Date.now(), data };
    return data;
  }
}
function slug$1(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "note";
}
function splitBlocks(content) {
  const raw = content.split(/\n{2,}|(?<=\n)(?=- |• |\* |\d+\. )/).map((s) => s.trim()).filter((s) => s.length > 10);
  const out = [];
  let buf = "";
  for (const b of raw) {
    if (buf && (buf.length + b.length > 1100 || b.length < 40)) {
      out.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}
${b}` : b;
    if (buf.length > 1100) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
class McpClient extends node_events.EventEmitter {
  proc = null;
  buffer = "";
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  tools = [];
  serverId;
  constructor(serverId) {
    super();
    this.serverId = serverId;
  }
  async start(cfg) {
    if (!cfg.command) throw new Error(`MCP server ${cfg.id} has no command`);
    const args = cfg.args ?? [];
    this.proc = node_child_process.spawn(cfg.command, args, {
      env: { ...process.env, ...cfg.env ?? {} },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.proc.stdout.on("data", (chunk) => this.onData(chunk.toString()));
    this.proc.stderr.on("data", (d) => this.emit("log", `[${cfg.name}] ${d.toString().trim()}`));
    this.proc.on("exit", (code) => {
      this.emit("exit", code);
      this.rejectAll(new Error(`MCP server exited (${code})`));
    });
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "keepmind", version: "0.1.0" }
    });
    this.notify("notifications/initialized");
    const list = await this.request("tools/list", {});
    this.tools = (list?.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} }
    }));
    this.emit("ready", this.tools);
  }
  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== void 0 && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        } else if (msg.method) {
          this.emit("notification", msg);
        }
      } catch {
      }
    }
  }
  send(msg) {
    if (!this.proc?.stdin?.writable) throw new Error("MCP server not running");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }
  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  rejectAll(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
  listTools() {
    return this.tools;
  }
  async callTool(name, args) {
    const res = await this.request("tools/call", { name, arguments: args });
    const content = res?.content ?? [];
    return content.map((c) => c.text ?? JSON.stringify(c)).join("\n");
  }
  async stop() {
    try {
      this.proc?.kill("SIGTERM");
    } catch {
    }
    this.proc = null;
    this.rejectAll(new Error("stopped"));
  }
}
class McpManager extends node_events.EventEmitter {
  clients = /* @__PURE__ */ new Map();
  configs;
  sessionDir;
  constructor(configs, userDataDir) {
    super();
    this.configs = configs;
    this.sessionDir = node_path.join(userDataDir, "mcp-sessions");
    node_fs.mkdirSync(this.sessionDir, { recursive: true });
  }
  resolveCommand(cfg) {
    if (cfg.kind === "whatsapp" && !cfg.command) {
      const bundled = node_path.join(__dirname, "mcp", "whatsapp-server.js");
      return {
        ...cfg,
        command: process.execPath,
        args: [bundled],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          WA_SESSION_DIR: cfg.sessionDir ?? node_path.join(this.sessionDir, "whatsapp")
        }
      };
    }
    if (cfg.kind === "telegram" && !cfg.command) {
      const bundled = node_path.join(__dirname, "mcp", "telegram-server.js");
      return {
        ...cfg,
        command: process.execPath,
        args: [bundled],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          TG_SESSION_DIR: cfg.sessionDir ?? node_path.join(this.sessionDir, "telegram"),
          TELEGRAM_API_ID: cfg.env?.TELEGRAM_API_ID ?? "",
          TELEGRAM_API_HASH: cfg.env?.TELEGRAM_API_HASH ?? ""
        }
      };
    }
    if (cfg.kind === "postgres" && !cfg.command) {
      const dbUrl = cfg.env?.DATABASE_URL ?? "";
      return {
        ...cfg,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres", dbUrl]
      };
    }
    return cfg;
  }
  async startServer(cfg) {
    if (cfg.permission === "block") throw new Error(`connector "${cfg.name ?? cfg.id}" is blocked`);
    await this.stopServer(cfg.id);
    const resolved = this.resolveCommand(cfg);
    const client = new McpClient(cfg.id);
    client.on("log", (msg) => this.emit("log", { serverId: cfg.id, message: msg }));
    client.on("notification", (n) => this.emit("notification", { serverId: cfg.id, ...n }));
    client.on("exit", (code) => {
      this.clients.delete(cfg.id);
      this.emit("serverExit", { serverId: cfg.id, code });
    });
    await client.start(resolved);
    this.clients.set(cfg.id, client);
    return client.listTools();
  }
  async stopServer(id) {
    const c = this.clients.get(id);
    if (c) {
      await c.stop();
      this.clients.delete(id);
    }
  }
  async stopAll() {
    await Promise.all([...this.clients.keys()].map((id) => this.stopServer(id)));
  }
  getClient(id) {
    return this.clients.get(id);
  }
  get runningServers() {
    return [...this.clients.keys()];
  }
  // Aggregate all tools from running servers, prefixed with server id
  allTools() {
    const out = [];
    for (const [id, c] of this.clients) {
      for (const t of c.listTools()) out.push({ serverId: id, tool: t });
    }
    return out;
  }
  async callTool(serverId, name, args) {
    const c = this.clients.get(serverId);
    if (!c) throw new Error(`MCP server ${serverId} not running`);
    return c.callTool(name, args);
  }
}
const execFileP$1 = node_util.promisify(node_child_process.execFile);
const LOCAL_MODELS = [
  {
    id: "smollm2-1.7b",
    label: "SmolLM2 1.7B",
    sizeGB: 1.1,
    hfRepo: "HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF",
    hfFile: "smollm2-1_7b-instruct-q4_k_m.gguf",
    description: "Smallest option. Fast on any machine, good for chat and light tasks."
  },
  {
    id: "qwen2.5-3b",
    label: "Qwen2.5 3B",
    sizeGB: 2,
    hfRepo: "Qwen/Qwen2.5-3B-Instruct-GGUF",
    hfFile: "qwen2.5-3b-instruct-q4_k_m.gguf",
    description: "Recommended default. Strong multilingual + tool calling, ~8GB RAM."
  },
  {
    id: "llama3.2-3b",
    label: "Llama 3.2 3B",
    sizeGB: 2,
    hfRepo: "bartowski/Meta-Llama-3.2-3B-Instruct-GGUF",
    hfFile: "Meta-Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    description: "Meta's small model. Good reasoning for its size."
  },
  {
    id: "qwen2.5-7b",
    label: "Qwen2.5 7B",
    sizeGB: 4.7,
    hfRepo: "Qwen/Qwen2.5-7B-Instruct-GGUF",
    hfFile: "qwen2.5-7b-instruct-q4_k_m.gguf",
    description: "Best quality. Needs ~12GB RAM / Apple Silicon recommended."
  }
];
const LLAMA_CPP_TAG = "b5590";
const EMBED_MODELS = [
  {
    id: "bge-small",
    label: "BGE Small EN v1.5",
    sizeMB: 64,
    hfRepo: "CompendiumLabs/bge-small-en-v1.5-gguf",
    hfFile: "bge-small-en-v1.5-f16.gguf",
    dims: 384
  },
  {
    id: "nomic-embed",
    label: "Nomic Embed Text v1.5",
    sizeMB: 85,
    hfRepo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
    hfFile: "nomic-embed-text-v1.5.Q4_K_M.gguf",
    dims: 768
  }
];
function platformAsset() {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin" && a === "arm64") {
    return {
      os: "macos",
      arch: "arm64",
      name: "llama-server",
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-macos-arm64.zip`
    };
  }
  if (p === "darwin") {
    return {
      os: "macos",
      arch: "x64",
      name: "llama-server",
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-macos-x64.zip`
    };
  }
  if (p === "win32") {
    const arch2 = a === "arm64" ? "arm64" : "x64";
    return {
      os: "win32",
      arch: arch2,
      name: "llama-server.exe",
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-win-${arch2}.zip`
    };
  }
  const arch = a === "arm64" ? "arm64" : "x64";
  return {
    os: "linux",
    arch,
    name: "llama-server",
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/llama-${LLAMA_CPP_TAG}-bin-ubuntu-${arch}.zip`
  };
}
class LocalLlm {
  store;
  proc = null;
  embedProc = null;
  rootDir;
  modelsDir;
  binDir;
  constructor(store2) {
    this.store = store2;
    this.rootDir = node_path.join(electron.app.getPath("userData"), "local-llm");
    this.modelsDir = node_path.join(this.rootDir, "models");
    this.binDir = node_path.join(this.rootDir, "bin");
    node_fs.mkdirSync(this.modelsDir, { recursive: true });
    node_fs.mkdirSync(this.binDir, { recursive: true });
  }
  get cfg() {
    return this.store.get().localLlm;
  }
  get modelCatalog() {
    return LOCAL_MODELS;
  }
  getServerBinary() {
    const asset = platformAsset();
    const bin = node_path.join(this.binDir, asset.name);
    return node_fs.existsSync(bin) ? bin : "";
  }
  getModelPath(modelId) {
    const id = modelId ?? this.cfg.modelId ?? LOCAL_MODELS[1].id;
    return node_path.join(this.modelsDir, `${id}.gguf`);
  }
  isModelDownloaded(modelId) {
    const p = this.getModelPath(modelId);
    return node_fs.existsSync(p) && node_fs.statSync(p).size > 1e8;
  }
  isServerDownloaded() {
    return !!this.getServerBinary();
  }
  async downloadServer(onProgress) {
    const asset = platformAsset();
    const bin = node_path.join(this.binDir, asset.name);
    if (node_fs.existsSync(bin)) return bin;
    const zipPath = node_path.join(this.binDir, "llama-server.zip");
    await download(asset.url, zipPath, onProgress);
    if (process.platform === "win32") {
      await execFileP$1("powershell", [
        "-Command",
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${this.binDir}' -Force`
      ]);
    } else {
      await execFileP$1("unzip", ["-o", zipPath, "-d", this.binDir]);
    }
    const found = findBinary(this.binDir, asset.name);
    if (!found) throw new Error("llama-server binary not found after unzip");
    if (found !== bin) {
      const { renameSync, chmodSync } = await import("node:fs");
      renameSync(found, bin);
      chmodSync(bin, 493);
    }
    return bin;
  }
  async downloadModel(modelId, onProgress) {
    const model = LOCAL_MODELS.find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    const dest = this.getModelPath(modelId);
    if (node_fs.existsSync(dest) && node_fs.statSync(dest).size > 1e8) return dest;
    const url = `https://huggingface.co/${model.hfRepo}/resolve/main/${model.hfFile}`;
    await download(url, dest, (pct, dl, total) => onProgress?.(dl, total ?? model.sizeGB * 1e9));
    this.store.updateLocalLlm({ modelId });
    return dest;
  }
  async ensureReady(modelId) {
    if (!this.isServerDownloaded()) await this.downloadServer();
    if (!this.isModelDownloaded(modelId)) await this.downloadModel(modelId);
    return this.ensureRunning(modelId);
  }
  async ensureRunning(modelId) {
    const id = modelId ?? this.cfg.modelId ?? LOCAL_MODELS[1].id;
    const port = this.cfg.port ?? 8765;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
    }
    const bin = this.getServerBinary();
    const modelPath = this.getModelPath(id);
    if (!bin || !node_fs.existsSync(modelPath)) return false;
    this.proc = node_child_process.spawn(bin, [
      "-m",
      modelPath,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "-c",
      "8192",
      // context
      "-ngl",
      "99",
      // offload all layers to GPU if available
      "--jinja"
      // enables tool-call chat template support
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stdout?.on("data", (d) => console.log("[llama-server]", d.toString().trim()));
    this.proc.stderr?.on("data", (d) => console.log("[llama-server:err]", d.toString().trim()));
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1e3));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1e3) });
        if (res.ok) {
          this.store.updateLocalLlm({ modelId: id, port });
          return true;
        }
      } catch {
      }
      if (this.proc.killed) return false;
    }
    return false;
  }
  async stop() {
    try {
      this.proc?.kill("SIGTERM");
    } catch {
    }
    try {
      this.embedProc?.kill("SIGTERM");
    } catch {
    }
    this.proc = null;
    this.embedProc = null;
  }
  get isRunning() {
    return !!this.proc && !this.proc.killed;
  }
  get endpoint() {
    const port = this.cfg.port ?? 8765;
    return `http://127.0.0.1:${port}/v1`;
  }
  // ── Embeddings (semantic memory / RAG) ──
  get embedPort() {
    return 8766;
  }
  get embedEndpoint() {
    return `http://127.0.0.1:${this.embedPort}/v1`;
  }
  get embedModelId() {
    return this.cfg.embedModelId;
  }
  getEmbedModelPath(modelId) {
    const id = modelId ?? this.cfg.embedModelId ?? EMBED_MODELS[0].id;
    return node_path.join(this.modelsDir, `embed-${id}.gguf`);
  }
  isEmbedModelDownloaded(modelId) {
    const p = this.getEmbedModelPath(modelId);
    return node_fs.existsSync(p) && node_fs.statSync(p).size > 1e7;
  }
  async downloadEmbedModel(modelId, onProgress) {
    const model = EMBED_MODELS.find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown embedding model: ${modelId}`);
    const dest = this.getEmbedModelPath(modelId);
    if (node_fs.existsSync(dest) && node_fs.statSync(dest).size > 1e7) return dest;
    const url = `https://huggingface.co/${model.hfRepo}/resolve/main/${model.hfFile}`;
    await download(url, dest, (_pct, dl, total) => onProgress?.(dl, total ?? model.sizeMB * 1e6));
    this.store.updateLocalLlm({ embedModelId: modelId });
    return dest;
  }
  async ensureEmbedRunning() {
    const id = this.cfg.embedModelId ?? EMBED_MODELS[0].id;
    const port = this.embedPort;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
    }
    const bin = this.getServerBinary();
    const modelPath = this.getEmbedModelPath(id);
    if (!bin || !node_fs.existsSync(modelPath)) return false;
    this.embedProc = node_child_process.spawn(bin, [
      "-m",
      modelPath,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--embeddings"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.embedProc.stdout?.on("data", (d) => console.log("[llama-embed]", d.toString().trim()));
    this.embedProc.stderr?.on("data", (d) => console.log("[llama-embed:err]", d.toString().trim()));
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1e3));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1e3) });
        if (res.ok) return true;
      } catch {
      }
      if (this.embedProc.killed) return false;
    }
    return false;
  }
  async embed(texts) {
    if (!texts.length) return [];
    try {
      const res = await fetch(`${this.embedEndpoint}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "embed", input: texts.slice(0, 32) }),
        signal: AbortSignal.timeout(3e4)
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.data ?? []).map((d) => d.embedding);
    } catch {
      return null;
    }
  }
  get embedReady() {
    return this.isEmbedModelDownloaded() && !!this.embedProc && !this.embedProc.killed;
  }
}
async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0) || void 0;
  const file = node_fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let downloaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      file.write(Buffer.from(value));
      downloaded += value.length;
      onProgress?.(total ? downloaded / total : 0, downloaded, total);
    }
  } finally {
    file.end();
    await new Promise((res2) => file.on("finish", () => res2()));
  }
}
function findBinary(dir, name, depth = 3) {
  if (depth < 0) return "";
  for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
    const p = node_path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findBinary(p, name, depth - 1);
      if (found) return found;
    } else if (e.name === name || e.name === `${name}.exe`) {
      return p;
    }
  }
  return "";
}
const AGENTS_MD = `# KeepMind — agent guide

This repository is a **KeepMind memory store**. Everything under \`memory/\`
is durable knowledge written and read by AI agents. Treat it as the user's
long-term memory: read before answering, write what matters.

## Layout (memory/)

| Path | Contents |
|---|---|
| \`short-term/\` | daily raw logs — recent working memory |
| \`medium-term/\` | weekly consolidations |
| \`long-term/\` | \`facts.md\`, \`lessons.md\`, \`skills.md\`, \`notes/\` — permanent memory |
| \`sleep/\` | nightly learning reports |
| \`insights/\`, \`summaries/\` | generated insights & daily summaries |
| \`notes/\` | user notes (Markdown) |
| \`tasks/\` | to-dos — \`# Title\` + \`> status: open · priority: … · due: …\` meta line |
| \`daily/\` | daily intentions/goals |
| \`meetings/\` | legacy roundtable transcripts |
| \`entities/\` | one page per person/project/topic, linked with \`[[Name]]\` |
| \`review/\` | spaced-repetition flashcards (\`cards.md\`) + quiz sessions |
| \`skills/\` | procedural skills — one Markdown page per reusable procedure |
| \`crm/\` | \`people/\`, \`companies/\`, \`interactions/\` — relationship memory |
| \`ops/\` | operational logs — \`search-gaps.md\` records unanswered queries |
| \`long-term/decisions.md\` | decision ledger — append via \`sb_remember kind=decision\` |

## MCP server (recommended)

This repo ships its own memory server — zero dependencies, Node 18+:

\`\`\`bash
node tools/keepmind-mcp.mjs --dir ./memory
\`\`\`

Tools: \`sb_search\` (search memory first!), \`sb_read\`, \`sb_write\`,
\`sb_append\`, \`sb_remember\` (durable fact/lesson/skill), \`sb_recent\`,
\`sb_list\`, \`sb_tree\`, \`sb_tasks\`, \`sb_query\` (structured filters:
tasks by status/priority/due, notes by tag, entities by text).

Claude Code picks it up automatically via \`.mcp.json\`. Codex, Gemini CLI,
OpenCode or any MCP client can spawn the same command.

## Conventions

- Markdown only. One fact per bullet in \`long-term/\` files.
- Tasks: first line \`# Title\`, second line \`> status: open|done · priority: low|normal|high · due: YYYY-MM-DD · created: ISO\`.
- Notes may carry YAML frontmatter (\`summary:\`, \`tags:\`, \`links:\`, \`enriched:\`) — preserve it when editing.
- Classify sensitivity in frontmatter: \`sensitivity: public|internal|sensitive|secret\`. The app masks secret-shaped values (API keys, tokens, private keys, password assignments) before any content reaches a cloud LLM — local models see everything. Use \`secret\` for credentials, financial or board-confidential material.
- Notes may also declare freshness: \`valido_ate: YYYY-MM-DD\` (or \`expires:\`) — expired notes are demoted in search. Set \`review_after:\` for time-sensitive content.
- Distinguish hypothesis from fact: prefix unverified claims with \`> proof: hypothesis\`; confirmed ones with \`> proof: confirmed\`.
- Link recurring people/projects/topics with \`[[Name]]\` — entity pages live in \`memory/entities/\`.
- Write in the user's language. Keep entries dated and concise.
- Prefer \`sb_remember\` for durable facts — it lands in the right long-term file.
`;
const MCP_JSON = JSON.stringify({
  mcpServers: {
    "keepmind": {
      command: "node",
      args: ["tools/keepmind-mcp.mjs", "--dir", "./memory"]
    }
  }
}, null, 2) + "\n";
const CURSOR_MCP_JSON = MCP_JSON;
const GEMINI_SETTINGS = JSON.stringify({
  mcpServers: {
    keepmind: {
      command: "node",
      args: ["tools/keepmind-mcp.mjs", "--dir", "./memory"]
    }
  }
}, null, 2) + "\n";
function mcpServerSource() {
  const candidates = [
    node_path.join(__dirname, "../../tools/keepmind-mcp.mjs"),
    node_path.join(__dirname, "../../../tools/keepmind-mcp.mjs"),
    node_path.join(process.cwd(), "tools/keepmind-mcp.mjs")
  ];
  for (const p of candidates) {
    try {
      return node_fs.readFileSync(p, "utf8");
    } catch {
    }
  }
  throw new Error("keepmind-mcp.mjs not found");
}
async function ensureRepoScaffold(gh) {
  if (!gh.accessToken || !gh.repoOwner) return [];
  const [root, tools] = await Promise.all([
    listRepoFiles(gh, ""),
    listRepoFiles(gh, "tools")
  ]);
  const files = [
    ["AGENTS.md", AGENTS_MD],
    ["CLAUDE.md", "@AGENTS.md\n"],
    ["GEMINI.md", "Read AGENTS.md — it documents this KeepMind memory repo, its layout under memory/, conventions, and the bundled MCP server (tools/keepmind-mcp.mjs).\n"],
    [".mcp.json", MCP_JSON],
    [".cursor/mcp.json", CURSOR_MCP_JSON],
    [".gemini/settings.json", GEMINI_SETTINGS],
    ["tools/keepmind-mcp.mjs", mcpServerSource()]
  ];
  const pushed = [];
  for (const [path, content] of files) {
    const base = path.split("/").pop();
    const inTools = path.startsWith("tools/");
    const exists = inTools ? tools.includes(path) || tools.includes(base) : root.includes(path) || root.includes(base);
    if (exists) continue;
    await pushFile(gh, path, content, "scaffold: agent onboarding files");
    pushed.push(path);
  }
  return pushed;
}
function brainConfigJson(cfg) {
  const doc = {
    $schema: "keepmind/v1",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    note: "Declarative snapshot of this KeepMind brain. Secrets are never included. Memory lives under memory/.",
    ai: { provider: cfg.ai.provider, model: cfg.ai.model ?? null, localModel: cfg.localLlm.modelId ?? null },
    agents: cfg.agents.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, builtin: !!a.builtin })),
    automations: cfg.automations.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      schedule: a.schedule,
      time: a.time ?? null,
      everyMinutes: a.everyMinutes ?? null,
      weekday: a.weekday ?? null,
      enabled: a.enabled,
      mode: a.mode ?? "auto"
    })),
    connectors: cfg.mcpServers.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      enabled: s.enabled,
      permission: s.permission ?? "allow",
      custom: s.kind === "custom"
    }))
  };
  return JSON.stringify(doc, null, 2) + "\n";
}
async function exportBrainConfig(gh, cfg) {
  if (!gh.accessToken || !gh.repoOwner) throw new Error("GitHub not configured");
  await pushFile(gh, "keepmind.json", brainConfigJson(cfg), "chore: refresh keepmind.json brain config");
}
const PULL_INTERVAL_MS = 6e4;
const PUSH_DEBOUNCE_MS = 2500;
const PUSH_MIN_INTERVAL_MS = 5e3;
const TEXT_FILE_RE = /\.(md|markdown|txt|json|canvas|csv|org|base)$/i;
class GitSync {
  memory;
  store;
  stateFile;
  state = { sha: {} };
  dirty = /* @__PURE__ */ new Set();
  pushTimer = null;
  pullTimer = null;
  pushing = false;
  pulling = false;
  lastPushAt = 0;
  listeners = /* @__PURE__ */ new Set();
  constructor(store2, memory, stateDir) {
    this.store = store2;
    this.memory = memory;
    this.stateFile = node_path.join(stateDir, "sync-state.json");
    this.loadState();
  }
  // ── public API ──
  onStatus(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  status() {
    const gh = this.store.get().github;
    return {
      connected: !!(gh.accessToken && (gh.repoOwner || gh.repoUrl)),
      pending: this.dirty.size,
      lastPull: this.state.lastPull ?? null,
      lastPush: this.state.lastPush ?? null,
      syncing: this.pushing || this.pulling
    };
  }
  emit() {
    const s = this.status();
    for (const cb of this.listeners) cb(s);
  }
  // Called by Memory on every local write/append
  markDirty(relPath) {
    if (!this.connected()) return;
    this.dirty.add(relPath);
    this.schedulePush();
    this.emit();
  }
  scaffoldDone = false;
  // Public so connect flows can trigger it right after repo creation
  async maybeScaffold() {
    return this.ensureScaffold();
  }
  start() {
    this.pullTimer = setInterval(() => {
      void this.pull();
    }, PULL_INTERVAL_MS);
    setTimeout(() => {
      void this.pull();
    }, 8e3);
    setTimeout(() => {
      void this.ensureScaffold();
    }, 2e4);
  }
  async ensureScaffold() {
    if (this.scaffoldDone || !this.connected()) return;
    this.scaffoldDone = true;
    try {
      const pushed = await ensureRepoScaffold(this.store.get().github);
      if (pushed.length) console.log(`[sync] repo scaffold pushed: ${pushed.join(", ")}`);
      await exportBrainConfig(this.store.get().github, this.store.get());
    } catch (e) {
      this.scaffoldDone = false;
      console.warn("[sync] scaffold failed:", e);
    }
  }
  stop() {
    if (this.pullTimer) clearInterval(this.pullTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
  }
  async syncNow() {
    await this.pull();
    await this.pushDirty();
    return this.status();
  }
  // Pull remote changes if due (>25s since last pull). Used before chat
  // so the brain always answers with the freshest shared memory.
  lastPullAttempt = 0;
  async pullIfDue() {
    if (Date.now() - this.lastPullAttempt < 25e3) return;
    this.lastPullAttempt = Date.now();
    await this.pull();
  }
  // ── internals ──
  connected() {
    const gh = this.store.get().github;
    return !!(gh.accessToken && (gh.repoOwner || gh.repoUrl));
  }
  schedulePush() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushDirty();
    }, PUSH_DEBOUNCE_MS);
  }
  async pushDirty() {
    if (this.pushing || !this.connected() || this.dirty.size === 0) return;
    if (Date.now() - this.lastPushAt < PUSH_MIN_INTERVAL_MS && this.dirty.size < 10) {
      this.schedulePush();
      return;
    }
    this.pushing = true;
    this.emit();
    const gh = this.store.get().github;
    const batch = [...this.dirty];
    try {
      for (const rel of batch) {
        const content = this.memory.read(rel);
        if (content == null) {
          try {
            await deleteMemoryFile(gh, rel, this.syncRoot);
          } catch {
          }
          delete this.state.sha[rel];
          this.dirty.delete(rel);
          continue;
        }
        await pushFile(gh, `${this.syncRoot}${rel}`, content, "sync: keepmind update");
        this.dirty.delete(rel);
        this.lastPushAt = Date.now();
      }
      this.state.lastPush = (/* @__PURE__ */ new Date()).toISOString();
      this.saveState();
    } catch (e) {
      console.warn("[sync] push failed:", e);
    } finally {
      this.pushing = false;
      this.emit();
      if (this.dirty.size > 0) this.schedulePush();
    }
  }
  // Repo prefix mirrored into local memory/. 'memory/' for keepmind-native repos,
  // '' when an existing vault (Obsidian/PARA) is imported — its layout becomes ours.
  get syncRoot() {
    return this.store.get().github.syncRoot ?? "memory/";
  }
  async pull() {
    if (this.pulling || !this.connected()) return;
    this.pulling = true;
    this.lastPullAttempt = Date.now();
    this.emit();
    const gh = this.store.get().github;
    const root = this.syncRoot;
    try {
      node_fs.appendFileSync(this.stateFile + ".debug", `${(/* @__PURE__ */ new Date()).toISOString()} pull start root=${JSON.stringify(root)} token=${!!gh.accessToken} owner=${gh.repoOwner}
`);
      const remote = await listTree(gh, root);
      const remoteMap = new Map(remote.map((r) => [r.path, r.sha]));
      try {
        node_fs.appendFileSync(
          this.stateFile + ".debug",
          `${(/* @__PURE__ */ new Date()).toISOString()} root=${JSON.stringify(root)} remote=${remote.length} tracked=${Object.keys(this.state.sha).length} sample=${remote.slice(0, 3).map((r) => r.path).join(",")}
`
        );
      } catch {
      }
      const tracked = Object.keys(this.state.sha).length;
      if (remote.length === 0 && tracked > 0) {
        console.warn(`[sync] remote tree empty but ${tracked} files tracked — skipping pull to avoid data loss`);
        return;
      }
      for (const { path: rel, sha } of remote) {
        if (this.dirty.has(rel)) continue;
        if (this.state.sha[rel] === sha) continue;
        if (!TEXT_FILE_RE.test(rel)) continue;
        if (rel.split("/").slice(0, -1).some((s) => s.startsWith("."))) continue;
        const file = await fetchMemoryFile(gh, rel, root);
        if (!file) continue;
        try {
          this.memory.quietWrite(rel, file.content);
          this.state.sha[rel] = file.sha;
        } catch (e) {
          console.warn(`[sync] skipped unsafe remote path ${rel}:`, e);
        }
      }
      let deletions = 0;
      for (const rel of Object.keys(this.state.sha)) {
        if (!remoteMap.has(rel) && !this.dirty.has(rel)) {
          deletions++;
          if (deletions > Math.max(10, tracked / 2)) {
            console.warn(`[sync] aborting pull: ${deletions} remote deletions exceeds safety threshold`);
            break;
          }
          try {
            this.memory.quietRemove(rel);
          } catch {
          }
          delete this.state.sha[rel];
        }
      }
      const localFiles = this.memory.allRelFiles();
      for (const rel of localFiles) {
        if (!remoteMap.has(rel) && !this.dirty.has(rel) && !this.state.sha[rel]) {
          this.dirty.add(rel);
        }
      }
      if (this.dirty.size > 0) void this.pushDirty();
      this.state.lastPull = (/* @__PURE__ */ new Date()).toISOString();
      this.saveState();
    } catch (e) {
      try {
        node_fs.appendFileSync(this.stateFile + ".debug", `${(/* @__PURE__ */ new Date()).toISOString()} pull error: ${e}
`);
      } catch {
      }
      console.warn("[sync] pull failed:", e);
    } finally {
      this.pulling = false;
      this.emit();
    }
  }
  loadState() {
    try {
      if (node_fs.existsSync(this.stateFile)) {
        this.state = { sha: {}, ...JSON.parse(node_fs.readFileSync(this.stateFile, "utf8")) };
      }
    } catch {
    }
  }
  saveState() {
    try {
      node_fs.mkdirSync(node_path.dirname(this.stateFile), { recursive: true });
      node_fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
    }
  }
}
const WEEKDAYS = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
};
function parseNaturalSchedule(text) {
  const t = text.toLowerCase();
  let kind = "brain";
  if (/\b(sleep|sono|dormir|learning cycle)\b/.test(t)) kind = "sleep";
  else if (/\b(librarian|hygiene|defrag|vault|dedup|limpeza|faxina)\b/.test(t)) kind = "librarian";
  else if (/\b(evol|evolve|evolução|self-improv|meta-learn|upgrade the brain)\b/.test(t)) kind = "evolve";
  else if (/\b(enrich|enriquec|annotate|tag notes|wikilink)\b/.test(t)) kind = "enrich";
  else if (/\b(quiz|review|flashcard|revis|estudo|self-test|spaced)\b/.test(t)) kind = "review";
  else if (/\b(triage|triagem|sort inbox|classify|classificar|route captures)\b/.test(t)) kind = "triage";
  else if (/\b(security|seguran[çc]a|secret|vazamento|credential|audit)\b/.test(t)) kind = "security";
  else if (/\b(skills?|habilidades)\b/.test(t) && /\b(evol|review|curat|consolid|promot)/.test(t)) kind = "skills";
  else if (/\b(daily summary|sum[aá]rio|recap|briefing)\b/.test(t)) kind = "summary";
  const name = text.trim().split(/\s+/).slice(0, 7).join(" ").replace(/[.,;:!?]+$/, "") || "automation";
  const interval = t.match(/every\s+(\d+|a|an|one)\s*(minute|min|hour|hr|day)s?\b/) ?? t.match(/(?:a cada|every)\s+(\d+|uma?|one)\s*(minuto|min|hora|hr|dia)s?\b/);
  if (interval) {
    const n = interval[1];
    const unit = interval[2];
    const num = /\d/.test(n) ? parseInt(n, 10) : 1;
    const minutes = unit.startsWith("min") || unit.startsWith("minuto") ? num : unit.startsWith("h") || unit.startsWith("hora") ? num * 60 : num * 1440;
    return {
      kind,
      schedule: "interval",
      everyMinutes: minutes,
      label: `every ${minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${minutes / 60}h` : `${minutes / 1440}d`}`,
      name
    };
  }
  let time;
  const tm = t.match(/(?:at|às|as)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\b/) ?? t.match(/\b(\d{1,2}):(\d{2})\b/) ?? t.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (tm) {
    let h = parseInt(tm[1], 10);
    const m = tm[2] ? parseInt(tm[2], 10) : 0;
    const mer = tm[3];
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const weekly = t.match(/\b(?:every|each|weekly|weekly on|toda|todo)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (weekly || /\bweekly\b|\bsemanal\b/.test(t)) {
    let weekday = weekly ? WEEKDAYS[weekly[1]] : void 0;
    if (weekday == null) {
      for (const [k, v] of Object.entries(WEEKDAYS)) {
        if (new RegExp(`\\b${k}\\b`).test(t)) {
          weekday = v;
          break;
        }
      }
    }
    return {
      kind,
      schedule: "weekly",
      weekday: weekday ?? 1,
      time: time ?? "09:00",
      label: `every ${weekdayName(weekday ?? 1)} at ${time ?? "09:00"}`,
      name
    };
  }
  const isDaily = /\b(daily|every\s+day|every\s+morning|every\s+night|every\s+evening|todo dia|diariamente|cada dia|every day)\b/.test(t);
  if (isDaily || !interval) {
    const assumed = !isDaily;
    return {
      kind,
      schedule: "daily",
      time: time ?? (assumed ? "08:00" : void 0) ?? "08:00",
      label: `every day at ${time ?? "08:00"}${assumed ? ' (assumed — add "at HH:MM" to change)' : ""}`,
      name
    };
  }
  return { kind, schedule: "daily", time: "08:00", label: "every day at 08:00", name };
}
function weekdayName(d) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d] ?? "Monday";
}
class AutomationScheduler {
  constructor(store2, brain2, log) {
    this.store = store2;
    this.brain = brain2;
    this.log = log;
  }
  timer = null;
  running = /* @__PURE__ */ new Set();
  listeners = /* @__PURE__ */ new Set();
  onRun(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  // Toggle the webhook trigger for an automation. Returns the updated
  // automation (with token) so callers can show the URL to the user.
  setWebhook(id, enabled) {
    const autos = this.store.get().automations.map((a) => a.id === id ? {
      ...a,
      webhook: enabled,
      webhookToken: enabled ? a.webhookToken ?? `wh_${node_crypto.randomBytes(18).toString("hex")}` : void 0
    } : a);
    this.store.set({ automations: autos });
    return autos.find((a) => a.id === id);
  }
  // Single entry point for "run this automation now-ish": used by the cron
  // tick AND by external webhook triggers. Approval-mode jobs are queued
  // for the user instead of executing. Returns what happened.
  async fire(auto) {
    if (auto.mode === "approval") {
      const pending = this.store.get().pendingApprovals;
      if (!pending.some((p) => p.automationId === auto.id)) {
        this.store.set({
          pendingApprovals: [...pending, {
            id: `ap-${Date.now().toString(36)}-${auto.id}`,
            automationId: auto.id,
            name: auto.name,
            kind: auto.kind,
            instruction: auto.instruction,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          }]
        });
        this.log(`automation "${auto.name}" queued for approval`);
        for (const cb of this.listeners) cb(auto);
      }
      return "queued";
    }
    if (this.running.has(auto.id)) return "busy";
    this.running.add(auto.id);
    try {
      await this.run(auto);
      for (const cb of this.listeners) cb(auto);
      return "ran";
    } catch (e) {
      this.log(`automation ${auto.name} failed: ${e}`);
      return "error";
    } finally {
      this.running.delete(auto.id);
    }
  }
  start() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 3e4);
    setTimeout(() => {
      void this.tick();
    }, 15e3);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (!this.store.isConfigured) return;
    const now = /* @__PURE__ */ new Date();
    for (const auto of this.store.get().automations) {
      if (!auto.enabled || this.running.has(auto.id)) continue;
      if (!this.isDue(auto, now)) continue;
      await this.fire(auto);
      this.store.set({
        automations: this.store.get().automations.map((a) => a.id === auto.id ? { ...a, lastRunAt: (/* @__PURE__ */ new Date()).toISOString() } : a)
      });
    }
  }
  isDue(auto, now) {
    const last = auto.lastRunAt ? new Date(auto.lastRunAt) : null;
    switch (auto.schedule) {
      case "interval": {
        const every = auto.everyMinutes ?? 60;
        if (!last) return true;
        return now.getTime() - last.getTime() >= every * 6e4;
      }
      case "daily": {
        const [h, m] = (auto.time ?? "08:00").split(":").map(Number);
        const due = new Date(now);
        due.setHours(h, m, 0, 0);
        if (now < due) return false;
        if (!last) return true;
        return last.toDateString() !== now.toDateString();
      }
      case "weekly": {
        const [h, m] = (auto.time ?? "09:00").split(":").map(Number);
        const due = new Date(now);
        due.setHours(h, m, 0, 0);
        if (now.getDay() !== (auto.weekday ?? 1) || now < due) return false;
        if (!last) return true;
        return last.toDateString() !== now.toDateString();
      }
    }
  }
  async run(auto) {
    this.log(`automation "${auto.name}" running (${auto.kind})`);
    this.brain.setActivitySource(`auto:${auto.name}`);
    await this.brain.ensureProviderReady();
    if (auto.kind === "sleep") {
      await this.brain.sleep();
    } else if (auto.kind === "librarian") {
      await this.brain.librarian();
    } else if (auto.kind === "evolve") {
      await this.brain.evolve();
    } else if (auto.kind === "enrich") {
      await this.brain.enrich();
    } else if (auto.kind === "review") {
      await this.brain.review();
    } else if (auto.kind === "security") {
      await this.brain.securityAudit();
    } else if (auto.kind === "skills") {
      await this.brain.evolveSkills();
    } else if (auto.kind === "triage") {
      await this.brain.triageInbox();
    } else if (auto.kind === "summary") {
      await this.brain.generateInsights();
      await this.brain.dailySummary();
    } else {
      await this.brain.chat(
        "brain",
        `[AUTOMATION] ${auto.instruction}

This is a scheduled automation. Do the task, save important results to memory, and reply with a short report of what you did.`
      );
    }
    this.log(`automation "${auto.name}" done`);
  }
}
const PORT = 4789;
const MAX_BODY = 64 * 1024;
const DEBOUNCE_MS = 5e3;
class HookServer {
  constructor(store2, scheduler, log) {
    this.store = store2;
    this.scheduler = scheduler;
    this.log = log;
  }
  server = null;
  lastFired = /* @__PURE__ */ new Map();
  get running() {
    return !!this.server;
  }
  get port() {
    return PORT;
  }
  get host() {
    return this.store.get().hooks?.lan ? "0.0.0.0" : "127.0.0.1";
  }
  ensureStarted() {
    if (this.server) return;
    this.server = node_http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.on("error", (e) => this.log(`hook server error: ${e}`));
    this.server.listen(PORT, this.host, () => {
      this.log(`webhook listener on http://${this.host}:${PORT}`);
    });
  }
  restart() {
    const was = this.server;
    this.server = null;
    was?.close(() => this.ensureStarted());
    if (!was) this.ensureStarted();
  }
  tokenOk(provided, expected) {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && node_crypto.timingSafeEqual(a, b);
  }
  async handle(req, res) {
    const json = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const m = url.pathname.match(/^\/hook\/([A-Za-z0-9_-]+)$/);
      if (req.method !== "POST" || !m) return json(404, { ok: false, error: "not found" });
      const auto = this.store.get().automations.find((a) => a.id === m[1]);
      if (!auto || !auto.enabled || !auto.webhook || !auto.webhookToken) {
        return json(404, { ok: false, error: "unknown or disabled hook" });
      }
      const token = req.headers["x-hook-token"] ?? url.searchParams.get("token") ?? req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      if (typeof token !== "string" || !this.tokenOk(token, auto.webhookToken)) {
        this.log(`hook ${auto.id}: bad token`);
        return json(401, { ok: false, error: "bad token" });
      }
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy();
      });
      await new Promise((r) => req.on("end", r));
      const now = Date.now();
      if (now - (this.lastFired.get(auto.id) ?? 0) < DEBOUNCE_MS) {
        return json(429, { ok: false, error: "debounced" });
      }
      this.lastFired.set(auto.id, now);
      json(202, { ok: true, accepted: true });
      void this.scheduler.fire(auto).then((result) => {
        this.log(`hook fired "${auto.name}" → ${result} (${size}B body)`);
      });
    } catch (e) {
      return json(500, { ok: false, error: String(e) });
    }
  }
}
const SCRYPT_KEYLEN = 32;
function hashPassword(password, salt) {
  return node_crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 }).toString("hex");
}
class AuthService {
  db = null;
  ready;
  dbFile;
  constructor(dir) {
    this.dbFile = node_path.join(dir, "auth.db");
    this.ready = this.init();
  }
  async init() {
    const SQL = await initSqlJs({
      locateFile: (f) => node_path.join(__dirname, "../../node_modules/sql.js/dist", f)
    });
    this.db = node_fs.existsSync(this.dbFile) ? new SQL.Database(new Uint8Array(node_fs.readFileSync(this.dbFile))) : new SQL.Database();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        pass_hash TEXT,
        salt TEXT,
        google_sub TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions(
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    this.persist();
  }
  persist() {
    try {
      node_fs.writeFileSync(this.dbFile, Buffer.from(this.db.export()));
    } catch {
    }
  }
  async q(fn) {
    await this.ready;
    const res = fn(this.db);
    this.persist();
    return res;
  }
  // sql.js exec() returns rows as positional arrays, not objects:
  // users columns = id, email, name, pass_hash, salt, google_sub, created_at
  static toUser(row) {
    return { id: row[0], email: row[1], name: row[2], googleSub: row[5] ?? void 0 };
  }
  async userCount() {
    return this.q((db) => db.exec("SELECT COUNT(*) c FROM users")[0]?.values[0]?.[0] ?? 0);
  }
  async hasUsers() {
    return await this.userCount() > 0;
  }
  async findByEmail(email) {
    return this.q((db) => {
      const r = db.exec("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
      return r.length ? AuthService.toUser(r[0].values[0]) : null;
    });
  }
  async register(email, password, name = "") {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Invalid email");
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    const existing = await this.findByEmail(e);
    if (existing) throw new Error("An account with this email already exists");
    const salt = node_crypto.randomBytes(16);
    const hash = hashPassword(password, salt);
    return this.q((db) => {
      db.run(
        "INSERT INTO users(email,name,pass_hash,salt,created_at) VALUES(?,?,?,?,?)",
        [e, name.trim(), hash, salt.toString("hex"), (/* @__PURE__ */ new Date()).toISOString()]
      );
      const r = db.exec("SELECT * FROM users WHERE email = ?", [e]);
      return AuthService.toUser(r[0].values[0]);
    });
  }
  async verifyPassword(email, password) {
    return this.q((db) => {
      const r = db.exec("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
      if (!r.length) return null;
      const row = r[0].values[0];
      if (!row[3] || !row[4]) return null;
      const salt = Buffer.from(row[4], "hex");
      const hash = Buffer.from(row[3], "hex");
      const candidate = Buffer.from(hashPassword(password, salt), "hex");
      if (hash.length !== candidate.length || !node_crypto.timingSafeEqual(hash, candidate)) return null;
      return AuthService.toUser(row);
    });
  }
  // Google sign-in: link by google_sub or email, create if needed
  async upsertGoogle(profile) {
    const sub = String(profile.sub ?? "");
    const e = String(profile.email ?? "").trim().toLowerCase();
    const name = String(profile.name ?? "");
    if (!sub && !e) throw new Error("Google profile is missing both sub and email");
    return this.q((db) => {
      let r = db.exec("SELECT * FROM users WHERE google_sub = ?", [sub]);
      if (!r.length && e) r = db.exec("SELECT * FROM users WHERE email = ?", [e]);
      if (r.length) {
        const row = r[0].values[0];
        if (!row[5] && sub) db.run("UPDATE users SET google_sub = ? WHERE id = ?", [sub, row[0]]);
        const rr2 = db.exec("SELECT * FROM users WHERE id = ?", [row[0]]);
        return AuthService.toUser(rr2[0].values[0]);
      }
      db.run(
        "INSERT INTO users(email,name,google_sub,created_at) VALUES(?,?,?,?)",
        [e || `google-${sub}@users.local`, name, sub || null, (/* @__PURE__ */ new Date()).toISOString()]
      );
      const rr = db.exec("SELECT * FROM users WHERE id = (SELECT MAX(id) FROM users)");
      return AuthService.toUser(rr[0].values[0]);
    });
  }
  async createSession(userId) {
    const token = node_crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    await this.q((db) => db.run(
      "INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
      [token, userId, new Date(now).toISOString(), new Date(now + 30 * 864e5).toISOString()]
    ));
    return token;
  }
  async userByToken(token) {
    if (!token) return null;
    return this.q((db) => {
      const r = db.exec("SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", [token]);
      if (!r.length) return null;
      const row = r[0].values[0];
      if (new Date(row[row.length - 1]).getTime() < Date.now()) {
        db.run("DELETE FROM sessions WHERE token = ?", [token]);
        return null;
      }
      return AuthService.toUser(row);
    });
  }
  async deleteSession(token) {
    await this.q((db) => db.run("DELETE FROM sessions WHERE token = ?", [token]));
  }
}
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS = 6e3;
const SEARCH_K = 6;
const INDEX_DIRS = [
  "entities",
  "long-term",
  "notes",
  "tasks",
  "daily",
  "skills",
  "crm",
  "insights",
  "summaries",
  "sleep",
  "review",
  "short-term",
  "medium-term",
  "agents",
  "inbox",
  "meetings"
];
const SKIP_FILES = /* @__PURE__ */ new Set(["INDEX.md"]);
class RagService {
  constructor(localLlm, memory, stateDir) {
    this.localLlm = localLlm;
    this.indexFile = node_path.join(stateDir, "memory-embeddings.json");
    this.memory = memory;
    this.load();
  }
  indexFile;
  index = { chunks: [] };
  indexing = false;
  embedding = false;
  memory;
  laya = null;
  setLaya(l) {
    this.laya = l;
  }
  load() {
    try {
      if (node_fs.existsSync(this.indexFile)) this.index = JSON.parse(node_fs.readFileSync(this.indexFile, "utf8"));
    } catch {
    }
  }
  save() {
    try {
      node_fs.mkdirSync(node_path.join(this.indexFile, ".."), { recursive: true });
      node_fs.writeFileSync(this.indexFile, JSON.stringify(this.index), "utf8");
    } catch {
    }
  }
  get stats() {
    return {
      available: this.localLlm.isEmbedModelDownloaded(),
      running: this.localLlm.embedReady,
      modelId: this.localLlm.embedModelId ?? null,
      chunks: this.index.chunks.length,
      embedded: this.index.chunks.filter((c) => c.vec).length
    };
  }
  // Rebuild the chunk list from memory files (cheap — no embeddings).
  // Vectors are kept per chunk-hash, so unchanged text never re-embeds.
  async ensureChunks() {
    const byKey = new Map(this.index.chunks.map((c) => [c.key, c]));
    const next = [];
    let truncated = false;
    for (const dir of INDEX_DIRS) {
      const files = this.memory.list(dir);
      for (const f of files) {
        if (SKIP_FILES.has(f)) continue;
        const content = this.memory.read(`${dir}/${f}`) ?? "";
        if (!content.trim()) continue;
        const stale = isStale(content);
        for (const chunk of chunkText(content)) {
          if (next.length >= MAX_CHUNKS) {
            truncated = true;
            break;
          }
          const file = `${dir}/${f}`;
          const key = node_crypto.createHash("sha1").update(`${file}:${chunk.offset}:${chunk.text.slice(0, 80)}`).digest("hex").slice(0, 16);
          const prev = byKey.get(key);
          next.push({ key, file, offset: chunk.offset, text: chunk.text, vec: prev?.vec, stale: stale || prev?.stale });
        }
        if (truncated) break;
      }
      if (truncated) break;
    }
    this.index.chunks = next;
    this.save();
    return next.length;
  }
  // Embed any chunks missing vectors. Safe to call repeatedly.
  async embedPending() {
    if (this.embedding || !this.localLlm.embedReady) return 0;
    const pending = this.index.chunks.filter((c) => !c.vec);
    if (!pending.length) return 0;
    this.embedding = true;
    let done = 0;
    try {
      for (let i = 0; i < pending.length; i += 32) {
        const batch = pending.slice(i, i + 32);
        const vecs = await this.localLlm.embed(batch.map((c) => c.text));
        if (!vecs) break;
        batch.forEach((c, j) => {
          c.vec = vecs[j];
        });
        done += batch.length;
        this.save();
      }
    } finally {
      this.embedding = false;
    }
    return done;
  }
  // Full pipeline: refresh chunks then embed what's missing.
  async reindex() {
    const chunks = await this.ensureChunks();
    const embedded = await this.embedPending();
    return { chunks, embedded };
  }
  // Semantic recall for a user message → formatted context block (or '').
  async search(query) {
    if (!this.localLlm.embedReady) return "";
    try {
      if (Date.now() - this.lastChunkScan > 6e4) {
        this.lastChunkScan = Date.now();
        void this.ensureChunks().then(() => this.embedPending()).catch(() => {
        });
      }
      const qv = await this.localLlm.embed([query]);
      if (!qv?.[0]) return "";
      const q = qv[0];
      const qTerms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2);
      const scored = this.index.chunks.filter((c) => c.vec && c.vec.length === q.length).map((c) => {
        const vec = cosine(q, c.vec);
        const lower = c.text.toLowerCase();
        const hits = qTerms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
        const lex = qTerms.length ? hits / qTerms.length : 0;
        const stalePenalty = c.stale ? 0.55 : 1;
        return { c, s: (vec * 0.7 + lex * 0.3) * stalePenalty, vec, lex };
      }).sort((a, b) => b.s - a.s).slice(0, SEARCH_K * 2);
      if (this.laya?.status().available && scored.length > 1) {
        const reranked = await Promise.all(scored.map(async (x) => {
          const p = await this.laya.yesNo(
            `Query: ${query}

Candidate memory:
${x.c.text.slice(0, 700)}`,
            "Does this memory chunk contain information relevant to answering the query?"
          );
          return { ...x, laya: p };
        }));
        reranked.sort((a, b) => {
          const ra = (a.laya ?? 0.5) * 0.6 + a.s * 0.4;
          const rb = (b.laya ?? 0.5) * 0.6 + b.s * 0.4;
          return rb - ra;
        });
        scored.length = 0;
        scored.push(...reranked.slice(0, SEARCH_K));
      } else {
        scored.length = SEARCH_K;
      }
      const good = scored.filter((x) => x.s > 0.3);
      if (!good.length) return "";
      return good.map(
        (x) => `### ${x.c.file}${x.c.stale ? " ⚠ stale" : ""} (score ${x.s.toFixed(2)})
${x.c.text.slice(0, 900)}`
      ).join("\n\n");
    } catch {
      return "";
    }
  }
  lastChunkScan = 0;
}
const STALE_LINE = /^(valido_ate|expires|review_after|stale_after|valid_until)\s*:\s*['"]?(\d{4}-\d{2}-\d{2})/im;
function isStale(content) {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 1500) : content.slice(0, end);
  const m = fm.match(STALE_LINE);
  return !!m && m[2] < (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function chunkText(text) {
  const clean = text.replace(/\r\n/g, "\n");
  const headings = [...clean.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)];
  const chunks = [];
  let i = 0;
  while (i < clean.length && chunks.length < 400) {
    let end = Math.min(i + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      const window = clean.slice(i, end);
      const brk = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      if (brk > CHUNK_SIZE * 0.5) end = i + brk + 1;
    }
    let body = clean.slice(i, end).trim();
    const h = [...headings].reverse().find((x) => (x.index ?? 0) < i);
    if (h && body && !body.startsWith("#")) body = `§ ${h[1]}
${body}`;
    chunks.push({ offset: i, text: body });
    i = end - CHUNK_OVERLAP > i ? end - CHUNK_OVERLAP : end;
    if (end >= clean.length) break;
  }
  return chunks.filter((c) => c.text.length > 40);
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
const MODEL_REPO = "nvkudva/laya-onnx-q8";
const MODEL_REVISION = "main";
const MODEL_FILES = [
  ["v1/encoder_q8.onnx", "encoder.onnx"],
  ["v1/encoder_q8.onnx.data", "encoder_q8.onnx.data"],
  ["v1/head_q8.onnx", "head.onnx"],
  ["v1/head_q8.onnx.data", "head_q8.onnx.data"],
  ["v1/rl_agent_config.json", "rl_agent_config.json"],
  ["v1/tokenizer.json", "tokenizer.json"],
  ["v1/tokenizer_config.json", "tokenizer_config.json"]
];
class LayaService {
  agent = null;
  loading = null;
  statusError = null;
  modelDir;
  constructor() {
    this.modelDir = node_path.join(electron.app.getPath("userData"), "laya");
  }
  status() {
    const downloaded = node_fs.existsSync(node_path.join(this.modelDir, "encoder.onnx")) && node_fs.existsSync(node_path.join(this.modelDir, "head.onnx")) && node_fs.existsSync(node_path.join(this.modelDir, "rl_agent_config.json"));
    return {
      available: downloaded,
      loaded: !!this.agent,
      modelDir: this.modelDir,
      downloaded,
      error: this.statusError ?? void 0
    };
  }
  async getAgent() {
    if (this.agent) return this.agent;
    if (!this.status().downloaded) return null;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const mod = await Promise.resolve().then(() => require("./chunks/index-DkZM0q9M.js"));
          const agent = await mod.Agent.load(this.modelDir);
          this.agent = agent;
          return this.agent;
        } catch (e) {
          this.statusError = e instanceof Error ? e.message : String(e);
          return null;
        } finally {
          this.loading = null;
        }
      })();
    }
    return this.loading;
  }
  // Drop the loaded agent (e.g. before deleting the model files).
  unload() {
    this.agent = null;
    this.loading = null;
  }
  // ── Download ──
  async download(onProgress) {
    node_fs.mkdirSync(this.modelDir, { recursive: true });
    const totalBytes = MODEL_FILES.reduce((n, [src]) => n + expectedSize(src), 0);
    let done = 0;
    for (const [src, dest] of MODEL_FILES) {
      const destPath = node_path.join(this.modelDir, dest);
      const size = await this.downloadFile(src, destPath);
      done += size;
      onProgress?.(done, totalBytes, dest);
    }
    for (const f of ["encoder.onnx", "head.onnx"]) {
      const p = node_path.join(this.modelDir, f);
      if (!node_fs.existsSync(p)) throw new Error(`download incomplete: ${f} missing`);
    }
  }
  async downloadFile(src, destPath) {
    const url = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${src}`;
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    const expected = Number(head.headers.get("content-length") ?? 0);
    if (node_fs.existsSync(destPath) && expected > 0) {
      const { statSync } = await import("node:fs");
      if (statSync(destPath).size === expected) return expected;
    }
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download failed ${src}: HTTP ${res.status}`);
    const tmp = `${destPath}.part`;
    await promises.pipeline(node_stream.Readable.fromWeb(res.body), node_fs.createWriteStream(tmp));
    const { renameSync } = await import("node:fs");
    renameSync(tmp, destPath);
    return expected || 0;
  }
  // ── Decisions ──
  // Generic typed decision. Returns null when the engine isn't available.
  async decide(state, questions) {
    const agent = await this.getAgent();
    if (!agent) return null;
    try {
      return await agent.predict(state.slice(0, 4e3), questions);
    } catch {
      return null;
    }
  }
  // Convenience: pick one of N options. Returns { choice, confidence } | null.
  async choose(state, question, options) {
    const out = await this.decide(state, {
      pick: { type: "choice", instructions: question, criteria: options }
    });
    const a = out?.answers?.pick;
    if (!a?.choice) return null;
    return { choice: a.choice, confidence: a.answer_confidence ?? a.confidence ?? 0 };
  }
  // Convenience: rate on an ordered scale. Returns index | null.
  async score(state, question, levels) {
    const out = await this.decide(state, {
      rate: { type: "score", instructions: question, criteria: levels }
    });
    const a = out?.answers?.rate;
    if (a?.score == null) return null;
    return { score: a.score, confidence: a.answer_confidence ?? a.confidence ?? 0 };
  }
  // Convenience: yes/no probability. Returns P(yes) 0..1 | null.
  async yesNo(state, question) {
    const out = await this.decide(state, {
      ans: { type: "noul", instructions: question }
    });
    const a = out?.answers?.ans;
    const p = a?.noul ?? a?.probability ?? a?.score;
    return typeof p === "number" ? p : null;
  }
}
function expectedSize(src) {
  if (src.includes("encoder_q8.onnx.data")) return 468e6;
  if (src.includes("head_q8.onnx.data")) return 53e6;
  if (src.includes("encoder_q8.onnx")) return 29e5;
  if (src.includes("tokenizer.json")) return 36e5;
  return 1e3;
}
const today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "item";
}
function noteTitle(content, fallback) {
  const m = content.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() || fallback;
}
function noteBody(content) {
  return content.replace(/^#\s+[^\n]*\n?/, "").replace(/\n?---\n(created|updated):[^\n]*\n?/g, "\n").trim();
}
function parseTaskMeta(line) {
  const meta = {};
  for (const part of line.split("·")) {
    const [k, v] = part.split(":").map((s) => s.trim());
    if (k && v) meta[k] = v;
  }
  return meta;
}
class Planner {
  constructor(memory, store2, localLlm = null) {
    this.memory = memory;
    this.store = store2;
    this.localLlm = localLlm;
  }
  // ── Notes ──
  listNotes() {
    return this.memory.list("notes").sort().reverse().map((f) => {
      const content = this.memory.read(`notes/${f}`) ?? "";
      const id = f.replace(/\.md$/, "");
      const m = content.match(/updated:\s*(\S+)/);
      return {
        id,
        title: noteTitle(content, id),
        body: noteBody(content),
        updated: m?.[1] ?? ""
      };
    });
  }
  getNote(id) {
    const content = this.memory.read(`notes/${id}.md`);
    if (content == null) return null;
    return {
      id,
      title: noteTitle(content, id),
      body: noteBody(content),
      updated: content.match(/updated:\s*(\S+)/)?.[1] ?? ""
    };
  }
  saveNote(id, title, body) {
    const slugId = id ?? slug(title);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = this.memory.read(`notes/${slugId}.md`) ?? "";
    const created = existing.match(/created:\s*(\S+)/)?.[1] ?? now;
    this.memory.write(
      `notes/${slugId}.md`,
      `# ${title.trim() || "Untitled"}

${body.trim()}

---
created: ${created}
updated: ${now}
`
    );
    return this.getNote(slugId);
  }
  deleteNote(id) {
    this.memory.remove(`notes/${id}.md`);
    this.memory.remove(`notes/${id}`);
  }
  // ── Tasks ──
  parseTaskFile(f) {
    const content = this.memory.read(`tasks/${f}`);
    if (content == null) return null;
    const lines = content.split("\n");
    const title = (lines.find((l) => l.startsWith("# ")) ?? "# ").slice(2).trim();
    const metaLine = lines.find((l) => l.startsWith("> ")) ?? "";
    const meta = parseTaskMeta(metaLine.replace(/^>\s*/, ""));
    return {
      id: f.replace(/\.md$/, ""),
      title,
      done: meta.status === "done",
      priority: meta.priority ?? "normal",
      due: meta.due ?? null,
      created: meta.created ?? "",
      notes: lines.slice(lines.indexOf(metaLine) + 1).join("\n").replace(/---\n(created|updated):[^\n]*/g, "").trim()
    };
  }
  writeTask(t) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.memory.write(
      `tasks/${t.id}.md`,
      `# ${t.title}
> status: ${t.done ? "done" : "open"} · priority: ${t.priority}${t.due ? ` · due: ${t.due}` : ""} · created: ${t.created || now}

${t.notes}
`
    );
  }
  listTasks() {
    const tasks = this.memory.list("tasks").map((f) => this.parseTaskFile(f)).filter((t) => !!t);
    return tasks.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return b.created.localeCompare(a.created);
    });
  }
  addTask(title, opts = {}) {
    const id = `${today().replace(/-/g, "")}-${slug(title)}-${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id,
      title: title.trim(),
      done: false,
      priority: opts.priority ?? "normal",
      due: opts.due ?? null,
      created: (/* @__PURE__ */ new Date()).toISOString(),
      notes: opts.notes ?? ""
    };
    this.writeTask(task);
    return task;
  }
  updateTask(id, patch) {
    const t = this.listTasks().find((x) => x.id === id);
    if (!t) return null;
    const next = { ...t, ...patch };
    this.writeTask(next);
    return next;
  }
  toggleTask(id) {
    const t = this.listTasks().find((x) => x.id === id);
    if (!t) return null;
    return this.updateTask(id, { done: !t.done });
  }
  deleteTask(id) {
    this.memory.remove(`tasks/${id}.md`);
  }
  // ── Daily goals ──
  getDailyGoals(date) {
    const d = date ?? today();
    const content = this.memory.read(`daily/${d}.md`) ?? "";
    const items = content.split("\n").filter((l) => /^- \[[ xX]\]/.test(l.trim())).map((l) => ({ done: /\[[xX]\]/.test(l), text: l.replace(/^- \[[ xX]\]\s*/, "").trim() }));
    return { date: d, items };
  }
  writeDailyGoals(d) {
    const body = d.items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n");
    this.memory.write(`daily/${d.date}.md`, `# Goals — ${d.date}

${body || "_No goals yet._"}
`);
  }
  setDailyGoals(date, items) {
    this.writeDailyGoals({ date, items });
  }
  toggleGoal(date, index) {
    const g = this.getDailyGoals(date);
    if (g.items[index]) g.items[index].done = !g.items[index].done;
    this.writeDailyGoals(g);
    return g;
  }
  addGoal(date, text) {
    const g = this.getDailyGoals(date);
    g.items.push({ text: text.trim(), done: false });
    this.writeDailyGoals(g);
    return g;
  }
  removeGoal(date, index) {
    const g = this.getDailyGoals(date);
    g.items.splice(index, 1);
    this.writeDailyGoals(g);
    return g;
  }
  // AI-suggested daily intentions grounded in recent memory
  async suggestGoals() {
    const cfg = this.store.get();
    const recent = this.memory.shortTermFiles().slice(-3).map((f) => this.memory.read(`short-term/${f}`) ?? "").join("\n").slice(-6e3);
    const openTasks = this.listTasks().filter((t) => !t.done).slice(0, 10).map((t) => `- ${t.title}${t.due ? ` (due ${t.due})` : ""}`).join("\n");
    const res = await chat(cfg.ai, [
      {
        role: "system",
        content: "You set daily intentions for a person. Given their recent activity and open tasks, propose exactly 3 concrete, realistic goals for today. One short line each, imperative mood, in the user's language. No numbering, no preamble."
      },
      {
        role: "user",
        content: `Recent activity:
${recent || "(none)"}

Open tasks:
${openTasks || "(none)"}`
      }
    ], [], this.localLlm?.endpoint);
    return res.text.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 3);
  }
}
function googleAuthUrl(creds, redirectUri, challenge, state) {
  const p = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "online",
    prompt: "select_account"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
function googleLogin(creds) {
  return new Promise((resolve, reject) => {
    if (!creds?.clientId || !creds.clientSecret) {
      reject(new Error("Google sign-in is not configured — add the OAuth client ID/secret in Settings → Account"));
      return;
    }
    const verifier = node_crypto.randomBytes(32).toString("base64url");
    const challenge = node_crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = node_crypto.randomBytes(16).toString("hex");
    let server = null;
    const timer = setTimeout(() => {
      server?.close();
      reject(new Error("Google sign-in timed out"));
    }, 5 * 6e4);
    server = node_http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        const st = url.searchParams.get("state");
        if (err || !code || st !== state) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end('<html><body style="background:#030712;color:#7dd3fc;font-family:monospace;display:grid;place-items:center;height:100vh"><h2>Sign-in cancelled — you can close this tab.</h2></body></html>');
          clearTimeout(timer);
          server?.close();
          reject(new Error(err ? `Google sign-in failed: ${err}` : "Missing auth code"));
          return;
        }
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            code,
            code_verifier: verifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri
          })
        });
        const tokens = await tokenRes.json();
        if (!tokens.access_token) throw new Error(tokens.error_description ?? "Token exchange failed");
        const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        }).then((r) => r.json());
        if (!info?.sub || !info?.email) {
          throw new Error(`Google sign-in failed: incomplete profile (${info?.error ?? "missing sub/email"})`);
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end('<html><body style="background:#030712;color:#a3e635;font-family:monospace;display:grid;place-items:center;height:100vh"><h2>✓ Signed in — return to KeepMind.</h2></body></html>');
        clearTimeout(timer);
        server?.close();
        resolve({ sub: info.sub, email: info.email, name: info.name, picture: info.picture });
      } catch (e) {
        clearTimeout(timer);
        server?.close();
        reject(e);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      electron.shell.openExternal(googleAuthUrl(creds, redirectUri, challenge, state));
    });
  });
}
const execFileP = node_util.promisify(node_child_process.execFile);
const REPO = "criptogus/keepmind";
const CONTINUOUS_TAG = "continuous";
let pendingContinuous = null;
let checking = false;
function stateFile() {
  return node_path.join(electron.app.getPath("userData"), "continuous-state.json");
}
function seenMarker() {
  try {
    return JSON.parse(node_fs.readFileSync(stateFile(), "utf8")).seen ?? null;
  } catch {
    return null;
  }
}
function markSeen(marker) {
  try {
    node_fs.writeFileSync(stateFile(), JSON.stringify({ seen: marker }));
  } catch {
  }
}
function send(channel, payload) {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    win.webContents.send("updater:event", { channel, ...payload });
  }
}
function initUpdater() {
  if (!electron.app.isPackaged) return { packaged: false };
  electronUpdater.autoUpdater.autoDownload = false;
  electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
  electronUpdater.autoUpdater.on("checking-for-update", () => send("checking"));
  electronUpdater.autoUpdater.on("update-available", (info) => send("available", { version: info.version }));
  electronUpdater.autoUpdater.on("update-not-available", () => send("up-to-date"));
  electronUpdater.autoUpdater.on("update-downloaded", (info) => send("downloaded", { version: info.version }));
  electronUpdater.autoUpdater.on("error", (err) => send("error", { message: String(err?.message ?? err) }));
  const tick = () => {
    void checkForUpdates();
  };
  setTimeout(tick, 15e3);
  setInterval(tick, 6 * 60 * 60 * 1e3);
  return { packaged: true };
}
function updaterStatus() {
  return { version: electron.app.getVersion(), packaged: electron.app.isPackaged };
}
function parseVersion(v) {
  return (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}
function versionGt(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}
function assetNameForPlatform() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? /-universal-mac\.zip$|-arm64-mac\.zip$/ : /-universal-mac\.zip$|-x64-mac\.zip$/;
  }
  if (process.platform === "win32") return /\.exe$/;
  return /\.AppImage$/;
}
async function findContinuousUpdate() {
  const res = await electron.net.fetch(`https://api.github.com/repos/${REPO}/releases/tags/${CONTINUOUS_TAG}`, {
    headers: { "User-Agent": "keepmind-updater", Accept: "application/vnd.github+json" }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github api ${res.status}`);
  const rel = await res.json();
  const re = assetNameForPlatform();
  const asset = (rel.assets ?? []).find((a) => re.test(a.name));
  if (!asset) return null;
  const m = asset.name.match(/(\d+\.\d+\.\d+)/);
  const version = m?.[1] ?? rel.tag_name;
  const marker = `${rel.updated_at ?? rel.created_at}:${asset.digest ?? asset.id}`;
  if (!versionGt(version, electron.app.getVersion())) {
    if (!node_fs.existsSync(stateFile())) {
      markSeen(marker);
      return null;
    }
    if (marker === seenMarker()) return null;
  }
  return { version, url: asset.browser_download_url, name: asset.name, marker };
}
async function downloadToFile(url, dest) {
  const res = await electron.net.fetch(url, { headers: { "User-Agent": "keepmind-updater" } });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  node_fs.mkdirSync(node_path.dirname(dest), { recursive: true });
  const out = node_fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let transferred = 0, lastPct = -1;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      out.write(Buffer.from(value));
      transferred += value.byteLength;
      if (total) {
        const pct = Math.round(transferred / total * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          send("progress", { percent: pct, transferred, total });
        }
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}
function appBundlePath() {
  return node_path.join(node_path.dirname(node_path.dirname(node_path.dirname(process.execPath))));
}
async function installMac(updateFile, version) {
  const work = node_path.join(electron.app.getPath("userData"), "update");
  node_fs.mkdirSync(work, { recursive: true });
  const dest = node_path.join(work, "extracted");
  await execFileP("ditto", ["-x", "-k", updateFile, dest]);
  const newApp = node_path.join(dest, "KeepMind.app");
  if (!node_fs.existsSync(newApp)) throw new Error("KeepMind.app not found in update archive");
  const target = appBundlePath();
  const script = node_path.join(work, "swap.sh");
  node_fs.writeFileSync(script, [
    "#!/bin/bash",
    "sleep 2",
    `rm -rf ${JSON.stringify(target)}`,
    `cp -R ${JSON.stringify(newApp)} ${JSON.stringify(node_path.dirname(target))}/`,
    `open -a ${JSON.stringify(node_path.join(node_path.dirname(target), "KeepMind.app"))}`,
    ""
  ].join("\n"));
  node_fs.chmodSync(script, 493);
  const child = node_child_process.spawn("nohup", ["bash", script], { detached: true, stdio: "ignore" });
  child.unref();
  electron.app.quit();
}
async function installWin(updateFile) {
  const child = node_child_process.spawn(updateFile, ["/S"], { detached: true, stdio: "ignore" });
  child.unref();
  electron.app.quit();
}
async function installLinux(updateFile) {
  const target = process.env.APPIMAGE ?? process.execPath;
  const script = node_path.join(node_os.tmpdir(), `keepmind-update-${Date.now()}.sh`);
  node_fs.writeFileSync(script, [
    "#!/bin/bash",
    "sleep 2",
    `chmod +x ${JSON.stringify(updateFile)}`,
    `cp ${JSON.stringify(updateFile)} ${JSON.stringify(target)}`,
    `nohup ${JSON.stringify(target)} >/dev/null 2>&1 &`,
    ""
  ].join("\n"));
  node_fs.chmodSync(script, 493);
  const child = node_child_process.spawn("nohup", ["bash", script], { detached: true, stdio: "ignore" });
  child.unref();
  electron.app.quit();
}
async function applyPending() {
  if (!pendingContinuous) return;
  const { file, version } = pendingContinuous;
  send("installing", { version });
  try {
    if (process.platform === "darwin") await installMac(file, version);
    else if (process.platform === "win32") await installWin(file);
    else await installLinux(file);
  } catch (e) {
    send("error", { message: `install failed: ${e?.message ?? e}` });
    pendingContinuous = null;
  }
}
async function checkForUpdates() {
  if (!electron.app.isPackaged) return { packaged: false };
  if (!checking) {
    checking = true;
    try {
      send("checking");
      const upd = await findContinuousUpdate();
      if (upd) {
        send("available", { version: upd.version, channel: "continuous" });
        const dest = node_path.join(electron.app.getPath("userData"), "update", upd.name);
        await downloadToFile(upd.url, dest);
        pendingContinuous = { file: dest, version: upd.version };
        markSeen(upd.marker);
        send("downloaded", { version: upd.version, channel: "continuous" });
        return { packaged: true, continuous: upd.version };
      }
      send("up-to-date");
      return { packaged: true, continuous: null };
    } catch (e) {
      send("error", { message: String(e?.message ?? e) });
      return { packaged: true, error: String(e?.message ?? e) };
    } finally {
      checking = false;
    }
  }
  return { packaged: true, busy: true };
}
function installUpdate() {
  if (!electron.app.isPackaged) return false;
  if (pendingContinuous) {
    void applyPending();
    return true;
  }
  try {
    electronUpdater.autoUpdater.quitAndInstall();
    return true;
  } catch {
    return false;
  }
}
function dirSize(dir) {
  let total = 0;
  try {
    for (const e of node_fs.readdirSync(dir, { withFileTypes: true })) {
      const p = node_path.join(dir, e.name);
      if (e.isDirectory()) total += dirSize(p);
      else if (e.isFile()) total += node_fs.statSync(p).size;
    }
  } catch {
  }
  return total;
}
function fileSize(p) {
  try {
    return node_fs.statSync(p).size;
  } catch {
    return 0;
  }
}
function listModels(localLlm, laya) {
  const out = [];
  const cfg = localLlm.cfg ?? {};
  const chatDir = node_path.join(localLlm.modelsDir ?? node_path.join(electron.app.getPath("userData"), "local-llm", "models"));
  const activeChat = cfg.modelId ?? LOCAL_MODELS[1]?.id;
  for (const m of LOCAL_MODELS) {
    const p = node_path.join(chatDir, `${m.id}.gguf`);
    const size = fileSize(p);
    out.push({
      key: `chat:${m.id}`,
      kind: "chat",
      label: m.label,
      detail: m.description,
      sizeBytes: size,
      downloaded: size > 1e8,
      active: activeChat === m.id,
      running: activeChat === m.id && localLlm.isRunning,
      path: p
    });
  }
  const activeEmbed = cfg.embedModelId ?? EMBED_MODELS[0]?.id;
  for (const m of EMBED_MODELS) {
    const p = node_path.join(chatDir, `embed-${m.id}.gguf`);
    const size = fileSize(p);
    out.push({
      key: `embed:${m.id}`,
      kind: "embed",
      label: `${m.label} (embeddings)`,
      detail: `${m.dims} dims · powers semantic search`,
      sizeBytes: size,
      downloaded: size > 1e7,
      active: activeEmbed === m.id,
      running: activeEmbed === m.id && localLlm.embedReady,
      path: p
    });
  }
  const bin = localLlm.getServerBinary();
  const binPath = bin || node_path.join(electron.app.getPath("userData"), "local-llm", "bin");
  out.push({
    key: "runtime:llama-server",
    kind: "runtime",
    label: "llama.cpp server",
    detail: "Local inference engine — required by chat + embedding models",
    sizeBytes: bin ? fileSize(bin) : 0,
    downloaded: !!bin,
    active: localLlm.isRunning || localLlm.embedReady,
    running: localLlm.isRunning || localLlm.embedReady,
    path: binPath
  });
  const layaDir = node_path.join(electron.app.getPath("userData"), "laya");
  const st = laya?.status();
  out.push({
    key: "decision:laya",
    kind: "decision",
    label: "Laya decision engine",
    detail: 'ONNX "System 1" — fast inbox triage, dedup, RAG rerank (~33ms decisions)',
    sizeBytes: dirSize(layaDir),
    downloaded: !!st?.downloaded,
    active: !!st?.downloaded,
    running: !!st?.loaded,
    path: layaDir
  });
  return out;
}
async function deleteModel(localLlm, laya, key) {
  const warnings = [];
  let freed = 0;
  if (key.startsWith("chat:")) {
    const id = key.slice(5);
    const p = localLlm.getModelPath(id);
    freed = fileSize(p);
    if (node_fs.existsSync(p)) node_fs.unlinkSync(p);
    const cfg = localLlm.cfg ?? {};
    if ((cfg.modelId ?? LOCAL_MODELS[1]?.id) === id) {
      localLlm.store?.updateLocalLlm?.({ modelId: void 0 });
      warnings.push("was the active chat model — provider falls back to default");
      await localLlm.stop();
    }
  } else if (key.startsWith("embed:")) {
    const id = key.slice(6);
    const p = localLlm.getEmbedModelPath(id);
    freed = fileSize(p);
    if (node_fs.existsSync(p)) node_fs.unlinkSync(p);
    const cfg = localLlm.cfg ?? {};
    if ((cfg.embedModelId ?? EMBED_MODELS[0]?.id) === id) {
      localLlm.store?.updateLocalLlm?.({ embedModelId: void 0 });
      warnings.push("was the active embedding model — RAG falls back to default");
      await localLlm.stop();
    }
  } else if (key === "runtime:llama-server") {
    const bin = localLlm.getServerBinary();
    if (bin) {
      freed = fileSize(bin);
      node_fs.unlinkSync(bin);
    }
    const zip = node_path.join(electron.app.getPath("userData"), "local-llm", "bin", "llama-server.zip");
    if (node_fs.existsSync(zip)) {
      freed += fileSize(zip);
      node_fs.unlinkSync(zip);
    }
    await localLlm.stop();
    warnings.push("llama-server removed — models will re-download it on next use");
  } else if (key === "decision:laya") {
    const dir = node_path.join(electron.app.getPath("userData"), "laya");
    freed = dirSize(dir);
    laya?.unload();
    if (node_fs.existsSync(dir)) node_fs.rmSync(dir, { recursive: true, force: true });
  } else {
    throw new Error(`Unknown model key: ${key}`);
  }
  return { key, freedBytes: freed, warnings };
}
const AI_PROVIDERS = /* @__PURE__ */ new Set(["local", "anthropic", "claude-oauth", "openai", "codex", "gemini", "grok", "ollama"]);
const MCP_KINDS = /* @__PURE__ */ new Set(["whatsapp", "telegram", "postgres", "custom"]);
const CONFIG_SET_KEYS = /* @__PURE__ */ new Set(["mcpServers", "onboardingDone"]);
const MCP_PATCH_KEYS = /* @__PURE__ */ new Set(["id", "name", "kind", "enabled", "command", "args", "env", "sessionDir", "permission"]);
const MCP_PERMISSIONS = /* @__PURE__ */ new Set(["allow", "ask", "block"]);
const AUTOMATION_PATCH_KEYS = /* @__PURE__ */ new Set(["name", "instruction", "kind", "schedule", "time", "everyMinutes", "weekday", "enabled", "mode"]);
const AUTOMATION_KINDS = /* @__PURE__ */ new Set(["brain", "sleep", "summary", "librarian", "evolve", "enrich", "review", "security", "skills", "triage"]);
const AUTOMATION_SCHEDULES = /* @__PURE__ */ new Set(["daily", "interval", "weekly"]);
function bad(field) {
  throw new Error(`invalid IPC payload: ${field}`);
}
function optStr(v, field, max = 8192) {
  if (v !== void 0 && (typeof v !== "string" || v.length > max)) bad(field);
}
function reqStr(v, field, max = 8192) {
  if (typeof v !== "string" || !v.length || v.length > max) bad(field);
}
function validateMcpServerShape(s, partial) {
  if (!isPlainObject(s)) bad("mcp server");
  if (partial) {
    for (const k of Object.keys(s)) if (!MCP_PATCH_KEYS.has(k)) bad(`mcp.${k}`);
  }
  if (!partial || s.id !== void 0) reqStr(s.id, "mcp.id", 128);
  if (!partial || s.name !== void 0) reqStr(s.name, "mcp.name", 256);
  if (!partial || s.kind !== void 0) {
    if (!MCP_KINDS.has(s.kind)) bad("mcp.kind");
  }
  if (s.enabled !== void 0 && typeof s.enabled !== "boolean") bad("mcp.enabled");
  if (s.permission !== void 0 && !MCP_PERMISSIONS.has(s.permission)) bad("mcp.permission");
  optStr(s.command, "mcp.command");
  optStr(s.sessionDir, "mcp.sessionDir", 1024);
  if (s.args !== void 0) {
    if (!Array.isArray(s.args) || s.args.length > 64 || s.args.some((a) => typeof a !== "string" || a.length > 2048)) bad("mcp.args");
  }
  if (s.env !== void 0) {
    if (!isPlainObject(s.env)) bad("mcp.env");
    const entries = Object.entries(s.env);
    if (entries.length > 64) bad("mcp.env size");
    for (const [k, v] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string" || v.length > 8192) bad("mcp.env entry");
    }
  }
}
function validateAiPatch(p) {
  if (!isPlainObject(p)) bad("ai patch");
  for (const k of Object.keys(p)) if (!["provider", "apiKey", "model", "baseUrl"].includes(k)) bad(`ai.${k}`);
  if (p.provider !== void 0 && !AI_PROVIDERS.has(p.provider)) bad("ai.provider");
  optStr(p.apiKey, "ai.apiKey", 512);
  optStr(p.model, "ai.model", 256);
  optStr(p.baseUrl, "ai.baseUrl", 512);
}
function validateGithubPatch(p) {
  if (!isPlainObject(p)) bad("github patch");
  for (const k of Object.keys(p)) {
    if (!["accessToken", "refreshToken", "login", "repoOwner", "repoName", "repoUrl", "defaultBranch", "syncRoot"].includes(k)) bad(`github.${k}`);
  }
  for (const k of Object.keys(p)) optStr(p[k], `github.${k}`, 2048);
}
function validateLocalLlmPatch(p) {
  if (!isPlainObject(p)) bad("localLlm patch");
  for (const k of Object.keys(p)) {
    if (!["modelId", "modelPath", "embedModelId"].includes(k)) {
      if (k === "port") {
        if (typeof p.port !== "number" || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535) bad("localLlm.port");
      } else if (k === "downloadedBytes" || k === "totalBytes") {
        if (typeof p[k] !== "number" || !Number.isFinite(p[k]) || p[k] < 0) bad(`localLlm.${k}`);
      } else bad(`localLlm.${k}`);
    } else optStr(p[k], `localLlm.${k}`, 1024);
  }
}
function validateAutomationPatch(p) {
  if (!isPlainObject(p)) bad("automation patch");
  for (const k of Object.keys(p)) if (!AUTOMATION_PATCH_KEYS.has(k)) bad(`automation.${k}`);
  optStr(p.name, "automation.name", 256);
  optStr(p.instruction, "automation.instruction", 8192);
  if (p.kind !== void 0 && !AUTOMATION_KINDS.has(p.kind)) bad("automation.kind");
  if (p.schedule !== void 0 && !AUTOMATION_SCHEDULES.has(p.schedule)) bad("automation.schedule");
  optStr(p.time, "automation.time", 16);
  if (p.everyMinutes !== void 0 && (typeof p.everyMinutes !== "number" || p.everyMinutes < 1 || p.everyMinutes > 10080)) bad("automation.everyMinutes");
  if (p.weekday !== void 0 && (typeof p.weekday !== "number" || p.weekday < 0 || p.weekday > 6)) bad("automation.weekday");
  if (p.enabled !== void 0 && typeof p.enabled !== "boolean") bad("automation.enabled");
  if (p.mode !== void 0 && p.mode !== "auto" && p.mode !== "approval") bad("automation.mode");
}
function registerIpc(store2, brain2, mcp2, localLlm, sync = null, automations = null, auth = null, rag = null, planner = null, laya = null, hooks = null) {
  electron.ipcMain.handle("config:get", () => store2.get());
  electron.ipcMain.handle("config:set", (_e, patch) => {
    if (!isPlainObject(patch)) bad("config patch");
    for (const k of Object.keys(patch)) if (!CONFIG_SET_KEYS.has(k)) bad(`config.${k}`);
    if (patch.onboardingDone !== void 0 && typeof patch.onboardingDone !== "boolean") bad("onboardingDone");
    if (patch.mcpServers !== void 0) {
      if (!Array.isArray(patch.mcpServers) || patch.mcpServers.length > 32) bad("mcpServers");
      for (const s of patch.mcpServers) validateMcpServerShape(s, false);
    }
    return store2.set(stripForbiddenKeys(patch));
  });
  electron.ipcMain.handle("config:updateAi", (_e, patch) => {
    validateAiPatch(patch);
    return store2.updateAi(stripForbiddenKeys(patch));
  });
  electron.ipcMain.handle("config:updateLocalLlm", (_e, patch) => {
    validateLocalLlmPatch(patch);
    return store2.updateLocalLlm(stripForbiddenKeys(patch));
  });
  electron.ipcMain.handle("config:updateGithub", (_e, patch) => {
    validateGithubPatch(patch);
    return store2.updateGithub(stripForbiddenKeys(patch));
  });
  electron.ipcMain.handle("config:updateMcp", (_e, id, patch) => {
    reqStr(id, "mcp id", 128);
    validateMcpServerShape(patch, true);
    return store2.updateMcpServer(id, stripForbiddenKeys(patch));
  });
  electron.ipcMain.handle("ai:providers", () => listProviders());
  electron.ipcMain.handle("ai:codexStatus", () => codexStatus());
  electron.ipcMain.handle("ai:test", async (e, provider) => {
    try {
      if (provider.provider === "local" && localLlm) {
        const modelId = provider.model ?? store2.get().localLlm.modelId ?? LOCAL_MODELS[1].id;
        const ok = await localLlm.ensureReady(modelId);
        if (!ok) return { ok: false, error: "Local model failed to start (download may be required)" };
      }
      const res = await chat(provider, [
        { role: "user", content: "Reply with exactly: OK" }
      ], [], localLlm?.endpoint);
      return { ok: true, reply: res.text.slice(0, 100) };
    } catch (e2) {
      return { ok: false, error: String(e2?.message ?? e2) };
    }
  });
  electron.ipcMain.handle("localllm:status", () => ({
    catalog: LOCAL_MODELS,
    serverDownloaded: localLlm?.isServerDownloaded() ?? false,
    running: localLlm?.isRunning ?? false,
    endpoint: localLlm?.endpoint,
    config: store2.get().localLlm,
    currentModelDownloaded: localLlm ? localLlm.isModelDownloaded() : false,
    embedCatalog: EMBED_MODELS
  }));
  electron.ipcMain.handle("localllm:downloadServer", async (e) => {
    if (!localLlm) throw new Error("no local llm");
    const win = electron.BrowserWindow.fromWebContents(e.sender);
    const bin = await localLlm.downloadServer((pct) => {
      win?.webContents.send("localllm:progress", { kind: "server", pct });
    });
    return { ok: true, bin };
  });
  electron.ipcMain.handle("localllm:downloadModel", async (e, modelId) => {
    if (!localLlm) throw new Error("no local llm");
    const win = electron.BrowserWindow.fromWebContents(e.sender);
    const path = await localLlm.downloadModel(modelId, (dl, total) => {
      win?.webContents.send("localllm:progress", { kind: "model", modelId, downloaded: dl, total });
    });
    return { ok: true, path };
  });
  electron.ipcMain.handle("localllm:ensure", async (_e, modelId) => {
    if (!localLlm) throw new Error("no local llm");
    const id = modelId ?? store2.get().localLlm.modelId ?? LOCAL_MODELS[1].id;
    await localLlm.ensureReady(id);
    return { ok: true, endpoint: localLlm.endpoint };
  });
  electron.ipcMain.handle("localllm:stop", async () => {
    await localLlm?.stop();
    return true;
  });
  electron.ipcMain.handle("github:startDeviceFlow", async () => {
    const dc = await startDeviceFlow();
    return dc;
  });
  electron.ipcMain.handle("github:pollDeviceFlow", async (_e, deviceCode) => {
    const res = await pollDeviceFlow(deviceCode);
    if (res.status === "success") {
      store2.updateGithub({ accessToken: res.accessToken });
      try {
        const me = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${res.accessToken}`, Accept: "application/vnd.github+json" }
        }).then((r) => r.json());
        store2.updateGithub({ login: me.login });
      } catch {
      }
    }
    return res;
  });
  electron.ipcMain.handle("github:listRepos", async () => {
    const t = store2.get().github.accessToken;
    if (!t) return [];
    try {
      return await listUserRepos(t);
    } catch {
      return [];
    }
  });
  electron.ipcMain.handle("github:useRepo", async (_e, owner, repo) => {
    const t = store2.get().github.accessToken;
    if (!t) throw new Error("Not authenticated");
    const r = await getRepo(t, owner, repo);
    const hasMemoryDir = (await listRepoFiles({ accessToken: t, repoOwner: owner, repoName: repo }, "memory")).length > 0;
    store2.updateGithub({
      repoOwner: owner,
      repoName: repo,
      repoUrl: r.html_url,
      defaultBranch: r.default_branch,
      syncRoot: hasMemoryDir ? "memory/" : ""
    });
    sync?.maybeScaffold().catch(() => {
    });
    return r;
  });
  electron.ipcMain.handle("github:createRepo", async (_e, name, description) => {
    const cfg = store2.get().github;
    if (!cfg.accessToken) throw new Error("Not authenticated");
    const repo = await createRepo(cfg.accessToken, name, description, true);
    const [owner] = repo.full_name.split("/");
    store2.updateGithub({
      repoOwner: owner,
      repoName: repo.full_name.split("/")[1],
      repoUrl: repo.html_url,
      defaultBranch: repo.default_branch
    });
    sync?.maybeScaffold().catch(() => {
    });
    return repo;
  });
  electron.ipcMain.handle("github:pushMemory", async (_e, message) => {
    const gh = store2.get().github;
    if (!gh.accessToken || !gh.repoOwner) throw new Error("GitHub not connected");
    const memDir = store2.memoryDir;
    const files = collectMd(memDir);
    for (const rel of files) {
      const content = node_fs.readFileSync(node_path.join(memDir, rel), "utf8");
      await pushFile(gh, `memory/${rel}`, content, message);
    }
    return { pushed: files.length };
  });
  electron.ipcMain.handle("mcp:start", async (_e, id) => {
    const cfg = store2.get().mcpServers.find((s) => s.id === id);
    if (!cfg) throw new Error("Unknown server");
    if (!mcp2) throw new Error("MCP manager not initialized");
    const tools = await mcp2.startServer(cfg);
    return { tools: tools.map((t) => t.name) };
  });
  electron.ipcMain.handle("mcp:stop", async (_e, id) => {
    await mcp2?.stopServer(id);
    return true;
  });
  electron.ipcMain.handle("mcp:status", () => ({
    running: mcp2?.runningServers ?? [],
    allTools: mcp2?.allTools().map(({ serverId, tool }) => ({ serverId, name: tool.name, description: tool.description })) ?? []
  }));
  electron.ipcMain.handle("mcp:connectorQr", (_e, id) => {
    const srv = store2.get().mcpServers.find((s) => s.id === id);
    if (!srv) return null;
    const sessionDir = srv.sessionDir ?? (id === "whatsapp" ? node_path.join(electron.app.getPath("userData"), "wa-session") : null) ?? (id === "telegram" ? node_path.join(electron.app.getPath("userData"), "tg-session") : null);
    if (!sessionDir) return null;
    const qrFile = node_path.join(sessionDir, "qr.txt");
    if (!node_fs.existsSync(qrFile)) return null;
    const v = node_fs.readFileSync(qrFile, "utf8");
    if (v === "CONNECTED") return { status: "connected" };
    if (/^(LOGGED_OUT|ERROR|LOGIN_FAILED|QR_EXPIRED)$/.test(v)) return { status: "error", code: v };
    return { status: "qr", dataUrl: v };
  });
  electron.ipcMain.handle("mcp:whatsappQr", () => {
    const qrFile = node_path.join(store2.get().mcpServers.find((s) => s.id === "whatsapp")?.sessionDir ?? "", "qr.txt");
    if (!node_fs.existsSync(qrFile)) return null;
    const v = node_fs.readFileSync(qrFile, "utf8");
    if (v === "CONNECTED") return { status: "connected" };
    if (v === "LOGGED_OUT") return { status: "logged_out" };
    return { status: "qr", dataUrl: v };
  });
  electron.ipcMain.handle("mcp:logs", () => mcpLogs);
  electron.ipcMain.handle("sync:status", () => sync?.status() ?? { connected: false, pending: 0, lastPull: null, lastPush: null, syncing: false });
  electron.ipcMain.handle("sync:now", async () => sync ? sync.syncNow() : null);
  electron.ipcMain.handle("automation:list", () => store2.get().automations);
  electron.ipcMain.handle("automation:parse", (_e, text) => parseNaturalSchedule(text));
  electron.ipcMain.handle("automation:create", (_e, input) => {
    const parsed = parseNaturalSchedule(input.instruction);
    const auto = {
      id: `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: input.name ?? parsed.name,
      instruction: input.instruction,
      kind: input.kind ?? parsed.kind,
      schedule: input.schedule ?? parsed.schedule,
      time: input.time ?? parsed.time,
      everyMinutes: input.everyMinutes ?? parsed.everyMinutes,
      weekday: input.weekday ?? parsed.weekday,
      enabled: input.enabled ?? true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    store2.set({ automations: [...store2.get().automations, auto] });
    return auto;
  });
  electron.ipcMain.handle("automation:update", (_e, id, patch) => {
    reqStr(id, "automation id", 128);
    validateAutomationPatch(patch);
    store2.set({
      automations: store2.get().automations.map((a) => a.id === id ? { ...a, ...patch } : a)
    });
    return store2.get().automations.find((a) => a.id === id);
  });
  electron.ipcMain.handle("automation:remove", (_e, id) => {
    store2.set({ automations: store2.get().automations.filter((a) => a.id !== id) });
    return true;
  });
  electron.ipcMain.handle("automation:runNow", async (_e, id) => {
    const auto = store2.get().automations.find((a) => a.id === id);
    if (!auto) throw new Error("Unknown automation");
    if (automations) await automations.run(auto);
    store2.set({
      automations: store2.get().automations.map((a) => a.id === id ? { ...a, lastRunAt: (/* @__PURE__ */ new Date()).toISOString() } : a)
    });
    return true;
  });
  electron.ipcMain.handle("automation:setWebhook", (_e, id, enabled) => {
    reqStr(id, "automation id", 128);
    if (typeof enabled !== "boolean") bad("webhook flag");
    const auto = automations?.setWebhook(id, enabled);
    if (!auto) throw new Error("Unknown automation");
    if (enabled) hooks?.ensureStarted();
    return {
      webhook: !!auto.webhook,
      url: auto.webhook && hooks ? `http://${hooks.host}:${hooks.port}/hook/${auto.id}` : null,
      token: auto.webhook ? auto.webhookToken : null
    };
  });
  electron.ipcMain.handle("hooks:status", () => ({
    running: hooks?.running ?? false,
    host: hooks?.host ?? "127.0.0.1",
    port: hooks?.port ?? 4789,
    lan: !!store2.get().hooks?.lan
  }));
  electron.ipcMain.handle("hooks:setLan", (_e, lan) => {
    if (typeof lan !== "boolean") bad("lan flag");
    store2.set({ hooks: { lan } });
    hooks?.restart();
    return { lan };
  });
  electron.ipcMain.handle("automation:pending", () => store2.get().pendingApprovals);
  electron.ipcMain.handle("automation:approve", async (_e, pendingId) => {
    const pending = store2.get().pendingApprovals.find((p) => p.id === pendingId);
    if (!pending) throw new Error("Unknown pending approval");
    const auto = store2.get().automations.find((a) => a.id === pending.automationId);
    store2.set({ pendingApprovals: store2.get().pendingApprovals.filter((p) => p.id !== pendingId) });
    if (auto && automations) {
      await automations.run(auto);
      store2.set({
        automations: store2.get().automations.map((a) => a.id === auto.id ? { ...a, lastRunAt: (/* @__PURE__ */ new Date()).toISOString() } : a)
      });
    }
    return true;
  });
  electron.ipcMain.handle("automation:reject", (_e, pendingId) => {
    store2.set({ pendingApprovals: store2.get().pendingApprovals.filter((p) => p.id !== pendingId) });
    return true;
  });
  electron.ipcMain.handle("brain:chat", async (e, agentId, message) => {
    brain2.setActivitySource("chat");
    const win = electron.BrowserWindow.fromWebContents(e.sender);
    return brain2.chat(agentId, message, (t) => {
      win?.webContents.send("brain:delta", t);
    });
  });
  electron.ipcMain.handle("brain:insights", async () => {
    brain2.setActivitySource("summary");
    await brain2.ensureProviderReady();
    return brain2.generateInsights();
  });
  electron.ipcMain.handle("brain:dailySummary", async () => {
    brain2.setActivitySource("summary");
    await brain2.ensureProviderReady();
    return brain2.dailySummary();
  });
  electron.ipcMain.handle("brain:sleep", async () => {
    brain2.setActivitySource("sleep");
    await brain2.ensureProviderReady();
    return brain2.sleep();
  });
  electron.ipcMain.handle("brain:listSleep", () => brain2.listSleepReports());
  electron.ipcMain.handle("brain:memoryTiers", () => brain2.memoryTierStats());
  electron.ipcMain.handle("brain:listInsights", () => brain2.listInsights());
  electron.ipcMain.handle("brain:listSummaries", () => brain2.listSummaries());
  electron.ipcMain.handle("brain:listMemory", () => {
    const memDir = store2.memoryDir;
    return collectMd(memDir).map((rel) => ({ path: rel, content: node_fs.readFileSync(node_path.join(memDir, rel), "utf8").slice(0, 1500) }));
  });
  electron.ipcMain.handle("brain:graph", () => brain2.memoryGraph());
  electron.ipcMain.handle("brain:memoryFile", (_e, rel) => {
    if (typeof rel !== "string" || rel.length > 500) return null;
    return brain2.readMemoryFile(rel);
  });
  electron.ipcMain.handle("brain:exportConfig", async () => {
    const gh = store2.get().github;
    if (!gh.accessToken || !gh.repoOwner) throw new Error("GitHub not configured");
    await exportBrainConfig(gh, store2.get());
    return true;
  });
  electron.ipcMain.handle("brain:activity", (_e, limit) => brain2.getMemory().activity(limit ?? 200));
  electron.ipcMain.handle("auth:state", async () => {
    if (!auth) return { needsSetup: false, user: null };
    const token = store2.get().auth.sessionToken;
    const user = await auth.userByToken(token);
    return { needsSetup: !await auth.hasUsers(), user };
  });
  electron.ipcMain.handle("auth:register", async (_e, email, password, name) => {
    if (!auth) throw new Error("auth unavailable");
    const user = await auth.register(email, password, name);
    const token = await auth.createSession(user.id);
    store2.set({ auth: { ...store2.get().auth, sessionToken: token } });
    return user;
  });
  electron.ipcMain.handle("auth:login", async (_e, email, password) => {
    if (!auth) throw new Error("auth unavailable");
    const user = await auth.verifyPassword(email, password);
    if (!user) throw new Error("Invalid email or password");
    const token = await auth.createSession(user.id);
    store2.set({ auth: { ...store2.get().auth, sessionToken: token } });
    return user;
  });
  electron.ipcMain.handle("auth:logout", async () => {
    const token = store2.get().auth.sessionToken;
    if (auth && token) await auth.deleteSession(token);
    store2.set({ auth: { ...store2.get().auth, sessionToken: void 0 } });
    return true;
  });
  electron.ipcMain.handle("auth:googleLogin", async () => {
    if (!auth) throw new Error("auth unavailable");
    const a = store2.get().auth;
    const profile = await googleLogin({ clientId: a.googleClientId ?? "", clientSecret: a.googleClientSecret ?? "" });
    const user = await auth.upsertGoogle(profile);
    const token = await auth.createSession(user.id);
    store2.set({ auth: { ...store2.get().auth, sessionToken: token } });
    return user;
  });
  electron.ipcMain.handle("auth:setGoogleCreds", (_e, clientId, clientSecret) => {
    store2.set({ auth: { ...store2.get().auth, googleClientId: clientId || void 0, googleClientSecret: clientSecret || void 0 } });
    return true;
  });
  electron.ipcMain.handle("billing:status", () => store2.get().pro);
  electron.ipcMain.handle("billing:setPaymentUrl", (_e, url) => {
    store2.set({ pro: { ...store2.get().pro, paymentUrl: url || void 0 } });
    return true;
  });
  electron.ipcMain.handle("billing:activate", (_e, key) => {
    store2.set({ pro: { ...store2.get().pro, active: true, key: key || "manual" } });
    return store2.get().pro;
  });
  electron.ipcMain.handle("rag:status", () => rag?.stats ?? { available: false, running: false, chunks: 0, embedded: 0 });
  electron.ipcMain.handle("rag:setup", async (e, modelId) => {
    if (!localLlm) throw new Error("no local llm");
    const win = electron.BrowserWindow.fromWebContents(e.sender);
    await localLlm.downloadEmbedModel(modelId, (dl, total) => {
      win?.webContents.send("localllm:progress", { kind: "embed", downloaded: dl, total });
    });
    await localLlm.ensureEmbedRunning();
    if (rag) await rag.reindex();
    return rag?.stats ?? null;
  });
  electron.ipcMain.handle("rag:reindex", async () => rag ? rag.reindex() : null);
  electron.ipcMain.handle("models:list", () => {
    if (!localLlm) return [];
    return listModels(localLlm, laya);
  });
  electron.ipcMain.handle("models:delete", async (_e, key) => {
    if (!localLlm || typeof key !== "string" || key.length > 80) throw new Error("invalid model key");
    const res = await deleteModel(localLlm, laya, key);
    pushMcpLog(`model deleted: ${key} (${(res.freedBytes / 1e6).toFixed(0)}MB)`);
    return res;
  });
  electron.ipcMain.handle("laya:status", () => laya?.status() ?? { available: false, loaded: false, modelDir: "", downloaded: false });
  electron.ipcMain.handle("laya:download", async (e) => {
    if (!laya) throw new Error("laya unavailable");
    const win = electron.BrowserWindow.fromWebContents(e.sender);
    await laya.download((done, total, file) => {
      win?.webContents.send("laya:progress", { done, total, file });
    });
    return laya.status();
  });
  electron.ipcMain.handle("laya:test", async () => {
    if (!laya) return null;
    return laya.choose("The user prefers dark mode and concise answers.", "What does the user prefer?", {
      dark: "dark theme / dark mode",
      light: "light theme",
      other: "something else"
    });
  });
  electron.ipcMain.handle("notes:list", () => planner?.listNotes() ?? []);
  electron.ipcMain.handle("notes:get", (_e, id) => planner?.getNote(id) ?? null);
  const ui = (fn) => {
    brain2.setActivitySource("ui");
    return fn();
  };
  electron.ipcMain.handle("notes:save", (_e, id, title, body) => ui(() => planner?.saveNote(id, title, body)));
  electron.ipcMain.handle("notes:delete", (_e, id) => ui(() => {
    planner?.deleteNote(id);
    return true;
  }));
  electron.ipcMain.handle("tasks:list", () => planner?.listTasks() ?? []);
  electron.ipcMain.handle("tasks:add", (_e, title, opts) => ui(() => planner?.addTask(title, opts)));
  electron.ipcMain.handle("tasks:update", (_e, id, patch) => ui(() => planner?.updateTask(id, patch)));
  electron.ipcMain.handle("tasks:toggle", (_e, id) => ui(() => planner?.toggleTask(id)));
  electron.ipcMain.handle("tasks:delete", (_e, id) => ui(() => {
    planner?.deleteTask(id);
    return true;
  }));
  electron.ipcMain.handle("goals:get", (_e, date) => planner?.getDailyGoals(date) ?? { date: "", items: [] });
  electron.ipcMain.handle("goals:set", (_e, date, items) => ui(() => planner?.setDailyGoals(date, items)));
  electron.ipcMain.handle("goals:add", (_e, date, text) => ui(() => planner?.addGoal(date, text)));
  electron.ipcMain.handle("goals:toggle", (_e, date, index) => ui(() => planner?.toggleGoal(date, index)));
  electron.ipcMain.handle("goals:remove", (_e, date, index) => ui(() => planner?.removeGoal(date, index)));
  electron.ipcMain.handle("goals:suggest", async () => planner ? planner.suggestGoals() : []);
  electron.ipcMain.handle("updater:status", () => updaterStatus());
  electron.ipcMain.handle("updater:check", () => checkForUpdates());
  electron.ipcMain.handle("updater:install", () => installUpdate());
  electron.ipcMain.handle("shell:openExternal", (_e, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "mailto:") return electron.shell.openExternal(url);
    } catch {
    }
    return false;
  });
}
const mcpLogs = [];
function pushMcpLog(line) {
  mcpLogs.push(line);
  if (mcpLogs.length > 500) mcpLogs.shift();
}
function collectMd(dir, prefix = "") {
  const out = [];
  if (!node_fs.existsSync(dir)) return out;
  for (const e of node_fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...collectMd(node_path.join(dir, e.name), rel));
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}
let mainWindow = null;
let store;
let brain;
let mcp = null;
let localLlmGlobal = null;
let gitSyncGlobal = null;
let autoSchedulerGlobal = null;
const HEADLESS = process.env.SECOND_BRAIN_HEADLESS === "1" || process.argv.includes("--headless");
function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "mailto:") electron.shell.openExternal(url);
  } catch {
  }
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#030712",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  store = new Store();
  mcp = new McpManager(store.get().mcpServers, electron.app.getPath("userData"));
  const localLlm = new LocalLlm(store);
  localLlmGlobal = localLlm;
  brain = new Brain(store, mcp, localLlm);
  brain.setMcp(mcp);
  const gitSync = new GitSync(store, brain.getMemory(), node_path.join(electron.app.getPath("userData"), "second-brain"));
  brain.attachSync(gitSync);
  gitSyncGlobal = gitSync;
  const autoScheduler = new AutomationScheduler(store, brain, (m) => pushMcpLog(`[auto] ${m}`));
  autoSchedulerGlobal = autoScheduler;
  const hookServer = new HookServer(store, autoScheduler, (m) => pushMcpLog(`[hook] ${m}`));
  const auth = new AuthService(node_path.join(electron.app.getPath("userData"), "second-brain"));
  const rag = new RagService(localLlm, brain.getMemory(), node_path.join(electron.app.getPath("userData"), "second-brain"));
  brain.setRag(rag);
  const laya = new LayaService();
  brain.setLaya(laya);
  rag.setLaya(laya);
  mcp.on("log", (m) => pushMcpLog(`[${m.serverId}] ${m.message}`));
  mcp.on("serverExit", (e) => pushMcpLog(`server ${e.serverId} exited (${e.code})`));
  const planner = new Planner(brain.getMemory(), store, localLlm);
  registerIpc(store, brain, mcp, localLlm, gitSync, autoScheduler, auth, rag, planner, laya, hookServer);
  initUpdater();
  if (!HEADLESS) createWindow();
  else console.log("[keepmind] headless mode — services only, no window");
  gitSync.start();
  setTimeout(() => {
    void brain.triageVaultTasks().catch(() => {
    });
  }, 3e4);
  autoScheduler.start();
  if (localLlm.isEmbedModelDownloaded()) {
    localLlm.ensureEmbedRunning().then((ok) => {
      if (ok) rag.reindex().catch(() => {
      });
    }).catch((e) => pushMcpLog(`embed server start failed: ${e}`));
  }
  for (const s of store.get().mcpServers.filter((s2) => s2.enabled && s2.permission !== "block" && s2.permission !== "ask")) {
    mcp.startServer(s).catch((e) => pushMcpLog(`auto-start ${s.id} failed: ${e}`));
  }
  if (store.get().automations.some((a) => a.enabled && a.webhook)) {
    hookServer.ensureStarted();
  }
  if (store.get().ai.provider === "local" && localLlm.isModelDownloaded()) {
    localLlm.ensureRunning().catch((e) => pushMcpLog(`local-llm start failed: ${e}`));
  }
  setTimeout(async () => {
    try {
      const today2 = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const hasSummary = brain.listSummaries().some((s) => s.date === today2);
      if (!hasSummary && store.isConfigured) {
        await brain.generateInsights();
        await brain.dailySummary();
        pushMcpLog("auto: daily insights + summary generated");
      }
    } catch (e) {
      pushMcpLog(`auto-summary failed: ${e}`);
    }
  }, 45e3);
  if (HEADLESS) {
    const shutdown = () => {
      mcp?.stopAll();
      localLlmGlobal?.stop();
      gitSyncGlobal?.stop();
      autoSchedulerGlobal?.stop();
      electron.app.quit();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0 && !HEADLESS) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (HEADLESS) return;
  mcp?.stopAll();
  localLlmGlobal?.stop();
  gitSyncGlobal?.stop();
  autoSchedulerGlobal?.stop();
  if (process.platform !== "darwin") electron.app.quit();
});
