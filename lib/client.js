window.__ModuleLoader__.load({
  id: "dsh-feishu-integration",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugin-src/client/index.js
var index_exports = {};
__export(index_exports, {
  FeishuSettingsTab: () => FeishuSettingsTab,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var React = __toESM(require("react"), 1);

// plugin-src/client/api.js
var FEISHU_RPC_CHANNEL = "/feishu";
var FEISHU_ENDPOINTS = Object.freeze({
  status: "connection.status",
  beginProvisioning: "provision.begin",
  pollProvisioning: "provision.poll",
  cancelProvisioning: "provision.cancel",
  reconnectBot: "bot.reconnect",
  disconnectBot: "bot.disconnect",
  deleteBot: "bot.delete",
  // Kept for rolling upgrades. The multi-bot UI never calls these endpoints.
  testConnection: "connection.test",
  disconnect: "connection.disconnect"
});
var CONNECTION_STATES = /* @__PURE__ */ new Set([
  "disconnected",
  "offline",
  "provisioning",
  "connecting",
  "reconnecting",
  "connected",
  "error"
]);
var POLL_STATES = /* @__PURE__ */ new Set([
  "pending",
  "scanned",
  "connecting",
  "connected",
  "expired",
  "failed"
]);
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
function optionalTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}
function clamp(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function unwrapRpcResult(result) {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  }
  if (!result.ok) {
    const message = optionalString(result.error?.message) ?? "\u98DE\u4E66\u670D\u52A1\u8BF7\u6C42\u5931\u8D25";
    const error = new Error(message);
    error.code = optionalString(result.error?.code) ?? "FEISHU_RPC_ERROR";
    throw error;
  }
  return result.value;
}
function normalizeProvisioning(value, now = Date.now()) {
  const source = isRecord(value?.provisioning) ? value.provisioning : value;
  if (!isRecord(source)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u4E8C\u7EF4\u7801\u4FE1\u606F");
  const attemptId = optionalString(source.attemptId) ?? optionalString(source.provisioningId);
  const verificationUrl = optionalString(source.verificationUrl);
  const qrCodeDataUrl = optionalString(source.qrCodeDataUrl);
  if (!attemptId || !verificationUrl && !qrCodeDataUrl) {
    throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u4E8C\u7EF4\u7801\u4FE1\u606F\u4E0D\u5B8C\u6574");
  }
  const explicitExpiry = optionalTimestamp(source.expiresAt);
  const expireIn = clamp(source.expireIn, 1, 60 * 60, 5 * 60);
  return {
    attemptId,
    verificationUrl,
    qrCodeDataUrl,
    expiresAt: explicitExpiry ?? now + expireIn * 1e3,
    pollIntervalMs: clamp(source.pollIntervalMs, 800, 1e4, 1800)
  };
}
function normalizeBot(value) {
  const source = isRecord(value) ? value : {};
  return {
    name: optionalString(source.name) ?? "\u98DE\u4E66\u673A\u5668\u4EBA",
    avatarUrl: optionalString(source.avatarUrl),
    appIdMasked: optionalString(source.appIdMasked),
    tenantName: optionalString(source.tenantName),
    domain: source.domain === "lark" ? "lark" : "feishu",
    activated: typeof source.activated === "boolean" || typeof source.activated === "number" ? source.activated : void 0
  };
}
function normalizeHealth(value, connected = false) {
  const source = isRecord(value) ? value : {};
  const fallbackStatus = connected ? "healthy" : "offline";
  const status = ["healthy", "degraded", "offline", "checking"].includes(source.status) ? source.status : fallbackStatus;
  return {
    status,
    summary: optionalString(source.summary) ?? (connected ? "\u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38" : "\u673A\u5668\u4EBA\u5C1A\u672A\u8FDE\u63A5"),
    lastCheckedAt: optionalTimestamp(source.lastCheckedAt),
    lastConnectedAt: optionalTimestamp(source.lastConnectedAt)
  };
}
function normalizeError(value) {
  if (!isRecord(value)) return void 0;
  const message = optionalString(value.message);
  if (!message) return void 0;
  return { message, code: optionalString(value.code) };
}
function authoritativeState(value, connected) {
  if (connected) return "connected";
  const reported = CONNECTION_STATES.has(value) ? value : "disconnected";
  if (reported === "connected" || reported === "connecting" || reported === "reconnecting") {
    return "connecting";
  }
  if (reported === "error") return "error";
  return "offline";
}
function normalizeBotConnection(value, fallbackBotId) {
  if (!isRecord(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u673A\u5668\u4EBA\u72B6\u6001");
  const botId = optionalString(value.botId) ?? optionalString(fallbackBotId);
  if (!botId) throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u673A\u5668\u4EBA\u7F3A\u5C11 botId");
  const connected = value.connected === true;
  return {
    botId,
    state: authoritativeState(value.state, connected),
    connected,
    configured: value.configured !== false,
    bot: normalizeBot(value.bot),
    health: normalizeHealth(value.health, connected),
    error: normalizeError(value.error)
  };
}
function normalizeBotsSnapshot(value) {
  if (!isRecord(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u8FDE\u63A5\u72B6\u6001");
  let sourceBots = Array.isArray(value.bots) ? value.bots : [];
  if (sourceBots.length === 0 && value.configured === true) {
    sourceBots = [{
      botId: optionalString(value.botId) ?? "legacy-default",
      state: value.state,
      connected: value.connected,
      configured: true,
      bot: value.bot,
      health: value.health,
      error: value.error
    }];
  }
  const seen = /* @__PURE__ */ new Set();
  const bots = [];
  for (const source of sourceBots) {
    const bot = normalizeBotConnection(source);
    if (seen.has(bot.botId)) continue;
    seen.add(bot.botId);
    bots.push(bot);
  }
  const configured = bots.filter((bot) => bot.configured).length;
  const connected = bots.filter((bot) => bot.connected).length;
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  const state = CONNECTION_STATES.has(value.state) ? value.state : "disconnected";
  return {
    schemaVersion: value.schemaVersion === 2 ? 2 : 1,
    revision,
    state,
    bots,
    // Derive counts from the authoritative list so stale summary fields never
    // make the UI claim that an unavailable bot is online.
    totals: { configured, connected },
    provisioning: value.provisioning ? normalizeProvisioning(value.provisioning) : void 0,
    error: normalizeError(value.error)
  };
}
function normalizeConnectionSnapshot(value) {
  if (!isRecord(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u8FDE\u63A5\u72B6\u6001");
  const connected = value.connected === true;
  const reportedState = CONNECTION_STATES.has(value.state) ? value.state : "disconnected";
  const state = connected ? "connected" : reportedState === "connected" ? "connecting" : reportedState;
  const snapshot = {
    state,
    configured: value.configured === true,
    bot: normalizeBot(value.bot),
    health: normalizeHealth(value.health, connected),
    provisioning: void 0,
    errorMessage: optionalString(value.error?.message) ?? optionalString(value.message)
  };
  if (value.provisioning) snapshot.provisioning = normalizeProvisioning(value.provisioning);
  return snapshot;
}
function normalizePollResult(value) {
  if (!isRecord(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u521B\u5EFA\u8FDB\u5EA6");
  const status = POLL_STATES.has(value.status) ? value.status : POLL_STATES.has(value.state) ? value.state : void 0;
  if (!status) throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u672A\u77E5\u7684\u521B\u5EFA\u72B6\u6001");
  const normalized = {
    status,
    botId: optionalString(value.botId),
    message: optionalString(value.error?.message) ?? optionalString(value.message),
    connection: void 0,
    provisioning: void 0
  };
  if (value.provisioning) normalized.provisioning = normalizeProvisioning(value.provisioning);
  if (status === "connected" && isRecord(value.connection)) {
    normalized.connection = value.connection.botId ? normalizeBotConnection(value.connection) : normalizeConnectionSnapshot(value.connection);
  }
  return normalized;
}
function presentError(error) {
  const raw = optionalString(error?.message) ?? "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
  const message = raw.replace(/(client[_-]?secret|app[_-]?secret|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=\u2022\u2022\u2022\u2022\u2022\u2022").slice(0, 240);
  return { message, code: optionalString(error?.code) };
}
function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// plugin-src/client/styles.js
var FEISHU_STYLE_ID = "beihuixinghe-dsh-feishu-settings";
var CSS = String.raw`
.bxf-page {
  --bxf-accent: var(--dsw-alias-state-business-primary, #3370ff);
  --bxf-success: var(--dsw-alias-state-success-primary, #20a162);
  --bxf-warning: var(--dsw-alias-state-warning-primary, #d97706);
  --bxf-error: var(--dsw-alias-state-error-primary, #d54941);
  box-sizing: border-box;
  width: 100%;
  max-width: 860px;
  color: var(--dsw-alias-label-primary, #1f2329);
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  gap: 18px;
  padding: 2px 0 24px;
}

.bxf-page *, .bxf-page *::before, .bxf-page *::after { box-sizing: border-box; }

.bxf-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.bxf-headingCopy { min-width: 0; }
.bxf-heading h2, .bxf-heading p, .bxf-card h3, .bxf-card p { margin: 0; }

.bxf-eyebrow {
  color: var(--dsw-alias-label-tertiary, #8f959e);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  letter-spacing: .08em;
  text-transform: uppercase;
  margin-bottom: 3px;
}

.bxf-heading h2 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 650;
  letter-spacing: -.015em;
}

.bxf-heading p {
  max-width: 540px;
  color: var(--dsw-alias-label-secondary, #646a73);
  font-size: 13px;
  line-height: 20px;
  margin-top: 5px;
  white-space: nowrap;
}

.bxf-headingTools {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.bxf-totalBadge {
  min-height: 28px;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  border-radius: 999px;
  padding: 4px 10px;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: var(--dsw-alias-bg-module-platform, #f2f3f5);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.bxf-totalBadge strong { color: var(--bxf-success); font-size: 13px; }

.bxf-localBadge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  border: 1px solid var(--dsw-alias-border-l2, #dee0e3);
  border-radius: 999px;
  padding: 4px 10px;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: var(--dsw-alias-bg-layer-1, #fff);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.bxf-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, #dee0e3);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-3, #fff);
  box-shadow: var(--dsw-shadow-lv1, 0 3px 12px rgba(31, 35, 41, .05));
}

.bxf-card::before {
  content: "";
  pointer-events: none;
  position: absolute;
  inset: 0 0 auto;
  height: 88px;
  background:
    radial-gradient(circle at 86% -35%, color-mix(in srgb, var(--bxf-accent) 18%, transparent), transparent 68%);
  opacity: .85;
}

.bxf-cardBody { position: relative; padding: 24px; }

.bxf-intro {
  min-height: 250px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 172px;
  gap: 32px;
  align-items: center;
}

.bxf-introCopy { max-width: 500px; }

.bxf-stateLabel {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--dsw-alias-label-secondary, #646a73);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  margin-bottom: 13px;
}

.bxf-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #8f959e);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-label-tertiary, #8f959e) 12%, transparent);
}

.bxf-dot[data-tone="success"] {
  background: var(--bxf-success);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bxf-success) 13%, transparent);
}

.bxf-dot[data-tone="warning"] {
  background: var(--bxf-warning);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bxf-warning) 13%, transparent);
}

.bxf-dot[data-tone="error"] {
  background: var(--bxf-error);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bxf-error) 13%, transparent);
}

.bxf-intro h3 {
  font-size: 24px;
  line-height: 34px;
  font-weight: 650;
  letter-spacing: -.02em;
}

.bxf-introCopy > p {
  max-width: 490px;
  color: var(--dsw-alias-label-secondary, #646a73);
  font-size: 14px;
  line-height: 23px;
  margin-top: 8px;
}

.bxf-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: var(--dsw-alias-label-tertiary, #8f959e);
  font-size: 12px;
  line-height: 18px;
  margin-top: 16px;
}

.bxf-note svg { flex: none; margin-top: 1px; }

.bxf-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.bxf-button {
  appearance: none;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--dsw-alias-border-l2, #dee0e3);
  border-radius: 8px;
  padding: 7px 13px;
  color: var(--dsw-alias-label-primary, #1f2329);
  background: var(--dsw-alias-bg-layer-1, #fff);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  line-height: 20px;
  text-decoration: none;
  cursor: pointer;
  transition: background .15s var(--ds-ease-in-out, ease), border-color .15s var(--ds-ease-in-out, ease), transform .15s var(--ds-ease-in-out, ease);
}

.bxf-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, #f2f3f5);
  border-color: var(--dsw-alias-border-l1, #c9cdd4);
}

.bxf-button:active:not(:disabled) { transform: translateY(1px); }

.bxf-button:focus-visible, .bxf-link:focus-visible {
  outline: 2px solid var(--bxf-accent);
  outline-offset: 2px;
}

.bxf-button:disabled { cursor: not-allowed; opacity: .55; }

.bxf-button[data-kind="primary"] {
  border-color: var(--bxf-accent);
  color: #fff;
  background: var(--bxf-accent);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--bxf-accent) 24%, transparent);
}

.bxf-button[data-kind="primary"]:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--bxf-accent) 86%, #000);
  background: color-mix(in srgb, var(--bxf-accent) 90%, #000);
}

.bxf-button[data-kind="danger"] { color: var(--bxf-error); }
.bxf-button[data-size="small"] { min-height: 32px; padding: 5px 10px; font-size: 12px; }

.bxf-provisionCard {
  border-color: color-mix(in srgb, var(--bxf-accent) 32%, var(--dsw-alias-border-l2, #dee0e3));
}

.bxf-markStage {
  position: relative;
  width: 156px;
  height: 156px;
  display: grid;
  place-items: center;
  justify-self: end;
}

.bxf-markStage::before, .bxf-markStage::after {
  content: "";
  position: absolute;
  border-radius: 50%;
}

.bxf-markStage::before {
  inset: 12px;
  border: 1px solid color-mix(in srgb, var(--bxf-accent) 18%, var(--dsw-alias-border-l2, #dee0e3));
  background: color-mix(in srgb, var(--bxf-accent) 4%, var(--dsw-alias-bg-layer-1, #fff));
}

.bxf-markStage::after {
  inset: 0;
  border: 1px dashed color-mix(in srgb, var(--bxf-accent) 16%, transparent);
  animation: bxf-rotate 18s linear infinite;
}

.bxf-brandMark {
  position: relative;
  z-index: 1;
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  border-radius: 20px;
  color: #fff;
  background: var(--bxf-accent);
  box-shadow: 0 12px 28px color-mix(in srgb, var(--bxf-accent) 28%, transparent);
}

.bxf-qrLayout {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  align-items: center;
  gap: 32px;
}

.bxf-qrColumn { min-width: 0; }

.bxf-qrFrame {
  position: relative;
  width: 222px;
  height: 222px;
  display: grid;
  place-items: center;
  border: 1px solid var(--dsw-alias-border-l2, #dee0e3);
  border-radius: 14px;
  padding: 13px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(31, 35, 41, .07);
}

.bxf-qrFrame::before, .bxf-qrFrame::after {
  content: "";
  position: absolute;
  width: 24px;
  height: 24px;
  border-color: var(--bxf-accent);
  border-style: solid;
}

.bxf-qrFrame::before { inset: -3px auto auto -3px; border-width: 2px 0 0 2px; border-radius: 5px 0 0; }
.bxf-qrFrame::after { inset: auto -3px -3px auto; border-width: 0 2px 2px 0; border-radius: 0 0 5px; }
.bxf-qrFrame img { width: 100%; height: 100%; display: block; object-fit: contain; }

.bxf-qrFallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--bxf-accent);
  background: #f7f9ff;
  text-align: center;
  padding: 20px;
}

.bxf-qrFallback span { display: block; color: #646a73; font-size: 12px; line-height: 18px; margin-top: 8px; }

.bxf-expiredOverlay {
  position: absolute;
  inset: 10px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: #1f2329;
  background: rgba(255, 255, 255, .94);
  backdrop-filter: blur(3px);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.bxf-countdown {
  width: 222px;
  color: var(--dsw-alias-label-tertiary, #8f959e);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  line-height: 17px;
  margin-top: 11px;
}

.bxf-countdownTop { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bxf-progress { height: 3px; overflow: hidden; border-radius: 99px; background: var(--dsw-alias-bg-module-platform, #f2f3f5); margin-top: 6px; }
.bxf-progress > span { display: block; width: var(--bxf-progress, 100%); height: 100%; border-radius: inherit; background: var(--bxf-accent); transition: width 1s linear; }

.bxf-qrCopy h3 { font-size: 20px; line-height: 29px; font-weight: 650; }
.bxf-qrCopy > p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 7px; }

.bxf-steps { counter-reset: bxf-step; display: flex; flex-direction: column; gap: 11px; margin: 20px 0 0; padding: 0; list-style: none; }
.bxf-steps li { counter-increment: bxf-step; display: grid; grid-template-columns: 23px minmax(0, 1fr); align-items: start; gap: 9px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 19px; }
.bxf-steps li::before { content: counter(bxf-step); width: 21px; height: 21px; display: grid; place-items: center; border: 1px solid var(--dsw-alias-border-l2, #dee0e3); border-radius: 50%; color: var(--dsw-alias-label-primary, #1f2329); background: var(--dsw-alias-bg-layer-1, #fff); font-size: 10px; font-weight: 650; }

.bxf-connecting { min-height: 292px; display: grid; place-items: center; text-align: center; padding: 36px 24px; }
.bxf-connectingCopy { max-width: 430px; }
.bxf-orbit { position: relative; width: 86px; height: 86px; display: grid; place-items: center; margin: 0 auto 22px; }
.bxf-orbit::before, .bxf-orbit::after { content: ""; position: absolute; border-radius: 50%; }
.bxf-orbit::before { inset: 3px; border: 1px solid color-mix(in srgb, var(--bxf-accent) 24%, transparent); animation: bxf-pulse 1.8s var(--ds-ease-in-out, ease) infinite; }
.bxf-orbit::after { inset: 0; border: 2px solid transparent; border-top-color: var(--bxf-accent); animation: bxf-rotate 1.2s linear infinite; }
.bxf-orbitCore { width: 50px; height: 50px; display: grid; place-items: center; border-radius: 16px; color: var(--bxf-accent); background: color-mix(in srgb, var(--bxf-accent) 9%, var(--dsw-alias-bg-layer-1, #fff)); }
.bxf-connecting h3 { font-size: 20px; line-height: 29px; }
.bxf-connecting p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 7px; }
.bxf-connectingCompact { min-height: 248px; }

.bxf-inlineError {
  min-height: 190px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-content: center;
  gap: 15px;
  padding: 28px;
}

.bxf-inlineError h3 { font-size: 17px; line-height: 25px; margin: 0; }
.bxf-inlineError p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 5px; overflow-wrap: anywhere; }

.bxf-listSection { display: flex; flex-direction: column; gap: 10px; }
.bxf-listHeading { min-height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 2px; }
.bxf-listHeading h3 { font-size: 14px; line-height: 22px; font-weight: 650; margin: 0; }
.bxf-listHeading span { color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 12px; }
.bxf-botList { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }
.bxf-botList > li { min-width: 0; }
.bxf-botCard:focus { outline: none; }
.bxf-botCard:focus-visible { outline: 2px solid var(--bxf-accent); outline-offset: 2px; }

.bxf-connectedTop { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.bxf-botIdentity { min-width: 0; display: flex; align-items: center; gap: 13px; }
.bxf-avatar { flex: none; width: 48px; height: 48px; display: grid; place-items: center; overflow: hidden; border-radius: 14px; color: var(--bxf-accent); background: color-mix(in srgb, var(--bxf-accent) 9%, var(--dsw-alias-bg-layer-1, #fff)); }
.bxf-avatar img { width: 100%; height: 100%; object-fit: cover; }
.bxf-botName { min-width: 0; }
.bxf-botName h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; line-height: 24px; font-weight: 650; }
.bxf-botName p { color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 12px; line-height: 18px; margin-top: 2px; }

.bxf-healthPill { flex: none; display: inline-flex; align-items: center; gap: 7px; min-height: 28px; border-radius: 999px; padding: 4px 10px; color: var(--bxf-success); background: color-mix(in srgb, var(--bxf-success) 10%, transparent); font-size: 12px; font-weight: 600; line-height: 18px; }
.bxf-healthPill[data-health="degraded"], .bxf-healthPill[data-health="checking"], .bxf-healthPill[data-health="connecting"] { color: var(--bxf-warning); background: color-mix(in srgb, var(--bxf-warning) 10%, transparent); }
.bxf-healthPill[data-health="offline"], .bxf-healthPill[data-health="error"] { color: var(--bxf-error); background: color-mix(in srgb, var(--bxf-error) 10%, transparent); }

.bxf-statusGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 22px; }
.bxf-metric { min-width: 0; border: 1px solid var(--dsw-alias-border-l2, #dee0e3); border-radius: 9px; padding: 12px 13px; background: var(--dsw-alias-bg-module-platform, #f7f8fa); }
.bxf-metric dt { color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 11px; line-height: 17px; }
.bxf-metric dd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; line-height: 18px; font-weight: 550; margin: 3px 0 0; }

.bxf-divider { height: 1px; background: var(--dsw-alias-border-l2, #dee0e3); margin: 22px 0 0; }
.bxf-connectedFooter { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 17px; }
.bxf-healthSummary { min-width: 0; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 18px; }
.bxf-healthSummary strong { color: var(--dsw-alias-label-primary, #1f2329); font-weight: 600; }
.bxf-healthSummary[data-error="true"] { color: var(--bxf-error); }
.bxf-botActions { margin-top: 0; justify-content: flex-end; }

.bxf-confirm {
  border-top: 1px solid var(--dsw-alias-border-l2, #dee0e3);
  background: color-mix(in srgb, var(--bxf-error) 4%, var(--dsw-alias-bg-module-platform, #f7f8fa));
  padding: 17px 24px 20px;
}
.bxf-confirm:focus { outline: none; }
.bxf-confirm h4 { font-size: 13px; line-height: 20px; margin: 0; }
.bxf-confirm p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 19px; margin: 4px 0 0; }
.bxf-confirm .bxf-actions { margin-top: 12px; }

.bxf-error { min-height: 252px; display: grid; grid-template-columns: 44px minmax(0, 1fr); align-content: center; gap: 15px; padding: 30px; }
.bxf-errorIcon { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 13px; color: var(--bxf-error); background: color-mix(in srgb, var(--bxf-error) 9%, transparent); }
.bxf-error h3 { font-size: 17px; line-height: 25px; }
.bxf-error p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 5px; overflow-wrap: anywhere; }
.bxf-errorCode { display: inline-block; color: var(--dsw-alias-label-tertiary, #8f959e); font-family: var(--ds-font-family-code, monospace); font-size: 11px; margin-top: 7px; }

.bxf-statusNotice {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid color-mix(in srgb, var(--bxf-warning) 28%, var(--dsw-alias-border-l2, #dee0e3));
  border-radius: 10px;
  padding: 9px 11px;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: color-mix(in srgb, var(--bxf-warning) 5%, var(--dsw-alias-bg-layer-1, #fff));
  font-size: 12px;
  line-height: 18px;
}
.bxf-statusNotice > svg { flex: none; color: var(--bxf-warning); }
.bxf-statusNotice > span { min-width: 0; flex: 1; overflow-wrap: anywhere; }

.bxf-skeleton { min-height: 260px; padding: 28px; }
.bxf-skeletonLine { height: 12px; border-radius: 999px; background: linear-gradient(90deg, var(--dsw-alias-bg-module-platform, #f2f3f5), color-mix(in srgb, var(--dsw-alias-label-tertiary, #8f959e) 10%, transparent), var(--dsw-alias-bg-module-platform, #f2f3f5)); background-size: 220% 100%; animation: bxf-shimmer 1.5s linear infinite; }
.bxf-skeletonLine:nth-child(1) { width: 92px; }
.bxf-skeletonLine:nth-child(2) { width: 44%; height: 22px; margin-top: 23px; }
.bxf-skeletonLine:nth-child(3) { width: 72%; margin-top: 14px; }
.bxf-skeletonLine:nth-child(4) { width: 58%; margin-top: 9px; }
.bxf-skeletonBox { width: 138px; height: 38px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform, #f2f3f5); margin-top: 28px; }

.bxf-visuallyHidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@keyframes bxf-rotate { to { transform: rotate(360deg); } }
@keyframes bxf-pulse { 0%, 100% { transform: scale(.9); opacity: .45; } 50% { transform: scale(1.08); opacity: 1; } }
@keyframes bxf-shimmer { to { background-position: -220% 0; } }

@container (max-width: 620px) {
  .bxf-heading { flex-direction: column; gap: 10px; }
  .bxf-headingTools { width: 100%; justify-content: flex-start; }
  .bxf-headingTools .bxf-button { margin-left: auto; }
}

@media (max-width: 680px) {
  .bxf-heading { flex-direction: column; gap: 10px; }
  .bxf-headingTools { width: 100%; justify-content: flex-start; }
  .bxf-headingTools .bxf-button { margin-left: auto; }
  .bxf-intro { grid-template-columns: minmax(0, 1fr); }
  .bxf-markStage { display: none; }
  .bxf-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  .bxf-qrCopy { width: 100%; }
  .bxf-statusGrid { grid-template-columns: minmax(0, 1fr); }
  .bxf-connectedTop, .bxf-connectedFooter { align-items: flex-start; flex-direction: column; }
  .bxf-botActions { width: 100%; justify-content: flex-start; }
  .bxf-botActions .bxf-button { min-height: 44px; }
  .bxf-inlineError { grid-template-columns: minmax(0, 1fr); padding: 20px; }
  .bxf-statusNotice { align-items: flex-start; flex-wrap: wrap; }
  .bxf-cardBody { padding: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .bxf-page *, .bxf-page *::before, .bxf-page *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
`;
function installFeishuStyles() {
  if (typeof document === "undefined") {
    return () => {
    };
  }
  const existing = document.querySelector(
    `style[data-plugin-css="${FEISHU_STYLE_ID}"]`
  );
  if (existing) {
    return () => {
    };
  }
  const style = document.createElement("style");
  style.dataset.plugin = "dsh-feishu-integration";
  style.dataset.pluginCss = FEISHU_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}

// plugin-src/client/index.js
var h = React.createElement;
var name = "feishu-settings";
var inject = ["slots", "connection"];
function SvgIcon({ children, size = 18, className, viewBox = "0 0 24 24" }) {
  return h("svg", {
    width: size,
    height: size,
    viewBox,
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
    focusable: "false",
    className
  }, children);
}
function ShieldIcon({ size = 18 }) {
  return h(
    SvgIcon,
    { size },
    h("path", {
      d: "M12 3 5.5 5.8v5.1c0 4.25 2.72 7.87 6.5 9.1 3.78-1.23 6.5-4.85 6.5-9.1V5.8L12 3Z",
      stroke: "currentColor",
      strokeWidth: "1.7",
      strokeLinejoin: "round"
    }),
    h("path", {
      d: "m9.3 11.8 1.7 1.7 3.8-4",
      stroke: "currentColor",
      strokeWidth: "1.7",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    })
  );
}
function RobotIcon({ size = 26 }) {
  return h(
    SvgIcon,
    { size },
    h("rect", {
      x: "5",
      y: "7.5",
      width: "14",
      height: "11",
      rx: "4",
      stroke: "currentColor",
      strokeWidth: "1.7"
    }),
    h("path", {
      d: "M12 4.5v3M8.7 12h.01M15.3 12h.01M9.2 15.3c1.67 1.08 3.93 1.08 5.6 0M3.5 11.5v3M20.5 11.5v3",
      stroke: "currentColor",
      strokeWidth: "1.7",
      strokeLinecap: "round"
    })
  );
}
function SparkIcon({ size = 18 }) {
  return h(
    SvgIcon,
    { size },
    h("path", {
      d: "M12 2.8c.75 3.67 2.7 5.62 6.4 6.4-3.7.77-5.65 2.72-6.4 6.4-.75-3.68-2.7-5.63-6.4-6.4 3.7-.78 5.65-2.73 6.4-6.4Z",
      stroke: "currentColor",
      strokeWidth: "1.55",
      strokeLinejoin: "round"
    }),
    h("path", {
      d: "M5.2 15.8c.35 1.7 1.28 2.63 3 3-1.72.36-2.65 1.29-3 3-.36-1.71-1.29-2.64-3-3 1.71-.37 2.64-1.3 3-3ZM18.7 2.7c.22 1.06.79 1.63 1.85 1.85-1.06.22-1.63.79-1.85 1.85-.22-1.06-.79-1.63-1.85-1.85 1.06-.22 1.63-.79 1.85-1.85Z",
      fill: "currentColor"
    })
  );
}
function PlusIcon({ size = 17 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M12 5v14M5 12h14",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }));
}
function RefreshIcon({ size = 16 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M19 7.5V4m0 0h-3.5M19 4l-2.1 2.1A7 7 0 1 0 19 13",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }));
}
function ExternalIcon({ size = 15 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M13 5h6v6M19 5l-8.5 8.5M18 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }));
}
function AlertIcon({ size = 22 }) {
  return h(
    SvgIcon,
    { size },
    h("path", {
      d: "M12 3.4 21 19H3L12 3.4Z",
      stroke: "currentColor",
      strokeWidth: "1.7",
      strokeLinejoin: "round"
    }),
    h("path", {
      d: "M12 9v4.4M12 16.6v.01",
      stroke: "currentColor",
      strokeWidth: "1.9",
      strokeLinecap: "round"
    })
  );
}
function QrIcon({ size = 58 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v4h-2v-4Zm-4 4h4v2h-4v-2Z",
    fill: "currentColor"
  }));
}
var Button = React.forwardRef(function Button2({ children, kind = "secondary", size, icon, className = "", ...props }, ref) {
  return h("button", {
    ...props,
    ref,
    type: "button",
    className: `bxf-button ${className}`.trim(),
    "data-kind": kind,
    "data-size": size
  }, icon, h("span", null, children));
});
function BrandMark({ compact = false }) {
  return h(
    "div",
    { className: compact ? "bxf-avatar" : "bxf-brandMark" },
    h(RobotIcon, { size: compact ? 25 : 34 })
  );
}
function Heading({ totals, onAdd, adding, busy, addButtonRef }) {
  const hasBots = totals.configured > 0;
  return h(
    "div",
    { className: "bxf-heading" },
    h(
      "div",
      { className: "bxf-headingCopy" },
      h("div", { className: "bxf-eyebrow" }, "Channel"),
      h("h2", null, "\u98DE\u4E66\u673A\u5668\u4EBA"),
      h("p", null, "\u901A\u8FC7\u626B\u7801\u628A\u98DE\u4E66\u673A\u5668\u4EBA\u63A5\u5165DeepSeek Harness")
    ),
    h(
      "div",
      { className: "bxf-headingTools" },
      hasBots ? h("div", {
        className: "bxf-totalBadge",
        "aria-label": `\u5DF2\u63A5\u5165 ${totals.configured} \u4E2A\u673A\u5668\u4EBA\uFF0C\u5176\u4E2D ${totals.connected} \u4E2A\u5728\u7EBF`
      }, h("strong", null, totals.connected), h("span", null, `/ ${totals.configured} \u5728\u7EBF`)) : null,
      h("div", {
        className: "bxf-localBadge",
        title: "\u6BCF\u4E2A\u5E94\u7528\u7684\u51ED\u636E\u5747\u7531 Host \u72EC\u7ACB\u4FDD\u5B58\uFF0C\u4E0D\u4F1A\u53D1\u9001\u5230\u6D4F\u89C8\u5668"
      }, h(ShieldIcon, { size: 14 }), h("span", null, "\u51ED\u636E\u4EC5\u4FDD\u5B58\u5728\u672C\u673A")),
      h(Button, {
        kind: "primary",
        size: "small",
        icon: h(PlusIcon),
        onClick: onAdd,
        disabled: adding || busy,
        ref: addButtonRef,
        "aria-busy": busy ? "true" : void 0
      }, adding ? "\u6B63\u5728\u6DFB\u52A0" : "\u6DFB\u52A0\u673A\u5668\u4EBA")
    )
  );
}
function LoadingView() {
  return h("div", {
    className: "bxf-card",
    "aria-busy": "true",
    "aria-label": "\u6B63\u5728\u8BFB\u53D6\u98DE\u4E66\u673A\u5668\u4EBA\u5217\u8868"
  }, h(
    "div",
    { className: "bxf-skeleton" },
    h("div", { className: "bxf-skeletonLine" }),
    h("div", { className: "bxf-skeletonLine" }),
    h("div", { className: "bxf-skeletonLine" }),
    h("div", { className: "bxf-skeletonLine" }),
    h("div", { className: "bxf-skeletonBox" })
  ));
}
function EmptyView({ onStart, busy }) {
  return h(
    "div",
    { className: "bxf-card" },
    h(
      "div",
      { className: "bxf-cardBody bxf-intro" },
      h(
        "div",
        { className: "bxf-introCopy" },
        h(
          "div",
          { className: "bxf-stateLabel" },
          h("span", { className: "bxf-dot" }),
          h("span", null, "\u5C1A\u672A\u63A5\u5165\u673A\u5668\u4EBA")
        ),
        h("h3", null, "\u626B\u7801\uFF0C\u521B\u5EFA\u7B2C\u4E00\u4E2A\u98DE\u4E66\u5165\u53E3"),
        h("p", null, "\u65E0\u9700\u624B\u52A8\u586B\u5199 App ID\u3002\u4EE5\u540E\u8FD8\u53EF\u4EE5\u7EE7\u7EED\u6DFB\u52A0\u673A\u5668\u4EBA\uFF0C\u5206\u522B\u670D\u52A1\u4E0D\u540C\u56E2\u961F\u6216\u98DE\u4E66\u79DF\u6237\u3002"),
        h(
          "div",
          { className: "bxf-actions" },
          h(Button, {
            kind: "primary",
            icon: h(SparkIcon),
            onClick: onStart,
            disabled: busy,
            "aria-busy": busy ? "true" : void 0
          }, busy ? "\u6B63\u5728\u521B\u5EFA\u2026" : "\u4E00\u952E\u521B\u5EFA\u98DE\u4E66\u673A\u5668\u4EBA")
        ),
        h(
          "div",
          { className: "bxf-note" },
          h(ShieldIcon, { size: 16 }),
          h("span", null, "\u6BCF\u4E2A App Secret \u90FD\u53EA\u5199\u5165 Host \u51ED\u636E\u5B58\u50A8\uFF0C\u6D4F\u89C8\u5668\u4E0D\u4F1A\u6536\u5230 Secret\u3002")
        )
      ),
      h("div", { className: "bxf-markStage", "aria-hidden": "true" }, h(BrandMark))
    )
  );
}
function safeVerificationHref(value) {
  if (!value) return void 0;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : void 0;
  } catch {
    return void 0;
  }
}
function safeQrSource(value) {
  if (!value) return void 0;
  return /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value) ? value : void 0;
}
function QrPane({ provision, now, onRefresh, onCancel, busy }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const qrSource = safeQrSource(provision.qrCodeDataUrl);
  const href = safeVerificationHref(provision.verificationUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = provision.expired === true || remaining === 0;
  const progress = Math.min(1, remaining / Math.max(1, provision.durationMs ?? remaining));
  React.useEffect(() => setImageFailed(false), [qrSource]);
  return h(
    "div",
    { className: "bxf-card bxf-provisionCard" },
    h(
      "div",
      { className: "bxf-cardBody bxf-qrLayout" },
      h(
        "div",
        { className: "bxf-qrColumn" },
        h(
          "div",
          { className: "bxf-qrFrame" },
          qrSource && !imageFailed ? h("img", {
            src: qrSource,
            alt: "\u7528\u4E8E\u65B0\u589E DeepSeek Harness \u98DE\u4E66\u673A\u5668\u4EBA\u7684\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801",
            onError: () => setImageFailed(true)
          }) : h(
            "div",
            { className: "bxf-qrFallback" },
            h("div", null, h(QrIcon), h("span", null, "\u4E8C\u7EF4\u7801\u672A\u5C31\u7EEA\uFF0C\u8BF7\u6253\u5F00\u6388\u6743\u94FE\u63A5"))
          ),
          expired ? h(
            "div",
            { className: "bxf-expiredOverlay", role: "status" },
            h("div", null, "\u4E8C\u7EF4\u7801\u5DF2\u5931\u6548", h("br"), "\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u626B\u7801")
          ) : null
        ),
        h(
          "div",
          {
            className: "bxf-countdown",
            "aria-label": expired ? "\u4E8C\u7EF4\u7801\u5DF2\u5931\u6548" : `\u4E8C\u7EF4\u7801\u5269\u4F59 ${formatRemaining(remaining)}`
          },
          h(
            "div",
            { className: "bxf-countdownTop", "aria-hidden": "true" },
            h("span", null, expired ? "\u7B49\u5F85\u5237\u65B0" : "\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4"),
            h("strong", null, formatRemaining(remaining))
          ),
          h(
            "div",
            { className: "bxf-progress", "aria-hidden": "true" },
            h("span", { style: { "--bxf-progress": `${Math.round(progress * 100)}%` } })
          )
        )
      ),
      h(
        "div",
        { className: "bxf-qrCopy" },
        h(
          "div",
          { className: "bxf-stateLabel" },
          h("span", { className: "bxf-dot", "data-tone": "warning" }),
          h("span", null, "\u6B63\u5728\u6DFB\u52A0\u65B0\u673A\u5668\u4EBA")
        ),
        h("h3", null, expired ? "\u5237\u65B0\u4E8C\u7EF4\u7801\u540E\u7EE7\u7EED" : "\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u521B\u5EFA\u673A\u5668\u4EBA"),
        h("p", null, "\u626B\u7801\u53EA\u4F1A\u65B0\u589E\u4E00\u4E2A\u673A\u5668\u4EBA\uFF0C\u5DF2\u63A5\u5165\u7684\u673A\u5668\u4EBA\u4F1A\u7EE7\u7EED\u6B63\u5E38\u6536\u53D1\u6D88\u606F\u3002"),
        h(
          "ol",
          { className: "bxf-steps" },
          h("li", null, "\u6253\u5F00\u98DE\u4E66\u79FB\u52A8\u7AEF\uFF0C\u4F7F\u7528\u626B\u4E00\u626B\u8BFB\u53D6\u4E8C\u7EF4\u7801"),
          h("li", null, "\u6838\u5BF9\u5E94\u7528\u540D\u79F0\u4E0E\u6743\u9650\u8303\u56F4\uFF0C\u5E76\u786E\u8BA4\u521B\u5EFA"),
          h("li", null, "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u65B0\u673A\u5668\u4EBA\u7684\u957F\u8FDE\u63A5\u5C31\u7EEA")
        ),
        h(
          "div",
          { className: "bxf-actions" },
          expired ? h(Button, {
            kind: "primary",
            icon: h(RefreshIcon),
            onClick: onRefresh,
            disabled: busy
          }, busy ? "\u5237\u65B0\u4E2D\u2026" : "\u5237\u65B0\u4E8C\u7EF4\u7801") : href ? h("a", {
            className: "bxf-button bxf-link",
            "data-kind": "secondary",
            href,
            target: "_blank",
            rel: "noopener noreferrer"
          }, h(ExternalIcon), h("span", null, "\u5728\u98DE\u4E66\u4E2D\u6253\u5F00")) : null,
          !expired ? h(Button, { icon: h(RefreshIcon), onClick: onRefresh, disabled: busy }, "\u6362\u4E00\u4E2A\u4E8C\u7EF4\u7801") : null,
          h(Button, { onClick: onCancel, disabled: busy }, "\u53D6\u6D88\u6DFB\u52A0")
        )
      )
    )
  );
}
function ProvisionProgress({ phase, onCancel, busy }) {
  const connecting = phase === "connecting";
  return h(
    "div",
    { className: "bxf-card bxf-provisionCard", "aria-busy": "true" },
    h(
      "div",
      { className: "bxf-connecting bxf-connectingCompact" },
      h(
        "div",
        { className: "bxf-connectingCopy" },
        h(
          "div",
          { className: "bxf-orbit" },
          h(
            "div",
            { className: "bxf-orbitCore" },
            connecting ? h(RobotIcon, { size: 24 }) : h(SparkIcon, { size: 24 })
          )
        ),
        h("h3", null, connecting ? "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u8FDE\u63A5\u65B0\u673A\u5668\u4EBA" : "\u6B63\u5728\u51C6\u5907\u6388\u6743\u4E8C\u7EF4\u7801"),
        h("p", null, connecting ? "\u6B63\u5728\u5B89\u5168\u4FDD\u5B58\u51ED\u636E\u5E76\u68C0\u67E5\u65B0\u673A\u5668\u4EBA\u7684\u6D88\u606F\u901A\u9053\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002" : "\u6B63\u5728\u5411\u98DE\u4E66\u7533\u8BF7\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u7A0D\u5019\u3002"),
        connecting ? h(
          "div",
          { className: "bxf-actions", style: { justifyContent: "center" } },
          h(Button, { onClick: onCancel, disabled: busy }, "\u53D6\u6D88\u6DFB\u52A0")
        ) : null
      )
    )
  );
}
function ProvisionError({ error, onRetry, onCancel, busy }) {
  return h(
    "div",
    { className: "bxf-card bxf-provisionCard" },
    h(
      "div",
      { className: "bxf-inlineError", role: "alert" },
      h("div", { className: "bxf-errorIcon" }, h(AlertIcon)),
      h(
        "div",
        null,
        h("h3", null, "\u65B0\u673A\u5668\u4EBA\u6CA1\u6709\u6DFB\u52A0\u5B8C\u6210"),
        h("p", null, error.message),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h(
          "div",
          { className: "bxf-actions" },
          h(
            Button,
            { kind: "primary", icon: h(RefreshIcon), onClick: onRetry, disabled: busy },
            busy ? "\u91CD\u8BD5\u4E2D\u2026" : "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"
          ),
          h(Button, { onClick: onCancel, disabled: busy }, "\u5173\u95ED")
        )
      )
    )
  );
}
var HEALTH_LABELS = {
  connected: "\u8FD0\u884C\u6B63\u5E38",
  connecting: "\u6B63\u5728\u8FDE\u63A5",
  offline: "\u8FDE\u63A5\u4E2D\u65AD",
  error: "\u9700\u8981\u5904\u7406"
};
function formatCheckedTime(timestamp) {
  if (!timestamp) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(timestamp));
  } catch {
    return "\u521A\u521A";
  }
}
function RemoveConfirmation({ bot, busy, onConfirm, onCancel }) {
  const cancelRef = React.useRef(null);
  const idPart = bot.botId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const titleId = `bxf-remove-title-${idPart}`;
  const descriptionId = `bxf-remove-description-${idPart}`;
  React.useEffect(() => cancelRef.current?.focus(), []);
  return h(
    "div",
    {
      className: "bxf-confirm",
      role: "alertdialog",
      "aria-labelledby": titleId,
      "aria-describedby": descriptionId,
      onKeyDown: (event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onCancel();
        }
      }
    },
    h("h4", { id: titleId }, `\u4ECE DeepSeek Harness \u79FB\u9664\u201C${bot.bot.name}\u201D\uFF1F`),
    h(
      "p",
      { id: descriptionId },
      "\u6B64\u64CD\u4F5C\u4F1A\u505C\u6B62\u8FD9\u4E2A\u673A\u5668\u4EBA\u7684\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u4FDD\u5B58\u5728\u672C\u673A\u7684\u63A5\u5165\u914D\u7F6E\u548C\u51ED\u636E\u3002\u98DE\u4E66\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u5E94\u7528\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E5F\u4E0D\u53D7\u5F71\u54CD\u3002"
    ),
    h(
      "div",
      { className: "bxf-actions" },
      h(Button, { ref: cancelRef, onClick: onCancel, disabled: busy }, "\u4FDD\u7559\u673A\u5668\u4EBA"),
      h(
        Button,
        { kind: "danger", onClick: onConfirm, disabled: busy },
        busy ? "\u6B63\u5728\u79FB\u9664\u2026" : "\u786E\u8BA4\u79FB\u9664\u63A5\u5165"
      )
    )
  );
}
function BotCard({
  connection,
  busy,
  actionError,
  removing,
  onReconnect,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
  cardRef,
  removeButtonRef
}) {
  const { bot, health, state, connected } = connection;
  const stateForDisplay = busy === "reconnect" ? "connecting" : state;
  const tone = stateForDisplay === "connected" ? "success" : stateForDisplay === "connecting" ? "warning" : "error";
  const summary = actionError?.message ?? connection.error?.message ?? health.summary;
  const titleId = `bxf-bot-${connection.botId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const domainLabel = bot.domain === "lark" ? "Lark" : "\u98DE\u4E66";
  return h(
    "article",
    {
      className: "bxf-card bxf-botCard",
      "aria-labelledby": titleId,
      "data-bot-id": connection.botId,
      tabIndex: -1,
      ref: cardRef
    },
    h(
      "div",
      { className: "bxf-cardBody" },
      h(
        "div",
        { className: "bxf-connectedTop" },
        h(
          "div",
          { className: "bxf-botIdentity" },
          bot.avatarUrl ? h("div", { className: "bxf-avatar" }, h("img", { src: bot.avatarUrl, alt: "" })) : h(BrandMark, { compact: true }),
          h(
            "div",
            { className: "bxf-botName" },
            h("h3", { id: titleId, title: bot.name }, bot.name),
            h("p", null, bot.tenantName ? `${bot.tenantName} \xB7 ${domainLabel}\u673A\u5668\u4EBA` : `${domainLabel}\u673A\u5668\u4EBA`)
          )
        ),
        h(
          "div",
          { className: "bxf-healthPill", "data-health": stateForDisplay },
          h("span", { className: "bxf-dot", "data-tone": tone }),
          h("span", null, HEALTH_LABELS[stateForDisplay] ?? "\u72B6\u6001\u672A\u77E5")
        )
      ),
      h(
        "dl",
        { className: "bxf-statusGrid" },
        h(
          "div",
          { className: "bxf-metric" },
          h("dt", null, "\u6D88\u606F\u901A\u9053"),
          h("dd", null, connected ? "\u957F\u8FDE\u63A5" : stateForDisplay === "connecting" ? "\u8FDE\u63A5\u4E2D" : "\u5DF2\u65AD\u5F00")
        ),
        h(
          "div",
          { className: "bxf-metric" },
          h("dt", null, "\u5E94\u7528\u6807\u8BC6"),
          h("dd", { title: bot.appIdMasked }, bot.appIdMasked ?? "\u5DF2\u5B89\u5168\u4FDD\u5B58")
        ),
        h(
          "div",
          { className: "bxf-metric" },
          h("dt", null, "\u6700\u8FD1\u68C0\u67E5"),
          h("dd", null, formatCheckedTime(health.lastCheckedAt))
        )
      ),
      h("div", { className: "bxf-divider" }),
      h(
        "div",
        { className: "bxf-connectedFooter" },
        h(
          "div",
          { className: "bxf-healthSummary", "data-error": actionError || connection.error ? "true" : void 0 },
          h("strong", null, "\u8FDE\u63A5\u72B6\u6001\uFF1A"),
          h("span", null, summary)
        ),
        h(
          "div",
          { className: "bxf-actions bxf-botActions" },
          h(Button, {
            size: "small",
            icon: h(RefreshIcon),
            onClick: onReconnect,
            disabled: Boolean(busy),
            "aria-busy": busy === "reconnect" ? "true" : void 0,
            "aria-label": `${connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"}${bot.name}`
          }, busy === "reconnect" ? connected ? "\u68C0\u67E5\u4E2D\u2026" : "\u6B63\u5728\u8FDE\u63A5\u2026" : connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"),
          h(Button, {
            size: "small",
            kind: "danger",
            onClick: onRequestRemove,
            disabled: Boolean(busy),
            ref: removeButtonRef,
            "aria-label": `\u4ECE DeepSeek Harness \u79FB\u9664${bot.name}`
          }, "\u79FB\u9664\u63A5\u5165")
        )
      )
    ),
    removing ? h(RemoveConfirmation, {
      bot: connection,
      busy: busy === "delete",
      onConfirm: onConfirmRemove,
      onCancel: onCancelRemove
    }) : null
  );
}
function BotList(props) {
  return h(
    "section",
    { className: "bxf-listSection", "aria-labelledby": "bxf-bot-list-title" },
    h(
      "div",
      { className: "bxf-listHeading" },
      h("h3", { id: "bxf-bot-list-title" }, "\u5DF2\u63A5\u5165\u7684\u673A\u5668\u4EBA"),
      h("span", null, `${props.bots.length} \u4E2A`)
    ),
    h(
      "ul",
      { className: "bxf-botList", role: "list" },
      props.bots.map((bot) => h(
        "li",
        { key: bot.botId },
        h(BotCard, {
          connection: bot,
          busy: props.busyByBot[bot.botId],
          actionError: props.errorsByBot[bot.botId],
          removing: props.removeTargetId === bot.botId,
          onReconnect: () => props.onReconnect(bot),
          onRequestRemove: () => props.onRequestRemove(bot),
          onConfirmRemove: () => props.onConfirmRemove(bot),
          onCancelRemove: props.onCancelRemove,
          cardRef: (node) => props.setCardRef(bot.botId, node),
          removeButtonRef: (node) => props.setRemoveButtonRef(bot.botId, node)
        })
      ))
    )
  );
}
function PageError({ error, onRetry, busy }) {
  return h(
    "div",
    { className: "bxf-card" },
    h(
      "div",
      { className: "bxf-error", role: "alert" },
      h("div", { className: "bxf-errorIcon" }, h(AlertIcon)),
      h(
        "div",
        null,
        h("h3", null, "\u65E0\u6CD5\u8BFB\u53D6\u98DE\u4E66\u673A\u5668\u4EBA"),
        h("p", null, error.message),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h(
          "div",
          { className: "bxf-actions" },
          h(
            Button,
            { kind: "primary", icon: h(RefreshIcon), onClick: onRetry, disabled: busy },
            busy ? "\u91CD\u8BD5\u4E2D\u2026" : "\u91CD\u65B0\u8BFB\u53D6"
          )
        )
      )
    )
  );
}
var EMPTY_TOTALS = Object.freeze({ configured: 0, connected: 0 });
function FeishuSettingsTab({ rpcCall }) {
  const [model, setModel] = React.useState({
    phase: "loading",
    revision: 0,
    bots: [],
    totals: EMPTY_TOTALS,
    provisioning: null,
    pageError: null,
    statusError: null
  });
  const [pageBusy, setPageBusy] = React.useState(false);
  const [provisionBusy, setProvisionBusy] = React.useState(false);
  const [busyByBot, setBusyByBot] = React.useState({});
  const [errorsByBot, setErrorsByBot] = React.useState({});
  const [removeTargetId, setRemoveTargetId] = React.useState(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [now, setNow] = React.useState(() => Date.now());
  const [focusBotId, setFocusBotId] = React.useState(null);
  const cardRefs = React.useRef(/* @__PURE__ */ new Map());
  const removeButtonRefs = React.useRef(/* @__PURE__ */ new Map());
  const addButtonRef = React.useRef(null);
  const announce = React.useCallback((message) => {
    setAnnouncement("");
    if (!message) return;
    window.requestAnimationFrame(() => setAnnouncement(message));
  }, []);
  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    return unwrapRpcResult(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const mergeSnapshot = React.useCallback((snapshot, { restoreProvisioning = true } = {}) => {
    setModel((current) => {
      if (snapshot.revision > 0 && current.revision > snapshot.revision) return current;
      let provisioning = current.provisioning;
      if (!provisioning && restoreProvisioning && snapshot.provisioning) {
        provisioning = {
          phase: snapshot.state === "connecting" ? "connecting" : "qr",
          ...snapshot.provisioning,
          durationMs: Math.max(1, snapshot.provisioning.expiresAt - Date.now()),
          expired: snapshot.provisioning.expiresAt <= Date.now()
        };
      }
      return {
        ...current,
        phase: "ready",
        revision: snapshot.revision,
        bots: snapshot.bots,
        totals: snapshot.totals,
        provisioning,
        pageError: null,
        statusError: null
      };
    });
  }, []);
  const loadStatus = React.useCallback(async ({ signal, silent = false, restoreProvisioning = true } = {}) => {
    if (!silent) setPageBusy(true);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(FEISHU_ENDPOINTS.status, {}, signal));
      mergeSnapshot(snapshot, { restoreProvisioning });
      return snapshot;
    } catch (error) {
      if (error?.name === "AbortError") return void 0;
      const presented = presentError(error);
      setModel((current) => current.phase === "loading" || !silent ? { ...current, phase: "error", pageError: presented } : { ...current, statusError: presented });
      return void 0;
    } finally {
      if (!silent) setPageBusy(false);
    }
  }, [invoke, mergeSnapshot]);
  React.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal });
    return () => controller.abort();
  }, [loadStatus]);
  React.useEffect(() => {
    if (model.phase !== "ready") return void 0;
    const controller = new AbortController();
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      await loadStatus({ signal: controller.signal, silent: true });
      inFlight = false;
    }, 15e3);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);
  React.useEffect(() => {
    if (!focusBotId) return;
    const node = cardRefs.current.get(focusBotId);
    if (!node) return;
    node.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    node.focus({ preventScroll: true });
    setFocusBotId(null);
  }, [focusBotId, model.bots]);
  const startProvisioning = React.useCallback(async ({ replace = false } = {}) => {
    setProvisionBusy(true);
    announce("");
    const previousAttemptId = model.provisioning?.attemptId;
    setModel((current) => ({
      ...current,
      phase: current.phase === "loading" ? "ready" : current.phase,
      provisioning: { phase: "creating" }
    }));
    try {
      if (replace && previousAttemptId) {
        await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId: previousAttemptId });
      }
      const provision2 = normalizeProvisioning(await invoke(
        FEISHU_ENDPOINTS.beginProvisioning,
        { locale: "zh-CN" }
      ));
      const timestamp = Date.now();
      setNow(timestamp);
      setModel((current) => ({
        ...current,
        provisioning: {
          phase: "qr",
          ...provision2,
          durationMs: Math.max(1, provision2.expiresAt - timestamp),
          expired: false
        }
      }));
      announce("\u6388\u6743\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u3002");
    } catch (error) {
      setModel((current) => ({
        ...current,
        provisioning: { phase: "error", error: presentError(error) }
      }));
    } finally {
      setProvisionBusy(false);
    }
  }, [announce, invoke, model.provisioning?.attemptId]);
  const cancelProvisioning = React.useCallback(async () => {
    const attemptId = model.provisioning?.attemptId;
    setProvisionBusy(true);
    try {
      if (attemptId) await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId });
      setModel((current) => ({ ...current, provisioning: null }));
      announce("\u5DF2\u53D6\u6D88\u6DFB\u52A0\u673A\u5668\u4EBA\u3002");
      await loadStatus({ silent: true, restoreProvisioning: false });
      window.requestAnimationFrame(() => addButtonRef.current?.focus());
    } catch (error) {
      setModel((current) => ({
        ...current,
        provisioning: { phase: "error", attemptId, error: presentError(error) }
      }));
    } finally {
      setProvisionBusy(false);
    }
  }, [announce, invoke, loadStatus, model.provisioning?.attemptId]);
  React.useEffect(() => {
    const provision2 = model.provisioning;
    if (!provision2 || provision2.phase !== "qr" || provision2.expired) return void 0;
    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= provision2.expiresAt) {
        setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? { ...current, provisioning: { ...current.provisioning, expired: true } } : current);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1e3);
    return () => window.clearInterval(timer);
  }, [model.provisioning]);
  React.useEffect(() => {
    const provision2 = model.provisioning;
    if (!provision2 || !["qr", "connecting"].includes(provision2.phase) || !provision2.attemptId || provision2.expired) return void 0;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = normalizePollResult(await invoke(
          FEISHU_ENDPOINTS.pollProvisioning,
          { attemptId: provision2.attemptId },
          controller.signal
        ));
        if (result.status === "connected") {
          const snapshot = await loadStatus({ signal: controller.signal, silent: true, restoreProvisioning: false });
          const newBot = snapshot?.bots.find((bot) => bot.botId === result.botId);
          if (!snapshot) {
            throw new Error("\u673A\u5668\u4EBA\u5DF2\u7ECF\u521B\u5EFA\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u8FDE\u63A5\u72B6\u6001");
          }
          if (!newBot?.connected) {
            setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? { ...current, provisioning: { ...current.provisioning, phase: "connecting" } } : current);
            return;
          }
          setModel((current) => ({ ...current, provisioning: null }));
          announce(newBot ? `${newBot.bot.name}\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5728\u98DE\u4E66\u4E2D\u5F00\u59CB\u804A\u5929\u3002` : "\u65B0\u98DE\u4E66\u673A\u5668\u4EBA\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5F00\u59CB\u804A\u5929\u3002");
          if (result.botId) setFocusBotId(result.botId);
          return;
        }
        if (result.status === "failed") {
          const error = new Error(result.message ?? "\u98DE\u4E66\u5E94\u7528\u521B\u5EFA\u5931\u8D25");
          error.code = "FEISHU_PROVISION_FAILED";
          throw error;
        }
        if (result.status === "expired") {
          setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? { ...current, provisioning: { ...current.provisioning, phase: "qr", expired: true } } : current);
          return;
        }
        setModel((current) => {
          if (current.provisioning?.attemptId !== provision2.attemptId) return current;
          const next = result.provisioning ?? current.provisioning;
          return {
            ...current,
            provisioning: {
              ...current.provisioning,
              ...next,
              phase: ["scanned", "connecting"].includes(result.status) ? "connecting" : "qr"
            }
          };
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? {
          ...current,
          provisioning: {
            phase: "error",
            attemptId: provision2.attemptId,
            error: presentError(error)
          }
        } : current);
      }
    }, provision2.pollIntervalMs);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [announce, invoke, loadStatus, model.provisioning]);
  const setBotBusy = React.useCallback((botId, value) => {
    setBusyByBot((current) => {
      const next = { ...current };
      if (value) next[botId] = value;
      else delete next[botId];
      return next;
    });
  }, []);
  const setBotError = React.useCallback((botId, error) => {
    setErrorsByBot((current) => {
      const next = { ...current };
      if (error) next[botId] = presentError(error);
      else delete next[botId];
      return next;
    });
  }, []);
  const reconnectOneBot = React.useCallback(async (connection) => {
    const { botId, bot } = connection;
    setBotBusy(botId, "reconnect");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(FEISHU_ENDPOINTS.reconnectBot, { botId }));
      mergeSnapshot(snapshot);
      const refreshed = snapshot.bots.find((item) => item.botId === botId);
      if (!refreshed?.connected) {
        const error = new Error(
          refreshed?.error?.message ?? refreshed?.health.summary ?? "\u673A\u5668\u4EBA\u4ECD\u672A\u8FDE\u63A5"
        );
        error.code = refreshed?.error?.code ?? "FEISHU_BOT_OFFLINE";
        throw error;
      }
      announce(connection.connected ? `${bot.name}\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002` : `${bot.name}\u5DF2\u91CD\u65B0\u8FDE\u63A5\u3002`);
    } catch (error) {
      setBotError(botId, error);
      announce(`${bot.name}\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u673A\u5668\u4EBA\u72B6\u6001\u3002`);
    } finally {
      setBotBusy(botId, null);
    }
  }, [announce, invoke, mergeSnapshot, setBotBusy, setBotError]);
  const requestRemove = React.useCallback((connection) => {
    setRemoveTargetId(connection.botId);
  }, []);
  const cancelRemove = React.useCallback(() => {
    const botId = removeTargetId;
    setRemoveTargetId(null);
    window.requestAnimationFrame(() => removeButtonRefs.current.get(botId)?.focus());
  }, [removeTargetId]);
  const confirmRemove = React.useCallback(async (connection) => {
    const { botId, bot } = connection;
    setBotBusy(botId, "delete");
    setBotError(botId, null);
    try {
      await invoke(FEISHU_ENDPOINTS.deleteBot, { botId, confirm: true });
      setRemoveTargetId(null);
      setModel((current) => {
        const bots = current.bots.filter((item) => item.botId !== botId);
        return {
          ...current,
          bots,
          totals: {
            configured: bots.length,
            connected: bots.filter((item) => item.connected).length
          }
        };
      });
      announce(`${bot.name}\u5DF2\u4ECE\u6B64 DeepSeek Harness \u79FB\u9664\uFF1B\u98DE\u4E66\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u5E94\u7528\u672A\u88AB\u5220\u9664\u3002`);
      await loadStatus({ silent: true });
      window.requestAnimationFrame(() => addButtonRef.current?.focus());
    } catch (error) {
      setBotError(botId, error);
      announce(`${bot.name}\u79FB\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002`);
    } finally {
      setBotBusy(botId, null);
    }
  }, [announce, invoke, loadStatus, setBotBusy, setBotError]);
  const provision = model.provisioning;
  let provisionContent = null;
  if (provision?.phase === "creating") {
    provisionContent = h(ProvisionProgress, { phase: "creating", busy: provisionBusy });
  } else if (provision?.phase === "qr") {
    provisionContent = h(QrPane, {
      provision,
      now,
      onRefresh: () => void startProvisioning({ replace: true }),
      onCancel: () => void cancelProvisioning(),
      busy: provisionBusy || model.phase !== "ready"
    });
  } else if (provision?.phase === "connecting") {
    provisionContent = h(ProvisionProgress, {
      phase: "connecting",
      onCancel: () => void cancelProvisioning(),
      busy: provisionBusy
    });
  } else if (provision?.phase === "error") {
    provisionContent = h(ProvisionError, {
      error: provision.error,
      onRetry: () => void startProvisioning({ replace: Boolean(provision.attemptId) }),
      onCancel: () => void cancelProvisioning(),
      busy: provisionBusy
    });
  }
  const setCardRef = React.useCallback((botId, node) => {
    if (node) cardRefs.current.set(botId, node);
    else cardRefs.current.delete(botId);
  }, []);
  const setRemoveButtonRef = React.useCallback((botId, node) => {
    if (node) removeButtonRefs.current.set(botId, node);
    else removeButtonRefs.current.delete(botId);
  }, []);
  return h(
    "section",
    { className: "bxf-page", "aria-label": "\u98DE\u4E66\u673A\u5668\u4EBA\u8BBE\u7F6E" },
    h(Heading, {
      totals: model.totals,
      onAdd: () => void startProvisioning(),
      adding: Boolean(provision),
      busy: provisionBusy,
      addButtonRef
    }),
    h("div", {
      className: "bxf-visuallyHidden",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true"
    }, announcement),
    model.statusError ? h(
      "div",
      { className: "bxf-statusNotice", role: "status" },
      h(AlertIcon, { size: 16 }),
      h("span", null, `\u72B6\u6001\u81EA\u52A8\u5237\u65B0\u5931\u8D25\uFF1A${model.statusError.message}`),
      h(Button, { size: "small", onClick: () => void loadStatus({ silent: true }), disabled: pageBusy }, "\u7ACB\u5373\u91CD\u8BD5")
    ) : null,
    model.phase === "loading" ? h(LoadingView) : model.phase === "error" ? h(PageError, {
      error: model.pageError ?? { message: "\u65E0\u6CD5\u8BFB\u53D6\u8FDE\u63A5\u72B6\u6001" },
      onRetry: () => void loadStatus(),
      busy: pageBusy
    }) : h(
      React.Fragment,
      null,
      provisionContent,
      model.bots.length === 0 && !provision ? h(EmptyView, { onStart: () => void startProvisioning(), busy: provisionBusy }) : null,
      model.bots.length > 0 ? h(BotList, {
        bots: model.bots,
        busyByBot,
        errorsByBot,
        removeTargetId,
        onReconnect: (bot) => void reconnectOneBot(bot),
        onRequestRemove: requestRemove,
        onConfirmRemove: (bot) => void confirmRemove(bot),
        onCancelRemove: cancelRemove,
        setCardRef,
        setRemoveButtonRef
      }) : null
    )
  );
}
function apply(ctx) {
  ctx.effect(
    () => installFeishuStyles(),
    "feishu-settings: install client styles"
  );
  const rpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
  ctx.slots.inject(
    "settings.plugins.tab",
    () => ctx.slots.register(
      {
        name: "settings.plugins.tab",
        id: "feishu",
        order: 20,
        label: "\u98DE\u4E66",
        inject: () => ({ rpcCall })
      },
      FeishuSettingsTab
    )
  );
}

    return module.exports;
  }
});
