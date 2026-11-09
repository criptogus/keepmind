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
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
function pyNumber(v) {
  const [mant, exp] = v.toExponential().split("e");
  const e = Number(exp);
  if (e >= -4 && e < 16) return String(v);
  return `${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}
function pyJson(v) {
  if (v === null) return "null";
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    return pyNumber(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => pyJson(x) ?? "null").join(", ")}]`;
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return void 0;
    const parts = [];
    for (const [k, x] of Object.entries(v)) {
      const s = pyJson(x);
      if (s !== void 0) parts.push(`${JSON.stringify(k)}: ${s}`);
    }
    return `{${parts.join(", ")}}`;
  }
  return void 0;
}
function serializeState(state) {
  if (typeof state === "string") return state;
  return pyJson(state) ?? String(state);
}
function renderCriterion(v) {
  return typeof v === "string" ? v : pyJson(v) ?? String(v);
}
function renderOptions(q2) {
  if (q2.t === "choice") {
    const crit2 = q2.crit;
    return Object.entries(crit2).map(([k, v]) => v === null || v === void 0 || v === "" ? k : `${k}: ${renderCriterion(v)}`);
  }
  if (q2.t === "score") {
    return q2.crit.map((c, i) => `level ${i}: ${renderCriterion(c)}`);
  }
  const crit = q2.crit ?? {};
  const labels = q2.labels ?? { false: "false", true: "true" };
  const f = crit["false"], t = crit["true"];
  return [
    labels.false + ": " + (f !== null && f !== void 0 && f !== "" ? renderCriterion(f) : "no, the statement does not hold"),
    labels.true + ": " + (t !== null && t !== void 0 && t !== "" ? renderCriterion(t) : "yes, the statement holds")
  ];
}
const prefixCache = /* @__PURE__ */ new WeakMap();
function buildQuestionPrefix(tok, q2, maxLen = 512, headMaxLen = 192, optionOrder) {
  let per = prefixCache.get(tok);
  if (!per) {
    per = /* @__PURE__ */ new Map();
    prefixCache.set(tok, per);
  }
  const key = JSON.stringify([q2.t, q2.ins, renderOptions(q2), maxLen, headMaxLen, optionOrder ?? null]);
  const hit = per.get(key);
  if (hit) return hit;
  const built = buildQuestionPrefixUncached(tok, q2, maxLen, headMaxLen, optionOrder);
  if (per.size > 1e3) per.clear();
  per.set(key, built);
  return built;
}
function buildQuestionPrefixUncached(tok, q2, maxLen = 512, headMaxLen = 192, optionOrder) {
  const maskTok = tok.maskToken;
  const opts = renderOptions(q2);
  const order = optionOrder ?? opts.map((_, i) => i);
  const ins = String(q2.ins).split(maskTok).join(" ");
  let headIds = tok.encode(`${q2.t} question: ${ins}`);
  let optIds = order.map((i) => [tok.maskId, ...tok.encode(" " + opts[i].split(maskTok).join(" ")).slice(0, 48)]);
  let budget = headMaxLen - optIds.reduce((a, o) => a + o.length, 0);
  let tokensPerOption = null;
  if (budget < 16) {
    const per = Math.max(4, Math.floor((headMaxLen - 16) / Math.max(1, optIds.length)));
    optIds = optIds.map((o) => o.slice(0, per));
    budget = headMaxLen - optIds.reduce((a, o) => a + o.length, 0);
    tokensPerOption = per;
  }
  headIds = headIds.slice(0, Math.max(8, budget));
  const ids = [tok.clsId, ...headIds, tok.sepId];
  const markers = [];
  for (const o of optIds) {
    markers.push(ids.length);
    ids.push(...o);
  }
  ids.push(tok.sepId);
  return {
    ids,
    markers,
    nOptions: opts.length,
    optionStats: {
      total: opts.length,
      distinct: new Set(optIds.map((o) => o.join(","))).size,
      tokens_per_option: tokensPerOption
    }
  };
}
function sequenceWithState(prefix, stateIds, sepId, maxLen = 512, truncateLeft = false) {
  const room = Math.max(0, maxLen - prefix.ids.length - 1);
  const kept = truncateLeft ? stateIds.slice(Math.max(0, stateIds.length - room)) : stateIds.slice(0, room);
  const ids = [...prefix.ids, ...kept, sepId].slice(0, maxLen);
  const used = Math.max(0, Math.min(kept.length, maxLen - prefix.ids.length));
  return {
    ids,
    markers: prefix.markers.filter((m) => m < maxLen),
    stats: {
      state_tokens: stateIds.length,
      state_tokens_used: used,
      state_tokens_dropped: stateIds.length - used,
      truncated: used < stateIds.length,
      options: prefix.optionStats
    }
  };
}
function collapsedOptions(qids, stats) {
  const out = {};
  qids.forEach((qid, i) => {
    const s = stats[i]?.options;
    if (s && s.distinct < s.total) out[qid] = {
      total: s.total,
      distinct: s.distinct,
      tokens_per_option: s.tokens_per_option
    };
  });
  return out;
}
function buildSequence(tok, state, q2, maxLen = 512, headMaxLen = 192, optionOrder, truncateLeft = false) {
  const stAll = tok.encode(serializeState(state).split(tok.maskToken).join(" "));
  return sequenceWithState(buildQuestionPrefix(tok, q2, maxLen, headMaxLen, optionOrder), stAll, tok.sepId, maxLen, truncateLeft);
}
function unpermuteProbs(p, order) {
  if (!order || order.length !== p.length) return p;
  const canonical = new Array(p.length);
  for (let s = 0; s < order.length; s++) canonical[order[s]] = p[s];
  return canonical;
}
function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
function confidenceFromProbs(p) {
  const k = p.length;
  if (k < 2) return 1;
  const ent = -p.reduce((a, v) => a + v * Math.log(Math.max(v, 1e-12)), 0);
  return Math.min(1, Math.max(0, 1 - ent / Math.log(k)));
}
function answerConfidence(p) {
  if (p.length < 1) return 1;
  return Math.min(1, Math.max(0, Math.max(...p)));
}
function pyRepr(v) {
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v === null || v === void 0) return "None";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "nan";
    if (v === Infinity) return "inf";
    if (v === -Infinity) return "-inf";
    return String(v);
  }
  if (typeof v === "string") return pyStrRepr(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (typeof v === "object") {
    const entries = Object.entries(v).map(
      ([k, val]) => `${pyRepr(k)}: ${pyRepr(val)}`
    );
    return `{${entries.join(", ")}}`;
  }
  return String(v);
}
function pyStrRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of s) {
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "	") out += "\\t";
    else if (ch < " " || ch === "") out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `${quote}${out}${quote}`;
}
const BUCKET_TYPES = ["choice", "score", "noul"];
const BUCKET_SIZES = ["2", "3-5", "6-10", "11+"];
function optionCountBucketSize(k) {
  return k <= 2 ? BUCKET_SIZES[0] : k <= 5 ? BUCKET_SIZES[1] : k <= 10 ? BUCKET_SIZES[2] : BUCKET_SIZES[3];
}
const BUCKET_KEY = new RegExp(
  `^(${BUCKET_TYPES.join("|")}):(${BUCKET_SIZES.map((size) => size.replace("+", "\\+")).join("|")})$`
);
function checkMinConfidenceMap(m) {
  if (!m || typeof m !== "object" || Array.isArray(m) || Object.keys(m).length === 0) {
    throw new Error(`a min_confidence map must be a non-empty dict of bucket -> float, got ${pyRepr(m)}`);
  }
  const out = {};
  for (const [key, val] of Object.entries(m)) {
    if (key !== "default" && !BUCKET_KEY.test(key)) {
      throw new Error(`min_confidence map keys must be a bucket like 'choice:3-5' or 'default', got ${pyRepr(key)}`);
    }
    if (typeof val === "boolean" || typeof val !== "number" || !Number.isFinite(val) || val < 0 || val > 1) {
      throw new Error(`min_confidence must be a float in [0.0, 1.0], got ${pyRepr(val)}`);
    }
    out[key] = val;
  }
  return out;
}
function checkMinConfidence(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return checkMinConfidenceMap(v);
  }
  if (typeof v === "boolean" || typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`min_confidence must be a float in [0.0, 1.0], got ${pyRepr(v)}`);
  }
  return v;
}
const DECIMAL_DIGIT = /\p{Nd}/u;
function decimalValue(ch) {
  const code = ch.codePointAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  let zero = code;
  while (zero > 0 && code - zero < 9 && DECIMAL_DIGIT.test(String.fromCodePoint(zero - 1))) zero--;
  return code - zero;
}
function intFromText(text) {
  const body = text.trim();
  const negative = body.startsWith("-");
  const digits = negative || body.startsWith("+") ? body.slice(1) : body;
  const chars = [...digits];
  if (chars.length === 0) return null;
  let value = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "_") {
      if (i === 0 || i === chars.length - 1 || chars[i - 1] === "_") return null;
      continue;
    }
    if (!DECIMAL_DIGIT.test(ch)) return null;
    value = value * 10 + decimalValue(ch);
  }
  return negative ? -value : value;
}
function refuseMaxLoaded(v) {
  throw new Error(`max_loaded must be a count of checkpoints to keep resident, got ${pyRepr(v)}`);
}
function checkMaxLoaded(v) {
  let count;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) refuseMaxLoaded(v);
    count = Math.trunc(v);
  } else if (typeof v === "bigint") {
    count = Math.trunc(Number(v));
  } else if (typeof v === "boolean") {
    count = v ? 1 : 0;
  } else if (typeof v === "string") {
    const read = intFromText(v);
    if (read === null) refuseMaxLoaded(v);
    count = read;
  } else {
    refuseMaxLoaded(v);
  }
  return Math.max(1, count);
}
function optionBucket(answer) {
  const qt = answer.type;
  if (qt !== "choice" && qt !== "score" && qt !== "noul") return null;
  const probs = answer.probabilities;
  let k;
  if (probs && typeof probs === "object" && !Array.isArray(probs)) {
    k = Object.keys(probs).length;
  } else if (qt === "noul") {
    k = 2;
  } else {
    return null;
  }
  const size = optionCountBucketSize(k);
  return `${qt}:${size}`;
}
function resolveMinConfidence(answer, thresholds, defaultVal = 0) {
  const key = optionBucket(answer);
  if (key !== null) {
    const threshold = thresholds[key];
    if (threshold !== void 0) return threshold;
  }
  return thresholds.default ?? defaultVal;
}
function gateConfidence(answer) {
  const primary = answer.answer_confidence;
  if (typeof primary === "number" && Number.isFinite(primary)) return primary;
  const fallback = answer.confidence;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return null;
}
function flagLowConfidence(results, minConfidence) {
  const isMap = typeof minConfidence === "object" && minConfidence !== null;
  const list = Array.isArray(results) ? results : [results];
  for (const res of list) {
    const answers = res && typeof res === "object" ? res.answers : null;
    if (!answers || typeof answers !== "object") continue;
    for (const a of Object.values(answers)) {
      if (!a || typeof a !== "object") continue;
      const ansObj = a;
      const conf = gateConfidence(ansObj);
      if (conf === null) {
        delete ansObj.low_confidence;
        continue;
      }
      const thr = isMap ? resolveMinConfidence(ansObj, minConfidence) : minConfidence;
      if (conf < thr) {
        ansObj.low_confidence = true;
      } else {
        delete ansObj.low_confidence;
      }
    }
  }
}
const TEMP_MIN = 0.5, TEMP_MAX = 5;
function clampTemperature(t) {
  let f;
  if (typeof t === "number" || typeof t === "bigint") f = Number(t);
  else if (typeof t === "string" && t.trim() !== "") f = Number(t);
  else return 1;
  if (!Number.isFinite(f)) return 1;
  return Math.min(TEMP_MAX, Math.max(TEMP_MIN, f));
}
function tempBucket(qtype, k) {
  return `${BUCKET_TYPES[qtype]}:${optionCountBucketSize(k)}`;
}
function checkBinningMap(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) {
    throw new Error(`binning_map must be an object of bucket -> {bins, values}, got ${pyRepr(m)}`);
  }
  const out = {};
  for (const [name, entry] of Object.entries(m)) {
    if (!BUCKET_KEY.test(name)) {
      throw new Error(`binning_map key ${pyRepr(name)} is not a bucket like "choice:2" or "score:3-5"`);
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`binning_map[${pyRepr(name)}] must be an object with "bins" and "values", got ${pyRepr(entry)}`);
    }
    const rec = entry;
    const nBins = rec.bins;
    const values = rec.values;
    if (typeof nBins === "boolean" || typeof nBins !== "number" || !Number.isInteger(nBins) || nBins < 1) {
      throw new Error(`binning_map[${pyRepr(name)}] must have an integer "bins" >= 1, got ${pyRepr(nBins)}`);
    }
    if (!Array.isArray(values) || values.length !== nBins) {
      throw new Error(`binning_map[${pyRepr(name)}] must have "values" of length "bins" (${nBins})`);
    }
    const parsedValues = [];
    for (const v of values) {
      if (typeof v === "boolean" || typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`binning_map[${pyRepr(name)}] values must be numbers in [0, 1], got ${pyRepr(v)}`);
      }
      parsedValues.push(v);
    }
    out[name] = { bins: nBins, values: parsedValues };
  }
  return out;
}
function applyBinningMap(confidence, bucket, binningMap) {
  if (!Number.isFinite(confidence)) return confidence;
  const entry = binningMap?.[bucket];
  if (!entry) {
    return confidence;
  }
  const bins = entry.bins;
  const b = Math.min(bins - 1, Math.max(0, Math.floor(confidence * bins)));
  return entry.values[b];
}
function maxOf(values, fallback = 0) {
  let m = fallback;
  for (let i = 0; i < values.length; i++) if (values[i] > m) m = values[i];
  return m;
}
function collateItems(batch, padId) {
  const items = (batch ?? []).flat();
  if (items.length === 0) return null;
  let L = 0;
  let K = 0;
  for (const it of items) {
    if (it.ids.length > L) L = it.ids.length;
    if (it.markers.length > K) K = it.markers.length;
  }
  const hasTarget = items.some((it) => "target" in it);
  const inputIds = items.map((it) => [...it.ids, ...Array(L - it.ids.length).fill(padId)]);
  const attentionMask = items.map((it) => [...Array(it.ids.length).fill(1), ...Array(L - it.ids.length).fill(0)]);
  const markerPos = items.map((it) => [...it.markers, ...Array(K - it.markers.length).fill(0)]);
  const markerMask = items.map((it) => [...it.markers.map(() => true), ...Array(K - it.markers.length).fill(false)]);
  const qtype = items.map((it) => it.qtype);
  const label = items.map((it) => typeof it.label === "number" ? it.label : -1);
  const meta = items.map((it) => {
    const { ids: _ids, markers: _markers, target: _target, ...m } = it;
    return m;
  });
  const out = { inputIds, attentionMask, markerPos, markerMask, qtype, label, meta };
  if (hasTarget) {
    out.target = items.map((it, i) => {
      const t = Array.isArray(it.target) ? it.target : [];
      const k = it.markers.length;
      if (t.length > k) {
        throw new Error(
          `collateItems: item ${i} has ${t.length} target entries but only ${k} marker positions; a target needs one entry per option`
        );
      }
      return [...t, ...Array(K - t.length).fill(0)];
    });
  }
  return out;
}
class PredictContext {
  /** `states` / `questions` may be rewritten by `onPredictStart`. */
  states;
  questions;
  /** Shared by every hook of one call. */
  runId;
  /** Set by `skip()` or after inference; `onPredictEnd` may rewrite it. */
  results = null;
  /** Router: the RouteDecision. */
  decision = null;
  /** Resolved checkpoint name. */
  model = null;
  agent = null;
  router = null;
  /** Per-call token-budget overrides; null = agent config. */
  maxLen = null;
  headMaxLen = null;
  /** Aggregated input/output tokens across results. */
  usage = null;
  startedAt;
  elapsedMs = null;
  error = null;
  constructor(init) {
    this.states = init.states;
    this.questions = init.questions;
    this.runId = newRunId();
    this.startedAt = now();
    for (const [k, v] of Object.entries(init)) {
      if (k !== "states" && k !== "questions" && v !== void 0) {
        this[k] = v;
      }
    }
  }
  /** Set cached results from a start hook; inference is skipped, end hooks still run. */
  skip(results) {
    this.results = results;
  }
  /** Set elapsedMs from startedAt. Called by the dispatching call, not by hooks. */
  markElapsed() {
    this.elapsedMs = now() - this.startedAt;
  }
}
function newRunId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replaceAll("-", "");
  let hex = "";
  for (let i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return hex;
}
function now() {
  const p = globalThis.performance;
  return p && typeof p.now === "function" ? p.now() : Date.now();
}
const HOOK_EVENTS = [
  "onPredictStart",
  "onPredictEnd",
  "onRoute",
  "onLoad",
  "onEvict",
  "onError"
];
class BaseHook {
  onPredictStart(_ctx) {
  }
  onPredictEnd(_ctx) {
  }
  onRoute(_ctx) {
  }
  onLoad(_ctx) {
  }
  onEvict(_ctx) {
  }
  onError(_ctx) {
  }
}
function isHookLike(item) {
  return typeof item === "object" && item !== null && HOOK_EVENTS.some((e) => typeof item[e] === "function");
}
function typeName(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "Array";
  if (typeof v === "object") return v.constructor?.name ?? "object";
  return typeof v;
}
function normaliseHooks(hooks, onPredictStart, onPredictEnd) {
  const out = [];
  const append = (item) => {
    if (item === null || item === void 0) return;
    if (typeof item === "function") {
      if (HOOK_EVENTS.some((e) => typeof item[e] === "function")) {
        throw new TypeError(
          "a hook must be a plain callable or implement hook methods, not both"
        );
      }
      throw new TypeError(
        "a plain callable is ambiguous; pass it as onPredictStart or onPredictEnd"
      );
    }
    if (Array.isArray(item)) {
      for (const h of item) append(h);
      return;
    }
    if (typeof item !== "object") {
      throw new TypeError(`hooks must be Hook objects, got ${typeName(item)}`);
    }
    if (!isHookLike(item)) {
      throw new TypeError(
        `a hook must implement at least one hook method (${HOOK_EVENTS.join(", ")})`
      );
    }
    out.push(item);
  };
  append(hooks);
  if (onPredictStart !== null && onPredictStart !== void 0) {
    if (typeof onPredictStart !== "function") {
      throw new TypeError(`onPredictStart must be callable, got ${typeName(onPredictStart)}`);
    }
    out.push({ onPredictStart });
  }
  if (onPredictEnd !== null && onPredictEnd !== void 0) {
    if (typeof onPredictEnd !== "function") {
      throw new TypeError(`onPredictEnd must be callable, got ${typeName(onPredictEnd)}`);
    }
    out.push({ onPredictEnd });
  }
  if (onPredictStart !== null && onPredictStart !== void 0 && onPredictStart === onPredictEnd) {
    throw new TypeError(
      "onPredictStart and onPredictEnd must be different callables; one callable cannot serve both events"
    );
  }
  return out;
}
const defaultHooksList = [];
function defaultHooks() {
  return [...defaultHooksList];
}
function setDefaultHooks(hooks, onPredictStart, onPredictEnd) {
  const normalised = normaliseHooks(hooks, onPredictStart, onPredictEnd);
  defaultHooksList.length = 0;
  defaultHooksList.push(...normalised);
}
function addDefaultHook(hook) {
  defaultHooksList.push(...normaliseHooks(hook));
}
function clearDefaultHooks() {
  defaultHooksList.length = 0;
}
const defaultsRan = /* @__PURE__ */ new WeakSet();
function markDefaultsRan(opts) {
  defaultsRan.add(opts);
}
function defaultsAlreadyRan(opts) {
  return defaultsRan.has(opts);
}
function composeHooks(installed, hooks, onPredictStart, onPredictEnd) {
  if (defaultHooksList.length === 0 && installed.length === 0 && (hooks === null || hooks === void 0) && (onPredictStart === null || onPredictStart === void 0) && (onPredictEnd === null || onPredictEnd === void 0)) {
    return EMPTY_HOOKS;
  }
  return [...defaultHooksList, ...installed, ...normaliseHooks(hooks, onPredictStart, onPredictEnd)];
}
const EMPTY_HOOKS = [];
Object.freeze(EMPTY_HOOKS);
class HookRegistry {
  hooks = [];
  /** Install one hook or a list of them. Returns this for chaining. */
  addHook(hook) {
    const added = normaliseHooks(hook);
    if (added.length > 0) this.hooks = [...this.hooks, ...added];
    return this;
  }
  /** Remove a hook by identity. Returns true if it was installed. */
  removeHook(hook) {
    const before = this.hooks.length;
    this.hooks = this.hooks.filter((installed) => installed !== hook);
    return this.hooks.length !== before;
  }
  /**
   * Run `fn` with hooks installed, then remove them -- works for sync and async `fn`:
   *
   *     await router.withHooks([tracer], () => router.predict(state, questions));
   */
  withHooks(hookArgs, fn) {
    const added = normaliseHooks(hookArgs);
    this.hooks = [...this.hooks, ...added];
    const release = () => {
      this.hooks = this.hooks.filter((installed) => !added.includes(installed));
    };
    let out;
    try {
      out = fn();
    } catch (err) {
      release();
      throw err;
    }
    if (out instanceof Promise) {
      return out.finally(release);
    }
    release();
    return out;
  }
}
function aggregateUsage(results) {
  const total = (key) => results.reduce((acc, r) => {
    const usage = r?.["usage"];
    const v = usage?.[key];
    return acc + (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
  }, 0);
  return { input_tokens: total("input_tokens"), output_tokens: total("output_tokens") };
}
function reportHookFailure(hook, event, err) {
  const name = hook?.constructor?.name ?? "hook";
  console.warn(`laya: hook ${name}.${event} failed: ${String(err)}`);
}
function isThenable(value) {
  return typeof value?.then === "function";
}
function floatFromText(text) {
  const body = text.trim().toLowerCase();
  if (body === "nan" || body === "+nan" || body === "-nan") return NaN;
  if (/^[+-]?(inf|infinity)$/.test(body)) return body.startsWith("-") ? -Infinity : Infinity;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(body)) return null;
  return Number(body);
}
function validateHooksTimeout(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "boolean") {
    throw new Error(
      `hooks_timeout must be a positive finite number or None, not a bool; got ${pyRepr(value)}`
    );
  }
  let seconds;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "bigint") seconds = Number(value);
  else if (typeof value === "string") {
    const read = floatFromText(value);
    if (read === null) {
      throw new Error(`could not convert string to float: ${pyRepr(value)}`);
    }
    seconds = read;
  } else seconds = null;
  if (seconds === null) {
    throw new Error(`hooks_timeout must be a positive finite number or None; got ${pyRepr(value)}`);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`hooks_timeout must be a positive finite number or None; got ${pyRepr(value)}`);
  }
  return seconds;
}
function trimTrailingZeros(decimal) {
  const dot = decimal.indexOf(".");
  if (dot < 0) return decimal;
  let end = decimal.length;
  while (end > 0 && decimal.charAt(end - 1) === "0") end--;
  if (end > 0 && decimal.charAt(end - 1) === ".") end--;
  return decimal.slice(0, end);
}
function formatTimeoutSeconds(timeoutMs) {
  const value = timeoutMs / 1e3;
  if (!Number.isFinite(value)) return String(value);
  const scientific = value.toExponential(5);
  const marker = scientific.indexOf("e");
  if (marker < 0) return scientific;
  const exponent = Number(scientific.slice(marker + 1));
  if (exponent < -4 || exponent >= 6) {
    const sign = exponent < 0 ? "-" : "+";
    return trimTrailingZeros(scientific.slice(0, marker)) + `e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  return trimTrailingZeros(value.toFixed(5 - exponent));
}
function hookTimeoutError(operationName, timeoutMs) {
  const err = new Error(`laya: hook ${operationName} exceeded ${formatTimeoutSeconds(timeoutMs)}s`);
  err.name = "TimeoutError";
  return err;
}
async function runWithTimeout(result, timeoutMs, operationName) {
  if (timeoutMs === null || timeoutMs === void 0) {
    await result;
    return;
  }
  if (!isThenable(result)) return;
  let timer;
  try {
    await Promise.race([
      result,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(hookTimeoutError(operationName, timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
}
function dispatch(hooks, event, ctx, opts = {}) {
  const raiseErrors = opts.raiseErrors ?? true;
  for (const hook of hooks) {
    const method = hook?.[event];
    if (typeof method !== "function") continue;
    try {
      const result = method.call(hook, ctx);
      if (isThenable(result)) {
        Promise.resolve(result).catch((err) => reportHookFailure(hook, event, err));
      }
    } catch (err) {
      if (raiseErrors) throw err;
      reportHookFailure(hook, event, err);
    }
  }
}
async function dispatchAsync(hooks, event, ctx, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? null;
  const raiseErrors = opts.raiseErrors ?? true;
  for (const hook of hooks) {
    const method = hook?.[event];
    if (typeof method !== "function") continue;
    const operationName = `${hook?.constructor?.name ?? "hook"}.${event}`;
    try {
      await runWithTimeout(method.call(hook, ctx), timeoutMs, operationName);
    } catch (err) {
      if (raiseErrors) throw err;
      reportHookFailure(hook, event, err);
    }
  }
}
function isDict(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (isDict(value)) return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, copyValue(val)]));
  return value;
}
function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
  }
  if (isDict(a) && isDict(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  return false;
}
function validateLongResult(value, label = "predictLong result", requireWindows = true) {
  if (!isDict(value) || typeof value.model !== "string" || !isDict(value.answers) || !isDict(value.usage)) {
    throw new TypeError(`${label}: expected model, answers and usage objects`);
  }
  const usage = value.usage;
  for (const key of ["input_tokens", "output_tokens", "state_tokens", "state_tokens_dropped"]) {
    if (key !== "input_tokens" && key !== "output_tokens" && usage[key] === void 0) continue;
    if (typeof usage[key] !== "number" || !Number.isFinite(usage[key]) || usage[key] < 0) {
      throw new TypeError(`${label}: usage.${key} must be a finite non-negative number`);
    }
  }
  if ((requireWindows || usage.windows !== void 0) && (!Number.isSafeInteger(usage.windows) || usage.windows < 0)) {
    throw new TypeError(`${label}: usage.windows must be a non-negative safe integer`);
  }
  if (usage.truncated !== void 0 && typeof usage.truncated !== "boolean" && (typeof usage.truncated !== "number" || !Number.isFinite(usage.truncated) || usage.truncated < 0)) {
    throw new TypeError(`${label}: usage.truncated must be a boolean or non-negative number`);
  }
  if (usage.truncated_questions !== void 0 && (!Array.isArray(usage.truncated_questions) || usage.truncated_questions.some((qid) => typeof qid !== "string"))) {
    throw new TypeError(`${label}: usage.truncated_questions must be an array of question ids`);
  }
  if (usage.options !== void 0 && (!isDict(usage.options) || Object.values(usage.options).some((stats) => !isDict(stats) || ["total", "distinct"].some((key) => typeof stats[key] !== "number" || !Number.isFinite(stats[key]) || stats[key] < 0) || stats.tokens_per_option !== null && (typeof stats.tokens_per_option !== "number" || !Number.isFinite(stats.tokens_per_option) || stats.tokens_per_option < 0)))) {
    throw new TypeError(`${label}: usage.options must map question ids to option statistics`);
  }
  for (const [qid, answer] of Object.entries(value.answers)) {
    if (!isDict(answer) || !["choice", "score", "noul"].includes(answer.type)) {
      throw new TypeError(`${label}: answer ${JSON.stringify(qid)} must have a supported type`);
    }
    for (const key of ["confidence", "answer_confidence", ...answer.type === "noul" ? ["noul"] : answer.type === "score" ? ["score"] : []]) {
      if (typeof answer[key] !== "number" || !Number.isFinite(answer[key])) {
        throw new TypeError(`${label}: answer ${JSON.stringify(qid)}.${key} must be a finite number`);
      }
    }
    if (answer.type === "choice" && typeof answer.choice !== "string") {
      throw new TypeError(`${label}: answer ${JSON.stringify(qid)}.choice must be a string`);
    }
    if (!isDict(answer.action) || typeof answer.action.act_probability !== "number" || !Number.isFinite(answer.action.act_probability)) {
      throw new TypeError(`${label}: answer ${JSON.stringify(qid)}.action.act_probability must be a finite number`);
    }
    if (answer.type !== "noul" && (!isDict(answer.probabilities) || Object.values(answer.probabilities).some((probability) => typeof probability !== "number" || !Number.isFinite(probability)))) {
      throw new TypeError(`${label}: answer ${JSON.stringify(qid)}.probabilities must map labels to finite numbers`);
    }
    if (answer.type === "score" && (!isDict(answer.legend) || Object.values(answer.legend).some((level) => typeof level !== "string"))) {
      throw new TypeError(`${label}: answer ${JSON.stringify(qid)}.legend must map levels to strings`);
    }
    if (answer.window !== void 0) {
      const w = answer.window;
      if (!isDict(w) || !["index", "token_start", "token_end", "count"].every((key) => Number.isSafeInteger(w[key]) && w[key] >= 0) || w.index >= w.count || w.token_start > w.token_end) {
        throw new TypeError(`${label}: answer ${JSON.stringify(qid)}.window is invalid`);
      }
    }
  }
}
function skippedLongResult(value) {
  validateLongResult(value, "predictLong hook result", false);
  return { ...value, usage: { ...value.usage, windows: 0 } };
}
function validateLongOptions(opts) {
  for (const key of ["window", "stride", "batchSize"]) {
    const value = opts[key];
    if (value !== void 0 && value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new TypeError(`predictLong: ${key} must be a positive safe integer`);
    }
  }
  if (opts.aggregate !== void 0 && opts.aggregate !== "auto") {
    throw new Error("predictLong: only aggregate='auto' is supported");
  }
}
const recorders = /* @__PURE__ */ new WeakMap();
function isLongCall(opts) {
  return recorders.has(opts);
}
function finishLongResults(opts, ctx) {
  const evidence = recorders.get(opts);
  if (!evidence) return;
  if (!Array.isArray(ctx.results)) throw new TypeError("predictLong: prediction hooks must return an array of results");
  evidence.resultCount = ctx.results.length;
}
const predictionFields = ["type", "choice", "noul", "score", "legend", "probabilities", "confidence", "answer_confidence"];
function answerValues(answer) {
  return Object.fromEntries(predictionFields.filter((key) => Object.hasOwn(answer, key)).map((key) => [key, copyValue(answer[key])]));
}
function recordLongResults(opts, ctx) {
  const evidence = recorders.get(opts);
  if (!evidence || !Array.isArray(ctx.results)) return;
  evidence.resultCount = ctx.results.length;
  if (evidence.answered || !evidence.trackAnswers) return;
  const recorded = /* @__PURE__ */ new Map();
  ctx.results.forEach((result, index) => {
    if (!isDict(result?.answers)) return;
    for (const [qid, answer] of Object.entries(result.answers)) {
      if (!isDict(answer)) continue;
      let byQuestion = recorded.get(answer);
      if (!byQuestion) recorded.set(answer, byQuestion = /* @__PURE__ */ new Map());
      byQuestion.set(qid, byQuestion.has(qid) ? null : { index, values: answerValues(answer) });
    }
  });
  evidence.answers = recorded;
}
function observedOptions(opts, trackAnswers) {
  const evidence = {
    answered: false,
    states: null,
    questionTypes: null,
    questions: null,
    maxLen: null,
    headMaxLen: null,
    answers: null,
    resultCount: null,
    trackAnswers
  };
  const hooks = normaliseHooks(opts.hooks, opts.onPredictStart, opts.onPredictEnd);
  hooks.push({ onPredictStart(ctx) {
    evidence.answered = ctx.results !== null;
    evidence.states = Array.isArray(ctx.states) ? [...ctx.states] : null;
    if (!evidence.answered && isDict(ctx.questions)) {
      evidence.questionTypes = Object.fromEntries(Object.entries(ctx.questions).map(([qid, q2]) => [qid, isDict(q2) ? q2.type : null]));
    }
    evidence.maxLen = ctx.maxLen;
    evidence.headMaxLen = ctx.headMaxLen;
    evidence.questions = isDict(ctx.questions) ? { ...ctx.questions } : null;
  } });
  const call = { lang: opts.lang, hooks, hooksRaise: opts.hooksRaise, hooksTimeout: opts.hooksTimeout };
  if (defaultsAlreadyRan(opts)) markDefaultsRan(call);
  recorders.set(call, evidence);
  return [call, evidence];
}
function stateRoom(agent2, questions, maxLen, headMaxLen) {
  return Object.values(questions).map((q2) => Math.max(0, maxLen - buildQuestionPrefix(agent2.tok, toInternal(q2), maxLen, headMaxLen).ids.length - 1));
}
function windowBudget(agent2, questions, opts) {
  const requested = opts.window ?? Math.max(64, agent2.maxLen - agent2.headMaxLen - 8);
  const rooms = stateRoom(agent2, questions, agent2.maxLen, agent2.headMaxLen);
  const room = rooms.length ? Math.min(...rooms) : requested;
  if (room <= 0) throw new Error(`predictLong: the questions' options fill the whole sequence (maxLen=${agent2.maxLen}, headMaxLen=${agent2.headMaxLen}), leaving no room for the state`);
  const size = Math.min(requested, room);
  if (size < requested && (opts.window != null || requested >= room * 2)) {
    console.warn(`laya: predictLong: questions leave ${room} state tokens inside maxLen=${agent2.maxLen}; capping window ${requested} -> ${size}. Fewer or shorter options reduce the number of full forward passes.`);
  }
  let step = opts.stride ?? Math.max(1, Math.floor(size / 2));
  if (step > size) {
    if (size < requested && step <= requested) {
      const adjusted = Math.max(1, Math.floor(size / 2));
      console.warn(`laya: predictLong: window was reduced to ${size}; adjusting stride ${step} -> ${adjusted} to avoid unread gaps`);
      step = adjusted;
    } else {
      throw new Error(`predictLong: stride=${step} steps past the ${size}-token window; pass stride <= ${size}`);
    }
  }
  return [size, step, room];
}
function checkScanBudget(agent2, evidence, sized, asked) {
  if (evidence.answered || !evidence.questions || !Object.keys(evidence.questions).length) return;
  const maxLen = evidence.maxLen ?? agent2.maxLen;
  const headMaxLen = evidence.headMaxLen ?? agent2.headMaxLen;
  if (maxLen === agent2.maxLen && headMaxLen === agent2.headMaxLen && sameValue(evidence.questions, asked)) return;
  let rooms;
  try {
    rooms = stateRoom(agent2, evidence.questions, maxLen, headMaxLen);
  } catch {
    return;
  }
  const room = Math.min(...rooms);
  if (room < sized) throw new Error(`predictLong: after the start hooks ran, the questions and token budget (maxLen=${maxLen} headMaxLen=${headMaxLen}) leave ${room} state tokens per window, but the scan was sized for ${sized} from the agent's config (maxLen=${agent2.maxLen} headMaxLen=${agent2.headMaxLen}). Every window would be re-truncated and parts of the document would reach no model. Pass window/stride explicitly, or call predictBatch directly, if a start hook changes either.`);
}
async function predictLong(agent2, state, questions, opts) {
  if (state === null || state === void 0) throw new TypeError("state must not be None; pass a string, dict, or list");
  if (!isDict(questions)) throw new TypeError("questions must be a dict of question id -> definition");
  validateLongOptions(opts);
  for (const [qid, q2] of Object.entries(questions)) checkQuestion(qid, q2);
  const [budget, step, room] = windowBudget(agent2, questions, opts);
  const asked = copyValue(questions);
  const stateIds = agent2.tok.encode(serializeState(state).split(agent2.tok.maskToken).join(" "));
  if (stateIds.length <= (opts.window != null ? budget : room)) {
    const [call2, evidence2] = observedOptions(opts, false);
    let single;
    try {
      single = await agent2.systemOne(state, questions, call2);
    } finally {
      recorders.delete(call2);
    }
    checkScanBudget(agent2, evidence2, Math.max(budget, stateIds.length), asked);
    if (evidence2.answered) {
      if (evidence2.resultCount !== 1) throw new Error(`predictLong: a start hook answered this state with ${evidence2.resultCount} results; ctx.skip() takes one result for the document`);
      console.warn("laya: predictLong: a hook answered the state before it was scanned, so no window decided the result");
      return skippedLongResult(single);
    }
    validateLongResult(single, "predictLong result", false);
    return { ...single, usage: { ...single.usage, windows: 1 } };
  }
  if (typeof agent2.tok.decode !== "function") {
    const name = agent2.tok.name ?? agent2.tok.constructor?.name ?? "custom tokenizer";
    throw new Error(`predictLong: tokenizer ${JSON.stringify(name)} needs decode(ids) to split a long state`);
  }
  const windows = [], starts = [];
  for (let start = 0; start < stateIds.length; start += step) {
    windows.push(agent2.tok.decode(stateIds.slice(start, start + budget)));
    starts.push(start);
    if (start + budget >= stateIds.length) break;
  }
  const [call, evidence] = observedOptions(opts, true);
  const configBudget = Math.max(64, agent2.maxLen - agent2.headMaxLen - 8);
  const unclamped = Math.max(1, Math.ceil(windows.length * Math.max(1, Math.floor(budget / 2)) / Math.max(1, Math.floor(configBudget / 2))));
  call.batchSize = opts.batchSize ?? (budget < configBudget && windows.length > unclamped * 2 ? unclamped : null);
  let results;
  try {
    results = await agent2.predictBatch([...windows], questions, call);
  } finally {
    recorders.delete(call);
  }
  checkScanBudget(agent2, evidence, budget, asked);
  if (!Array.isArray(results)) throw new TypeError("predictLong: prediction hooks must return an array of results");
  if (evidence.answered) {
    if (results.length !== 1) throw new Error(`predictLong: a start hook answered this state with ${results.length} results; ctx.skip() takes one result for the document, not one per window`);
    console.warn("laya: predictLong: a hook answered the state before it was scanned, so no window decided the result");
    return skippedLongResult(results[0]);
  }
  const rewritten = evidence.states !== null && !sameValue(evidence.states, windows);
  if (results.length !== windows.length && !rewritten) throw new Error(`predictLong: the state was split into ${windows.length} windows and the call returned ${results.length} results`);
  if (!results.length) {
    console.warn("laya: predictLong: a start hook left no states to score, so the call aggregated nothing and returns no answers");
    return { model: "laya-rl-agent", answers: {}, usage: { input_tokens: 0, output_tokens: 0, windows: 0 } };
  }
  for (const result2 of results) validateLongResult(result2, "predictLong window result", false);
  const rows = results;
  const questionTypes = evidence.questionTypes ?? Object.fromEntries(Object.entries(questions).map(([qid, q2]) => [qid, q2.type]));
  const answers = {};
  for (const [qid, qtype] of Object.entries(questionTypes)) {
    const missing = rows.filter((r) => !Object.hasOwn(r.answers, qid)).length;
    if (missing) {
      if (missing === rows.length && !Object.hasOwn(asked, qid) && evidence.questionTypes !== null) continue;
      throw new Error(`predictLong: answer ${JSON.stringify(qid)} is missing from ${missing} of ${rows.length} windows after prediction hooks`);
    }
    const per = rows.map((r) => r.answers[qid]);
    if (per.some((answer2) => answer2.type !== per[0].type)) throw new Error(`predictLong: answer ${JSON.stringify(qid)} has inconsistent types across windows`);
    const metric = (answer2) => qtype === "noul" ? answer2.noul : answer2.answer_confidence;
    if (per.some((answer2) => !Number.isFinite(metric(answer2)))) throw new TypeError(`predictLong: answer ${JSON.stringify(qid)} is missing the numeric aggregation field for ${String(qtype)}`);
    let best2 = 0;
    for (let i = 1; i < per.length; i++) if (metric(per[i]) > metric(per[best2])) best2 = i;
    const original = per[best2];
    let index = null;
    if (!rewritten) {
      if (evidence.answers === null) index = best2;
      else {
        const record = evidence.answers.get(original)?.get(qid);
        if (record && sameValue(record.values, answerValues(original))) index = record.index;
      }
    }
    const answer = { ...original };
    delete answer.window;
    if (index !== null) answer.window = { index, token_start: starts[index], token_end: Math.min(starts[index] + budget, stateIds.length), count: rows.length };
    Object.defineProperty(answers, qid, { value: answer, enumerable: true, writable: true, configurable: true });
  }
  const usage = /* @__PURE__ */ Object.create(null);
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.usage)) {
      const previous = usage[key];
      if (typeof value === "number" || typeof value === "boolean") {
        usage[key] = (typeof previous === "number" || typeof previous === "boolean" ? Number(previous) : 0) + Number(value);
      } else if (isDict(value) && isDict(previous)) usage[key] = { ...previous, ...value };
      else Object.defineProperty(usage, key, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  const result = { model: "laya-rl-agent", answers, usage: { ...usage, output_tokens: 0, windows: rows.length } };
  validateLongResult(result);
  return result;
}
const CHECKPOINT_IDS = { cls: 50281, sep: 50282, mask: 50284, pad: 50283, unk: 50280 };
const SPECIAL_ALIASES = {
  cls: ["[CLS]", "<bos>", "<s>"],
  sep: ["[SEP]", "<eos>", "</s>"],
  pad: ["[PAD]", "<pad>"],
  mask: ["[MASK]", "<mask>"],
  unk: ["[UNK]", "<unk>"]
};
const METASPACE_REPLACEMENT = "▁";
function byteUnicodeMaps() {
  const b2u = /* @__PURE__ */ new Map();
  const u2b = /* @__PURE__ */ new Map();
  const extra = (n) => n < 256 ? n + 256 : n;
  const ranges = [[33, 126], [161, 172], [174, 255]];
  let k = 0;
  const inRange = (b) => ranges.some(([lo, hi]) => b >= lo && b <= hi);
  for (let b = 0; b < 256; b++) {
    const cp = inRange(b) ? b : extra(k++);
    b2u.set(b, String.fromCodePoint(cp));
    u2b.set(String.fromCodePoint(cp), b);
  }
  return { b2u, u2b };
}
let cached$1 = null;
function maps() {
  if (!cached$1) cached$1 = byteUnicodeMaps();
  return cached$1;
}
const GPT2_SPLIT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
const HEAP_MIN_LEN = 32;
function bpeWord(chars, rank2) {
  if (chars.length >= HEAP_MIN_LEN) return bpeWordHeap(chars, rank2);
  let word = chars.slice();
  if (word.length <= 1) return word;
  for (; ; ) {
    let best2 = Infinity, idx = -1;
    for (let i = 0; i < word.length - 1; i++) {
      const r = rank2.get(word[i] + " " + word[i + 1]);
      if (r !== void 0 && r < best2) {
        best2 = r;
        idx = i;
      }
    }
    if (idx < 0) return word;
    word = [...word.slice(0, idx), word[idx] + word[idx + 1], ...word.slice(idx + 2)];
  }
}
function bpeWordHeap(chars, rank2) {
  const n = chars.length;
  const tok = chars.slice();
  if (n <= 1) return tok;
  const next = new Int32Array(n), prev = new Int32Array(n);
  const version = new Int32Array(n);
  const dead = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    prev[i] = i - 1;
    next[i] = i + 1 < n ? i + 1 : -1;
  }
  let heapCap = 3 * n;
  let heapRank = new Int32Array(heapCap), heapSlot = new Int32Array(heapCap), heapVer = new Int32Array(heapCap);
  let heapLen = 0;
  const offer = (slot) => {
    const j = next[slot];
    if (j < 0) return;
    const r = rank2.get(tok[slot] + " " + tok[j]);
    if (r === void 0) return;
    if (heapLen === heapCap) {
      heapCap *= 2;
      const r2 = new Int32Array(heapCap);
      r2.set(heapRank);
      heapRank = r2;
      const s2 = new Int32Array(heapCap);
      s2.set(heapSlot);
      heapSlot = s2;
      const v2 = new Int32Array(heapCap);
      v2.set(heapVer);
      heapVer = v2;
    }
    const ver = version[slot];
    let c = heapLen++;
    while (c > 0) {
      const p = c - 1 >> 1;
      if (heapRank[p] < r || heapRank[p] === r && heapSlot[p] < slot) break;
      heapRank[c] = heapRank[p];
      heapSlot[c] = heapSlot[p];
      heapVer[c] = heapVer[p];
      c = p;
    }
    heapRank[c] = r;
    heapSlot[c] = slot;
    heapVer[c] = ver;
  };
  for (let i = 0; i < n - 1; i++) offer(i);
  while (heapLen > 0) {
    const slot = heapSlot[0], ver = heapVer[0];
    const lastRank = heapRank[--heapLen], lastSlot = heapSlot[heapLen], lastVer = heapVer[heapLen];
    if (heapLen > 0) {
      let c = 0;
      for (; ; ) {
        const l = 2 * c + 1;
        if (l >= heapLen) break;
        const r = l + 1;
        let m = l;
        if (r < heapLen && (heapRank[r] < heapRank[l] || heapRank[r] === heapRank[l] && heapSlot[r] < heapSlot[l])) m = r;
        if (heapRank[m] > lastRank || heapRank[m] === lastRank && heapSlot[m] > lastSlot) break;
        heapRank[c] = heapRank[m];
        heapSlot[c] = heapSlot[m];
        heapVer[c] = heapVer[m];
        c = m;
      }
      heapRank[c] = lastRank;
      heapSlot[c] = lastSlot;
      heapVer[c] = lastVer;
    }
    if (dead[slot] || version[slot] !== ver) continue;
    const j = next[slot];
    if (j < 0 || dead[j]) continue;
    tok[slot] = tok[slot] + tok[j];
    dead[j] = 1;
    const k = next[j];
    next[slot] = k;
    if (k >= 0) prev[k] = slot;
    version[slot]++;
    offer(slot);
    const p = prev[slot];
    if (p >= 0) {
      version[p]++;
      offer(p);
    }
  }
  const out = [];
  for (let i = 0; i >= 0; i = next[i]) out.push(tok[i]);
  return out;
}
let sharedEncoder = null;
function bpeEncode(vocab, merges, text) {
  const { b2u } = maps();
  const unkId = vocab.get("[UNK]") ?? CHECKPOINT_IDS.unk;
  const out = [];
  const enc = sharedEncoder ??= new TextEncoder();
  const parts = text.normalize("NFC").match(GPT2_SPLIT);
  if (!parts) return out;
  for (const piece of parts) {
    const chars = [];
    for (const b of enc.encode(piece)) chars.push(b2u.get(b) ?? "");
    for (const tok of bpeWord(chars, merges)) out.push(vocab.get(tok) ?? unkId);
  }
  return out;
}
function metaspaceEncode(vocab, merges, text, unkId, replaces = [[" ", METASPACE_REPLACEMENT]], byteFallback = false) {
  const unk = unkId ?? vocab.get("<unk>") ?? vocab.get("[UNK]") ?? CHECKPOINT_IDS.unk;
  if (!text) return [];
  let t = text;
  for (const [from, to] of replaces) t = t.split(from).join(to);
  const out = [];
  const push = (piece) => {
    for (const tok of bpeWord(Array.from(piece), merges)) {
      const id = vocab.get(tok);
      if (id !== void 0) {
        out.push(id);
        continue;
      }
      const bytes = byteFallback ? Array.from((sharedEncoder ??= new TextEncoder()).encode(tok), (b) => vocab.get(`<0x${b.toString(16).toUpperCase().padStart(2, "0")}>`)) : [];
      if (bytes.length > 0 && bytes.every((b) => b !== void 0)) out.push(...bytes);
      else out.push(unk);
    }
  };
  for (const seg of t.split(/(\n+)/)) {
    if (!seg) continue;
    if (seg[0] === "\n") {
      push(seg);
    } else {
      const w = seg.startsWith(METASPACE_REPLACEMENT) ? seg : METASPACE_REPLACEMENT + seg;
      for (const chunk of w.split(METASPACE_REPLACEMENT).slice(1)) {
        push(chunk ? METASPACE_REPLACEMENT + chunk : METASPACE_REPLACEMENT);
      }
    }
  }
  return out;
}
function encodeSegment(data, text) {
  return data.kind === "metaspace" ? metaspaceEncode(data.vocab, data.merges, text, data.ids.unk, data.replaces, data.byteFallback) : bpeEncode(data.vocab, data.merges, text);
}
function trieSource(words) {
  const root = { kids: /* @__PURE__ */ new Map(), end: false };
  for (const w of words) {
    let n = root;
    for (const ch of w) {
      let k = n.kids.get(ch);
      if (!k) n.kids.set(ch, k = { kids: /* @__PURE__ */ new Map(), end: false });
      n = k;
    }
    n.end = true;
  }
  const walk = (n) => {
    const alts = [...n.kids].map(([c, k]) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + walk(k));
    if (!alts.length) return "";
    const body = alts.length === 1 ? alts[0] : "(?:" + alts.join("|") + ")";
    return n.end ? "(?:" + body + ")?" : body;
  };
  return walk(root);
}
const addedPhases = /* @__PURE__ */ new WeakMap();
function phasesOf(data) {
  let phases = addedPhases.get(data);
  if (!phases) {
    phases = [false, true].flatMap((normalized) => {
      const toks = (data.added ?? []).filter((t) => t.normalized === normalized && t.content);
      if (!toks.length) return [];
      const re = new RegExp(trieSource(toks.map((t) => t.content)), "gu");
      return [{ re, byContent: new Map(toks.map((t) => [t.content, t])), normalized }];
    });
    addedPhases.set(data, phases);
  }
  return phases;
}
function splitOnAdded(text, { re, byContent }) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const tok = byContent.get(m[0]);
    let before = text.slice(last, m.index);
    if (tok.lstrip) before = before.trimEnd();
    if (before) out.push(before);
    out.push(tok);
    last = m.index + m[0].length;
    if (tok.rstrip) while (last < text.length && /\s/u.test(text[last])) last++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function encodeWithData(data, text) {
  let pieces = [text];
  for (const phase of phasesOf(data)) {
    pieces = pieces.flatMap((p) => {
      if (typeof p !== "string") return [p];
      return splitOnAdded(phase.normalized && data.kind === "bytelevel" ? p.normalize("NFC") : p, phase);
    });
  }
  const out = [];
  for (const p of pieces) {
    if (typeof p === "string") out.push(...encodeSegment(data, p));
    else out.push(p.id);
  }
  return out;
}
function childNodes(node) {
  if (!node || typeof node !== "object") return [];
  const o = node;
  const out = [];
  for (const k of ["normalizers", "pre_tokenizers", "decoders"]) {
    const v = o[k];
    if (Array.isArray(v)) out.push(...v);
  }
  return out;
}
function hasNodeType(node, want) {
  if (!node || typeof node !== "object") return false;
  if (node["type"] === want) return true;
  return childNodes(node).some((c) => hasNodeType(c, want));
}
function collectReplaces(node, out) {
  if (!node || typeof node !== "object") return;
  const o = node;
  if (o["type"] === "Replace") {
    const pat = o["pattern"];
    const from = pat?.["String"];
    const to = o["content"];
    if (typeof from === "string" && typeof to === "string") out.push([from, to]);
  }
  for (const c of childNodes(node)) collectReplaces(c, out);
}
function checkpointDecoder(raw, vocab, added) {
  if (!raw || typeof raw !== "object") return void 0;
  const decoder = raw;
  let decodeTokens;
  const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });
  if (decoder.type === "ByteLevel") {
    decodeTokens = (tokens) => {
      const bytes = [];
      const { u2b } = maps();
      for (const token of tokens) {
        const mapped = Array.from(token, (ch) => u2b.get(ch));
        const part = mapped.every((b) => b !== void 0) ? mapped : (sharedEncoder ??= new TextEncoder()).encode(token);
        for (const b of part) bytes.push(b);
      }
      return utf8.decode(new Uint8Array(bytes));
    };
  } else if (decoder.type === "Sequence" && Array.isArray(decoder.decoders)) {
    const steps = decoder.decoders;
    const pattern = steps[0]?.pattern;
    if (steps.length !== 3 || steps[0]?.type !== "Replace" || typeof pattern?.String !== "string" || pattern.String.length === 0 || typeof steps[0].content !== "string" || steps[1]?.type !== "ByteFallback" || steps[2]?.type !== "Fuse") return void 0;
    const from = pattern.String, to = steps[0].content;
    const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    decodeTokens = (tokens) => {
      const out = [], bytes = [];
      const flush = () => {
        if (bytes.length === 0) return;
        try {
          out.push(strict.decode(new Uint8Array(bytes)));
        } catch {
          out.push("�".repeat(bytes.length));
        }
        bytes.length = 0;
      };
      for (const token of tokens) {
        const replaced = token.split(from).join(to);
        const match = /^<0x([\dA-Fa-f]{2})>$/.exec(replaced);
        if (match) bytes.push(parseInt(match[1], 16));
        else {
          flush();
          out.push(replaced);
        }
      }
      flush();
      return out.join("");
    };
  } else return void 0;
  const byId = new Map(Array.from(vocab, ([token, id]) => [id, token]));
  for (const token of added) byId.set(token.id, token.content);
  return (ids) => decodeTokens(ids.flatMap((id) => {
    const token = byId.get(id);
    return token === void 0 ? [] : [token];
  }));
}
function parseTokenizerJson(raw) {
  try {
    const r = raw;
    const vocabObj = r?.model?.vocab;
    if (!vocabObj || typeof vocabObj !== "object") return null;
    const vocab = new Map(Object.entries(vocabObj));
    const merges = /* @__PURE__ */ new Map();
    for (const [i, m] of (r.model?.merges ?? []).entries()) {
      const pair = typeof m === "string" ? m.split(" ") : m;
      if (pair.length >= 2) merges.set(pair[0] + " " + pair[1], i);
    }
    const added = /* @__PURE__ */ new Map();
    const addedTokens = [];
    for (const t of r.added_tokens ?? []) {
      if (typeof t?.content === "string" && typeof t?.id === "number") {
        added.set(t.content, t.id);
        addedTokens.push({
          content: t.content,
          id: t.id,
          normalized: t.normalized === true,
          lstrip: t.lstrip === true,
          rstrip: t.rstrip === true
        });
      }
    }
    const pick = (aliases, fb) => {
      for (const a of aliases) {
        const v = added.get(a) ?? vocab.get(a);
        if (v !== void 0) return { id: v, token: a };
      }
      return { id: fb, token: aliases[0] };
    };
    const cls = pick(SPECIAL_ALIASES.cls, CHECKPOINT_IDS.cls);
    const sep = pick(SPECIAL_ALIASES.sep, CHECKPOINT_IDS.sep);
    const mask = pick(SPECIAL_ALIASES.mask, CHECKPOINT_IDS.mask);
    const pad = pick(SPECIAL_ALIASES.pad, CHECKPOINT_IDS.pad);
    const unk = pick(SPECIAL_ALIASES.unk, CHECKPOINT_IDS.unk);
    const kind = hasNodeType(r?.pre_tokenizer, "Metaspace") ? "metaspace" : "bytelevel";
    const replaces = [];
    collectReplaces(r?.normalizer, replaces);
    if (kind === "metaspace" && replaces.length === 0) replaces.push([" ", METASPACE_REPLACEMENT]);
    return {
      vocab,
      merges,
      ids: { cls: cls.id, sep: sep.id, mask: mask.id, pad: pad.id, unk: unk.id },
      kind,
      maskToken: mask.token,
      replaces,
      byteFallback: r.model?.byte_fallback === true,
      added: addedTokens,
      decode: checkpointDecoder(r.decoder, vocab, addedTokens)
    };
  } catch {
    return null;
  }
}
async function loadTokenizerJson(pathOrUrl) {
  let raw;
  if (/^https?:\/\//.test(pathOrUrl)) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) return null;
    raw = await res.json();
  } else {
    const fs = await import("node:fs/promises");
    raw = JSON.parse(await fs.readFile(pathOrUrl, "utf8"));
  }
  return parseTokenizerJson(raw);
}
const MAX_PROPERTIES = 32;
const MAX_OPTIONS = 32;
const MAX_SCORE_LEVELS = 10;
class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}
const r4$1 = (v) => Math.round(v * 1e4) / 1e4;
function pyType(v) {
  if (v === null || v === void 0) return "NoneType";
  if (Array.isArray(v)) return "list";
  switch (typeof v) {
    case "boolean":
      return "bool";
    case "number":
      return Number.isInteger(v) ? "int" : "float";
    case "string":
      return "str";
    case "object":
      return "dict";
    default:
      return typeof v;
  }
}
function schemaOf(model) {
  const m = model;
  for (const key of ["toJSONSchema", "model_json_schema", "schema"]) {
    if (typeof m?.[key] === "function") return m[key]();
  }
  if (m !== null && typeof m === "object" && !Array.isArray(m)) return m;
  throw new SchemaError(`expected a JSON schema object or a model with toJSONSchema(), got ${pyType(model)}`);
}
function noulField(name, description) {
  return {
    name,
    kind: "noul",
    question: { type: "noul", instructions: description || `Is \`${name}\` true?` }
  };
}
function enumField(path, name, values, description) {
  if (values.length > MAX_OPTIONS) {
    throw new SchemaError(`${path}: ${values.length} options exceeds MAX_OPTIONS=${MAX_OPTIONS}`);
  }
  if (values.length === 0) throw new SchemaError(`${path}: 'enum' must not be empty`);
  if (values.length === 2 && values.every((v) => typeof v === "boolean") && values[0] !== values[1]) {
    return noulField(name, description);
  }
  const options = values.map((v) => [v == null ? "null" : String(v), v]);
  if (new Set(options.map(([label]) => label)).size !== options.length) {
    throw new SchemaError(`${path}: enum values produce duplicate choice labels`);
  }
  return {
    name,
    kind: "choice",
    question: {
      type: "choice",
      instructions: description || `What is \`${name}\`?`,
      criteria: Object.fromEntries(options.map(([label]) => [label, null]))
    },
    options
  };
}
function scoreField(path, name, prop, description) {
  const lo = prop.minimum;
  const hi = prop.maximum;
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
    throw new SchemaError(`${path}: a numeric field needs integer 'minimum' and 'maximum' to become a score`);
  }
  const loN = lo;
  const hiN = hi;
  if (hiN < loN) throw new SchemaError(`${path}: 'maximum' ${hiN} is below 'minimum' ${loN}`);
  const span = hiN - loN + 1;
  if (span > MAX_SCORE_LEVELS) {
    throw new SchemaError(
      `${path}: ${span} levels exceeds MAX_SCORE_LEVELS=${MAX_SCORE_LEVELS}; narrow the range or use an enum`
    );
  }
  return {
    name,
    kind: "score",
    question: {
      type: "score",
      instructions: description || `Score \`${name}\` from ${loN} to ${hiN}`,
      criteria: Array.from({ length: span }, (_, i) => String(loN + i))
    },
    minimum: loN
  };
}
function fieldFor(path, name, prop) {
  if (prop === null || typeof prop !== "object" || Array.isArray(prop)) {
    throw new SchemaError(`${path}: property must be an object, got ${pyType(prop)}`);
  }
  const p = prop;
  const description = p.description;
  if (!("const" in p || "enum" in p || "type" in p)) {
    const union = p.anyOf ?? p.oneOf;
    if (union !== void 0 && Array.isArray(union)) {
      const branches = union.filter(
        (b) => b !== null && typeof b === "object" && !Array.isArray(b) && b.type !== "null"
      );
      if (branches.length !== 1) {
        throw new SchemaError(
          `${path}: only 'Optional[...]' unions (one non-null branch) are supported, got ${branches.length}`
        );
      }
      const branch = { ...branches[0] };
      if (branch.description === void 0 && description !== void 0) {
        branch.description = description;
      }
      return fieldFor(path, name, branch);
    }
  }
  if ("const" in p) return enumField(path, name, [p.const], description);
  if ("enum" in p) {
    if (!Array.isArray(p.enum)) throw new SchemaError(`${path}: 'enum' must be a list, got ${pyType(p.enum)}`);
    return enumField(path, name, p.enum, description);
  }
  let jtype = p.type;
  if (Array.isArray(jtype)) {
    const nonNullTypes = jtype.filter((t) => t !== "null");
    if (nonNullTypes.length > 1) {
      throw new SchemaError(`${path}: 'type' has multiple non-null types; unions are not supported`);
    }
    jtype = nonNullTypes[0];
  }
  if (jtype === "boolean") return noulField(name, description);
  if (jtype === "string") {
    throw new SchemaError(`${path}: a free string cannot be a fixed option set; use 'enum' or a boolean`);
  }
  if (jtype === "integer" || jtype === "number") return scoreField(path, name, p, description);
  if (jtype === "array") throw new SchemaError(`${path}: arrays are not supported; ask one field per element`);
  if (jtype === "object") throw new SchemaError(`${path}: nested objects are not supported; flatten the schema`);
  if ("$ref" in p) throw new SchemaError(`${path}: $ref/recursion is not supported; flatten the schema`);
  throw new SchemaError(`${path}: unsupported schema ${JSON.stringify(prop)}`);
}
function planFromJsonSchema(schema) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new SchemaError(`expected a JSON schema object, got ${pyType(schema)}`);
  }
  const s = schema;
  if (!(s.type === void 0 || s.type === null || s.type === "object") || !("properties" in s)) {
    throw new SchemaError("the top level must be an object with 'properties'");
  }
  const properties = s.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties) || Object.keys(properties).length === 0) {
    throw new SchemaError("'properties' must be a non-empty object");
  }
  const entries = Object.entries(properties);
  if (entries.length > MAX_PROPERTIES) {
    throw new SchemaError(`${entries.length} properties exceeds MAX_PROPERTIES=${MAX_PROPERTIES}`);
  }
  return entries.map(([name, prop]) => fieldFor(`properties.${name}`, name, prop));
}
function questionsFromJsonSchema(schema) {
  return Object.fromEntries(planFromJsonSchema(schema).map((f) => [f.name, f.question]));
}
function isAnswerObject(answer) {
  return answer !== null && typeof answer === "object" && !Array.isArray(answer);
}
function project(answers, fields) {
  const values = {};
  for (const f of fields) {
    const answer = answers[f.name];
    if (!isAnswerObject(answer)) continue;
    if (answer.low_confidence) {
      values[f.name] = null;
      continue;
    }
    if (f.kind === "noul") {
      values[f.name] = Number(answer.noul ?? 0) >= 0.5;
    } else if (f.kind === "score") {
      const probs = answer.probabilities ?? {};
      const n = Object.keys(probs).length;
      let idx;
      if (n > 0) {
        idx = 0;
        let best2 = -Infinity;
        for (let i = 0; i < n; i++) {
          const v = Number(probs[String(i)] ?? 0);
          if (v > best2) {
            best2 = v;
            idx = i;
          }
        }
      } else {
        idx = Math.round(Number(answer.score ?? 0));
      }
      values[f.name] = (f.minimum ?? 0) + idx;
    } else {
      const label = String(answer.choice);
      const hit = (f.options ?? []).find(([l]) => l === label);
      values[f.name] = hit ? hit[1] : label;
    }
  }
  return values;
}
function answersToJson(answers, schema) {
  return project(answers, planFromJsonSchema(schema));
}
function answerConfidenceValue(answer) {
  const conf = answer.answer_confidence;
  if (typeof conf === "number" && typeof conf !== "boolean" && Number.isFinite(conf)) {
    return conf;
  }
  return null;
}
function detailsOf(values, answers, result) {
  const confidence = {};
  const answerConfidence2 = {};
  const probabilities = {};
  for (const [name, answer] of Object.entries(answers)) {
    if (!isAnswerObject(answer)) continue;
    confidence[name] = Number(answer.confidence ?? 0);
    answerConfidence2[name] = answerConfidenceValue(answer);
    if (answer.type === "noul") {
      const p = Number(answer.noul ?? 0);
      probabilities[name] = { false: r4$1(1 - p), true: r4$1(p) };
    } else {
      probabilities[name] = { ...answer.probabilities ?? {} };
    }
  }
  return {
    values,
    confidence,
    answerConfidence: answerConfidence2,
    probabilities,
    answers: { ...answers },
    usage: result.usage,
    routing: result.routing
  };
}
async function decide(runner, state, schema, opts = {}) {
  const { questions, returnDetails = false, minConfidence, min_confidence, ...predictOpts } = opts;
  if (schema == null === (questions == null)) {
    throw new Error("pass exactly one of schema= or questions=");
  }
  const mcOpt = minConfidence ?? min_confidence;
  const mc = mcOpt !== void 0 && mcOpt !== null ? checkMinConfidence(mcOpt) : null;
  if (mc !== null) {
    predictOpts.minConfidence = mc;
  }
  let fields = null;
  let qs = questions;
  if (schema != null) {
    fields = planFromJsonSchema(schemaOf(schema));
    qs = Object.fromEntries(fields.map((f) => [f.name, f.question]));
  }
  const result = await runner.predict(state, qs, predictOpts);
  if (mc !== null && result && typeof result === "object") {
    flagLowConfidence(result, mc);
  }
  const answers = result.answers ?? {};
  const values = fields ? project(answers, fields) : { ...answers };
  if (returnDetails) return detailsOf(values, answers, result);
  return values;
}
async function decideBatch(runner, states, schema, opts = {}) {
  const {
    questions,
    returnDetails = false,
    minConfidence,
    min_confidence,
    ...predictOpts
  } = opts;
  if (schema == null === (questions == null)) {
    throw new Error("pass exactly one of schema= or questions=");
  }
  if (typeof states === "string" || !Array.isArray(states)) {
    throw new TypeError(`states must be an array of states, not ${pyType(states)}`);
  }
  const mcOpt = minConfidence ?? min_confidence;
  const mc = mcOpt !== void 0 && mcOpt !== null ? checkMinConfidence(mcOpt) : null;
  let fields = null;
  let qs = questions;
  if (schema != null) {
    fields = planFromJsonSchema(schemaOf(schema));
    qs = Object.fromEntries(fields.map((f) => [f.name, f.question]));
  }
  const r = runner;
  const predictBatchFn = typeof r.predictBatch === "function" ? r.predictBatch : null;
  if (!predictBatchFn) {
    const runnerName = r?.constructor?.name ?? typeof runner;
    throw new TypeError(`${runnerName} has no predictBatch; loop decide() over the states instead`);
  }
  const isRouter = typeof r.routeBatch === "function";
  let results;
  if (isRouter) {
    const requestKeys = ["model", "task", "lang", "langGuess", "lang_guess", "maxLen", "headMaxLen"];
    const perRequest = {};
    const callOpts = {};
    for (const [key, value] of Object.entries(predictOpts)) {
      if (requestKeys.includes(key)) {
        perRequest[key] = value;
      } else if (key === "hooks" || key === "onPredictStart" || key === "onPredictEnd" || key === "hooksRaise") {
        callOpts[key] = value;
      }
    }
    const requests = states.map((s) => ({ state: s, questions: qs, ...perRequest }));
    const batchSize = predictOpts.batchSize ?? null;
    results = await predictBatchFn.call(runner, requests, batchSize, callOpts);
  } else {
    results = await predictBatchFn.call(runner, states, qs, predictOpts);
  }
  if (mc !== null && Array.isArray(results)) {
    flagLowConfidence(results, mc);
  }
  const one = (res) => {
    const answers = (res && typeof res === "object" ? res.answers : null) || {};
    const values = fields !== null ? project(answers, fields) : { ...answers };
    if (returnDetails) {
      return detailsOf(values, answers, res || {});
    }
    return values;
  };
  return (results || []).map(one);
}
const QTYPES = { choice: 0, score: 1, noul: 2 };
function qidStr(qid) {
  return JSON.stringify(qid);
}
function optionCount(qdef) {
  if (qdef["type"] === "noul") return 2;
  const crit = qdef["criteria"];
  return Array.isArray(crit) || typeof crit === "object" && crit !== null ? Object.keys(crit).length : 0;
}
function checkQuestion(qid, qdef) {
  if (typeof qid !== "string" || !qid.trim()) {
    throw new Error(`question id must be a non-empty string, got ${qidStr(qid)}`);
  }
  if (typeof qdef !== "object" || qdef === null || Array.isArray(qdef)) {
    const got = Array.isArray(qdef) ? "list" : qdef === null ? "NoneType" : typeof qdef;
    throw new Error(`question ${qidStr(qid)}: definition must be a dict, got ${got}`);
  }
  const q2 = qdef;
  const t = q2["type"];
  if (t !== "choice" && t !== "score" && t !== "noul") {
    throw new Error(
      `question ${qidStr(qid)}: unknown type ${JSON.stringify(t)}; use one of ${JSON.stringify(Object.keys(QTYPES).sort())}`
    );
  }
  if (!("instructions" in q2)) {
    throw new Error(`question ${qidStr(qid)}: no 'instructions'; add the text the model should answer`);
  }
  const ins = q2["instructions"];
  if (ins === null || ins === void 0) {
    throw new Error(
      `question ${qidStr(qid)}: 'instructions' must not be None; add the text the model should answer`
    );
  }
  if (typeof ins === "string" && !ins.trim()) {
    throw new Error(
      `question ${qidStr(qid)}: 'instructions' must not be empty; add the text the model should answer`
    );
  }
  if (typeof ins === "object" && Object.keys(ins).length === 0) {
    throw new Error(
      `question ${qidStr(qid)}: 'instructions' must not be empty; add the text the model should answer`
    );
  }
  if (!["string", "object", "number", "bigint", "boolean"].includes(typeof ins)) {
    throw new Error(
      `question ${qidStr(qid)}: 'instructions' must be a string, dict, or list, got ${typeof ins}`
    );
  }
  const crit = q2["criteria"];
  if (t === "choice") {
    if (typeof crit !== "object" || crit === null) {
      throw new Error(
        `question ${qidStr(qid)}: a choice question takes 'criteria' as a dict of label -> description, or a list of labels`
      );
    }
    if (Object.keys(crit).length === 0) {
      throw new Error(`question ${qidStr(qid)}: a choice question needs at least one criterion`);
    }
    if (Array.isArray(crit)) {
      for (let i = 0; i < crit.length; i++) {
        const label = crit[i];
        if (label === null || label === void 0) {
          throw new Error(
            `question ${qidStr(qid)}: choice label ${i} is null; a label is rendered as option text and used as the answer key, so it must be a string, number or bool`
          );
        }
        if (typeof label !== "object") continue;
        throw new Error(
          `question ${qidStr(qid)}: choice label ${i} is a ${Array.isArray(label) ? "list" : "dict"}; a label is rendered as option text and used as the answer key, so it must be a scalar (a string, number or bool), got ${JSON.stringify(label)}`
        );
      }
      const seen = /* @__PURE__ */ new Map();
      crit.forEach((label, i) => {
        const key = String(label);
        const first = seen.get(key);
        if (first === void 0) {
          seen.set(key, i);
          return;
        }
        throw new Error(
          `question ${qidStr(qid)}: choice label ${i} (${JSON.stringify(label)}) repeats label ${first}; the labels are the answer keys, so every option needs its own (1 and "1" are one key)`
        );
      });
    }
  } else if (t === "score") {
    if (!Array.isArray(crit)) {
      throw new Error(
        `question ${qidStr(qid)}: a score question takes 'criteria' as a list of level descriptions, index 0 first`
      );
    }
    if (crit.length === 0) {
      throw new Error(`question ${qidStr(qid)}: a score question needs at least one level`);
    }
    const nullAt = crit.findIndex((c) => c === null || c === void 0);
    if (nullAt >= 0) {
      throw new Error(
        `question ${qidStr(qid)}: score level ${nullAt} is null; give every level a description, index 0 first`
      );
    }
  } else if (crit !== void 0 && crit !== null && (typeof crit !== "object" || Array.isArray(crit))) {
    throw new Error(
      `question ${qidStr(qid)}: a noul question takes 'criteria' as a dict with optional 'true'/'false' descriptions, or omits it`
    );
  } else if (crit && typeof crit === "object" && !Array.isArray(crit)) {
    const invalid = Object.keys(crit).filter((key) => key.toLowerCase() !== "true" && key.toLowerCase() !== "false");
    if (invalid.length > 0) {
      throw new Error(
        `question ${qidStr(qid)}: noul criteria may contain only 'true' and 'false'; got ${JSON.stringify(invalid)}`
      );
    }
  }
  if (Object.hasOwn(q2, "option_order")) {
    const order = q2["option_order"];
    const n = optionCount(q2);
    const ints = Array.isArray(order) ? order.filter((i) => typeof i === "number" && Number.isInteger(i)) : null;
    const isPermutation = ints !== null && ints.length === n && [...ints].sort((a, b) => a - b).join(",") === Array.from({ length: n }, (_, i) => i).join(",");
    if (!isPermutation) {
      throw new Error(
        `question ${qidStr(qid)}: 'option_order' must be a permutation of range(${n}) -- one slot per option, each option once -- got ${JSON.stringify(order)}`
      );
    }
  }
  if ("labels" in q2 && t !== "noul") {
    throw new Error(`question ${qidStr(qid)}: 'labels' is only supported for noul questions`);
  }
  if (t === "noul" && q2["labels"] !== null && q2["labels"] !== void 0) {
    const labels = q2["labels"];
    if (typeof labels !== "object" || labels === null || Array.isArray(labels)) {
      throw new Error(`question ${qidStr(qid)}: noul labels must be an object with 'false' and 'true'`);
    }
    const entries = Object.entries(labels);
    const keys = entries.map(([key]) => key).sort();
    if (keys.length !== 2 || keys[0] !== "false" || keys[1] !== "true" || entries.some(([, value]) => typeof value !== "string" || value.trim() === "")) {
      throw new Error(`question ${qidStr(qid)}: noul labels must map exactly 'false' and 'true' to distinct non-empty strings`);
    }
    const falseLabel = String(labels["false"]).trim();
    const trueLabel = String(labels["true"]).trim();
    if (falseLabel === trueLabel) {
      throw new Error(`question ${qidStr(qid)}: noul labels must be distinct`);
    }
  }
}
function isPlainDict(o) {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return false;
  const proto = Object.getPrototypeOf(o);
  return proto === null || proto === Object.prototype;
}
function isEmptyOverride(v) {
  if (v === null || v === void 0 || v === false || v === "") return true;
  if (v === 0) return true;
  return Array.isArray(v) && v.length === 0;
}
function toInternal(qdef) {
  const t = qdef["type"];
  let crit = qdef["criteria"];
  if (t === "choice" && Array.isArray(crit)) {
    crit = Object.fromEntries(crit.map((c) => [c, null]));
  } else if (t === "noul" && crit !== null && crit !== void 0 && typeof crit === "object" && !Array.isArray(crit)) {
    crit = Object.fromEntries(Object.entries(crit).map(([k, v]) => [String(k).toLowerCase(), v]));
  }
  let ins = qdef["instructions"];
  if (typeof ins !== "string") ins = serializeState(ins);
  const out = {
    t,
    ins,
    crit
  };
  if (t === "noul" && qdef["labels"] && typeof qdef["labels"] === "object" && !Array.isArray(qdef["labels"])) {
    const labels = qdef["labels"];
    out.labels = { false: String(labels["false"]).trim(), true: String(labels["true"]).trim() };
  }
  if (Object.hasOwn(qdef, "option_order")) {
    out.optionOrder = qdef["option_order"].map((i) => Math.trunc(Number(i)));
  }
  return out;
}
function defaultTokenizer() {
  return {
    clsId: 101,
    sepId: 102,
    maskId: 103,
    padId: 0,
    maskToken: "[MASK]",
    encode(text) {
      return text.split(/\s+/).filter(Boolean).map((w, i) => 1e3 + (w.length * 31 + i * 7) % 2e4);
    }
  };
}
function tokenizerFromHF(tokenizerJson) {
  const data = parseTokenizerJson(tokenizerJson);
  if (!data) return null;
  return {
    clsId: data.ids.cls,
    sepId: data.ids.sep,
    maskId: data.ids.mask,
    padId: data.ids.pad,
    maskToken: data.maskToken,
    encode: (text) => encodeWithData(data, text),
    ...data.decode ? { decode: data.decode } : {}
  };
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;
class Agent extends HookRegistry {
  hooksRaise;
  hooksTimeout;
  cfg;
  provider;
  revision;
  tok;
  maxLen;
  headMaxLen;
  temperatureRaw;
  temperatureByOptionsRaw;
  temperature;
  temperatureByOptions;
  binningMap;
  langTemperatures;
  constructor(opts) {
    super();
    if (!opts || !opts.provider) throw new Error("Agent needs a provider");
    this.provider = opts.provider;
    this.revision = opts.revision ?? null;
    this.hooks = normaliseHooks(opts.hooks, opts.onPredictStart, opts.onPredictEnd);
    this.hooksRaise = opts.hooksRaise ?? true;
    this.hooksTimeout = validateHooksTimeout(opts.hooksTimeout ?? null);
    const cfg = { ...opts.cfg ?? {} };
    if (opts.max_len !== void 0) cfg.max_len = opts.max_len;
    if (opts.head_max_len !== void 0) cfg.head_max_len = opts.head_max_len;
    if (opts.temperature !== void 0) cfg.temperature = opts.temperature;
    if (opts.temperature_by_options !== void 0) cfg.temperature_by_options = opts.temperature_by_options;
    if (opts.binning_map !== void 0) cfg.binning_map = opts.binning_map;
    if (opts.binningMap !== void 0) cfg.binning_map = opts.binningMap;
    this.cfg = cfg;
    this.maxLen = Number(cfg.max_len ?? 512);
    this.headMaxLen = Number(cfg.head_max_len ?? 192);
    this.tok = opts.tok ?? defaultTokenizer();
    const bmapRaw = cfg.binning_map;
    this.binningMap = bmapRaw !== void 0 && bmapRaw !== null ? checkBinningMap(bmapRaw) : null;
    const raw = cfg.temperature ?? [1, 1, 1];
    this.temperatureRaw = raw;
    if (!Array.isArray(raw) || raw.length !== 3) {
      throw new Error(`Incompatible model: temperature must be a list of 3 floats, got ${JSON.stringify(raw)}`);
    }
    const rawList = raw;
    this.temperature = rawList.map((t) => clampTemperature(t));
    this.temperatureByOptionsRaw = cfg.temperature_by_options ?? {};
    this.temperatureByOptions = Object.fromEntries(
      Object.entries(this.temperatureByOptionsRaw).map(([k, v]) => [k, clampTemperature(v)])
    );
    const entries = [
      ...Object.entries(this.temperatureByOptionsRaw).map(
        ([k, v]) => [k, v, this.temperatureByOptions[k]]
      ),
      ...[0, 1, 2].map(
        (i) => [`temperature[${i}]`, rawList[i], this.temperature[i]]
      )
    ];
    const rejected = [];
    for (const [name, rawV, applied] of entries) {
      if (typeof rawV !== "boolean" && Number(rawV) === applied) continue;
      rejected.push(`${name}=${JSON.stringify(rawV) ?? String(rawV)} -> ${applied}`);
    }
    if (rejected.length > 0) {
      console.warn(
        `laya: this checkpoint ships invalid temperatures or values outside [${TEMP_MIN}, ${TEMP_MAX}]; using ${rejected.join(", ")}. Treat confidence from the affected entries as uncalibrated.`
      );
    }
    this.langTemperatures = {};
    for (const [l, lc] of Object.entries(opts.lang_temperatures ?? {})) {
      const normL = l.split("-")[0].toLowerCase();
      const tRaw = lc?.temperature ?? rawList;
      if (!Array.isArray(tRaw) || tRaw.length !== 3) {
        throw new Error(
          `Language override ${JSON.stringify(l)} temperature must be a list of 3 floats`
        );
      }
      const tboRaw = lc?.temperature_by_options;
      if (!isEmptyOverride(tboRaw) && !isPlainDict(tboRaw)) {
        throw new Error(
          `Language override ${JSON.stringify(l)} temperature_by_options must be a mapping of bucket -> float, got ${Array.isArray(tboRaw) ? "list" : typeof tboRaw}`
        );
      }
      const tboDict = isPlainDict(tboRaw) ? tboRaw : {};
      this.langTemperatures[normL] = {
        temperature: [0, 1, 2].map((i) => clampTemperature(tRaw[i])),
        temperatureByOptions: Object.fromEntries(
          Object.entries(tboDict).map(([k, v]) => [k, clampTemperature(v)])
        )
      };
    }
  }
  /**
   * Evaluate typed questions across one state in a single forward pass.
   *
   * `hooks` / `onPredictStart` / `onPredictEnd` observe or shape the prediction, appended
   * after any hooks installed on the Agent; a start hook may rewrite the state/questions or
   * call `ctx.skip(...)` to short-circuit inference, an end hook may rewrite the results.
   * See hooks.ts. `hooksRaise` overrides the Agent's setting for this call.
   */
  async systemOne(state, questions, opts = {}) {
    return (await this._predictHooked([state], questions, opts))[0];
  }
  async _predictHooked(states, questions, opts) {
    const mcOpt = opts.minConfidence ?? opts.min_confidence;
    const mc = mcOpt !== void 0 && mcOpt !== null ? checkMinConfidence(mcOpt) : null;
    const active = defaultsAlreadyRan(opts) ? [...this.hooks, ...normaliseHooks(opts.hooks, opts.onPredictStart, opts.onPredictEnd)] : composeHooks(this.hooks, opts.hooks, opts.onPredictStart, opts.onPredictEnd);
    const raiseErrors = opts.hooksRaise ?? this.hooksRaise;
    const hooksTimeout = validateHooksTimeout(opts.hooksTimeout ?? this.hooksTimeout);
    const timeoutMs = hooksTimeout === null ? null : hooksTimeout * 1e3;
    const ctx = new PredictContext({
      states,
      questions,
      agent: this,
      maxLen: opts.maxLen ?? null,
      headMaxLen: opts.headMaxLen ?? null
    });
    try {
      await dispatchAsync(active, "onPredictStart", ctx, { raiseErrors, timeoutMs });
      if (ctx.results === null) {
        if (!Array.isArray(ctx.states)) {
          throw new TypeError(
            "predictBatch expects an array of states; pass a single state to predict()/systemOne()."
          );
        }
        if (!isPlainDict(ctx.questions)) {
          const typeName2 = ctx.questions === null ? "NoneType" : Array.isArray(ctx.questions) ? "list" : typeof ctx.questions === "object" ? ctx.questions.constructor?.name ?? "object" : typeof ctx.questions;
          throw new TypeError(
            `questions must be a dict of question id -> definition, got ${typeName2}`
          );
        }
        for (const st of ctx.states) {
          if (st === null || st === void 0) {
            throw new TypeError("state must not be None; pass a string, dict, or list");
          }
        }
        const out = await this._systemOneMany(ctx.states, ctx.questions, {
          maxLen: ctx.maxLen,
          headMaxLen: ctx.headMaxLen,
          batchSize: opts.batchSize ?? null,
          lang: opts.lang ?? null
        });
        ctx.results = out;
        ctx.model ??= out[0]?.model ?? null;
      }
    } catch (err) {
      ctx.error = err;
      try {
        await dispatchAsync(active, "onError", ctx, { raiseErrors });
      } catch {
      }
      throw err;
    } finally {
      ctx.markElapsed();
      if (ctx.results !== null && (!isLongCall(opts) || Array.isArray(ctx.results))) {
        ctx.usage = aggregateUsage(ctx.results);
        if (mc !== null) {
          flagLowConfidence(ctx.results, mc);
        }
        recordLongResults(opts, ctx);
      }
      try {
        await dispatchAsync(active, "onPredictEnd", ctx, { raiseErrors, timeoutMs });
      } catch (hookErr) {
        if (ctx.error === null) throw hookErr;
      }
    }
    finishLongResults(opts, ctx);
    return ctx.results;
  }
  /** Encode one state into one sequence row per question; the state text is tokenized once. */
  _encodeItems(state, ids, internals, maxLen, headMaxLen) {
    const stAll = this.tok.encode(serializeState(state).split(this.tok.maskToken).join(" "));
    const items = [];
    const stats = [];
    for (let qi = 0; qi < ids.length; qi++) {
      const qid = ids[qi];
      const q2 = internals[qi];
      const prefix = buildQuestionPrefix(this.tok, q2, maxLen, headMaxLen, q2.optionOrder);
      const seq = sequenceWithState(
        prefix,
        stAll,
        this.tok.sepId,
        maxLen,
        Array.isArray(state)
      );
      if (seq.markers.length !== renderOptions(q2).length) {
        throw new Error(`question ${qidStr(qid)} options exceed head_max_len=${headMaxLen}`);
      }
      items.push({ ids: seq.ids, markers: seq.markers, qtype: QTYPES[q2.t] });
      stats.push(seq.stats);
    }
    return { items, nTokens: items.reduce((a, it) => a + it.ids.length, 0), stats };
  }
  /**
   * Evaluate one shared question schema over many states. Each chunk of up to `batchSize`
   * states is collated into a single encoder+head forward pass; results align with `states`
   * by index. (Python `Agent.predict_batch` parity; its `sort_by_length` is not ported.)
   */
  async _systemOneMany(states, questions, opts = {}) {
    if (states.length === 0) return [];
    const ids = Object.keys(questions ?? {});
    if (ids.length === 0) {
      return states.map(() => ({
        model: "laya-rl-agent",
        answers: {},
        usage: { input_tokens: 0, output_tokens: 0 }
      }));
    }
    const maxLen = opts.maxLen ?? this.maxLen;
    const headMaxLen = opts.headMaxLen ?? this.headMaxLen;
    const internals = ids.map((qid) => {
      checkQuestion(qid, questions[qid]);
      return toInternal(questions[qid]);
    });
    const chunkSize = opts.batchSize && opts.batchSize > 0 ? Math.floor(opts.batchSize) : states.length;
    const out = [];
    for (let start = 0; start < states.length; start += chunkSize) {
      const chunk = states.slice(start, start + chunkSize);
      const built = chunk.map((st) => this._encodeItems(st, ids, internals, maxLen, headMaxLen));
      const collated = collateItems(built.map((b) => b.items), this.tok.padId);
      if (!collated) throw new Error("no items to collate");
      const batch = collated;
      const { lastHidden } = await this.provider.runEncoder(batch);
      const { logits, act } = await this.provider.runHead(lastHidden, batch);
      const rows = chunk.length * ids.length;
      if (!Array.isArray(logits) || !Array.isArray(act) || logits.length < rows || act.length < rows) {
        throw new Error("model provider returned fewer output rows than input items");
      }
      for (let s = 0; s < chunk.length; s++) {
        for (let qi = 0; qi < ids.length; qi++) {
          const r = s * ids.length + qi;
          const k = built[s].items[qi].markers.length;
          const logitRow = logits[r];
          const actRow = act[r];
          if (!Array.isArray(logitRow) || logitRow.length < k || !Array.isArray(actRow) || actRow.length === 0 || logitRow.some((v) => !Number.isFinite(v)) || actRow.some((v) => !Number.isFinite(v))) {
            throw new Error(`model provider returned invalid output for question ${ids[qi]}`);
          }
        }
      }
      let row = 0;
      for (let s = 0; s < chunk.length; s++) {
        const answers = {};
        for (let qi = 0; qi < ids.length; qi++) {
          answers[ids[qi]] = this._decodeRow(
            logits[row],
            // The action head is normalised here, at the model boundary, as `laya/agent.py`'s
            // `_forward` (agent.py:1329) and `laya/onnx_agent.py` (onnx_agent.py:805) do: the decode
            // layer's contract -- the Java decoder's `actionProbabilities`, and the `act` rows in
            // `laya-java/fixtures/decode.json` -- is a probability row. Softmaxing it a second time
            // inside `_decodeRow` reported 0.6899 for the row `[0.9, 0.1]`, where the reference
            // reports 0.9.
            softmax(act[row] ?? [1, 0]),
            internals[qi],
            built[s].items[qi].markers.length,
            opts.lang ?? null
          );
          row++;
        }
        const st = built[s].stats;
        const dropped = st.reduce((a, x) => Math.max(a, x.state_tokens_dropped), 0);
        const collapsed = collapsedOptions(ids, st);
        out.push({
          model: "laya-rl-agent",
          answers,
          usage: {
            input_tokens: built[s].nTokens,
            output_tokens: 0,
            state_tokens: st[0]?.state_tokens ?? 0,
            state_tokens_dropped: dropped,
            truncated: dropped > 0,
            truncated_questions: ids.filter((_, qi) => st[qi].truncated),
            ...Object.keys(collapsed).length ? { options: collapsed } : {}
          }
        });
      }
    }
    return out;
  }
  /**
   * Decode one head row into the answer for its question. `actRow` is the model boundary's
   * normalised action-probability row, so its first entry is the reported `act_probability` --
   * exactly what `Agent._decode_answers` reads as `act[r, 0]`.
   */
  _decodeRow(logitsRow, actRow, q2, k, lang = null) {
    const qt = QTYPES[q2.t];
    const bucket = tempBucket(qt, k);
    const langCfg = lang ? this.langTemperatures[lang.split("-")[0].toLowerCase()] : void 0;
    const scale = langCfg ? langCfg.temperatureByOptions[bucket] ?? langCfg.temperature[qt] ?? 1 : this.temperatureByOptions[bucket] ?? this.temperature[qt] ?? 1;
    const z = logitsRow.slice(0, k).map((v) => v / scale);
    const p = unpermuteProbs(softmax(z), q2.optionOrder);
    const ext = { act_probability: r4(actRow[0]) };
    const ansRaw = answerConfidence(p);
    const langOverride = Boolean(lang && lang.split("-")[0].toLowerCase() in this.langTemperatures);
    const ansConf = r4(
      this.binningMap && !langOverride ? applyBinningMap(ansRaw, bucket, this.binningMap) : ansRaw
    );
    if (q2.t === "choice") {
      const keys = Object.keys(q2.crit);
      let best2 = 0;
      for (let i = 1; i < p.length; i++) if (p[i] > p[best2]) best2 = i;
      return {
        type: "choice",
        choice: keys[best2],
        probabilities: Object.fromEntries(keys.map((kk, i) => [kk, r4(p[i] ?? 0)])),
        confidence: r4(confidenceFromProbs(p)),
        answer_confidence: ansConf,
        action: ext
      };
    }
    if (q2.t === "score") {
      const exp = p.reduce((a, v, i) => a + i * v, 0);
      return {
        type: "score",
        score: r4(exp),
        // `renderCriterion`, not the raw `c`: a legend maps an index to the TEXT of a level, and
        // the keys are already strings. A numeric scale written directly used to come back with
        // the caller's own JSON types (`{"0": 1}`), so a client that reads a level as a string
        // had to handle a number, a boolean and null as well -- and `{"0": null}` is not even
        // parseable by a Jev client (#302). Same change as the Python `agent.py` and
        // `onnx_agent.py` legends, so the two runtimes return the same value types.
        legend: Object.fromEntries(
          q2.crit.map((c, i) => [String(i), renderCriterion(c)])
        ),
        probabilities: Object.fromEntries(p.map((v, i) => [String(i), r4(v)])),
        confidence: r4(confidenceFromProbs(p)),
        answer_confidence: ansConf,
        action: ext
      };
    }
    const pt = p[1] ?? 0;
    return {
      type: "noul",
      noul: r4(pt),
      confidence: r4(Math.max(pt, 1 - pt)),
      // over two options max(p_true, 1 - p_true) is max(p): identical to confidence here
      answer_confidence: ansConf,
      action: ext
    };
  }
  async predict(state, questions, opts = {}) {
    return this.systemOne(state, questions, opts);
  }
  /**
   * Evaluate the same questions over many states, packing each chunk of up to
   * `opts.batchSize` states into one shared forward pass (Python `Agent.predict_batch`
   * parity). This is the throughput path: `systemOne`/`predict` run one state per forward
   * pass, which leaves most of the batch dimension idle on GPU. Results align with
   * `states` by index and are identical in shape to `systemOne`'s output.
   *
   * `opts.maxLen` / `opts.headMaxLen` override the agent config for this call; a start
   * hook may also set `ctx.maxLen` / `ctx.headMaxLen` or call `ctx.skip(results)`.
   * Python's `sort_by_length` grouping is not ported.
   */
  async predictBatch(states, questions, opts = {}) {
    return this._predictHooked(states, questions, opts);
  }
  /** Scan overlapping token windows locally and keep each question's strongest answer.
   * Attribution refers to the original candidate token slice; decoding and re-encoding can
   * change its length. Confidence belongs to the winning window, not the whole document.
   * Agent hooks wrap one batch of windows. A hook budget change is checked after inference.
   */
  async predictLong(state, questions, opts = {}) {
    return predictLong(this, state, questions, opts);
  }
  async decide(state, schema, opts = {}) {
    return decide(this, state, schema, opts);
  }
  async decideBatch(states, schema, opts = {}) {
    return decideBatch(this, states, schema, opts);
  }
  static async load(modelDirOrRepo, opts) {
    const sub = opts?.subfolder ?? null;
    const isBrowser = typeof globalThis.window !== "undefined";
    let cfg = {};
    let tokenizerJson = null;
    let dir = opts?.localDir ?? modelDirOrRepo;
    let revision = null;
    let provider;
    if (isBrowser) {
      const { loadWebBundle: loadWebBundle2, createWebProvider: createWebProvider2 } = await Promise.resolve().then(() => providers);
      const bundle = await loadWebBundle2(modelDirOrRepo, {
        subfolder: sub,
        revision: opts?.revision,
        expectedSha256: opts?.expectedSha256,
        signal: opts?.signal,
        onProgress: opts?.onProgress
      });
      cfg = bundle.cfg;
      tokenizerJson = bundle.tokenizerJson;
      dir = bundle.dir;
      revision = bundle.revision;
      provider = await createWebProvider2(dir, {
        numThreads: opts?.numThreads,
        expectedSha256: opts?.expectedSha256
      });
    } else {
      const { loadNodeBundle: loadNodeBundle2, createNodeProvider: createNodeProvider2 } = await Promise.resolve().then(() => providers);
      const bundle = await loadNodeBundle2(modelDirOrRepo, {
        subfolder: sub,
        localDir: opts?.localDir,
        token: opts?.token,
        revision: opts?.revision,
        expectedSha256: opts?.expectedSha256,
        signal: opts?.signal,
        onProgress: opts?.onProgress
      });
      cfg = bundle.cfg;
      tokenizerJson = bundle.tokenizerJson;
      dir = bundle.dir;
      revision = bundle.revision;
      provider = await createNodeProvider2(dir, {
        device: opts?.device,
        numThreads: opts?.numThreads,
        expectedSha256: opts?.expectedSha256
      });
    }
    if (!tokenizerJson) {
      throw new Error(
        `Incompatible model: tokenizer.json is missing or invalid in ${JSON.stringify(dir)}`
      );
    }
    let tok;
    try {
      const parsed = tokenizerFromHF(tokenizerJson);
      if (!parsed) throw new Error("unsupported tokenizer.json format");
      tok = parsed;
    } catch (error) {
      throw new Error(
        `Incompatible model: tokenizer.json is missing or invalid in ${JSON.stringify(dir)}: ${String(error)}`
      );
    }
    return new Agent({ provider, tok, cfg, revision, lang_temperatures: opts?.lang_temperatures });
  }
}
const agent = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Agent,
  QTYPES,
  checkQuestion,
  defaultTokenizer,
  toInternal
}, Symbol.toStringTag, { value: "Module" }));
const PINNED_REVISIONS = {
  "convaiinnovations/laya": "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851",
  "convaiinnovations/laya-multilingual": "e4e9ddf21a7b1903b7acffd8814ad4307bf63a67",
  "convaiinnovations/laya-typed-decisions": "1a793eb568e6718f15941d08f85432581df534e3"
};
function resolveRevision(_repoOrId, revision) {
  return revision || null;
}
async function sha256Hex(data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("laya-ts: SHA-256 verification requires Web Crypto (globalThis.crypto.subtle)");
  }
  const digest = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
function normaliseDigestPath(rel) {
  const raw = String(rel).replace(/\\/g, "/");
  if (/^(?:[A-Za-z]:|\/)/.test(raw)) {
    throw new Error(`laya-ts: unsafe absolute path in expectedSha256: ${JSON.stringify(rel)}`);
  }
  const norm = raw;
  if (!norm || norm === ".." || norm.startsWith("../") || norm.includes("/../")) {
    throw new Error(`laya-ts: unsafe path in expectedSha256: ${JSON.stringify(rel)}`);
  }
  return norm;
}
function assertDigestMap(expected) {
  if (expected === void 0 || expected === null) return;
  if (typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error("laya-ts: expected_sha256 must be a mapping of artifact paths to digests");
  }
}
async function expectDigest(rel, data, expected) {
  const want = expected[rel] ?? expected[normaliseDigestPath(rel)];
  if (want === void 0) return;
  const got = await sha256Hex(data);
  if (got.toLowerCase() !== String(want).trim().toLowerCase()) {
    throw new Error(
      `laya-ts: SHA-256 mismatch for ${rel}: expected ${want}, got ${got}. Refusing to load the artifact.`
    );
  }
}
function toNested(data, dims) {
  let total = 1;
  for (const d of dims) total *= d;
  const flat = new Array(total);
  for (let i = 0; i < total; i++) {
    const v = data[i];
    flat[i] = typeof v === "bigint" ? Number(v) : v;
  }
  if (dims.length === 0) return flat[0];
  const steps = new Array(dims.length);
  for (let d = 0; d < dims.length; d++) {
    let s = 1;
    for (let k = d + 1; k < dims.length; k++) s *= dims[k];
    steps[d] = s;
  }
  const rec = (d, off) => {
    if (d === dims.length - 1) return flat.slice(off, off + dims[d]);
    const out = new Array(dims[d]);
    for (let i = 0; i < dims[d]; i++) out[i] = rec(d + 1, off + i * steps[d]);
    return out;
  };
  return rec(0, 0);
}
function i64(ort, arr, dims) {
  const out = new BigInt64Array(dims.reduce((a, b) => a * b, 1));
  let p = 0;
  if (Array.isArray(arr[0])) {
    for (const row of arr) for (const v of row) out[p++] = BigInt(Math.trunc(v));
  } else {
    for (const v of arr) out[p++] = BigInt(Math.trunc(v));
  }
  return new ort.Tensor("int64", out, dims);
}
function feed(ort, b) {
  const n = b.inputIds.length;
  let L = 1;
  for (const r of b.inputIds) if (r.length > L) L = r.length;
  return {
    input_ids: i64(ort, b.inputIds, [n, L]),
    attention_mask: i64(ort, b.attentionMask, [n, L])
  };
}
function feedHead(ort, hidden, b) {
  const n = b.markerPos.length;
  let k = 1;
  for (const r of b.markerPos) if (r.length > k) k = r.length;
  const nH = hidden.length ?? n;
  const S = hidden[0]?.length ?? 1;
  const Hd = hidden[0]?.[0]?.length ?? 1;
  const flatH = new Float32Array(nH * S * Hd);
  let p = 0;
  for (let i = 0; i < nH; i++) {
    const bi = hidden[i] ?? [];
    for (let j = 0; j < S; j++) {
      const hj = bi[j] ?? [];
      for (let h = 0; h < Hd; h++) flatH[p++] = Number(hj[h] ?? 0);
    }
  }
  const H = new ort.Tensor("float32", flatH, [nH, S, Hd]);
  const maskRows = b.attentionMask.map((r) => {
    const row = r.slice(0, S);
    while (row.length < S) row.push(0);
    return row;
  });
  return {
    hidden_states: H,
    marker_pos: i64(ort, b.markerPos, [n, k]),
    marker_mask: new ort.Tensor("bool", (() => {
      const out = new Uint8Array(n * k);
      let q2 = 0;
      for (const row of b.markerMask)
        for (let j = 0; j < k; j++) out[q2++] = row[j] ? 1 : 0;
      return out;
    })(), [n, k]),
    qtype: i64(ort, b.qtype.map((v) => [v]), [n, 1]),
    // Padding mask for the head transformer (py DecisionModel.forward).
    // Without it, batch mates of unequal length corrupt each other's markers.
    attention_mask: i64(ort, maskRows, [n, S])
  };
}
function alignFeeds(session, feeds, ort) {
  const meta = session?.inputMetadata ?? [];
  const names = meta.length ? meta.map((m) => m.name) : session?.inputNames ?? [];
  if (!names.length) return feeds;
  if (!names.includes("hidden_states") && feeds.hidden_states !== void 0) {
    const target = names.find((n) => !["marker_pos", "marker_mask", "qtype", "attention_mask"].includes(n)) ?? names[0];
    if (target && feeds[target] === void 0) {
      feeds[target] = feeds.hidden_states;
      delete feeds.hidden_states;
    }
  }
  for (const m of meta) {
    const t = feeds[m.name];
    if (!t || !Array.isArray(m.shape)) continue;
    const expectedRank = m.shape.length;
    let dims = [...t.dims];
    while (dims.length > expectedRank && dims[dims.length - 1] === 1) dims.pop();
    while (dims.length < expectedRank) dims.push(1);
    if (dims.length !== t.dims.length || dims.some((d, i) => d !== t.dims[i])) {
      feeds[m.name] = new ort.Tensor(t.type, t.data, dims);
    }
  }
  return feeds;
}
function pickOutput(out, names) {
  for (const n of names) if (out[n] !== void 0) return out[n];
  const vals = Object.values(out);
  return vals[0];
}
function applyNumThreads(ort, numThreads) {
  try {
    const raw = numThreads ?? (typeof process !== "undefined" ? Number(process.env?.["LAYA_THREADS"]) : NaN);
    if (Number.isFinite(raw) && raw > 0 && ort?.env) {
      ort.env.numThreads = Math.trunc(raw);
    }
  } catch {
  }
}
function isOomError(e) {
  const m = String(e?.message ?? e).toLowerCase();
  return m.includes("memory") || m.includes("cuda") || m.includes("out of memory") || m.includes("oom");
}
const CACHE_KEY = "laya-ts";
const TOKENIZER_CANDIDATES = ["tokenizer.json", "tokenizer/tokenizer.json"];
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function fetchWithRetry(url, init, retries = 2) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(100 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      if (e?.name === "AbortError") throw e;
      if (attempt < retries) {
        await sleep(100 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw last instanceof Error ? last : new Error(`fetch failed for ${url}`);
}
async function fetchArrayBuffer(url, opts) {
  const g = globalThis;
  let cache = null;
  let hit = null;
  try {
    if (g.caches && typeof g.caches.open === "function") {
      try {
        cache = await g.caches.open(CACHE_KEY);
        try {
          hit = await cache.match(url);
        } catch {
          hit = null;
        }
      } catch {
        cache = null;
      }
    }
  } catch {
    cache = null;
  }
  if (cache) {
    try {
      const res2 = await fetchWithRetry(url, { signal: opts?.signal ?? void 0 });
      opts?.onHeaders?.(res2);
      if (res2.ok) {
        try {
          await cache.put(url, res2.clone());
        } catch {
        }
        return await res2.arrayBuffer();
      }
    } catch (e) {
      if (hit) {
        try {
          return await hit.arrayBuffer();
        } catch {
        }
      }
      throw e;
    }
    if (hit) {
      try {
        return await hit.arrayBuffer();
      } catch {
      }
    }
    throw new Error(`fetch failed for ${url}`);
  }
  const res = await fetchWithRetry(url, { signal: opts?.signal ?? void 0 });
  opts?.onHeaders?.(res);
  if (!res.ok) throw new Error(`fetch failed for ${url}: ${res.status}`);
  return await res.arrayBuffer();
}
async function loadNodeBundle(modelDirOrRepo, opts) {
  assertDigestMap(opts?.expectedSha256);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const sub = opts?.subfolder ?? null;
  let dir = opts?.localDir ?? modelDirOrRepo;
  let resolvedRevision = null;
  try {
    const st = await fs.stat(sub ? path.join(dir, sub) : dir);
    if (st.isDirectory()) dir = sub ? path.join(dir, sub) : dir;
    else dir = path.dirname(dir);
  } catch {
    const revision = resolveRevision(modelDirOrRepo, opts?.revision);
    resolvedRevision = revision;
    const cache = path.join(
      os.homedir(),
      ".cache",
      "laya-ts",
      "hf",
      modelDirOrRepo.replace(/\//g, "__"),
      sub ?? "root",
      ...revision && revision !== "main" ? [revision] : []
    );
    await fs.mkdir(cache, { recursive: true });
    const token = opts?.token ?? (typeof process !== "undefined" ? process.env?.["HF_TOKEN"] : void 0);
    const files = ["rl_agent_config.json", "tokenizer.json", "tokenizer/tokenizer.json", "encoder.onnx", "head.onnx"];
    let done = 0;
    for (const f of files) {
      try {
        await fs.stat(path.join(cache, f));
      } catch {
        const url = `https://huggingface.co/${modelDirOrRepo}/resolve/${revision ?? "main"}/${sub ? sub + "/" : ""}${f}`;
        const res = await fetchWithRetry(
          url,
          {
            ...token ? { headers: { Authorization: `Bearer ${token}` } } : {},
            signal: opts?.signal ?? void 0
          }
        );
        const commit = res.headers?.get?.("x-repo-commit");
        if (commit) resolvedRevision = commit;
        if (!res.ok) {
          if (f === "rl_agent_config.json") {
            throw new Error(
              `Incompatible model: ${JSON.stringify(modelDirOrRepo)} does not contain 'rl_agent_config.json'.`
            );
          }
          continue;
        }
        const target = path.join(cache, f);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const tmp = `${target}.tmp-${typeof process !== "undefined" ? process.pid : 0}`;
        await fs.writeFile(tmp, new Uint8Array(await res.arrayBuffer()));
        await fs.rename(tmp, target);
      }
      done++;
      opts?.onProgress?.(done, files.length, f);
    }
    dir = cache;
  }
  if (opts?.expectedSha256) {
    const { createHash } = await import("node:crypto");
    for (const [rel, want] of Object.entries(opts.expectedSha256)) {
      const norm = normaliseDigestPath(rel);
      let buf;
      try {
        buf = new Uint8Array(await fs.readFile(path.join(dir, norm)));
      } catch {
        throw new Error(`laya-ts: cannot verify ${JSON.stringify(rel)}: not found under ${dir}`);
      }
      const got = createHash("sha256").update(buf).digest("hex");
      if (got.toLowerCase() !== String(want).trim().toLowerCase()) {
        throw new Error(
          `laya-ts: SHA-256 mismatch for ${rel}: expected ${want}, got ${got}. Refusing to load the artifact.`
        );
      }
    }
  }
  let cfg = {};
  try {
    cfg = JSON.parse(await fs.readFile(path.join(dir, "rl_agent_config.json"), "utf8"));
  } catch {
    throw new Error(
      `Incompatible model: ${JSON.stringify(modelDirOrRepo)} does not contain 'rl_agent_config.json'.`
    );
  }
  let tokenizerJson = null;
  for (const candidate of TOKENIZER_CANDIDATES) {
    try {
      tokenizerJson = JSON.parse(await fs.readFile(path.join(dir, candidate), "utf8"));
      break;
    } catch {
    }
  }
  return { dir, cfg, tokenizerJson, revision: resolvedRevision };
}
function trimSlashes(value, leading = false) {
  let start = 0;
  let end = value.length;
  if (leading) while (start < end && value[start] === "/") start++;
  while (end > start && value[end - 1] === "/") end--;
  return value.slice(start, end);
}
function baseUrlFor(repoOrUrl, subfolder, revision) {
  const sub = subfolder ? `/${trimSlashes(subfolder, true)}` : "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(repoOrUrl)) {
    return `${trimSlashes(repoOrUrl)}${sub}`;
  }
  return `https://huggingface.co/${repoOrUrl}/resolve/${revision ?? "main"}${sub}`;
}
async function loadWebBundle(repoOrUrl, opts) {
  assertDigestMap(opts?.expectedSha256);
  const revision = resolveRevision(repoOrUrl, opts?.revision);
  const base = baseUrlFor(repoOrUrl, opts?.subfolder ?? null, revision);
  let reportedRevision = revision;
  const fetchVerifiedJson = async (rel) => {
    const buf = await fetchArrayBuffer(`${base}/${rel}`, {
      signal: opts?.signal ?? void 0,
      onHeaders: (response) => {
        const commit = response.headers?.get?.("x-repo-commit");
        if (commit) reportedRevision = commit;
      }
    });
    if (opts?.expectedSha256) await expectDigest(rel, buf, opts.expectedSha256);
    return JSON.parse(new TextDecoder().decode(buf));
  };
  let cfg;
  try {
    cfg = await fetchVerifiedJson("rl_agent_config.json");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("laya-ts: SHA-256 mismatch")) throw e;
    if (e?.name === "AbortError") throw e;
    throw new Error(`Incompatible model: ${JSON.stringify(repoOrUrl)} does not contain 'rl_agent_config.json'.`);
  }
  opts?.onProgress?.(1, 2, "rl_agent_config.json");
  let tokenizerJson = null;
  for (const candidate of TOKENIZER_CANDIDATES) {
    try {
      tokenizerJson = await fetchVerifiedJson(candidate);
      break;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("laya-ts: SHA-256 mismatch")) throw e;
    }
  }
  opts?.onProgress?.(2, 2, "tokenizer.json");
  return { dir: base, cfg, tokenizerJson, revision: reportedRevision };
}
async function createNodeProvider(modelDir, opts) {
  assertDigestMap(opts?.expectedSha256);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  for (const f of ["encoder.onnx", "head.onnx"]) {
    const p = path.join(modelDir, f);
    try {
      await fs.stat(p);
    } catch {
      throw new Error(`Incompatible model: '${f}' not found in ${JSON.stringify(modelDir)} (expected ${p}).`);
    }
    if (opts?.expectedSha256) await expectDigest(f, await fs.readFile(p), opts.expectedSha256);
  }
  const spec = "onnxruntime-node";
  const ort = await import(
    /* @vite-ignore */
    spec
  );
  applyNumThreads(ort, opts?.numThreads);
  const dev = String(opts?.device ?? "cpu").toLowerCase();
  const want = dev === "cuda" ? "cuda" : dev === "dml" ? "dml" : "cpu";
  const make = async (ep) => {
    const e = await ort.InferenceSession.create(`${modelDir}/encoder.onnx`, {
      executionProviders: [ep]
    });
    const h = await ort.InferenceSession.create(`${modelDir}/head.onnx`, {
      executionProviders: ["cpu"]
    });
    return { e, h };
  };
  let enc;
  let head;
  let activeEP = want;
  try {
    ({ e: enc, h: head } = await make(want));
  } catch (e) {
    if (want !== "cpu") {
      console.warn(`Warning: ${want.toUpperCase()} requested but not available. Falling back to CPU.`);
      ({ e: enc, h: head } = await make("cpu"));
      activeEP = "cpu";
    } else {
      throw e;
    }
  }
  let cpuEnc = null;
  let cpuHead = null;
  const ensureCpu = async () => {
    if (!cpuEnc) {
      cpuEnc = await ort.InferenceSession.create(`${modelDir}/encoder.onnx`, {
        executionProviders: ["cpu"]
      });
      cpuHead = await ort.InferenceSession.create(`${modelDir}/head.onnx`, {
        executionProviders: ["cpu"]
      });
    }
    return { cpuEnc, cpuHead };
  };
  const runWithCpuFallback = async (fn) => {
    try {
      return await fn(enc, head);
    } catch (e) {
      if (activeEP !== "cpu" && isOomError(e)) {
        console.warn("Warning: GPU memory exceeded during inference. Falling back to CPU...");
        const { cpuEnc: ce, cpuHead: ch } = await ensureCpu();
        enc = ce;
        head = ch;
        activeEP = "cpu";
        return await fn(enc, head);
      }
      if (isOomError(e)) {
        throw new Error(`${e.message} (GPU out of memory; try device: "cpu")`);
      }
      throw e;
    }
  };
  return {
    runEncoder: async (b) => runWithCpuFallback(async (e) => {
      const out = await e.run(feed(ort, b));
      const t = pickOutput(out, ["last_hidden_state", "lastHidden", "hidden_states"]);
      return { lastHidden: toNested(t.data, t.dims) };
    }),
    runHead: async (h, b) => runWithCpuFallback(async (_e, hd) => {
      const out = await hd.run(alignFeeds(hd, feedHead(ort, h, b), ort));
      const vals = Object.values(out);
      const lt = pickOutput(out, ["logits"]);
      const at = pickOutput(out, ["act_logits", "act"]) ?? vals[1] ?? vals[0];
      return { logits: toNested(lt.data, lt.dims), act: toNested(at.data, at.dims) };
    })
  };
}
async function fetchSidecar(url) {
  const name = `${url.split("/").pop()}.data`;
  const sidecarUrl = `${trimSlashes(url).split("/").slice(0, -1).join("/")}/${name}`;
  try {
    const buf = await fetchArrayBuffer(sidecarUrl);
    return { path: name, data: new Uint8Array(buf) };
  } catch {
    return null;
  }
}
async function createWebProvider(modelUrl, opts) {
  assertDigestMap(opts?.expectedSha256);
  const spec = "onnxruntime-web";
  const ort = await import(
    /* @vite-ignore */
    spec
  );
  applyNumThreads(ort, opts?.numThreads);
  const base = trimSlashes(modelUrl);
  const encUrl = `${base}/encoder.onnx`;
  const headUrl = `${base}/head.onnx`;
  const readEncoderParts = async (signal) => {
    const buf = await fetchArrayBuffer(encUrl, { signal: signal ?? void 0 });
    const sidecar = await fetchSidecar(encUrl);
    return { buf, extra: sidecar ? { externalData: [sidecar] } : {} };
  };
  let encBuf;
  let encExtra;
  try {
    ({ buf: encBuf, extra: encExtra } = await readEncoderParts(opts?.signal));
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error(`Incompatible model: 'encoder.onnx' not found (expected ${encUrl}).`);
  }
  opts?.onProgress?.(1, 2, "encoder.onnx");
  let headBuf;
  try {
    headBuf = await fetchArrayBuffer(headUrl, { signal: opts?.signal ?? void 0 });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error(`Incompatible model: 'head.onnx' not found (expected ${headUrl}).`);
  }
  opts?.onProgress?.(2, 2, "head.onnx");
  if (opts?.expectedSha256) {
    await expectDigest("encoder.onnx", encBuf, opts.expectedSha256);
    await expectDigest("head.onnx", headBuf, opts.expectedSha256);
  }
  const headSidecar = await fetchSidecar(headUrl);
  const headExtra = headSidecar ? { externalData: [headSidecar] } : {};
  let enc;
  try {
    enc = await ort.InferenceSession.create(new Uint8Array(encBuf), {
      executionProviders: ["webgpu", "wasm"],
      graphOptimizationLevel: "basic",
      ...encExtra
    });
  } catch (e) {
    enc = await ort.InferenceSession.create(new Uint8Array(encBuf), {
      executionProviders: ["wasm"],
      ...encExtra
    });
  }
  const head = await ort.InferenceSession.create(new Uint8Array(headBuf), {
    executionProviders: ["wasm"],
    ...headExtra
  });
  let encWasm = null;
  const runEncoderOn = async (session, b) => {
    const out = await session.run(feed(ort, b));
    const t = pickOutput(out, ["last_hidden_state", "lastHidden", "hidden_states"]);
    return { lastHidden: toNested(t.data, t.dims) };
  };
  return {
    runEncoder: async (b) => {
      if (encWasm) {
        try {
          return await runEncoderOn(encWasm, b);
        } catch (e) {
          if (isOomError(e)) throw new Error(`${e.message} (out of memory; try fewer questions per call)`);
          throw e;
        }
      }
      try {
        return await runEncoderOn(enc, b);
      } catch (e) {
        if (isOomError(e)) throw new Error(`${e.message} (WebGPU out of memory; WASM fallback already active)`);
        if (/\[webgpu\]/i.test(String(e?.message ?? e))) {
          console.warn(
            `laya: WebGPU encoder run failed (${String(e?.message ?? e)}); falling back to WASM.`
          );
          if (!encWasm) {
            let parts;
            try {
              parts = await readEncoderParts();
            } catch {
              throw e;
            }
            encWasm = await ort.InferenceSession.create(new Uint8Array(parts.buf), {
              executionProviders: ["wasm"],
              ...parts.extra
            });
          }
          try {
            return await runEncoderOn(encWasm, b);
          } catch (e2) {
            if (isOomError(e2)) throw new Error(`${e2.message} (out of memory; try fewer questions per call)`);
            throw e2;
          }
        }
        throw e;
      }
    },
    runHead: async (h, b) => {
      try {
        const out = await head.run(alignFeeds(head, feedHead(ort, h, b), ort));
        const vals = Object.values(out);
        const lt = pickOutput(out, ["logits"]);
        const at = pickOutput(out, ["act_logits", "act"]) ?? vals[1] ?? vals[0];
        return { logits: toNested(lt.data, lt.dims), act: toNested(at.data, at.dims) };
      } catch (e) {
        if (isOomError(e)) throw new Error(`${e.message} (out of memory; try fewer questions per call)`);
        throw e;
      }
    }
  };
}
const providers = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  PINNED_REVISIONS,
  createNodeProvider,
  createWebProvider,
  feed,
  feedHead,
  loadNodeBundle,
  loadWebBundle,
  resolveRevision
}, Symbol.toStringTag, { value: "Module" }));
const SCRIPT_RANGES = [
  ["greek", [[880, 1023], [7936, 8191]]],
  ["cyrillic", [[1024, 1327], [11744, 11775], [42560, 42655]]],
  ["armenian", [[1328, 1423]]],
  ["hebrew", [[1424, 1535]]],
  ["arabic", [[1536, 1791], [1872, 1919], [2208, 2303], [64336, 65023], [65136, 65279]]],
  ["devanagari", [[2304, 2431], [43232, 43263]]],
  ["bengali", [[2432, 2559]]],
  ["gurmukhi", [[2560, 2687]]],
  ["gujarati", [[2688, 2815]]],
  ["oriya", [[2816, 2943]]],
  ["tamil", [[2944, 3071]]],
  ["telugu", [[3072, 3199]]],
  ["kannada", [[3200, 3327]]],
  ["malayalam", [[3328, 3455]]],
  ["sinhala", [[3456, 3583]]],
  ["thai", [[3584, 3711]]],
  ["lao", [[3712, 3839]]],
  ["tibetan", [[3840, 4095]]],
  ["myanmar", [[4096, 4255]]],
  ["georgian", [[4256, 4351]]],
  ["ethiopic", [[4608, 4991]]],
  ["khmer", [[6016, 6143]]],
  ["hangul", [[4352, 4607], [12592, 12687], [44032, 55215]]],
  ["kana", [[12352, 12447], [12448, 12543], [12784, 12799]]],
  ["han", [[13312, 19903], [19968, 40959], [63744, 64255]]]
];
const STOP = {
  en: /* @__PURE__ */ new Set([
    "the",
    "and",
    "is",
    "are",
    "was",
    "were",
    "to",
    "of",
    "in",
    "for",
    "with",
    "that",
    "this",
    "it",
    "you",
    "have",
    "has",
    "not",
    "but",
    "on",
    "at",
    "be",
    "as",
    "from",
    "will",
    "can",
    "would",
    "there",
    "their",
    "what",
    "which",
    "please",
    "we",
    "i",
    // Question words, auxiliaries, pronouns and connectives, so a plain request such as "Why hasn't
    // my card been delivered?" is not left undecided. See _STOP["en"] in laya/lang.py for how they
    // were chosen and which words stay out.
    "how",
    "why",
    "when",
    "where",
    "who",
    "whom",
    "does",
    "done",
    "doing",
    "been",
    "being",
    "could",
    "should",
    "might",
    "must",
    "shall",
    "doesn",
    "didn",
    "isn",
    "aren",
    "wasn",
    "weren",
    "haven",
    "hasn",
    "couldn",
    "wouldn",
    "won",
    "dont",
    "wont",
    "didnt",
    "doesnt",
    "isnt",
    "wasnt",
    "havent",
    "ive",
    "youre",
    "thats",
    "whats",
    "any",
    "some",
    "many",
    "much",
    "every",
    "each",
    "these",
    "those",
    "both",
    "few",
    "they",
    "them",
    "she",
    "him",
    "his",
    "our",
    "your",
    "yours",
    "into",
    "onto",
    "between",
    "after",
    "before",
    "through",
    "during",
    "without",
    "within",
    "down",
    "if",
    "nor",
    "than",
    "then",
    "because",
    "while",
    "until",
    "here",
    "only",
    "very",
    "too",
    "ever",
    "never",
    "always",
    "already",
    "yet"
  ]),
  fr: /* @__PURE__ */ new Set([
    "le",
    "la",
    "les",
    "des",
    "une",
    "est",
    "pour",
    "dans",
    "que",
    "qui",
    "avec",
    "sur",
    "pas",
    "plus",
    "nous",
    "vous",
    "être",
    "cette",
    "mais",
    "sont",
    "ont",
    "aux",
    "ce",
    "et",
    "du",
    "au",
    "ou",
    "je",
    "tu",
    "il",
    "elle",
    "ils",
    "elles",
    "mon",
    "ton",
    "ma",
    "ta",
    "sa",
    "mes",
    "tes",
    "ses",
    "ces",
    "deux",
    "trois",
    "très",
    "bien",
    "tout",
    "tous",
    "toute",
    "fait",
    "veux",
    "veut",
    "peux",
    "peut",
    "dois",
    "doit",
    "merci",
    "bonjour",
    "jour",
    "jours",
    "mois",
    "fois",
    "quand",
    "comment",
    "pourquoi",
    "alors",
    "donc"
  ]),
  de: /* @__PURE__ */ new Set([
    "der",
    "die",
    "das",
    "und",
    "ist",
    "ein",
    "eine",
    "den",
    "dem",
    "nicht",
    "mit",
    "für",
    "auf",
    "von",
    "zu",
    "sich",
    "auch",
    "werden",
    "wurde",
    "haben",
    "sind",
    "oder",
    "aber",
    "ich",
    "wir",
    "mir",
    "mich",
    "dir",
    "dich",
    "uns",
    "mein",
    "meine",
    "meinen",
    "meinem",
    "meiner",
    "diese",
    "dieser",
    "diesen",
    "dieses",
    "einen",
    "einem",
    "einer",
    "wie",
    "wo",
    "wann",
    "welche",
    "im",
    "zum",
    "zur",
    "aus",
    "bei",
    "nach",
    "noch",
    "bitte",
    "heute",
    "jetzt",
    "kann",
    "kannst",
    "habe",
    "gibt",
    "wird",
    // shared with English on purpose: counted for English alone, they outvoted short German
    "in",
    "was"
  ]),
  es: /* @__PURE__ */ new Set([
    "el",
    "los",
    "las",
    "que",
    "por",
    "con",
    "para",
    "una",
    "es",
    "se",
    "del",
    "como",
    "pero",
    "son",
    "está",
    "este",
    "esta",
    "todo",
    "más",
    "muy",
    "hay",
    "sus",
    "la",
    "un",
    "y",
    "al",
    "lo",
    "le",
    "les",
    "su",
    "mi",
    "tu",
    "nos",
    "ni",
    "dos",
    "tres",
    "fue",
    "fueron",
    "ser",
    "tiene",
    "tienen",
    "tengo",
    "puede",
    "pueden",
    "quiero",
    "necesito",
    "hemos",
    "han",
    "sobre",
    "entre",
    "cuando",
    "donde",
    "porque",
    "aunque",
    "también",
    "ya",
    "eso",
    "esto",
    "esa",
    "ese",
    "nada",
    "algo",
    "aquí",
    "hoy",
    "gracias"
  ]),
  pt: /* @__PURE__ */ new Set([
    "os",
    "as",
    "que",
    "em",
    "um",
    "uma",
    "para",
    "com",
    "não",
    "é",
    "se",
    "do",
    "da",
    "dos",
    "das",
    "mas",
    "são",
    "está",
    "este",
    "esta",
    "muito",
    "pelo",
    "pela",
    "o",
    "e",
    "na",
    "nas",
    "nos",
    "ao",
    "aos",
    "por",
    "foi",
    "era",
    "ser",
    "sou",
    "tem",
    "tenho",
    "pode",
    "podem",
    "quero",
    "preciso",
    "eu",
    "meu",
    "minha",
    "seu",
    "sua",
    "isso",
    "isto",
    "aqui",
    "ali",
    "como",
    "quando",
    "onde",
    "porque",
    "mais",
    "já",
    "ainda",
    "agora",
    "hoje",
    "ontem",
    "dois",
    "três",
    "tudo",
    "nada",
    "obrigado",
    "olá",
    "você",
    "vocês",
    "voce",
    "voces",
    "vc",
    "vcs",
    "nao",
    "sao",
    "ja",
    "até",
    "tá",
    "pra",
    "gostaria",
    "obrigada",
    "também",
    "tambem",
    "estou",
    "estamos",
    "meus",
    "minhas",
    "nosso",
    "nossa",
    "consigo",
    "cadê",
    "boa",
    "tarde",
    "noite",
    "depois",
    "antes",
    "então",
    "entao",
    "ninguém",
    "ninguem",
    "alguém",
    "alguem",
    "nenhum",
    "nenhuma",
    "estava",
    "ficou",
    "fiz",
    "deu"
  ]),
  it: /* @__PURE__ */ new Set([
    "il",
    "lo",
    "gli",
    "che",
    "di",
    "per",
    "con",
    "non",
    "è",
    "si",
    "del",
    "della",
    "sono",
    "questo",
    "questa",
    "anche",
    "come",
    "più",
    "sono",
    "nella",
    "alla",
    "la",
    "le",
    "un",
    "uno",
    "una",
    "e",
    "ed",
    "o",
    "da",
    "su",
    "tra",
    "fra",
    "mi",
    "ci",
    "ne",
    "ho",
    "hai",
    "ha",
    "abbiamo",
    "avete",
    "hanno",
    "era",
    "stato",
    "stata",
    "devo",
    "deve",
    "devono",
    "voglio",
    "vorrei",
    "mio",
    "mia",
    "tuo",
    "sua",
    "quando",
    "dove",
    "perche",
    "molto",
    "poco",
    "sempre",
    "mai",
    "già",
    "ancora",
    "adesso",
    "oggi",
    "ieri",
    "grazie",
    "ciao",
    "scusa",
    "nel",
    "nell",
    "negli",
    "sul",
    "sulla",
    "sulle",
    "dal",
    "dalla",
    "dallo",
    "dagli",
    "dei",
    "delle",
    "dello",
    "degli",
    "agli",
    "alle",
    "col"
  ]),
  nl: /* @__PURE__ */ new Set([
    "het",
    "een",
    "van",
    "is",
    "op",
    "te",
    "dat",
    "niet",
    "met",
    "voor",
    "zijn",
    "aan",
    "door",
    "maar",
    "ook",
    "worden",
    "deze",
    "naar",
    "wordt"
  ]),
  // Keep Swedish routing in parity with Python. Distinctive words help ASCII-normalised ticket text;
  // shared Nordic words are tracked separately so Danish and Norwegian are not named Swedish.
  sv: /* @__PURE__ */ new Set([
    "jag",
    "är",
    "och",
    "inte",
    "att",
    "från",
    "till",
    "behöver",
    "får",
    "skulle",
    "ska",
    "vill",
    "måste",
    "också",
    "dessa",
    "detta",
    "säger",
    "upp",
    "utan",
    "mitt",
    "min",
    "om",
    "kommer",
    "här",
    "två",
    "vi",
    "nästa",
    "gör",
    "göra",
    "hjälp",
    "hjälpa",
    "mig",
    "återbetalning",
    "återbetala",
    "faktura",
    "gång",
    "gånger",
    "hittar",
    "inställningen",
    "inställningarna",
    "lösenord",
    "när",
    "öppnar",
    "spårningen",
    "aterbetalning",
    "aterbetala",
    "behover",
    "fel",
    "ganger",
    "hjalp",
    "hjalpa",
    "installningen",
    "installningarna",
    "kraschar",
    "kvittot",
    "losenord",
    "nar",
    "oppnar",
    "paket",
    "skicka",
    "sparningen",
    "tva",
    "uppdaterats",
    "blivit",
    "debiterade",
    "appen"
  ]),
  ro: /* @__PURE__ */ new Set([
    "și",
    "să",
    "este",
    "sunt",
    "care",
    "pentru",
    "din",
    "dar",
    "după",
    "până",
    "fără",
    "ale",
    "lui",
    "în",
    "fost",
    "acum",
    "vreau",
    "trebuie",
    "foarte",
    "acest",
    "această",
    "acesta",
    "aceasta",
    "mi",
    "ți",
    "vă",
    "nu"
  ]),
  // Romanized Bangla ("Banglish"): how Bangla is typed in chats, tickets and email when no Bengali
  // keyboard is at hand. It has no diacritics, so without a list it read as undecided-but-English
  // and went to the English checkpoint, which scores 0.08 on Bangla at 0.94 confidence.
  bn: /* @__PURE__ */ new Set([
    "ami",
    "amar",
    "amake",
    "amra",
    "amader",
    "apni",
    "apnar",
    "apnake",
    "apnara",
    "tumi",
    "tomar",
    "tomake",
    "tomra",
    "tader",
    "ota",
    "eita",
    "oita",
    "ekta",
    "ei",
    "oi",
    "ki",
    "keno",
    "kivabe",
    "kibhabe",
    "kothay",
    "kokhon",
    "kobe",
    "koto",
    "kintu",
    "jodi",
    "tahole",
    "ar",
    "theke",
    "jonno",
    "sathe",
    "shathe",
    "diye",
    "niye",
    "moddhe",
    "kore",
    "korte",
    "korchi",
    "korsi",
    "korbo",
    "korechi",
    "koreche",
    "korun",
    "koren",
    "korlam",
    "hobe",
    "hoyeche",
    "hoise",
    "hocche",
    "hoyni",
    "chai",
    "chaina",
    "lagbe",
    "parchi",
    "parbo",
    "parchina",
    "peyechi",
    "paini",
    "dite",
    "dilam",
    "diyechi",
    "nai",
    "khub",
    "onek",
    "ekhon",
    "akhon",
    "ekhono",
    "abar",
    "ekbar",
    "duibar",
    "ajke",
    "kalke",
    "taka",
    "bhalo",
    "valo",
    "kharap",
    "shomossa",
    "somossa",
    "dhonnobad",
    "bhai",
    "shob",
    "keu",
    "kichu",
    "bolte",
    "bolun",
    "parben",
    "asbe",
    "jabe",
    "pabo",
    "ferot",
    "dorkar",
    "hoye",
    "geche",
    "gese"
  ]),
  az: /* @__PURE__ */ new Set([
    "və",
    "ve",
    "bir",
    "bu",
    "üçün",
    "ucun",
    "ilə",
    "ile",
    "olan",
    "olub",
    "olmasa",
    "var",
    "yox",
    "yoxdur",
    "mən",
    "sən",
    "biz",
    "siz",
    "onlar",
    "daha",
    "çox",
    "cox",
    "hər",
    "nə",
    "kimi",
    "görə",
    "sonra",
    "əgər",
    "eger",
    "deyil",
    "lakin",
    "amma",
    "ancaq",
    "artıq",
    "artiq",
    "də",
    "isə",
    "həm",
    "yalnız",
    "yalniz"
  ])
};
const NON_EN_DIACRITICS = new Set(
  "àâäãáåçéèêëíìîïñóòôöõøúùûüýÿßæœăâîșțşţąćęłńśźżčďěňřšťůžőűğıāēģīķļņūžđəạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹơư".split("")
);
const NON_EN_DIACRITIC_RATE = 0.02;
const ENGLISH_RESCUE_DIACRITIC_RATE = 0.06;
function englishRescuedByWords(wordSet, diacRate) {
  if (diacRate >= ENGLISH_RESCUE_DIACRITIC_RATE) return false;
  let englishOnly = 0;
  let accented = 0;
  for (const w of wordSet) {
    if (EN_ONLY_WORDS.has(w)) englishOnly += 1;
    if ([...w].some((ch) => NON_EN_DIACRITICS.has(ch))) accented += 1;
  }
  return englishOnly >= 2 && accented <= 1;
}
const SHARED_WORDS = (() => {
  const counts = /* @__PURE__ */ new Map();
  for (const words of Object.values(STOP)) {
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const out = /* @__PURE__ */ new Set();
  for (const [w, n] of counts) if (n > 1) out.add(w);
  return out;
})();
const NORDIC_OVERLAP_WORDS = /* @__PURE__ */ new Set(["hej", "ja", "nej", "jo", "tack", "mig", "min", "om", "kommer", "får", "skulle", "vi"]);
for (const word of NORDIC_OVERLAP_WORDS) SHARED_WORDS.add(word);
const EN_ONLY_WORDS = new Set([...STOP["en"]].filter((w) => !SHARED_WORDS.has(w)));
const EN_COLLISION_WORDS = new Set(
  ["come", "son", "do", "care", "todo", "im", "per", "plus"].filter((w) => Object.entries(STOP).some(([lg, sw]) => lg !== "en" && sw.has(w)))
);
const SHORT_SWEDISH_WORDS = /* @__PURE__ */ new Set([
  "åtkomst",
  "atkomst",
  "lösenord",
  "losenord",
  "fakturan",
  "betalningen",
  "inloggningen",
  "glömt",
  "glomt",
  "behöver",
  "behover",
  "återbetalning",
  "aterbetalning",
  "kvitto",
  "kvittot",
  "spårningen",
  "sparningen",
  "inställningen",
  "installningen",
  "felmeddelande",
  "abonnemanget"
]);
const WORD_RE = /[\p{L}\p{Nl}\p{No}]+/gu;
const IDENTIFIER_RE = /(?<![\p{L}\p{N}_-])[\p{L}\p{N}_-]*(?:[.@][\p{L}\p{N}_-]+)+/gu;
const IS_ALPHA_RE = /\p{L}/u;
function isLatinCp(cp) {
  return cp < 688 || 7680 <= cp && cp <= 7935 || 65313 <= cp && cp <= 65338 || 65345 <= cp && cp <= 65370;
}
function scriptOf(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 592 || 7680 <= cp && cp <= 7935 || 65313 <= cp && cp <= 65338 || 65345 <= cp && cp <= 65370) {
    return null;
  }
  for (const [name, ranges] of SCRIPT_RANGES) {
    if (ranges.some(([lo, hi]) => lo <= cp && cp <= hi)) return name;
  }
  return null;
}
function width$1(text) {
  let count = 0;
  for (const _ch of text) count++;
  return count;
}
function cutCodePoints$1(text, count) {
  const chars = Array.from(text);
  const end = count < 0 ? Math.max(0, chars.length + count) : Math.min(count, chars.length);
  return chars.slice(0, end).join("");
}
function iterText(state, depth = 0) {
  if (depth > 6 || state == null) return [];
  if (typeof state === "string") return [state];
  if (state instanceof Uint8Array) {
    try {
      return [new TextDecoder("utf-8", { fatal: true }).decode(state)];
    } catch {
      return [];
    }
  }
  if (Array.isArray(state)) {
    const out = [];
    for (const v of state) out.push(...iterText(v, depth + 1));
    return out;
  }
  if (typeof state === "object") {
    const out = [];
    for (const v of Object.values(state)) out.push(...iterText(v, depth + 1));
    return out;
  }
  return [];
}
function stateText(state, maxChars = 4e3) {
  return cutCodePoints$1(iterText(state).join(" "), maxChars);
}
function detectScript(text) {
  const counts = /* @__PURE__ */ new Map();
  let latin = 0;
  for (const ch of text) {
    if (!IS_ALPHA_RE.test(ch)) continue;
    const cp = ch.codePointAt(0);
    if (isLatinCp(cp)) {
      latin += 1;
      continue;
    }
    let found = null;
    for (const [name, ranges] of SCRIPT_RANGES) {
      if (ranges.some(([lo, hi]) => lo <= cp && cp <= hi)) {
        found = name;
        break;
      }
    }
    counts.set(found ?? "other", (counts.get(found ?? "other") ?? 0) + 1);
  }
  counts.set("latin", latin);
  let total = 0;
  for (const v of counts.values()) total += v;
  if (total === 0) return "unknown";
  let best2 = "latin";
  let bestN = -1;
  for (const [k, v] of counts) {
    if (v > bestN) {
      bestN = v;
      best2 = k;
    }
  }
  return best2;
}
function scriptProfile(text) {
  const counts = /* @__PURE__ */ new Map([["latin", 0]]);
  for (const ch of text) {
    if (!IS_ALPHA_RE.test(ch)) continue;
    const cp = ch.codePointAt(0);
    if (isLatinCp(cp)) {
      counts.set("latin", (counts.get("latin") ?? 0) + 1);
      continue;
    }
    let found = null;
    for (const [name, ranges] of SCRIPT_RANGES) {
      if (ranges.some(([lo, hi]) => lo <= cp && cp <= hi)) {
        found = name;
        break;
      }
    }
    const key = found ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let total = 0;
  for (const v of counts.values()) total += v;
  if (!total) return {};
  const out = {};
  for (const [k, v] of counts) {
    if (v) out[k] = v / total;
  }
  return out;
}
const SHOUTED_MIN_WORD = 5;
const SHOUTED_MIN_STOPWORD = 4;
const NON_LATIN_FRACTION = 0.2;
const NON_LATIN_MIN_FRACTION = 0.1;
const NON_LATIN_MIN_LETTERS = 10;
function nonLatinWords(text) {
  const runs = [];
  let cur = "";
  let script = null;
  for (const ch of text) {
    if (/^\p{M}$/u.test(ch)) continue;
    const s = scriptOf(ch);
    if (s !== null && s === script) {
      cur += ch;
      continue;
    }
    if (cur) runs.push(cur);
    if (s !== null) {
      cur = ch;
      script = s;
    } else {
      cur = "";
      script = null;
    }
  }
  if (cur) runs.push(cur);
  return runs.filter((w) => [...w].length >= 2 && !/^[\p{Lu}\p{Lt}]/u.test(w));
}
function latinProfile(text) {
  const stripped = text.replace(IDENTIFIER_RE, " ");
  const rawWords = stripped.match(WORD_RE) ?? [];
  const words = rawWords.map((w) => w.toLowerCase());
  const lowered = text.toLowerCase();
  let diac = 0;
  for (const ch of lowered) {
    if (NON_EN_DIACRITICS.has(ch)) diac += 1;
  }
  const diacRate = diac / Math.max(1, width$1(lowered));
  const nonEnglish = diacRate >= NON_EN_DIACRITIC_RATE;
  const nordicOverlap = words.some((w) => NORDIC_OVERLAP_WORDS.has(w)) && !words.some((w) => EN_ONLY_WORDS.has(w));
  if (words.length > 1 && words.length < 4 && words.some((w) => SHORT_SWEDISH_WORDS.has(w))) {
    return { language: "sv", englishHits: 0, diacriticRate: diacRate, looksNonEnglish: nonEnglish };
  }
  if (words.length < 4) {
    return { language: null, englishHits: 0, diacriticRate: diacRate, looksNonEnglish: nonEnglish || nordicOverlap };
  }
  const counts = /* @__PURE__ */ new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const scores = {};
  for (const [lg, sw] of Object.entries(STOP)) {
    let s = 0;
    for (const [w, n] of counts) if (sw.has(w)) s += EN_COLLISION_WORDS.has(w) ? 1 : n;
    scores[lg] = s;
  }
  const en = scores["en"] ?? 0;
  const wordSet = new Set(words);
  let bestLg = null;
  let best2 = 0;
  for (const [lg, s] of Object.entries(scores)) {
    if (lg === "en") continue;
    const hasEvidence = [...wordSet].some((w) => STOP[lg].has(w) && !SHARED_WORDS.has(w));
    if (!hasEvidence) continue;
    if (s > best2) {
      best2 = s;
      bestLg = lg;
    }
  }
  let lang = null;
  if (bestLg && best2 >= Math.max(2, en + 2)) {
    lang = bestLg;
  } else if (bestLg === "sv" && words.includes("inte") && words.includes("kan") && ["kan", "jag", "vi"].includes(words[0]) && en <= 1) {
    lang = bestLg;
  } else if (bestLg && nonEnglish && best2 >= Math.max(2, en)) {
    lang = bestLg;
  } else if (en && (!nonEnglish || englishRescuedByWords(wordSet, diacRate))) {
    lang = "en";
  }
  return { language: lang, englishHits: en, diacriticRate: diacRate, looksNonEnglish: nonEnglish || lang === null && nordicOverlap };
}
function guessLatinLanguage(text) {
  return latinProfile(text).language;
}
const CODE_LINE_RE = /[=;{}[\]]|\w\(/;
const JOINED_RE = /[^\W_][._/\\][^\W_]/;
const LETTER_RUN_RE = /[\p{L}]{2,}/gu;
function shouted(text) {
  let upper = false;
  for (const ch of text) {
    if (/\p{Ll}/u.test(ch)) return false;
    if (/\p{Lu}|\p{Lt}/u.test(ch)) upper = true;
  }
  return upper;
}
function shoutedEvidence(tokens, lang, diacriticRate) {
  if (!tokens.some((t) => width$1(t) >= SHOUTED_MIN_WORD)) return false;
  if (diacriticRate >= NON_EN_DIACRITIC_RATE) return true;
  const stopSet = STOP[lang];
  if (!stopSet) return false;
  const matched = new Set(tokens.map((t) => t.toLowerCase()).filter((t) => stopSet.has(t)));
  return [...matched].some((w) => width$1(w) >= SHOUTED_MIN_STOPWORD);
}
function namedProseLanguage(segment) {
  if (!segment.trim() || CODE_LINE_RE.test(segment)) return null;
  let prose = segment.split(/\s+/).filter((tok) => !JOINED_RE.test(tok)).join(" ");
  const isShouted = shouted(prose);
  if (!isShouted) {
    prose = prose.replace(LETTER_RUN_RE, (m) => m === m.toUpperCase() ? " " : m);
  }
  const tokens = prose.match(WORD_RE) ?? [];
  if (tokens.length < 4) return null;
  const prof = latinProfile(prose);
  const lang = prof.language;
  if (lang === null || lang === "en") return null;
  if (isShouted && !shoutedEvidence(tokens, lang, prof.diacriticRate)) return null;
  const stopSet = STOP[lang];
  if (!stopSet) return null;
  const distinctHits = new Set(tokens.map((w) => w.toLowerCase()).filter((w) => stopSet.has(w)));
  if (distinctHits.size < 2) return null;
  return lang;
}
function nonEnglishSegment(state, maxChars = 4e3) {
  let seen = 0;
  for (const leaf of iterText(state)) {
    for (const seg of leaf.split("\n")) {
      if (seen >= maxChars) return null;
      const capped = cutCodePoints$1(seg, maxChars - seen);
      seen += [...capped].length;
      const lang = namedProseLanguage(capped);
      if (lang) return [lang, capped.trim()];
    }
  }
  return null;
}
function nonLatinCarries(nonLatin, nNonLatin) {
  return nonLatin >= NON_LATIN_FRACTION || nonLatin >= NON_LATIN_MIN_FRACTION && nNonLatin >= NON_LATIN_MIN_LETTERS;
}
function round4$1(x) {
  const [whole, fraction = ""] = x.toFixed(20).split(".");
  const kept = Number(whole + fraction.slice(0, 4).padEnd(4, "0"));
  const rest = fraction.slice(4);
  const first = rest.charAt(0);
  const tail = rest.slice(1).replace(/0+$/, "");
  if (first > "5" || first === "5" && (tail.length > 0 || kept % 2 === 1)) {
    return (kept + 1) / 1e4;
  }
  return kept / 1e4;
}
function analyseText(text) {
  const prof = scriptProfile(text);
  let script = detectScript(text);
  const nonLatin = prof && Object.keys(prof).length ? round4$1(1 - (prof["latin"] ?? 0)) : 0;
  let nAlpha = 0;
  for (const ch of text) if (IS_ALPHA_RE.test(ch)) nAlpha += 1;
  const nNonLatin = Math.round(nonLatin * nAlpha);
  if (script === "latin" && nonLatinWords(text).length > 0 && nonLatinCarries(nonLatin, nNonLatin)) {
    let bestScript = script;
    let bestShare = -1;
    for (const [s, share] of Object.entries(prof)) {
      if (s !== "latin" && share > bestShare) {
        bestShare = share;
        bestScript = s;
      }
    }
    script = bestScript;
  }
  if (script === "unknown") {
    return {
      script: "unknown",
      scriptProfile: prof,
      language: null,
      isEnglish: true,
      languageUndecided: true,
      diacriticRate: 0,
      nonLatinFraction: 0,
      mixedSegment: null
    };
  }
  if (script !== "latin") {
    return {
      script,
      scriptProfile: prof,
      language: null,
      isEnglish: false,
      languageUndecided: true,
      diacriticRate: 0,
      nonLatinFraction: nonLatin,
      mixedSegment: null
    };
  }
  const profLat = latinProfile(text);
  let lang = profLat.language;
  if (lang !== null && lang !== "en" && !nonLatinCarries(nonLatin, nNonLatin)) {
    if (shouted(text)) {
      if (!shoutedEvidence(text.match(WORD_RE) ?? [], lang, profLat.diacriticRate)) lang = null;
    } else {
      const caps = (text.match(LETTER_RUN_RE) ?? []).filter((m) => m === m.toUpperCase());
      if (caps.length > 0 && !caps.some((c) => width$1(c) >= SHOUTED_MIN_WORD)) {
        const blanked = text.replace(LETTER_RUN_RE, (m) => m === m.toUpperCase() ? " " : m);
        if (blanked !== text) lang = latinProfile(blanked).language;
      }
    }
  }
  const undecided = lang === null;
  const english = lang === "en" || undecided && !profLat.looksNonEnglish;
  return {
    script: "latin",
    scriptProfile: prof,
    language: lang,
    isEnglish: english,
    languageUndecided: undecided,
    diacriticRate: round4$1(profLat.diacriticRate),
    nonLatinFraction: nonLatin,
    mixedSegment: null
  };
}
function alphaCount(text) {
  let n = 0;
  for (const ch of text) if (IS_ALPHA_RE.test(ch)) n += 1;
  return n;
}
function leafNonEnglish(leaf) {
  let bestN = -1;
  let best2 = null;
  for (const line of leaf.split("\n")) {
    if (width$1(line) < 7) continue;
    const sample = cutCodePoints$1(line, 4e3);
    if (!sample.trim() || CODE_LINE_RE.test(sample)) continue;
    const det = analyseText(sample);
    if (det.isEnglish) continue;
    const named = det.language !== null && det.language !== "en" && namedProseLanguage(sample) !== null;
    const nAlpha = alphaCount(sample);
    if (!named) {
      if (det.script !== "latin" && det.script !== "unknown") {
        if (nonLatinWords(sample).length === 0 || nAlpha < NON_LATIN_MIN_LETTERS) continue;
      } else if (!(det.diacriticRate >= NON_EN_DIACRITIC_RATE && (sample.match(WORD_RE) ?? []).length >= 4)) {
        continue;
      }
    }
    if (nAlpha > bestN) {
      bestN = nAlpha;
      best2 = det;
    }
  }
  return best2;
}
function analyse(state) {
  const result = analyseText(stateText(state));
  if (result.script === "latin" && result.isEnglish) {
    const leaves = iterText(state);
    if (leaves.length > 1 || leaves.some((leaf) => leaf.includes("\n"))) {
      const found = nonEnglishSegment(state);
      if (found) {
        const [lang, mixed] = found;
        return {
          ...result,
          language: lang,
          isEnglish: false,
          languageUndecided: false,
          mixedSegment: mixed
        };
      }
    }
  }
  if (typeof state === "string" || state == null || state instanceof Uint8Array || !result.isEnglish) {
    return result;
  }
  let best2 = null;
  let bestN = -1;
  for (const leaf of iterText(state)) {
    const det = leafNonEnglish(leaf);
    if (!det) continue;
    const n = alphaCount(cutCodePoints$1(leaf, 4e3));
    if (n > bestN) {
      bestN = n;
      best2 = det;
    }
  }
  if (!best2) return result;
  return {
    ...result,
    language: best2.language,
    isEnglish: false,
    languageUndecided: best2.languageUndecided
  };
}
function isEnglish(state) {
  return analyse(state).isEnglish;
}
const BUNDLE_REPO = "convaiinnovations/laya";
const DEFAULT_MODELS = {
  english: { repo: BUNDLE_REPO, subfolder: null },
  multilingual: { repo: BUNDLE_REPO, subfolder: "multilingual" },
  "typed-decisions": { repo: BUNDLE_REPO, subfolder: "typed-decisions" }
};
const STANDALONE_MODELS = {
  english: "convaiinnovations/laya",
  multilingual: "convaiinnovations/laya-multilingual",
  "typed-decisions": "convaiinnovations/laya-typed-decisions"
};
const ALIASES = {
  en: "english",
  laya: "english",
  default: "english",
  multi: "multilingual",
  ml: "multilingual",
  "laya-multilingual": "multilingual",
  typed: "typed-decisions",
  typed_decisions: "typed-decisions",
  "laya-typed-decisions": "typed-decisions",
  decisions: "typed-decisions"
};
function normaliseName(name) {
  const raw = String(name).trim().toLowerCase();
  const key = ALIASES[raw] ?? raw;
  if (!(key in DEFAULT_MODELS)) {
    throw new Error(
      `unknown model ${JSON.stringify(name)}; choose one of ${JSON.stringify(
        Object.keys(DEFAULT_MODELS).sort()
      )} (or an alias: ${JSON.stringify(Object.keys(ALIASES).sort())})`
    );
  }
  return key;
}
const TYPED_DECISION_WORKFLOWS = {
  agent_trace_observability: /* @__PURE__ */ new Set(["action", "needs_review", "outcome", "risk", "urgency"]),
  customer_service: /* @__PURE__ */ new Set(["action", "category", "churn_risk", "needs_human", "urgency"]),
  invoice_processing: /* @__PURE__ */ new Set(["discrepancy_severity", "disposition", "duplicate", "matches_order", "urgency"]),
  security_incidents: /* @__PURE__ */ new Set(["credential_compromise", "disposition", "severity", "true_positive", "urgency"])
};
function matchTypedDecisionsWorkflow(questions) {
  const ids = new Set(Object.keys(questions ?? {}));
  for (const [wf, sig] of Object.entries(TYPED_DECISION_WORKFLOWS)) {
    if (sig.size === ids.size && [...sig].every((id) => ids.has(id))) return wf;
  }
  return null;
}
const ENGLISH_SUBTAGS = /* @__PURE__ */ new Set(["en", "eng", "english"]);
const LANGUAGE_AGNOSTIC_CODES = /* @__PURE__ */ new Set(["c", "posix", "und", "zxx", "mul"]);
function englishFromCode(value) {
  if (value === null || value === void 0) return null;
  let code = String(value).trim().toLowerCase();
  if (!code) return null;
  code = code.split(".", 1)[0];
  const primary = code.replace(/_/g, "-").split("-", 1)[0];
  if (!primary || LANGUAGE_AGNOSTIC_CODES.has(primary)) return null;
  return ENGLISH_SUBTAGS.has(primary);
}
function validLongRouting(routing) {
  if (!routing || typeof routing !== "object" || Array.isArray(routing) || !Object.hasOwn(DEFAULT_MODELS, routing.model) || typeof routing.repo !== "string" || typeof routing.reason !== "string" || routing.workflow !== null && typeof routing.workflow !== "string") return false;
  const d = routing.detection;
  return d === null || typeof d === "object" && !Array.isArray(d) && typeof d.script === "string" && (d.language === null || typeof d.language === "string") && typeof d.isEnglish === "boolean" && typeof d.languageUndecided === "boolean" && Number.isFinite(d.diacriticRate) && Number.isFinite(d.nonLatinFraction) && (d.mixedSegment === null || typeof d.mixedSegment === "string") && d.scriptProfile !== null && typeof d.scriptProfile === "object" && !Array.isArray(d.scriptProfile) && Object.values(d.scriptProfile).every((value) => typeof value === "number" && Number.isFinite(value));
}
function questionSchema(questions) {
  return JSON.stringify(
    questions,
    (_key, value) => typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" ? String(value) : value
  );
}
function digestsFromEnv(models) {
  if (typeof process === "undefined" || !process.env) return {};
  const raw = (process.env["LAYA_SHA256_DIGESTS"] ?? "").trim();
  if (!raw) return {};
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const entries = Object.entries(data);
  if (entries.length === 0) return {};
  const values = entries.map(([, v]) => v);
  if (values.every((v) => typeof v === "string")) {
    return {};
  }
  if (!values.every((v) => typeof v === "object" && v !== null && !Array.isArray(v))) {
    throw new Error(
      `LAYA_SHA256_DIGESTS must be either {artifact: digest} for every checkpoint or {model: {artifact: digest}} per checkpoint; ${JSON.stringify(Object.keys(data).sort())} mixes the two or holds a value that is neither`
    );
  }
  const perModel = {};
  for (const [k, v] of entries) {
    perModel[normaliseName(k)] = v;
  }
  for (const name of Object.keys(models)) {
    const norm = normaliseName(name);
    if (!(norm in perModel)) {
      perModel[norm] = {};
    }
  }
  return perModel;
}
const _digestsFromEnv = digestsFromEnv;
function toSpec(spec) {
  if (typeof spec === "string") return { repo: spec, subfolder: null };
  if (Array.isArray(spec)) {
    const [repo, sub] = [...spec, null].slice(0, 2);
    return { repo, subfolder: sub ?? null };
  }
  return { repo: spec.repo, subfolder: spec.subfolder ?? null };
}
function repoStr(spec) {
  return spec.subfolder ? `${spec.repo}/${spec.subfolder}` : spec.repo;
}
class Router extends HookRegistry {
  hooksRaise;
  hooksTimeout;
  models;
  device;
  token;
  revision;
  revisions;
  sha256Digests;
  get sha256_digests() {
    return this.sha256Digests;
  }
  maxLoaded;
  default;
  autoTaskDetection;
  langGuess;
  loader;
  _agents = /* @__PURE__ */ new Map();
  _order = [];
  // least-recently-used first
  _loading = /* @__PURE__ */ new Map();
  constructor(opts = {}) {
    super();
    this.hooks = normaliseHooks(opts.hooks, opts.onPredictStart, opts.onPredictEnd);
    this.hooksRaise = opts.hooksRaise ?? true;
    this.hooksTimeout = validateHooksTimeout(opts.hooksTimeout ?? opts.hooks_timeout ?? null);
    const base = opts.standaloneRepos ?? opts.standalone_repos ? { ...STANDALONE_MODELS } : Object.fromEntries(Object.entries(DEFAULT_MODELS).map(([k, v]) => [k, { ...v }]));
    this.models = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, toSpec(v)]));
    if (opts.models) {
      for (const [k, v] of Object.entries(opts.models)) {
        this.models[normaliseName(k)] = toSpec(v);
      }
    }
    this.device = opts.device ?? null;
    this.token = opts.token ?? (typeof process !== "undefined" ? process.env?.["HF_TOKEN"] : void 0);
    this.revision = opts.revision ?? null;
    this.revisions = Object.fromEntries(
      Object.entries(opts.revisions ?? {}).map(([name, value]) => [normaliseName(name), value])
    );
    this.sha256Digests = digestsFromEnv(this.models);
    const rawDigests = opts.sha256Digests ?? opts.sha256_digests;
    if (rawDigests) {
      for (const [name, val] of Object.entries(rawDigests)) {
        this.sha256Digests[normaliseName(name)] = val;
      }
    }
    this.maxLoaded = checkMaxLoaded(opts.maxLoaded ?? opts.max_loaded ?? 2);
    this.default = normaliseName(opts.default ?? "multilingual");
    this.autoTaskDetection = Boolean(opts.autoTaskDetection ?? opts.auto_task_detection ?? false);
    this.langGuess = opts.langGuess ?? opts.lang_guess ?? null;
    this.loader = opts.loader ?? null;
    if (opts.preload === true) {
      void this.preload();
    } else if (Array.isArray(opts.preload)) {
      void this.preload(opts.preload);
    }
  }
  /** `hooksTimeout` in the milliseconds `dispatchAsync` races against; null starts no timer. */
  get hooksTimeoutMs() {
    return this.hooksTimeout === null ? null : this.hooksTimeout * 1e3;
  }
  async load(name) {
    const key = normaliseName(name);
    if (this._agents.has(key)) {
      this._touch(key);
      return this._agents.get(key);
    }
    const loading = this._loading.get(key);
    if (loading) return loading;
    const pending = Promise.resolve().then(async () => {
      let agent$1;
      if (this.loader) {
        agent$1 = await this.loader(key, this.models[key]);
      } else {
        const { Agent: Agent2 } = await Promise.resolve().then(() => agent);
        const spec = this.models[key];
        const revision = Object.prototype.hasOwnProperty.call(this.revisions, key) ? this.revisions[key] : this.revision;
        const opts = {
          subfolder: spec.subfolder,
          device: this.device ?? void 0,
          token: this.token ?? void 0
        };
        if (revision) opts.revision = revision;
        if (Object.prototype.hasOwnProperty.call(this.sha256Digests, key)) {
          opts.expectedSha256 = this.sha256Digests[key] ?? {};
        }
        agent$1 = await Agent2.load(spec.repo, opts);
      }
      this._agents.set(key, agent$1);
      this._order.push(key);
      const evicted = this._evict();
      for (const victim of evicted) {
        await dispatchAsync(
          composeHooks(this.hooks),
          "onEvict",
          new PredictContext({ states: [], questions: {}, model: victim, router: this }),
          { raiseErrors: this.hooksRaise, timeoutMs: this.hooksTimeoutMs }
        );
      }
      await dispatchAsync(
        composeHooks(this.hooks),
        "onLoad",
        new PredictContext({ states: [], questions: {}, model: key, agent: agent$1, router: this }),
        { raiseErrors: this.hooksRaise, timeoutMs: this.hooksTimeoutMs }
      );
      return agent$1;
    });
    this._loading.set(key, pending);
    try {
      return await pending;
    } finally {
      this._loading.delete(key);
    }
  }
  _touch(key) {
    const i = this._order.indexOf(key);
    if (i !== -1) this._order.splice(i, 1);
    this._order.push(key);
  }
  /** Drop least-recently-used agents until `maxLoaded` holds. Returns evicted names. */
  _evict() {
    const evicted = [];
    while (this._order.length > this.maxLoaded) {
      const victim = this._order.shift();
      if (this._agents.delete(victim)) evicted.push(victim);
    }
    if (this._order.length < this._agents.size) {
      for (const k of [...this._agents.keys()]) {
        if (!this._order.includes(k)) {
          this._agents.delete(k);
          evicted.push(k);
        }
      }
    }
    return evicted;
  }
  attach(name, agent2) {
    const key = normaliseName(name);
    this._agents.set(key, agent2);
    this._touch(key);
    this.maxLoaded = Math.max(this.maxLoaded, this._agents.size);
    return agent2;
  }
  async preload(names) {
    const keys = (names ?? Object.keys(this.models)).map((n) => normaliseName(n));
    this.maxLoaded = Math.max(this.maxLoaded, (/* @__PURE__ */ new Set([...keys, ...this._agents.keys()])).size);
    for (const n of keys) {
      if (!this._agents.has(n)) await this.load(n);
    }
    return this;
  }
  unload(name) {
    if (name === null || name === void 0) {
      this._agents.clear();
      this._order = [];
    } else {
      const key = normaliseName(name);
      this._agents.delete(key);
      const i = this._order.indexOf(key);
      if (i !== -1) this._order.splice(i, 1);
    }
  }
  get loaded() {
    return [...this._order];
  }
  _resolveHint(hint, state) {
    if (hint === null || hint === void 0) return null;
    const value = typeof hint === "function" ? hint(state) : hint;
    return englishFromCode(value);
  }
  /**
   * Decide which checkpoint to use, then let `onRoute` hooks observe or replace the decision.
   *
   * `ctx.decision` is the RouteDecision; a hook may replace it (for example to pin a
   * checkpoint) and the replacement is what gets returned and used. `opts.hooks` are
   * per-call hooks, appended after any installed on the Router.
   */
  route(state, questions = null, opts = {}) {
    if (questions !== null && questions !== void 0) {
      if (typeof questions !== "object" || Array.isArray(questions)) {
        throw new TypeError(
          `questions must be a dict of question id -> definition, got ${Array.isArray(questions) ? "Array" : typeof questions}`
        );
      }
    }
    const decision = this._route(state, questions, opts);
    const raiseErrors = opts.hooksRaise ?? this.hooksRaise;
    const active = composeHooks(this.hooks, opts.hooks);
    const ctx = new PredictContext({
      states: [state],
      questions: questions ?? {},
      decision,
      router: this
    });
    dispatch(active, "onRoute", ctx, { raiseErrors });
    return ctx.decision;
  }
  /** Decide which checkpoint to use, without loading, running, or hooking anything. */
  _route(state, questions = null, opts = {}) {
    const { model = null, task = null, lang = null } = opts;
    const langGuessOpt = opts.langGuess ?? opts.lang_guess ?? null;
    if (model !== null && model !== void 0) {
      const key2 = normaliseName(model);
      return {
        model: key2,
        repo: repoStr(this.models[key2]),
        reason: `explicit model=${JSON.stringify(model)}`,
        detection: null,
        workflow: null
      };
    }
    if (task !== null && task !== void 0) {
      const key2 = normaliseName(task);
      return {
        model: key2,
        repo: repoStr(this.models[key2]),
        reason: `explicit task=${JSON.stringify(task)}`,
        detection: null,
        workflow: null
      };
    }
    const workflow = matchTypedDecisionsWorkflow(questions ?? {});
    if (workflow && this.autoTaskDetection) {
      return {
        model: "typed-decisions",
        repo: repoStr(this.models["typed-decisions"]),
        reason: `question ids match the ${JSON.stringify(workflow)} typed-decisions workflow`,
        detection: null,
        workflow
      };
    }
    const resolvedLang = englishFromCode(lang);
    if (resolvedLang !== null) {
      const key2 = resolvedLang ? "english" : "multilingual";
      return {
        model: key2,
        repo: repoStr(this.models[key2]),
        reason: `explicit lang=${JSON.stringify(lang)}`,
        detection: null,
        workflow
      };
    }
    const hints = [
      ["lang_guess", langGuessOpt],
      ["Router(lang_guess=...)", this.langGuess]
    ];
    for (const [source, hint] of hints) {
      const resolved = this._resolveHint(hint, state);
      if (resolved !== null && resolved !== void 0) {
        const key2 = resolved ? "english" : "multilingual";
        return {
          model: key2,
          repo: repoStr(this.models[key2]),
          reason: `${source}: the caller identified this as ${resolved ? "English" : "non-English"} text`,
          detection: null,
          workflow
        };
      }
    }
    const det = analyse(state);
    let key;
    let reason;
    if (det.script === "unknown") {
      key = this.default;
      reason = `no letters detected in state; using default (${key})`;
    } else if (det.script !== "latin") {
      key = "multilingual";
      reason = `non-Latin script (${det.script}, ${Math.round(100 * det.nonLatinFraction)}% of letters); the English checkpoint cannot read it`;
    } else if (!det.isEnglish) {
      key = "multilingual";
      if (det.mixedSegment) {
        reason = `Latin script, mostly English, but a line or field reads as ${JSON.stringify(det.language)} (${JSON.stringify(det.mixedSegment.slice(0, 60))}); the English checkpoint cannot read it`;
      } else if (det.language) {
        reason = `Latin script but language looks like ${JSON.stringify(det.language)}, not English`;
      } else {
        reason = `Latin script, language not identified but ${Math.round(100 * det.diacriticRate)}% non-English letters; not safe for the English checkpoint`;
      }
    } else if (det.languageUndecided) {
      key = this.default;
      reason = `Latin script, language not identified and no non-English letters; using default (${key})`;
    } else {
      key = "english";
      reason = "English Latin text";
    }
    return { model: key, repo: repoStr(this.models[key]), reason, detection: det, workflow };
  }
  /**
   * Route, then answer every question in one forward pass on the chosen checkpoint.
   *
   * The result is the usual systemOne payload plus a `routing` key recording the decision.
   * Router-level `onPredictStart` / `onPredictEnd` hooks wrap the whole route+infer call and
   * see `ctx.decision`; see hooks.ts.
   */
  async predict(state, questions, opts = {}) {
    return this._predict(state, questions, opts);
  }
  /** Route the document once, then scan it using the selected Agent's window budget. */
  async predictLong(state, questions, opts = {}) {
    validateLongOptions(opts);
    return this._predict(state, questions, opts, opts);
  }
  async _predict(state, questions, opts, scan) {
    if (state === null || state === void 0) {
      throw new TypeError("state must not be None; pass a string, dict, or list");
    }
    if (typeof questions !== "object" || questions === null || Array.isArray(questions)) {
      throw new TypeError(
        `questions must be a dict of question id -> definition, got ${questions === null ? "null" : Array.isArray(questions) ? "Array" : typeof questions}`
      );
    }
    const mcOpt = scan ? void 0 : opts.minConfidence ?? opts.min_confidence;
    const mc = mcOpt !== void 0 && mcOpt !== null ? checkMinConfidence(mcOpt) : null;
    const active = composeHooks(this.hooks, opts.hooks, opts.onPredictStart, opts.onPredictEnd);
    const raiseErrors = opts.hooksRaise ?? this.hooksRaise;
    const hooksTimeout = validateHooksTimeout(opts.hooksTimeout ?? this.hooksTimeout);
    const timeoutMs = hooksTimeout === null ? null : hooksTimeout * 1e3;
    const hasStart = active.some((h) => typeof h.onPredictStart === "function");
    const ctx = new PredictContext({
      states: [state],
      questions,
      decision: null,
      model: null,
      agent: null,
      router: this,
      maxLen: scan ? null : opts.maxLen ?? null,
      headMaxLen: scan ? null : opts.headMaxLen ?? null
    });
    try {
      const decision = this.route(state, questions, opts);
      ctx.decision = { ...decision };
      ctx.model = decision.model;
      const agent2 = await this.load(decision.model);
      ctx.agent = agent2;
      await dispatchAsync(active, "onPredictStart", ctx, { raiseErrors, timeoutMs });
      if (ctx.results === null) {
        if (hasStart) {
          if (typeof ctx.questions !== "object" || ctx.questions === null || Array.isArray(ctx.questions)) {
            throw new TypeError(
              `questions must be a dict of question id -> definition, got ${ctx.questions === null ? "null" : Array.isArray(ctx.questions) ? "Array" : typeof ctx.questions}`
            );
          }
        }
        for (const [qid, qdef] of Object.entries(ctx.questions)) {
          checkQuestion(qid, qdef);
        }
        const detected = decision.detection?.language;
        const effectiveLang = opts.lang ?? detected ?? null;
        const agentOpts = { lang: effectiveLang };
        if (mc !== null) agentOpts.minConfidence = mc;
        if (ctx.maxLen !== null && ctx.maxLen !== void 0) agentOpts.maxLen = ctx.maxLen;
        if (ctx.headMaxLen !== null && ctx.headMaxLen !== void 0) agentOpts.headMaxLen = ctx.headMaxLen;
        markDefaultsRan(agentOpts);
        let result;
        if (scan) {
          const runner = ctx.agent;
          if (typeof runner?.predictLong !== "function") {
            throw new TypeError("Router.predictLong requires the routed agent to implement predictLong");
          }
          const detection = ctx.decision?.detection;
          const longOpts = {
            window: scan.window,
            stride: scan.stride,
            aggregate: scan.aggregate,
            batchSize: scan.batchSize,
            lang: scan.lang ?? detection?.language ?? null
          };
          markDefaultsRan(longOpts);
          const scanned = await runner.predictLong(ctx.states[0], ctx.questions, longOpts);
          validateLongResult(scanned, "Router.predictLong agent result");
          result = { ...scanned, routing: scanned.routing ?? { ...decision } };
        } else {
          result = await agent2.systemOne(ctx.states[0], ctx.questions, agentOpts);
          result.routing = { ...decision };
        }
        ctx.results = [result];
      } else {
        if (scan) {
          if (!Array.isArray(ctx.results) || ctx.results.length !== 1) {
            throw new Error("Router.predictLong: a skipping hook must return exactly one document result");
          }
          ctx.results = [skippedLongResult(ctx.results[0])];
          console.warn("laya: Router.predictLong: a start hook answered the document without scanning; usage.windows is 0");
        }
        for (const result of ctx.results) {
          if (result && typeof result === "object" && !("routing" in result)) {
            result.routing = { ...decision };
          }
        }
      }
    } catch (err) {
      ctx.error = err;
      try {
        await dispatchAsync(active, "onError", ctx, { raiseErrors, timeoutMs });
      } catch {
      }
      throw err;
    } finally {
      ctx.markElapsed();
      if (ctx.results !== null && (!scan || Array.isArray(ctx.results))) {
        ctx.usage = aggregateUsage(ctx.results);
        if (mc !== null) {
          flagLowConfidence(ctx.results, mc);
        }
      }
      try {
        await dispatchAsync(active, "onPredictEnd", ctx, { raiseErrors, timeoutMs });
      } catch (hookErr) {
        if (ctx.error === null) throw hookErr;
      }
    }
    if (scan) {
      if (!Array.isArray(ctx.results) || ctx.results.length !== 1) {
        throw new Error("Router.predictLong must return exactly one document result");
      }
      validateLongResult(ctx.results[0], "Router.predictLong result");
      const routing = ctx.results[0].routing;
      if (!validLongRouting(routing)) {
        throw new TypeError("Router.predictLong result must include a valid routing decision");
      }
    }
    return ctx.results[0];
  }
  async decide(state, schema, opts = {}) {
    return decide(this, state, schema, opts);
  }
  async decideBatch(states, schema, opts = {}) {
    return decideBatch(this, states, schema, opts);
  }
  async systemOne(state, questions, opts = {}) {
    return this.predict(state, questions, opts);
  }
  /**
   * Route many requests in one call (Python `Router.route_batch` parity). Every request is
   * validated before anything loads, so a malformed batch fails fast. Entries keep input
   * order; routing is deterministic, so repeated batches route identically.
   */
  routeBatch(requests, opts = {}) {
    if (!Array.isArray(requests)) {
      throw new TypeError("requests must be an array of request objects");
    }
    const decisions = [];
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      if (typeof request !== "object" || request === null || Array.isArray(request)) {
        const got = Array.isArray(request) ? "list" : request === null ? "null" : typeof request;
        throw new TypeError(`request ${i} must be an object, got ${got}`);
      }
      if (!("state" in request)) {
        throw new Error(`request ${i} is missing required key 'state'`);
      }
      if (request.state === null || request.state === void 0) {
        throw new TypeError(`request ${i} 'state' must not be None; pass a string, dict, or list`);
      }
      if (!("questions" in request)) {
        throw new Error(`request ${i} is missing required key 'questions'`);
      }
      const questions = request.questions;
      if (typeof questions !== "object" || questions === null || Array.isArray(questions)) {
        const got = Array.isArray(questions) ? "list" : questions === null ? "null" : typeof questions;
        throw new TypeError(`request ${i} 'questions' must be an object, got ${got}`);
      }
      decisions.push(
        this.route(request.state, questions, {
          model: request.model ?? null,
          task: request.task ?? null,
          lang: request.lang ?? null,
          langGuess: request.langGuess ?? request.lang_guess ?? null,
          hooks: opts.hooks,
          hooksRaise: opts.hooksRaise
        })
      );
    }
    return decisions;
  }
  /**
   * Route and run many requests in one call (Python `Router.predict_batch` parity).
   * Requests are routed first, then grouped by checkpoint so each loaded Agent scores its
   * requests in as few forward passes as possible; results are restored to input order.
   * The group key is the resolved checkpoint, so an `onRoute` pin that spells it as an alias
   * ("ml") shares the canonical group's pass instead of splitting into a second forward pass.
   * Requests routed to the same checkpoint still split into separate `predictBatch` calls
   * when their question schemas differ (order-sensitively), when per-request start hooks
   * set different maxLen/headMaxLen overrides, or — for an agent carrying
   * `lang_temperatures` — when their languages differ: each request's effective language
   * (an explicit `lang`, otherwise the detected non-English one) is forwarded so the
   * batched path scores exactly like `predict`.
   *
   * Router-level predict hooks run per request: each request gets its own PredictContext
   * carrying `decision`; `onPredictStart` may rewrite a request or `ctx.skip()` it, and
   * `onPredictEnd` runs once per started request even when the batch fails.
   * `opts.hooks`, `opts.onPredictStart` and `opts.onPredictEnd` are composed the way `predict`
   * composes them: `setDefaultHooks` defaults, then installed hooks, then this call's hooks.
   * `null` and `[]` add nothing. `hooks`
   * also run `onRoute`. `opts.hooksRaise` overrides the Router's policy for this call, the way
   * `predict` uses `opts.hooksRaise ?? this.hooksRaise`.
   * `opts.minConfidence` (or `min_confidence`) is the abstention threshold `predict` takes, and it
   * gates this call the same way: validated on the entry line, before anything routes or loads,
   * and applied to every request's answers before its `onPredictEnd` runs. A batch is not a
   * second-class entry point for it -- an audit hook on either path sees the same marker.
   */
  async predictBatch(requests, batchSize = null, opts = {}) {
    const mcOpt = opts.minConfidence ?? opts.min_confidence;
    const mc = mcOpt !== void 0 && mcOpt !== null ? checkMinConfidence(mcOpt) : null;
    const decisions = this.routeBatch(requests, opts);
    if (decisions.length === 0) return [];
    const groups = /* @__PURE__ */ new Map();
    for (let i = 0; i < decisions.length; i++) {
      const model = normaliseName(decisions[i].model);
      const bucket = groups.get(model);
      if (bucket) bucket.push(i);
      else groups.set(model, [i]);
    }
    const results = new Array(requests.length).fill(null);
    const active = composeHooks(this.hooks, opts.hooks, opts.onPredictStart, opts.onPredictEnd);
    const raiseErrors = opts.hooksRaise ?? this.hooksRaise;
    const gate = (contexts) => {
      if (mc === null) return;
      for (const ctx of contexts) {
        if (ctx.results !== null) flagLowConfidence(ctx.results, mc);
      }
    };
    for (const [modelName, indices] of groups) {
      const agent2 = await this.load(modelName);
      const started = [];
      try {
        for (const i of indices) {
          const ctx = new PredictContext({
            states: [requests[i].state],
            questions: requests[i].questions,
            decision: { ...decisions[i] },
            model: modelName,
            agent: agent2,
            router: this,
            maxLen: requests[i].maxLen ?? null,
            headMaxLen: requests[i].headMaxLen ?? null
          });
          started.push(ctx);
          dispatch(active, "onPredictStart", ctx, { raiseErrors });
        }
        const hasLangOverrides = Object.keys(agent2.langTemperatures ?? {}).length > 0;
        const questionGroups = [];
        for (let s = 0; s < indices.length; s++) {
          const i = indices[s];
          const ctx = started[s];
          if (ctx.results !== null) {
            for (const result of ctx.results) {
              if (result && typeof result === "object" && !("routing" in result)) {
                result.routing = { ...decisions[i] };
              }
            }
            continue;
          }
          const detectedLang = decisions[i].detection?.language ?? null;
          const effectiveLang = requests[i].lang ?? detectedLang;
          const langKey = hasLangOverrides ? effectiveLang : null;
          const schema = questionSchema(ctx.questions);
          const found = questionGroups.find(
            (g) => g.schema === schema && g.maxLen === ctx.maxLen && g.headMaxLen === ctx.headMaxLen && g.lang === langKey
          );
          if (found) found.items.push([i, ctx]);
          else {
            questionGroups.push({
              questions: ctx.questions,
              schema,
              maxLen: ctx.maxLen,
              headMaxLen: ctx.headMaxLen,
              lang: langKey,
              items: [[i, ctx]]
            });
          }
        }
        for (const group of questionGroups) {
          const agentOpts = { batchSize };
          if (group.maxLen !== null) agentOpts.maxLen = group.maxLen;
          if (group.headMaxLen !== null) agentOpts.headMaxLen = group.headMaxLen;
          if (group.lang !== null) agentOpts.lang = group.lang;
          markDefaultsRan(agentOpts);
          let batchResults;
          if (typeof agent2.predictBatch === "function") {
            batchResults = await agent2.predictBatch(
              group.items.map(([, ctx]) => ctx.states[0]),
              group.questions,
              agentOpts
            );
          } else {
            batchResults = [];
            for (const [, ctx] of group.items) {
              const singleOpts = group.lang === null ? {} : { lang: group.lang };
              if (group.maxLen !== null) singleOpts.maxLen = group.maxLen;
              if (group.headMaxLen !== null) singleOpts.headMaxLen = group.headMaxLen;
              markDefaultsRan(singleOpts);
              batchResults.push(
                await agent2.systemOne(
                  ctx.states[0],
                  group.questions,
                  singleOpts
                )
              );
            }
          }
          if (batchResults.length !== group.items.length) {
            throw new Error(
              `internal error: Agent.predictBatch returned ${batchResults.length} results for ${group.items.length} states`
            );
          }
          for (let s = 0; s < group.items.length; s++) {
            const [i, ctx] = group.items[s];
            const result = batchResults[s];
            result.routing = { ...decisions[i] };
            ctx.results = [result];
          }
        }
      } catch (err) {
        gate(started);
        for (const ctx of started) {
          if (ctx.results === null) {
            ctx.error = err;
            try {
              dispatch(active, "onError", ctx, { raiseErrors });
            } catch {
            }
          }
        }
        try {
          this._endContexts(active, started, raiseErrors);
        } catch {
        }
        throw err;
      }
      gate(started);
      this._endContexts(active, started, raiseErrors);
      for (let s = 0; s < indices.length; s++) {
        results[indices[s]] = started[s].results[0];
      }
    }
    if (results.some((r) => r === null)) {
      throw new Error("internal error: batch execution did not produce every result");
    }
    return results;
  }
  /** Alias of predictBatch, mirroring Python's `Router.predict_many`. */
  async predictMany(requests, batchSize = null, opts = {}) {
    return this.predictBatch(requests, batchSize, opts);
  }
  /**
   * Run onPredictEnd for every started per-request context and raise the first hook
   * failure, if any. Elapsed and usage are stamped on every context before any end hook
   * runs, so one request's end hooks never inflate another request's elapsed time.
   *
   * The end hooks run in REVERSE start order, because every request started before any
   * ended: a hook that opens something in start and closes it in end (a tracing span, an
   * `AsyncLocalStorage` frame, an in-flight counter) must unwind the last one first, or it
   * closes the wrong frame and every request after the first inherits a corrupted context.
   * Python's `Router.predict_batch` ends its contexts the same way and says so
   * (`laya/router.py::_end_contexts`).
   */
  _endContexts(active, contexts, raiseErrors) {
    for (const ctx of contexts) {
      ctx.markElapsed();
      if (ctx.results !== null) ctx.usage = aggregateUsage(ctx.results);
    }
    let firstError = null;
    for (const ctx of [...contexts].reverse()) {
      try {
        dispatch(active, "onPredictEnd", ctx, { raiseErrors });
      } catch (hookErr) {
        if (ctx.error === null && firstError === null) firstError = hookErr;
      }
    }
    if (firstError !== null) throw firstError;
  }
}
const DEFAULT_SHORTLIST_K = 20;
const DEFAULT_TOURNAMENT_GROUP = 16;
const DEFAULT_SHORTLIST_MAXSIZE = 4096;
function checkK(k) {
  if (typeof k !== "number" || !Number.isInteger(k) || k < 1) {
    throw new Error(`k must be a positive integer, got ${JSON.stringify(k)}`);
  }
  return k;
}
function criteriaItems(criteria) {
  let items;
  if (Array.isArray(criteria)) {
    items = criteria.map((item) => [String(item), null]);
  } else if (typeof criteria === "object" && criteria !== null) {
    items = Object.entries(criteria);
  } else {
    throw new TypeError(
      `choice criteria must be a dict or list, got ${Array.isArray(criteria) ? "list" : criteria === null ? "NoneType" : typeof criteria}`
    );
  }
  if (items.length === 0) throw new Error("choice criteria must contain at least one option");
  const seen = /* @__PURE__ */ new Set();
  for (const [key] of items) {
    if (seen.has(key)) throw new Error(`choice criteria label ${JSON.stringify(key)} is duplicated`);
    seen.add(key);
  }
  return items;
}
function optionTexts(items) {
  const crit = Object.fromEntries(items);
  const rendered = renderOptions({ t: "choice", crit });
  if (rendered.length !== items.length) throw new Error("could not render every choice option");
  return rendered.map((p) => typeof p === "string" ? p : String(p));
}
function queryText(state, instructions) {
  const body = serializeState(state);
  if (instructions === null || instructions === void 0 || instructions === "") return body;
  if (typeof instructions !== "string") return `${JSON.stringify(instructions)}
${body}`;
  return `${instructions}
${body}`;
}
function clean(v) {
  return typeof v !== "number" || !Number.isFinite(v) ? 0 : v;
}
async function embeddings(embedFn, texts) {
  if (typeof embedFn !== "function") throw new TypeError("embed_fn must be callable");
  const raw = await embedFn([...texts]);
  const arr = raw;
  if (!Array.isArray(arr) || arr.length !== texts.length) {
    throw new Error(`embed_fn must return an array of shape (${texts.length}, dim), got ${Array.isArray(arr) ? `(${arr.length}, ?)` : typeof arr}`);
  }
  const rows = arr.map((row) => {
    if (!Array.isArray(row) || row.length < 1) {
      throw new Error(`embed_fn must return an array of shape (${texts.length}, dim), got row ${JSON.stringify(row)?.slice(0, 60)}`);
    }
    return row.map((v) => clean(Number(v)));
  });
  return rows;
}
function cosine(query, docs) {
  const qn = Math.sqrt(query.reduce((a, v) => a + v * v, 0));
  if (qn === 0 || docs.length === 0) return docs.map(() => 0);
  return docs.map((d) => {
    const dn = Math.sqrt(d.reduce((a, v) => a + v * v, 0));
    if (dn === 0) return 0;
    const dot = d.reduce((a, v, i) => a + v * (query[i] ?? 0), 0);
    return Math.min(1, Math.max(-1, dot / (dn * qn)));
  });
}
async function rank(state, criteria, embedFn, k, instructions) {
  const checked = checkK(k);
  const items = criteriaItems(criteria);
  const n = items.length;
  const keys = items.map(([key]) => key);
  if (checked >= n) return { labels: [...keys], scores: null, passthrough: true, n };
  const q2 = queryText(state, instructions);
  const matrix = await embeddings(embedFn, [q2, ...optionTexts(items)]);
  const sims = cosine(matrix[0], matrix.slice(1));
  const order = sims.map((s, i) => i).sort((a, b) => sims[b] - sims[a]);
  const top = order.slice(0, checked);
  return { labels: top.map((i) => keys[i]), scores: top.map((i) => sims[i]), passthrough: false, n };
}
function subsetCriteria(criteria, labels) {
  if (Array.isArray(criteria)) return [...labels];
  return Object.fromEntries(labels.map((l) => [l, criteria[l]]));
}
function dropStaleOrder(qid, question, nOptions, warned) {
  if (!Object.hasOwn(question, "option_order")) return question;
  const out = { ...question };
  const order = out["option_order"];
  delete out["option_order"];
  if (!warned.has(qid)) {
    warned.add(qid);
    const had = Array.isArray(order) ? `${order.length} slots` : JSON.stringify(order);
    console.warn(
      `laya.shortlist: question ${JSON.stringify(qid)}: 'option_order' (${had}) was dropped because the label set was narrowed to ${nOptions}; the order no longer fits the kept options and remapping it onto them would move options between slots.`
    );
  }
  return out;
}
async function shortlistChoice(state, criteria, embedFn, k = DEFAULT_SHORTLIST_K, instructions) {
  const { labels } = await rank(state, criteria, embedFn, k, instructions);
  return labels;
}
async function predictShortlist(agent2, state, questions, embedFn, k = DEFAULT_SHORTLIST_K, predictKwargs = {}) {
  if (typeof questions !== "object" || questions === null || Array.isArray(questions)) {
    throw new TypeError("questions must be a dict of question id -> definition");
  }
  const checked = checkK(k);
  const needsEmbed = Object.values(questions).some(
    (qdef) => typeof qdef === "object" && qdef !== null && !Array.isArray(qdef) && qdef["type"] === "choice" && "criteria" in qdef && Object.keys(qdef["criteria"] ?? {}).length > checked
  );
  const embed = embedFn ?? (needsEmbed ? embedFnFromAgent(agent2) : null);
  const reduced = {};
  const meta = {};
  const warned = /* @__PURE__ */ new Set();
  for (const [qid, qdef] of Object.entries(questions)) {
    if (typeof qdef !== "object" || qdef === null || Array.isArray(qdef) || qdef["type"] !== "choice") {
      reduced[qid] = qdef;
      continue;
    }
    if (!("criteria" in qdef)) {
      throw new Error(`question ${JSON.stringify(qid)} is a choice but has no criteria`);
    }
    const q2 = qdef;
    const { labels, scores, passthrough, n } = await rank(state, q2["criteria"], embed, checked, q2["instructions"]);
    meta[qid] = { labels: [...labels], scores, k: checked, n, passthrough };
    if (passthrough) {
      reduced[qid] = qdef;
      continue;
    }
    reduced[qid] = dropStaleOrder(
      qid,
      { ...q2, criteria: subsetCriteria(q2["criteria"], labels) },
      labels.length,
      warned
    );
  }
  const a = agent2;
  const fn = a?.["predict"] ?? a?.["systemOne"] ?? a?.["system_one"];
  if (typeof fn !== "function") throw new TypeError("agent must provide predict or system_one");
  const extra = Object.keys(predictKwargs ?? {}).length ? [predictKwargs] : [];
  const result = await fn.call(agent2, state, reduced, ...extra);
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new TypeError("predict/system_one must return a dict");
  }
  return { ...result, shortlist: meta };
}
async function predictTournament(agent2, state, questions, groupSize = DEFAULT_TOURNAMENT_GROUP, predictKwargs = {}) {
  if (typeof questions !== "object" || questions === null || Array.isArray(questions) || Object.getPrototypeOf(questions) !== null && Object.getPrototypeOf(questions) !== Object.prototype) {
    throw new TypeError("questions must be a dict of question id -> definition");
  }
  if (!Number.isSafeInteger(groupSize) || groupSize < 2) {
    throw new Error(`groupSize must be a safe integer >= 2, got ${JSON.stringify(groupSize)}`);
  }
  const meta = /* @__PURE__ */ new Map();
  for (const [qid, qdef] of Object.entries(questions)) {
    if (typeof qdef !== "object" || qdef === null || Array.isArray(qdef) || qdef["type"] !== "choice") continue;
    if (!("criteria" in qdef)) {
      throw new Error(`question ${JSON.stringify(qid)} is a choice but has no criteria`);
    }
    const criteria = qdef["criteria"];
    if (Array.isArray(criteria)) {
      for (const label of criteria) {
        if (label === null || label === void 0 || typeof label === "object") {
          throw new Error(`question ${JSON.stringify(qid)}: choice labels must not be null, lists or dicts`);
        }
      }
    }
    const labels = criteriaItems(criteria).map(([label]) => label);
    meta.set(qid, { labels, n: labels.length, rounds: 0 });
  }
  const a = agent2;
  const fn = a?.["predict"] ?? a?.["systemOne"] ?? a?.["system_one"];
  if (typeof fn !== "function") throw new TypeError("agent must provide predict or system_one");
  const extra = Object.keys(predictKwargs ?? {}).length ? [predictKwargs] : [];
  const predict = async (current) => {
    const result2 = await fn.call(agent2, state, current, ...extra);
    if (typeof result2 !== "object" || result2 === null || Array.isArray(result2)) {
      throw new TypeError("predict/system_one must return a dict");
    }
    return result2;
  };
  const warned = /* @__PURE__ */ new Set();
  const cut = (qid, labels) => dropStaleOrder(
    qid,
    { ...questions[qid], criteria: subsetCriteria(questions[qid]["criteria"], labels) },
    labels.length,
    warned
  );
  while (true) {
    const groups = [];
    for (const [qid, entry] of meta) {
      const n = entry.labels.length;
      const parts = Math.ceil(n / groupSize);
      if (parts <= 1) continue;
      for (let i = 0; i < parts; i++) {
        groups.push({ qid, labels: entry.labels.slice(Math.floor(i * n / parts), Math.floor((i + 1) * n / parts)) });
      }
    }
    if (groups.length === 0) break;
    const roundQuestions = Object.fromEntries(groups.map(({ qid, labels }, i) => [String(i), cut(qid, labels)]));
    const result2 = await predict(roundQuestions);
    const answers = result2["answers"];
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
      throw new TypeError("tournament round must return an answers dict");
    }
    const winners = /* @__PURE__ */ new Map();
    for (const [i, { qid, labels }] of groups.entries()) {
      const answer = Object.hasOwn(answers, String(i)) ? answers[String(i)] : void 0;
      const choice = typeof answer === "object" && answer !== null && !Array.isArray(answer) && Object.hasOwn(answer, "choice") ? answer["choice"] : void 0;
      if (typeof choice !== "string" || !labels.includes(choice)) {
        throw new Error(`tournament group ${i} for question ${JSON.stringify(qid)} must return a choice from its criteria`);
      }
      const kept = winners.get(qid) ?? [];
      kept.push(choice);
      winners.set(qid, kept);
    }
    for (const [qid, labels] of winners) {
      const entry = meta.get(qid);
      entry.labels = labels;
      entry.rounds++;
    }
  }
  const finalQuestions = Object.fromEntries(Object.entries(questions).map(([qid, qdef]) => {
    const entry = meta.get(qid);
    return [qid, entry?.rounds ? cut(qid, entry.labels) : qdef];
  }));
  const result = await predict(finalQuestions);
  return { ...result, tournament: Object.fromEntries(meta) };
}
function embedFnFromAgent(agent2, maxLength = 512, batchSize = 32) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new Error(`max_length must be a positive integer, got ${JSON.stringify(maxLength)}`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batch_size must be a positive integer, got ${JSON.stringify(batchSize)}`);
  }
  const a = agent2;
  if (!a?.provider || typeof a.provider.runEncoder !== "function" || !a?.tok || typeof a.tok.encode !== "function") {
    throw new Error("embedFnFromAgent needs encoder access: agent.provider.runEncoder + agent.tok.encode required");
  }
  const tok = a.tok;
  const provider = a.provider;
  return async (texts) => {
    const rows = (texts ?? []).map((t) => t === null || t === void 0 ? "" : String(t));
    if (rows.length === 0) return [];
    const out = [];
    for (let s = 0; s < rows.length; s += batchSize) {
      const chunk = rows.slice(s, s + batchSize);
      const ids = chunk.map((t) => tok.encode(t).slice(0, maxLength));
      const L = maxOf(ids.map((r) => r.length), 1);
      const pad = tok.padId ?? 0;
      const batch = {
        inputIds: ids.map((r) => [...r, ...Array(L - r.length).fill(pad)]),
        attentionMask: ids.map((r) => [...Array(r.length).fill(1), ...Array(L - r.length).fill(0)]),
        markerPos: ids.map(() => [0]),
        markerMask: ids.map(() => [true]),
        qtype: ids.map(() => 0)
      };
      const { lastHidden } = await provider.runEncoder(batch);
      for (let i = 0; i < chunk.length; i++) {
        const mask = batch.attentionMask[i];
        const denom = Math.max(1, mask.reduce((x, y) => x + y, 0));
        const dim = lastHidden[i]?.[0] ? lastHidden[i][0].length : 0;
        const pooled = new Array(dim).fill(0);
        for (let j = 0; j < mask.length; j++) {
          if (!mask[j]) continue;
          const hv = lastHidden[i]?.[j];
          if (!hv) continue;
          for (let h = 0; h < dim; h++) pooled[h] += Number(hv[h] ?? 0);
        }
        out.push(pooled.map((v) => v / denom));
      }
    }
    return out;
  };
}
function cachedEmbedFn(embedFn, maxsize = DEFAULT_SHORTLIST_MAXSIZE) {
  if (typeof embedFn !== "function") {
    throw new TypeError("embed_fn must be callable");
  }
  if (typeof maxsize !== "number" || !Number.isInteger(maxsize) || maxsize < 1) {
    throw new Error(`maxsize must be a positive integer, got ${JSON.stringify(maxsize)}`);
  }
  const rowsByText = /* @__PURE__ */ new Map();
  let hitsTotal = 0;
  let missesTotal = 0;
  let generation = 0;
  const fn = async (texts) => {
    const keys = (texts ?? []).map((t) => t === null || t === void 0 ? "" : String(t));
    if (keys.length === 0) return [];
    const found = /* @__PURE__ */ new Map();
    let hitsThisCall = 0;
    for (const key of keys) {
      const row = rowsByText.get(key);
      if (row !== void 0) {
        found.set(key, row);
        hitsThisCall++;
      }
    }
    hitsTotal += hitsThisCall;
    missesTotal += keys.length - hitsThisCall;
    const missing = [];
    const seenMissing = /* @__PURE__ */ new Set();
    for (const key of keys) {
      if (!found.has(key) && !seenMissing.has(key)) {
        seenMissing.add(key);
        missing.push(key);
      }
    }
    const genAtStart = generation;
    if (missing.length > 0) {
      const fresh = await embeddings(embedFn, missing);
      const heldDim = rowsByText.size > 0 ? rowsByText.values().next().value?.length : void 0;
      const expectedDim = heldDim ?? (fresh.length > 0 ? fresh[0]?.length : void 0);
      for (let i = 0; i < fresh.length; i++) {
        const rowDim = fresh[i]?.length ?? 0;
        if (expectedDim !== void 0 && rowDim !== expectedDim) {
          if (heldDim !== void 0) {
            throw new Error(
              `the embedder returned dim ${rowDim}, but the cache holds dim ${heldDim}; call cacheClear() if the model behind it changed`
            );
          } else {
            throw new Error(
              `the embedder returned inconsistent embedding dimensions (${expectedDim} vs ${rowDim})`
            );
          }
        }
      }
      for (let i = 0; i < missing.length; i++) {
        found.set(missing[i], fresh[i]);
      }
      if (generation !== genAtStart) {
        return keys.map((key) => [...found.get(key) ?? []]);
      }
    }
    for (const key of keys) {
      const row = found.get(key);
      if (row !== void 0) {
        rowsByText.delete(key);
        rowsByText.set(key, row);
        while (rowsByText.size > maxsize) {
          const victim = rowsByText.keys().next().value;
          rowsByText.delete(victim);
        }
      }
    }
    return keys.map((key) => [...found.get(key) ?? []]);
  };
  const cacheInfo = () => ({
    size: rowsByText.size,
    maxsize,
    hits: hitsTotal,
    misses: missesTotal
  });
  const cacheClear = () => {
    rowsByText.clear();
    hitsTotal = 0;
    missesTotal = 0;
    generation++;
  };
  const cachedResult = fn;
  cachedResult.cacheInfo = cacheInfo;
  cachedResult.cache_info = cacheInfo;
  cachedResult.cacheClear = cacheClear;
  cachedResult.cache_clear = cacheClear;
  return cachedResult;
}
const cached = cachedEmbedFn;
const SP_IN = "\\u0009-\\u000D\\u001C-\\u001F\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
const SP = `[${SP_IN}]`;
const NOT_SP = `[^${SP_IN}]`;
const WORD_IN = "\\p{L}\\p{N}_";
const WORD = `[${WORD_IN}]`;
const DIGIT = "\\p{Nd}";
const B_L = `(?<!${WORD})`;
const B_R = `(?!${WORD})`;
const LEADING_SP = new RegExp(`^${SP}+`, "u");
const TRAILING_SP = new RegExp(`${SP}+$`, "u");
function trimPy(text) {
  return text.replace(LEADING_SP, "").replace(TRAILING_SP, "");
}
function width(text) {
  let count = 0;
  for (const _ch of text) count++;
  return count;
}
function cutCodePoints(text, count) {
  const chars = Array.from(text);
  const end = count < 0 ? Math.max(0, chars.length + count) : Math.min(count, chars.length);
  return chars.slice(0, end).join("");
}
const QUOTE_HEADERS = [
  new RegExp(`^${SP}*On .{0,300}wrote:${SP}*$`, "iu"),
  // "Em resposta ao que você escreveu:" is body text; a client's attribution always carries a date
  new RegExp(`^${SP}*Em (?=.*${DIGIT}).{0,300}escreveu:${SP}*$`, "iu"),
  new RegExp(`^${SP}*El (?=.*${DIGIT}).{0,300}escribi[óo]:${SP}*$`, "iu"),
  // Gmail's French attribution carries a date like the others ("Le lun. ... a écrit :"), and
  // French typography puts a space before the colon, so the verb allows one
  new RegExp(`^${SP}*Le (?=.*${DIGIT}).{0,300}a [eé]crit${SP}*:${SP}*$`, "iu"),
  new RegExp(`^${SP}*-{2,}${SP}*(Original|Forwarded) Message${SP}*-{2,}`, "iu"),
  new RegExp(
    `^${SP}*-{2,}${SP}*(Mensagem (original|encaminhada)|Mensaje (original|reenviado)|Message d'origine)${SP}*-{2,}`,
    "iu"
  ),
  new RegExp(`^${SP}*_{8,}${SP}*$`, "u"),
  // `From:` opens ordinary prose too ("From: my side the integration works, but please
  // refund..."), and a reply header always carries the sender, so the header is only recognised
  // when an address follows -- the same rule as `De:` below. A bare `From: Name` header is
  // caught by HEADER_FROM_NAME/HEADER_NEXT instead, which need the header's own `Sent:`/`Date:`
  // line to tell it apart from a sentence.
  new RegExp(`^${SP}*From:${SP}.*[@<]`, "iu"),
  // `De:` also opens ordinary Portuguese/Spanish lines ("De: 10/09 a 15/09"), so the Outlook
  // header is only recognised when it carries an address. French Outlook writes `De :` with a
  // space, so the marker allows one; the address rule is unchanged
  new RegExp(`^${SP}*De${SP}*:${SP}.*[@<]`, "iu")
];
const ATTRIBUTION_TAIL = new RegExp(
  `^.{0,120}${NOT_SP}@${NOT_SP}+${SP}+(wrote|escreveu|escribi[óo]|a [eé]crit)${SP}*:${SP}*$`,
  "iu"
);
const ATTRIBUTION_HEAD = new RegExp(`^${SP}*(On|Em|El|Le) (?=.*${DIGIT})`, "iu");
const HEADER_FROM_NAME = new RegExp(`^${SP}*(De|From)${SP}*:${SP}+${NOT_SP}`, "iu");
const HEADER_NEXT = new RegExp(
  `^${SP}*(Enviad[oa]( em| el)?:${SP}|Envoy[ée]( le)?${SP}*:${SP}|Sent:${SP}|(Data|Fecha|Date):${SP}.*${DIGIT}{4})`,
  "iu"
);
const SIGNOFF_HEAD = new RegExp(
  `^${SP}*(?:best|kind|warmest|warm|many thanks|thanks|thank you|regards|cheers|sincerely)(?:${SP}+(?:and|&)${SP}+regards|${SP}+(?:regards|wishes|again|in advance|a lot|so much|very much))?`,
  "iu"
);
const SIGNOFF_TAIL = new RegExp(
  `^[${SP_IN},;:!.]*(?:[\\p{Lu}\\p{Lt}\\p{Lo}][\\p{L}\\p{M}\\p{N}_'-]*[${SP_IN},.]*){0,3}$`,
  "u"
);
function isEnglishSignoff(line) {
  const m = SIGNOFF_HEAD.exec(line);
  return m !== null && SIGNOFF_TAIL.test(line.slice(m[0].length));
}
const SIGNATURE_MARKERS = [
  (l) => new RegExp(`^${SP}*--${SP}*$`, "u").test(l),
  isEnglishSignoff,
  (l) => new RegExp(
    `^${SP}*(atenciosamente|att|abraços?|abs|um abraço|cordialmente|grat[oa]|(muito )?obrigad[oa]s?( desde já| pela atenção)?|(com os melhores )?cumprimentos|saudações|(un )?saludos?( cordiales)?|atentamente|(muchas )?gracias( de antemano)?|(bien )?cordialement|salutations( distinguées)?|bien à vous|merci( d'avance)?|bonne journée)[${SP_IN},!.]*$`,
    "iu"
  ).test(l)
];
const DEVICE = "iphone|ipad|android|ios|mobile|celular|telemóvel|móvil|galaxy|smartphone|samsung|tablet|outlook|yahoo|mail|e-?mail|gmail|windows";
const DEVICE_FOOTER = new RegExp(
  `^${SP}*((enviad[oa] (do|pelo|pela|via|desde|a partir do)( meu| minha| mi)?|sent from( my)?|envoy[ée] (depuis|de)( mon| ma| mes)?) (${DEVICE})( (${DEVICE}|para|for|no|na|${DIGIT}+|phone|device|pro|max|mini|plus|using [a-z][${WORD_IN}.+-]*))*|(obter o|get) outlook (para|for) (ios|android))[${SP_IN}.!]*$`,
  "iu"
);
const DISCLAIMER = new RegExp(
  // English is tied to a disclaimer noun and a disclaimer tail, the way the Portuguese branches
  // below are. The bare word matched any sentence that merely mentioned it, so "Is this
  // confidential?" and "Confidential: I need a refund." were deleted whole and the model was
  // scored on an empty state. `[^.]` rather than `[^.\n]`: a footer wraps, so "are\nconfidential"
  // must still match.
  `(${B_L}(e-?mail|message|information|communication|transmission|contents?)${B_R}[^.]{0,60}${B_L}confidential${B_R}[^.]{0,60}${B_L}(intended|solely|addressee|recipient|privileged|disclos|unauthori[sz]ed)|${B_L}confidential${B_R}[^.]{0,60}${B_L}(and (may|is) (also )?privileged)|if you (have )?received this (e-?mail|message) in error|${B_L}(esta|este) (mensagem|e-?mail|mensaje|correo)${B_R}[^.]{0,80}(confidencia|sigilos|privilegiad)|${B_L}(uso exclusivo|exclusivamente|únicamente|unicamente)${B_R}[^.]{0,30}(destinatári|destinatari|pessoa|persona|entidade|entidad)|${B_L}(recebeu|recebido|receber) (esta|este) (mensagem|e-?mail)${B_R}[^.]{0,20} por (engano|erro)|${B_L}(ha recibido|recibió|recibe) (este|esta) (mensaje|correo)${B_R}[^.]{0,20} por error|${B_L}antes de imprimir${B_R}[^.]{0,100}(meio ambiente|medio ambiente|natureza|planeta|realmente necess)|${B_L}(meio|medio) ambiente${B_R}[^.]{0,30}antes de imprimir|${B_L}(ce|cet|cette) (message|e-?mail|mail|courriel)${B_R}[^.]{0,80}(confidentiel|privil[eé]gi)|${B_L}avez re[çc]u (ce|cet|cette) (message|e-?mail|mail)${B_R}[^.]{0,20} par erreur|${B_L}(usage exclusif|exclusivement|uniquement)${B_R}[^.]{0,30}destinataire)`,
  "iu"
);
const SENTENCE = new RegExp(`(?<=[.!?])${SP}+`, "u");
function startsNewSentence(line) {
  for (const ch of line) {
    if (/\p{L}/u.test(ch)) return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
  }
  return false;
}
function splitFusedLines(sentence) {
  if (!sentence.includes("\n")) return [sentence];
  const pieces = [];
  let buf = "";
  for (const line of sentence.split("\n").map(trimPy)) {
    if (!line) continue;
    if (buf && startsNewSentence(line)) {
      pieces.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + " " + line : line;
    }
  }
  if (buf) pieces.push(buf);
  return pieces;
}
function stripDisclaimer(paragraph) {
  if (!DISCLAIMER.test(paragraph)) return paragraph;
  const parts = paragraph.split(SENTENCE).map(trimPy).filter(Boolean);
  const pieces = [];
  for (const p of parts) {
    if (DISCLAIMER.test(p)) pieces.push(...splitFusedLines(p));
    else pieces.push(p);
  }
  return pieces.filter((p) => !DISCLAIMER.test(p)).join(" ");
}
function cleanEmailBody(body, maxChars = 3e3) {
  let text = (body ?? "").replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
  if (width(text) > maxChars * 4) text = cutCodePoints(text, maxChars * 4);
  const lines = [];
  const src = text.split("\n");
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    if (QUOTE_HEADERS.some((p) => p.test(line)) && lines.length) break;
    if (lines.length && HEADER_FROM_NAME.test(line) && i + 1 < src.length && HEADER_NEXT.test(src[i + 1])) break;
    if (ATTRIBUTION_TAIL.test(line) && lines.length) {
      if (ATTRIBUTION_HEAD.test(lines[lines.length - 1])) lines.pop();
      break;
    }
    if (line.replace(LEADING_SP, "").startsWith(">")) continue;
    lines.push(line.replace(TRAILING_SP, ""));
  }
  let cut = lines.length;
  const start = Math.max(1, Math.min(Math.floor(lines.length * 0.6), lines.length - 8));
  for (let i = start; i < lines.length; i++) {
    const n = width(trimPy(lines[i]));
    if (n <= 40 && SIGNATURE_MARKERS.some((p) => p(lines[i])) || n <= 60 && DEVICE_FOOTER.test(lines[i])) {
      cut = i;
      break;
    }
  }
  const kept = lines.slice(0, cut);
  const paragraphs = kept.join("\n").split(new RegExp(`\\n${SP}*\\n`, "u")).map(stripDisclaimer);
  const out = paragraphs.map(trimPy).filter(Boolean).join("\n\n").replace(/[ \t]+/g, " ");
  return cutCodePoints(out, maxChars);
}
function emailState(subject, body, sender, clean2 = true, extra = {}, maxChars = 3e3) {
  const state = {
    subject: trimPy(subject ?? ""),
    body: clean2 ? cleanEmailBody(body ?? "", maxChars) : body ?? ""
  };
  if (sender) state["from"] = sender;
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== null && v !== void 0) state[k] = v;
  }
  return state;
}
class StabilityRandom {
  state = new Uint32Array(624);
  index = 624;
  constructor(seedKey) {
    let crc = 4294967295;
    for (const byte of new TextEncoder().encode(seedKey)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
    }
    const seed = (crc ^ 4294967295) >>> 0;
    const mt = this.state;
    mt[0] = 19650218;
    for (let i2 = 1; i2 < mt.length; i2++) {
      mt[i2] = Math.imul(mt[i2 - 1] ^ mt[i2 - 1] >>> 30, 1812433253) + i2 >>> 0;
    }
    let i = 1;
    for (let k = 624; k > 0; k--) {
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ mt[i - 1] >>> 30, 1664525)) + seed >>> 0;
      if (++i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    for (let k = 623; k > 0; k--) {
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ mt[i - 1] >>> 30, 1566083941)) - i >>> 0;
      if (++i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    mt[0] = 2147483648;
  }
  next() {
    const mt = this.state;
    if (this.index >= 624) {
      for (let i = 0; i < 624; i++) {
        const y2 = mt[i] & 2147483648 | mt[(i + 1) % 624] & 2147483647;
        mt[i] = mt[(i + 397) % 624] ^ y2 >>> 1 ^ (y2 & 1 ? 2567483615 : 0);
      }
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= y << 7 & 2636928640;
    y ^= y << 15 & 4022730752;
    y ^= y >>> 18;
    return y >>> 0;
  }
  below(n) {
    const bits = 32 - Math.clz32(n);
    let r;
    do {
      r = this.next() >>> 32 - bits;
    } while (r >= n);
    return r;
  }
  shuffle(values) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
  }
}
const SEP = "::rel";
const ALL_VARIANTS = ["reversed", "shuffle1", "shuffle2", "shuffle3", "letters", "letters_reversed", "letters_shuffle"];
function makeVariants(labels, seedKey, opts = {}) {
  const { nShuffles = 3, relabel = true, include = null, reorder = true } = opts;
  checkShuffles(nShuffles);
  const rng = new StabilityRandom(seedKey);
  const candidates = [{ name: "original", order: [...labels], relabel: false }];
  if (reorder) {
    candidates.push({ name: "reversed", order: [...labels].reverse(), relabel: false });
    for (let i = 0; i < nShuffles; i++) {
      const order = [...labels];
      rng.shuffle(order);
      candidates.push({ name: `shuffle${i + 1}`, order, relabel: false });
    }
  }
  if (relabel && labels.length <= 26) {
    candidates.push({ name: "letters", order: [...labels], relabel: true });
    candidates.push({ name: "letters_reversed", order: [...labels].reverse(), relabel: true });
    const order = [...labels];
    rng.shuffle(order);
    candidates.push({ name: "letters_shuffle", order, relabel: true });
  }
  const wanted = include === null ? null : new Set(include);
  const seen = /* @__PURE__ */ new Set();
  return candidates.filter((v) => {
    if (wanted && v.name !== "original" && !wanted.has(v.name)) return false;
    const key = JSON.stringify([v.order, v.relabel]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function decideReliability(softStability, accept, escalate = null) {
  checkProbability(softStability, "softStability");
  checkThresholds(accept, escalate);
  if (accept === null) return null;
  if (softStability >= accept) return "ACCEPT";
  if (escalate !== null && softStability < escalate) return "ESCALATE";
  return "VERIFY";
}
function calibrateReliability(scores, correct, opts = {}) {
  const { targetAccuracy = 0.9, maxEscalateAccuracy = 1 / 3 } = opts;
  if (scores.length !== correct.length) throw new Error("scores and correct must have the same length");
  if (!scores.length) throw new Error("cannot calibrate reliability on empty scores/correct pairs");
  checkProbability(targetAccuracy, "targetAccuracy");
  checkProbability(maxEscalateAccuracy, "maxEscalateAccuracy");
  const pairs = Array.from(scores, (score, i) => {
    checkProbability(score, `scores[${i}]`);
    if (typeof correct[i] !== "boolean") throw new TypeError(`correct[${i}] must be a bool`);
    return [score, correct[i]];
  });
  const cuts = [...new Set(pairs.map(([score]) => score))].sort((a, b) => a - b);
  let accept = 1.01;
  for (const t of cuts) {
    const kept = pairs.filter(([s]) => s >= t);
    if (kept.length && kept.filter(([, c]) => c).length / kept.length >= targetAccuracy) {
      accept = t;
      break;
    }
  }
  let escalate = 0;
  for (const t of cuts) {
    if (t >= accept) break;
    const below = pairs.filter(([s]) => s < t);
    if (below.length && below.filter(([, c]) => c).length / below.length <= maxEscalateAccuracy) escalate = t;
  }
  return [accept, escalate];
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function checkShuffles(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("nShuffles must be a non-negative integer");
  }
}
function checkThreshold(value, name, max) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max)) {
    throw new Error(`${name} must be null or a number in [0, ${max}]`);
  }
}
function checkProbability(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number in [0, 1]`);
  }
}
function checkThresholds(accept, escalate) {
  checkThreshold(accept, "accept", 1.01);
  checkThreshold(escalate, "escalate", 1);
  if (accept !== null && escalate !== null && escalate > accept) {
    throw new Error("escalate must not be greater than accept");
  }
}
function resolveProbes(probes) {
  if (probes === void 0 || probes === null || probes === "auto") return null;
  if (probes === "all") return ["reorder", "rename"];
  if (probes === "rename" || probes === "reorder") return [probes];
  if (!Array.isArray(probes) || !probes.length || probes.some((p) => p !== "reorder" && p !== "rename")) {
    throw new Error("probes must be 'auto', 'all', 'reorder', 'rename', or a non-empty sequence of probe names");
  }
  return [...new Set(probes)];
}
function resolveVariants(variants) {
  if (variants === void 0 || variants === null || variants === "full") return null;
  if (variants === "fast") return ["reversed", "letters_reversed"];
  if (!Array.isArray(variants) || !variants.length || variants.some((v) => !ALL_VARIANTS.includes(v))) {
    throw new Error(`variants must be 'full', 'fast', or a non-empty sequence from ${ALL_VARIANTS.join(", ")}`);
  }
  return [...variants];
}
function detectLayout(ctx) {
  const cfg = isRecord(ctx.agent) && isRecord(ctx.agent.cfg) ? ctx.agent.cfg : null;
  const raw = cfg?.option_layout;
  if (typeof raw === "string") {
    const layout = raw.trim().toLowerCase();
    if (layout === "parallel" || layout === "sequential") return layout;
    console.warn(`laya: unknown option_layout ${JSON.stringify(raw)} in agent config; defaulting to 'sequential'`);
  }
  return "sequential";
}
function variantQuestion(q2, order, relabel) {
  const shown = relabel ? order.map((_, i) => String.fromCharCode(65 + i)) : [...order];
  const criteria = q2.criteria;
  const entries = shown.map((label, i) => {
    const original = order[i];
    let description = Array.isArray(criteria) ? null : criteria[original];
    if (relabel && (description === null || description === void 0 || typeof description === "string" && description.trim() === "")) description = original;
    return [label, description];
  });
  const nextCriteria = Object.fromEntries(entries);
  const question = { ...q2, criteria: Array.isArray(criteria) && !relabel ? [...order] : nextCriteria };
  const actual = Object.keys(nextCriteria);
  const callerOrder = Array.isArray(q2.option_order) ? q2.option_order : order.map((_, i) => i);
  const effectiveOrder = callerOrder.map((i) => actual.indexOf(shown[i]));
  if (Object.hasOwn(q2, "option_order") || effectiveOrder.some((i, slot) => i !== slot)) {
    question.option_order = effectiveOrder;
  }
  return { question, back: new Map(shown.map((label, i) => [label, order[i]])) };
}
function round4(value) {
  if (!Number.isFinite(value) || value === 0) return value;
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, value);
  const bits = data.getBigUint64(0);
  const exponent = Number(bits >> 52n & 0x7ffn);
  const mantissa = bits & (1n << 52n) - 1n | (exponent ? 1n << 52n : 0n);
  const power = exponent ? exponent - 1075 : -1074;
  let numerator = mantissa * 10000n;
  const denominator = power < 0 ? 1n << BigInt(-power) : 1n;
  if (power > 0) numerator <<= BigInt(power);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && rounded & 1n) rounded++;
  return (bits >> 63n ? -Number(rounded) : Number(rounded)) / 1e4;
}
function compareCodePoints(a, b) {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
class OptionStabilityHook extends BaseHook {
  accept;
  escalate;
  probes;
  nShuffles;
  relabel;
  renameMaxOptions;
  include;
  seed;
  plans = /* @__PURE__ */ new WeakMap();
  constructor(opts) {
    super();
    if (!opts || !Object.hasOwn(opts, "accept") || !Object.hasOwn(opts, "escalate")) {
      throw new Error("accept and escalate are required; pass null for uncalibrated metrics");
    }
    checkThresholds(opts.accept, opts.escalate);
    this.accept = opts.accept;
    this.escalate = opts.escalate;
    this.probes = resolveProbes(opts.probes);
    this.nShuffles = opts.nShuffles === void 0 ? 3 : opts.nShuffles;
    checkShuffles(this.nShuffles);
    this.relabel = opts.relabel === void 0 ? true : opts.relabel;
    if (typeof this.relabel !== "boolean") throw new TypeError("relabel must be a bool");
    this.renameMaxOptions = opts.renameMaxOptions === void 0 ? 20 : opts.renameMaxOptions;
    if (!Number.isInteger(this.renameMaxOptions) || this.renameMaxOptions < 2) {
      throw new Error("renameMaxOptions must be an integer >= 2");
    }
    this.include = resolveVariants(opts.variants);
    this.seed = opts.seed === void 0 || opts.seed === null ? null : String(opts.seed);
  }
  onPredictStart(ctx) {
    this.plans.delete(ctx);
    for (const qid of Object.keys(ctx.questions)) {
      if (qid.includes(SEP)) throw new Error(`question id ${JSON.stringify(qid)} must not contain ${JSON.stringify(SEP)}`);
    }
    const layout = detectLayout(ctx);
    const configured = new Set(this.probes ?? (layout === "parallel" ? this.relabel ? ["rename"] : [] : this.relabel ? ["reorder", "rename"] : ["reorder"]));
    const baseSeed = this.seed ?? (ctx.states.length === 1 ? serializeState(ctx.states[0]) : "batch");
    const plan = /* @__PURE__ */ new Map();
    const questions = { ...ctx.questions };
    for (const [qid, q2] of Object.entries(ctx.questions)) {
      if (!isRecord(q2) || q2.type !== "choice") continue;
      const criteria = q2.criteria;
      if (!Array.isArray(criteria) && !isRecord(criteria)) continue;
      const labels = Object.keys(Array.isArray(criteria) ? Object.fromEntries(criteria.map((label) => [String(label), null])) : criteria);
      const variants = [{
        name: "original",
        key: qid,
        back: new Map(labels.map((label) => [label, label])),
        relabel: false
      }];
      const probes = [];
      if (labels.length >= 2) {
        const generated = makeVariants(labels, `${baseSeed}|${qid}`, {
          nShuffles: this.nShuffles,
          relabel: configured.has("rename") && labels.length <= this.renameMaxOptions,
          reorder: configured.has("reorder"),
          include: this.include
        }).slice(1);
        if (generated.some((v) => !v.relabel)) probes.push("reorder");
        if (generated.some((v) => v.relabel)) probes.push("rename");
        generated.forEach((variant, i) => {
          const key = `${qid}${SEP}${i + 1}`;
          const { question, back } = variantQuestion(q2, variant.order, variant.relabel);
          questions[key] = question;
          variants.push({ name: variant.name, key, back, relabel: variant.relabel });
        });
      }
      plan.set(qid, { layout, variants, probes });
    }
    if (plan.size) {
      ctx.questions = questions;
      this.plans.set(ctx, plan);
    }
  }
  onPredictEnd(ctx) {
    const plan = this.plans.get(ctx);
    this.plans.delete(ctx);
    if (!plan || !ctx.results) return;
    const internalKeys = new Set([...plan.values()].flatMap((p) => p.variants.slice(1).map((v) => v.key)));
    for (const result of ctx.results) {
      if (!isRecord(result)) continue;
      const answers = result.answers;
      if (isRecord(answers)) {
        for (const [qid, p] of plan) {
          if (!Object.hasOwn(answers, qid)) continue;
          const answer = answers[qid];
          if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string") continue;
          const seen = [];
          for (const variant of p.variants) {
            if (!Object.hasOwn(answers, variant.key)) break;
            const value = answers[variant.key];
            if (!isRecord(value) || value.type !== "choice" || typeof value.choice !== "string" || !isRecord(value.probabilities)) break;
            const probabilities = Object.entries(value.probabilities);
            if (probabilities.some(([, v]) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) break;
            const probs = new Map(probabilities.map(([label, probability]) => [variant.back.get(label) ?? label, probability]));
            const choice = variant.back.get(value.choice) ?? value.choice;
            seen.push({ name: variant.name, choice, support: probs.get(answer.choice) ?? 0, relabel: variant.relabel });
          }
          if (seen.length !== p.variants.length) continue;
          const others = seen.slice(1);
          const probed = others.length > 0 && p.probes.length > 0;
          const rate = (items) => items.length ? round4(items.filter((v) => v.choice === answer.choice).length / items.length) : null;
          const soft = probed ? seen.reduce((sum, v) => sum + v.support, 0) / seen.length : null;
          const report = {
            probes: probed ? [...p.probes] : [],
            option_layout: p.layout,
            decision: soft === null ? null : decideReliability(soft, this.accept, this.escalate),
            soft_stability: soft,
            stability: probed ? rate(others) : null,
            rename_stability: probed ? rate(others.filter((v) => v.relabel)) : null,
            reorder_stability: probed ? rate(others.filter((v) => !v.relabel)) : null,
            n_variants: seen.length,
            distinct_choices: [...new Set(seen.flatMap((v) => v.choice === null ? [] : [v.choice]))].sort(compareCodePoints),
            variant_choices: Object.fromEntries(seen.map((v) => [v.name, v.choice])),
            variant_support: Object.fromEntries(seen.map((v) => [v.name, round4(v.support)]))
          };
          answer.reliability = report;
        }
        for (const key of internalKeys) delete answers[key];
      }
      const usage = result.usage;
      if (isRecord(usage)) {
        if (Array.isArray(usage.truncated_questions)) {
          usage.truncated_questions = usage.truncated_questions.filter((key) => !internalKeys.has(key));
        }
        if (isRecord(usage.options)) {
          usage.options = Object.fromEntries(Object.entries(usage.options).filter(([key]) => !internalKeys.has(key)));
        }
      }
    }
  }
  onError(ctx) {
    this.plans.delete(ctx);
  }
}
function triageQuestions() {
  return {
    intent: {
      type: "choice",
      instructions: "What does the customer want in `message`?",
      criteria: {
        refund: "money returned or a duplicate charge reversed",
        technical_help: "a bug, outage or integration problem",
        billing_question: "a question about an invoice, plan or payment method",
        information: "general information, pricing or how-to",
        cancellation: "wants to cancel or downgrade",
        other: "none of the other options fits"
      }
    },
    is_urgent: {
      type: "noul",
      instructions: "Does `message` communicate time pressure or a deadline?"
    },
    frustration: {
      type: "score",
      instructions: "How frustrated does the customer sound in `message`?",
      criteria: [
        "calm and neutral",
        "concerned but civil",
        "clearly annoyed",
        "very angry or using strong language"
      ]
    },
    refund_requested: {
      type: "noul",
      instructions: "Does the customer ask for money back?"
    },
    churn_risk: {
      type: "noul",
      instructions: "Does `message` suggest the customer may leave for a competitor or cancel?"
    }
  };
}
function emailQuestions(categories) {
  const cats = categories && Object.keys(categories).length > 0 ? categories : {
    billing: "invoices, payments, refunds",
    technical: "bugs, outages, integrations",
    sales: "pricing, demos, new purchases",
    security: "phishing, scams, account compromise",
    hr: "hiring, leave, payroll",
    other: "none of the above"
  };
  return {
    category: {
      type: "choice",
      instructions: "Which team should handle the email in `body`?",
      criteria: cats
    },
    is_spam: {
      type: "noul",
      instructions: "Is this email unsolicited spam or bulk marketing?"
    },
    is_phishing: {
      type: "noul",
      instructions: "Is this email a phishing or scam attempt to steal money, credentials, or personal data?",
      criteria: { true: "phishing, scam, or fraud", false: "a legitimate email" }
    },
    urgency: {
      type: "score",
      instructions: "How urgent is the request in `body`?",
      criteria: ["no time pressure", "needs attention soon", "blocking issue or hard deadline"]
    },
    needs_reply: {
      type: "noul",
      instructions: "Does the sender expect a reply?"
    }
  };
}
function guardQuestions() {
  return {
    jailbreak: {
      type: "noul",
      instructions: "Does `prompt` try to make an AI assistant ignore its rules, policies or system instructions?"
    },
    prompt_injection: {
      type: "noul",
      instructions: "Does `prompt` contain instructions aimed at the AI system rather than a genuine user request?"
    },
    sensitive_data: {
      type: "noul",
      instructions: "Does `prompt` contain credentials, personal data or other sensitive information?"
    },
    harm_severity: {
      type: "score",
      instructions: "How much harm would complying with `prompt` cause?",
      criteria: [
        "none: ordinary request",
        "minor: mildly inappropriate",
        "serious: unsafe advice or abuse",
        "severe: dangerous or illegal"
      ]
    },
    topic: {
      type: "choice",
      instructions: "What is `prompt` about?",
      criteria: {
        product_support: null,
        coding: null,
        general_knowledge: null,
        personal_advice: null,
        security_testing: null,
        other: null
      }
    }
  };
}
function moderationQuestions() {
  return {
    toxic: {
      type: "noul",
      instructions: "Is `post` toxic: rude, disrespectful or likely to make someone leave the discussion?"
    },
    harassment: {
      type: "noul",
      instructions: "Does `post` target or harass a specific person?"
    },
    threat: {
      type: "noul",
      instructions: "Does `post` threaten violence, harm or intimidation?"
    },
    spam: {
      type: "noul",
      instructions: "Is `post` spam or advertising?"
    },
    severity: {
      type: "score",
      instructions: "How severe is any rule-breaking in `post`?",
      criteria: [
        "no rule-breaking: ordinary on-topic post",
        "mild: rude tone or off-topic, no target",
        "clear violation: insults, harassment or spam aimed at someone",
        "severe: threats, hate speech or calls for violence"
      ]
    }
  };
}
function routerQuestions() {
  return {
    difficulty: {
      type: "score",
      instructions: "How hard is `request` for a language model?",
      criteria: [
        "trivial: a lookup or one-liner",
        "easy: short answer, no reasoning",
        "moderate: several steps",
        "hard: long multi-step reasoning or specialist knowledge"
      ]
    },
    domain: {
      type: "choice",
      instructions: "What domain does `request` belong to?",
      criteria: {
        code: "software engineering, programming, refactoring, architecture, debugging",
        math_or_logic: "mathematics, logic puzzles, proofs, complex calculation",
        writing: "creative writing, essays, emails, blog posts, copywriting",
        factual_lookup: "facts, definitions, trivia, history",
        data_analysis: "statistics, SQL, data manipulation, metrics",
        chitchat: "casual conversation, greetings, small talk"
      }
    },
    needs_tools: {
      type: "noul",
      instructions: "Does answering `request` require external tools, search or private data?"
    },
    is_sensitive: {
      type: "noul",
      instructions: "Does `request` involve money, legal, medical or safety consequences?"
    }
  };
}
const q = {
  choice(instructions, criteria) {
    return { type: "choice", instructions, criteria };
  },
  score(instructions, criteria) {
    return { type: "score", instructions, criteria };
  },
  noul(instructions, criteria, labels) {
    const out = { type: "noul", instructions };
    if (criteria !== void 0) out["criteria"] = criteria;
    if (labels !== void 0) out["labels"] = labels;
    return out;
  }
};
function best(answer) {
  if (answer.type === "choice") return answer.choice;
  if (answer.type === "score") {
    let bk = "";
    let bv = -Infinity;
    for (const [k, v] of Object.entries(answer.probabilities)) {
      if (v > bv) {
        bv = v;
        bk = k;
      }
    }
    return bk;
  }
  return answer.noul >= 0.5;
}
function topK(probs, k) {
  return Object.entries(probs).sort((a, b) => b[1] - a[1]).slice(0, Math.max(0, k)).map(([key]) => key);
}
function isConfident(answer, thresh = 0.8) {
  return (answer.answer_confidence ?? 0) >= thresh;
}
const VERSION = "0.1.0";
exports.Agent = Agent;
exports.BaseHook = BaseHook;
exports.CHECKPOINT_IDS = CHECKPOINT_IDS;
exports.DEFAULT_MODELS = DEFAULT_MODELS;
exports.DEFAULT_SHORTLIST_K = DEFAULT_SHORTLIST_K;
exports.DEFAULT_SHORTLIST_MAXSIZE = DEFAULT_SHORTLIST_MAXSIZE;
exports.DEFAULT_TOURNAMENT_GROUP = DEFAULT_TOURNAMENT_GROUP;
exports.HOOK_EVENTS = HOOK_EVENTS;
exports.HookRegistry = HookRegistry;
exports.MAX_OPTIONS = MAX_OPTIONS;
exports.MAX_PROPERTIES = MAX_PROPERTIES;
exports.MAX_SCORE_LEVELS = MAX_SCORE_LEVELS;
exports.METASPACE_REPLACEMENT = METASPACE_REPLACEMENT;
exports.OptionStabilityHook = OptionStabilityHook;
exports.PINNED_REVISIONS = PINNED_REVISIONS;
exports.PredictContext = PredictContext;
exports.Router = Router;
exports.SPECIAL_ALIASES = SPECIAL_ALIASES;
exports.SchemaError = SchemaError;
exports.TEMP_MAX = TEMP_MAX;
exports.TEMP_MIN = TEMP_MIN;
exports.VERSION = VERSION;
exports._digestsFromEnv = _digestsFromEnv;
exports.addDefaultHook = addDefaultHook;
exports.aggregateUsage = aggregateUsage;
exports.analyse = analyse;
exports.answerConfidence = answerConfidence;
exports.answersToJson = answersToJson;
exports.applyBinningMap = applyBinningMap;
exports.best = best;
exports.bpeEncode = bpeEncode;
exports.buildQuestionPrefix = buildQuestionPrefix;
exports.buildSequence = buildSequence;
exports.cached = cached;
exports.cachedEmbedFn = cachedEmbedFn;
exports.calibrateReliability = calibrateReliability;
exports.checkBinningMap = checkBinningMap;
exports.checkMinConfidence = checkMinConfidence;
exports.checkMinConfidenceMap = checkMinConfidenceMap;
exports.checkQuestion = checkQuestion;
exports.clampTemperature = clampTemperature;
exports.cleanEmailBody = cleanEmailBody;
exports.clearDefaultHooks = clearDefaultHooks;
exports.collapsedOptions = collapsedOptions;
exports.collateItems = collateItems;
exports.composeHooks = composeHooks;
exports.confidenceFromProbs = confidenceFromProbs;
exports.createNodeProvider = createNodeProvider;
exports.createWebProvider = createWebProvider;
exports.decide = decide;
exports.decideBatch = decideBatch;
exports.decideReliability = decideReliability;
exports.defaultHooks = defaultHooks;
exports.defaultTokenizer = defaultTokenizer;
exports.detectScript = detectScript;
exports.digestsFromEnv = digestsFromEnv;
exports.dispatch = dispatch;
exports.emailQuestions = emailQuestions;
exports.emailState = emailState;
exports.embedFnFromAgent = embedFnFromAgent;
exports.encodeWithData = encodeWithData;
exports.feed = feed;
exports.feedHead = feedHead;
exports.flagLowConfidence = flagLowConfidence;
exports.guardQuestions = guardQuestions;
exports.guessLatinLanguage = guessLatinLanguage;
exports.isConfident = isConfident;
exports.isEnglish = isEnglish;
exports.loadNodeBundle = loadNodeBundle;
exports.loadTokenizerJson = loadTokenizerJson;
exports.loadWebBundle = loadWebBundle;
exports.makeVariants = makeVariants;
exports.metaspaceEncode = metaspaceEncode;
exports.moderationQuestions = moderationQuestions;
exports.normaliseHooks = normaliseHooks;
exports.normaliseName = normaliseName;
exports.optionBucket = optionBucket;
exports.parseTokenizerJson = parseTokenizerJson;
exports.planFromJsonSchema = planFromJsonSchema;
exports.predictShortlist = predictShortlist;
exports.predictTournament = predictTournament;
exports.q = q;
exports.questionsFromJsonSchema = questionsFromJsonSchema;
exports.renderOptions = renderOptions;
exports.resolveMinConfidence = resolveMinConfidence;
exports.resolveRevision = resolveRevision;
exports.routerQuestions = routerQuestions;
exports.sequenceWithState = sequenceWithState;
exports.serializeState = serializeState;
exports.setDefaultHooks = setDefaultHooks;
exports.shortlistChoice = shortlistChoice;
exports.softmax = softmax;
exports.tempBucket = tempBucket;
exports.toInternal = toInternal;
exports.topK = topK;
exports.triageQuestions = triageQuestions;
