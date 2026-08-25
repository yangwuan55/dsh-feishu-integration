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

// client-src/index.js
var index_exports = {};
__export(index_exports, {
  FeishuSettingsTab: () => FeishuSettingsTab,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);

// client-src/api.js
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
    throw new Error("飞书服务返回了无法识别的响应");
  }
  if (!result.ok) {
    const message = optionalString(result.error?.message) ?? "飞书服务请求失败";
    const error = new Error(message);
    error.code = optionalString(result.error?.code) ?? "FEISHU_RPC_ERROR";
    throw error;
  }
  return result.value;
}
function normalizeProvisioning(value, now = Date.now()) {
  const source = isRecord(value?.provisioning) ? value.provisioning : value;
  if (!isRecord(source)) throw new Error("飞书服务没有返回二维码信息");
  const attemptId = optionalString(source.attemptId) ?? optionalString(source.provisioningId);
  const verificationUrl = optionalString(source.verificationUrl);
  const qrCodeDataUrl = optionalString(source.qrCodeDataUrl);
  if (!attemptId || !verificationUrl && !qrCodeDataUrl) {
    throw new Error("飞书服务返回的二维码信息不完整");
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
    name: optionalString(source.name) ?? "飞书机器人",
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
    summary: optionalString(source.summary) ?? (connected ? "长连接运行正常" : "机器人尚未连接"),
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
  if (!isRecord(value)) throw new Error("飞书服务返回了无效的机器人状态");
  const botId = optionalString(value.botId) ?? optionalString(fallbackBotId);
  if (!botId) throw new Error("飞书服务返回的机器人缺少 botId");
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
  if (!isRecord(value)) throw new Error("飞书服务没有返回连接状态");
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
  if (!isRecord(value)) throw new Error("飞书服务没有返回连接状态");
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
  if (!isRecord(value)) throw new Error("飞书服务没有返回创建进度");
  const status = POLL_STATES.has(value.status) ? value.status : POLL_STATES.has(value.state) ? value.state : void 0;
  if (!status) throw new Error("飞书服务返回了未知的创建状态");
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
  const raw = optionalString(error?.message) ?? "操作失败，请稍后重试";
  const message = raw.replace(/(client[_-]?secret|app[_-]?secret|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=••••••").slice(0, 240);
  return { message, code: optionalString(error?.code) };
}
function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// client-src/styles.js
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

// client-src/index.js
var h = import_react.default.createElement;
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
var Button = import_react.default.forwardRef(function Button2({ children, kind = "secondary", size, icon, className = "", ...props }, ref) {
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
      h("h2", null, "飞书机器人"),
      h("p", null, "通过扫码把飞书机器人接入DeepSeek Harness")
    ),
    h(
      "div",
      { className: "bxf-headingTools" },
      hasBots ? h("div", {
        className: "bxf-totalBadge",
        "aria-label": `已接入 ${totals.configured} 个机器人，其中 ${totals.connected} 个在线`
      }, h("strong", null, totals.connected), h("span", null, `/ ${totals.configured} 在线`)) : null,
      h("div", {
        className: "bxf-localBadge",
        title: "每个应用的凭据均由 Host 独立保存，不会发送到浏览器"
      }, h(ShieldIcon, { size: 14 }), h("span", null, "凭据仅保存在本机")),
      h(Button, {
        kind: "primary",
        size: "small",
        icon: h(PlusIcon),
        onClick: onAdd,
        disabled: adding || busy,
        ref: addButtonRef,
        "aria-busy": busy ? "true" : void 0
      }, adding ? "正在添加" : "添加机器人")
    )
  );
}
function LoadingView() {
  return h("div", {
    className: "bxf-card",
    "aria-busy": "true",
    "aria-label": "正在读取飞书机器人列表"
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
          h("span", null, "尚未接入机器人")
        ),
        h("h3", null, "扫码，创建第一个飞书入口"),
        h("p", null, "无需手动填写 App ID。以后还可以继续添加机器人，分别服务不同团队或飞书租户。"),
        h(
          "div",
          { className: "bxf-actions" },
          h(Button, {
            kind: "primary",
            icon: h(SparkIcon),
            onClick: onStart,
            disabled: busy,
            "aria-busy": busy ? "true" : void 0
          }, busy ? "正在创建…" : "一键创建飞书机器人")
        ),
        h(
          "div",
          { className: "bxf-note" },
          h(ShieldIcon, { size: 16 }),
          h("span", null, "每个 App Secret 都只写入 Host 凭据存储，浏览器不会收到 Secret。")
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
  const [imageFailed, setImageFailed] = import_react.default.useState(false);
  const qrSource = safeQrSource(provision.qrCodeDataUrl);
  const href = safeVerificationHref(provision.verificationUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = provision.expired === true || remaining === 0;
  const progress = Math.min(1, remaining / Math.max(1, provision.durationMs ?? remaining));
  import_react.default.useEffect(() => setImageFailed(false), [qrSource]);
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
            alt: "用于新增 DeepSeek Harness 飞书机器人的一次性授权二维码",
            onError: () => setImageFailed(true)
          }) : h(
            "div",
            { className: "bxf-qrFallback" },
            h("div", null, h(QrIcon), h("span", null, "二维码未就绪，请打开授权链接"))
          ),
          expired ? h(
            "div",
            { className: "bxf-expiredOverlay", role: "status" },
            h("div", null, "二维码已失效", h("br"), "请刷新后重新扫码")
          ) : null
        ),
        h(
          "div",
          {
            className: "bxf-countdown",
            "aria-label": expired ? "二维码已失效" : `二维码剩余 ${formatRemaining(remaining)}`
          },
          h(
            "div",
            { className: "bxf-countdownTop", "aria-hidden": "true" },
            h("span", null, expired ? "等待刷新" : "二维码有效时间"),
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
          h("span", null, "正在添加新机器人")
        ),
        h("h3", null, expired ? "刷新二维码后继续" : "使用飞书扫码创建机器人"),
        h("p", null, "扫码只会新增一个机器人，已接入的机器人会继续正常收发消息。"),
        h(
          "ol",
          { className: "bxf-steps" },
          h("li", null, "打开飞书移动端，使用扫一扫读取二维码"),
          h("li", null, "核对应用名称与权限范围，并确认创建"),
          h("li", null, "保持本页打开，等待新机器人的长连接就绪")
        ),
        h(
          "div",
          { className: "bxf-actions" },
          expired ? h(Button, {
            kind: "primary",
            icon: h(RefreshIcon),
            onClick: onRefresh,
            disabled: busy
          }, busy ? "刷新中…" : "刷新二维码") : href ? h("a", {
            className: "bxf-button bxf-link",
            "data-kind": "secondary",
            href,
            target: "_blank",
            rel: "noopener noreferrer"
          }, h(ExternalIcon), h("span", null, "在飞书中打开")) : null,
          !expired ? h(Button, { icon: h(RefreshIcon), onClick: onRefresh, disabled: busy }, "换一个二维码") : null,
          h(Button, { onClick: onCancel, disabled: busy }, "取消添加")
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
        h("h3", null, connecting ? "已确认，正在连接新机器人" : "正在准备授权二维码"),
        h("p", null, connecting ? "正在安全保存凭据并检查新机器人的消息通道，其他机器人不会中断。" : "正在向飞书申请一次性授权二维码，请稍候。"),
        connecting ? h(
          "div",
          { className: "bxf-actions", style: { justifyContent: "center" } },
          h(Button, { onClick: onCancel, disabled: busy }, "取消添加")
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
        h("h3", null, "新机器人没有添加完成"),
        h("p", null, error.message),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h(
          "div",
          { className: "bxf-actions" },
          h(
            Button,
            { kind: "primary", icon: h(RefreshIcon), onClick: onRetry, disabled: busy },
            busy ? "重试中…" : "重新生成二维码"
          ),
          h(Button, { onClick: onCancel, disabled: busy }, "关闭")
        )
      )
    )
  );
}
var HEALTH_LABELS = {
  connected: "运行正常",
  connecting: "正在连接",
  offline: "连接中断",
  error: "需要处理"
};
function formatCheckedTime(timestamp) {
  if (!timestamp) return "尚未检查";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(timestamp));
  } catch {
    return "刚刚";
  }
}
function RemoveConfirmation({ bot, busy, onConfirm, onCancel }) {
  const cancelRef = import_react.default.useRef(null);
  const idPart = bot.botId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const titleId = `bxf-remove-title-${idPart}`;
  const descriptionId = `bxf-remove-description-${idPart}`;
  import_react.default.useEffect(() => cancelRef.current?.focus(), []);
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
    h("h4", { id: titleId }, `从 DeepSeek Harness 移除“${bot.bot.name}”？`),
    h(
      "p",
      { id: descriptionId },
      "此操作会停止这个机器人的连接，并删除保存在本机的接入配置和凭据。飞书开放平台中的应用不会被自动删除，其他机器人也不受影响。"
    ),
    h(
      "div",
      { className: "bxf-actions" },
      h(Button, { ref: cancelRef, onClick: onCancel, disabled: busy }, "保留机器人"),
      h(
        Button,
        { kind: "danger", onClick: onConfirm, disabled: busy },
        busy ? "正在移除…" : "确认移除接入"
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
  const domainLabel = bot.domain === "lark" ? "Lark" : "飞书";
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
            h("p", null, bot.tenantName ? `${bot.tenantName} · ${domainLabel}机器人` : `${domainLabel}机器人`)
          )
        ),
        h(
          "div",
          { className: "bxf-healthPill", "data-health": stateForDisplay },
          h("span", { className: "bxf-dot", "data-tone": tone }),
          h("span", null, HEALTH_LABELS[stateForDisplay] ?? "状态未知")
        )
      ),
      h(
        "dl",
        { className: "bxf-statusGrid" },
        h(
          "div",
          { className: "bxf-metric" },
          h("dt", null, "消息通道"),
          h("dd", null, connected ? "长连接" : stateForDisplay === "connecting" ? "连接中" : "已断开")
        ),
        h(
          "div",
          { className: "bxf-metric" },
          h("dt", null, "应用标识"),
          h("dd", { title: bot.appIdMasked }, bot.appIdMasked ?? "已安全保存")
        ),
        h(
          "div",
          { className: "bxf-metric" },
          h("dt", null, "最近检查"),
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
          h("strong", null, "连接状态："),
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
            "aria-label": `${connected ? "检查连接" : "重试连接"}${bot.name}`
          }, busy === "reconnect" ? connected ? "检查中…" : "正在连接…" : connected ? "检查连接" : "重试连接"),
          h(Button, {
            size: "small",
            kind: "danger",
            onClick: onRequestRemove,
            disabled: Boolean(busy),
            ref: removeButtonRef,
            "aria-label": `从 DeepSeek Harness 移除${bot.name}`
          }, "移除接入")
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
      h("h3", { id: "bxf-bot-list-title" }, "已接入的机器人"),
      h("span", null, `${props.bots.length} 个`)
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
        h("h3", null, "无法读取飞书机器人"),
        h("p", null, error.message),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h(
          "div",
          { className: "bxf-actions" },
          h(
            Button,
            { kind: "primary", icon: h(RefreshIcon), onClick: onRetry, disabled: busy },
            busy ? "重试中…" : "重新读取"
          )
        )
      )
    )
  );
}
var EMPTY_TOTALS = Object.freeze({ configured: 0, connected: 0 });
function FeishuSettingsTab({ rpcCall }) {
  const [model, setModel] = import_react.default.useState({
    phase: "loading",
    revision: 0,
    bots: [],
    totals: EMPTY_TOTALS,
    provisioning: null,
    pageError: null,
    statusError: null
  });
  const [pageBusy, setPageBusy] = import_react.default.useState(false);
  const [provisionBusy, setProvisionBusy] = import_react.default.useState(false);
  const [busyByBot, setBusyByBot] = import_react.default.useState({});
  const [errorsByBot, setErrorsByBot] = import_react.default.useState({});
  const [removeTargetId, setRemoveTargetId] = import_react.default.useState(null);
  const [announcement, setAnnouncement] = import_react.default.useState("");
  const [now, setNow] = import_react.default.useState(() => Date.now());
  const [focusBotId, setFocusBotId] = import_react.default.useState(null);
  const cardRefs = import_react.default.useRef(/* @__PURE__ */ new Map());
  const removeButtonRefs = import_react.default.useRef(/* @__PURE__ */ new Map());
  const addButtonRef = import_react.default.useRef(null);
  const announce = import_react.default.useCallback((message) => {
    setAnnouncement("");
    if (!message) return;
    window.requestAnimationFrame(() => setAnnouncement(message));
  }, []);
  const invoke = import_react.default.useCallback(async (endpoint, payload = {}, signal) => {
    return unwrapRpcResult(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const mergeSnapshot = import_react.default.useCallback((snapshot, { restoreProvisioning = true } = {}) => {
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
  const loadStatus = import_react.default.useCallback(async ({ signal, silent = false, restoreProvisioning = true } = {}) => {
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
  import_react.default.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal });
    return () => controller.abort();
  }, [loadStatus]);
  import_react.default.useEffect(() => {
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
  import_react.default.useEffect(() => {
    if (!focusBotId) return;
    const node = cardRefs.current.get(focusBotId);
    if (!node) return;
    node.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    node.focus({ preventScroll: true });
    setFocusBotId(null);
  }, [focusBotId, model.bots]);
  const startProvisioning = import_react.default.useCallback(async ({ replace = false } = {}) => {
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
      announce("授权二维码已生成，请使用飞书扫码。");
    } catch (error) {
      setModel((current) => ({
        ...current,
        provisioning: { phase: "error", error: presentError(error) }
      }));
    } finally {
      setProvisionBusy(false);
    }
  }, [announce, invoke, model.provisioning?.attemptId]);
  const cancelProvisioning = import_react.default.useCallback(async () => {
    const attemptId = model.provisioning?.attemptId;
    setProvisionBusy(true);
    try {
      if (attemptId) await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId });
      setModel((current) => ({ ...current, provisioning: null }));
      announce("已取消添加机器人。");
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
  import_react.default.useEffect(() => {
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
  import_react.default.useEffect(() => {
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
            throw new Error("机器人已经创建，但暂时无法确认连接状态");
          }
          if (!newBot?.connected) {
            setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? { ...current, provisioning: { ...current.provisioning, phase: "connecting" } } : current);
            return;
          }
          setModel((current) => ({ ...current, provisioning: null }));
          announce(newBot ? `${newBot.bot.name}已连接，可以在飞书中开始聊天。` : "新飞书机器人已连接，可以开始聊天。");
          if (result.botId) setFocusBotId(result.botId);
          return;
        }
        if (result.status === "failed") {
          const error = new Error(result.message ?? "飞书应用创建失败");
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
  const setBotBusy = import_react.default.useCallback((botId, value) => {
    setBusyByBot((current) => {
      const next = { ...current };
      if (value) next[botId] = value;
      else delete next[botId];
      return next;
    });
  }, []);
  const setBotError = import_react.default.useCallback((botId, error) => {
    setErrorsByBot((current) => {
      const next = { ...current };
      if (error) next[botId] = presentError(error);
      else delete next[botId];
      return next;
    });
  }, []);
  const reconnectOneBot = import_react.default.useCallback(async (connection) => {
    const { botId, bot } = connection;
    setBotBusy(botId, "reconnect");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(FEISHU_ENDPOINTS.reconnectBot, { botId }));
      mergeSnapshot(snapshot);
      const refreshed = snapshot.bots.find((item) => item.botId === botId);
      if (!refreshed?.connected) {
        const error = new Error(
          refreshed?.error?.message ?? refreshed?.health.summary ?? "机器人仍未连接"
        );
        error.code = refreshed?.error?.code ?? "FEISHU_BOT_OFFLINE";
        throw error;
      }
      announce(connection.connected ? `${bot.name}连接检查完成。` : `${bot.name}已重新连接。`);
    } catch (error) {
      setBotError(botId, error);
      announce(`${bot.name}操作失败，请查看机器人状态。`);
    } finally {
      setBotBusy(botId, null);
    }
  }, [announce, invoke, mergeSnapshot, setBotBusy, setBotError]);
  const requestRemove = import_react.default.useCallback((connection) => {
    setRemoveTargetId(connection.botId);
  }, []);
  const cancelRemove = import_react.default.useCallback(() => {
    const botId = removeTargetId;
    setRemoveTargetId(null);
    window.requestAnimationFrame(() => removeButtonRefs.current.get(botId)?.focus());
  }, [removeTargetId]);
  const confirmRemove = import_react.default.useCallback(async (connection) => {
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
      announce(`${bot.name}已从此 DeepSeek Harness 移除；飞书开放平台中的应用未被删除。`);
      await loadStatus({ silent: true });
      window.requestAnimationFrame(() => addButtonRef.current?.focus());
    } catch (error) {
      setBotError(botId, error);
      announce(`${bot.name}移除失败，请重试。`);
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
  const setCardRef = import_react.default.useCallback((botId, node) => {
    if (node) cardRefs.current.set(botId, node);
    else cardRefs.current.delete(botId);
  }, []);
  const setRemoveButtonRef = import_react.default.useCallback((botId, node) => {
    if (node) removeButtonRefs.current.set(botId, node);
    else removeButtonRefs.current.delete(botId);
  }, []);
  return h(
    "section",
    { className: "bxf-page", "aria-label": "飞书机器人设置" },
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
      h("span", null, `状态自动刷新失败：${model.statusError.message}`),
      h(Button, { size: "small", onClick: () => void loadStatus({ silent: true }), disabled: pageBusy }, "立即重试")
    ) : null,
    model.phase === "loading" ? h(LoadingView) : model.phase === "error" ? h(PageError, {
      error: model.pageError ?? { message: "无法读取连接状态" },
      onRetry: () => void loadStatus(),
      busy: pageBusy
    }) : h(
      import_react.default.Fragment,
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
        label: "飞书",
        inject: () => ({ rpcCall })
      },
      FeishuSettingsTab
    )
  );
}

    return module.exports;
  }
});
