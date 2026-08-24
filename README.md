# dsh-feishu-integration

> **中文优先 / Chinese first**

将飞书与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 双向连接：

- DSH 会话完成后，把总结发送到飞书；
- 在飞书中回复某条总结，自动路由回产生该总结的 DSH 会话；
- 支持 p2p 和群聊的固定会话延续；
- 在 DSH 设置页查看绑定状态、扫码绑定、重连、断开和解绑；
- 提供二维码 provisioning 和 `fsum-admin` CLI 管理入口；
- 支持飞书 Feishu 域和国际版 Lark 域。

## 安全默认值

公开安装包默认使用 `takeoverInbound: false`。这样安装时不会自动和已有的飞书长连接插件竞争事件流。

只有在同一个 DSH profile 中禁用其他飞书长连接插件后，才应启用入站接管：

```yaml
- id: xmanrui-dsh-feishu
  disabled: true

- id: dsh-feishu-integration
  config:
    takeoverInbound: true
```

飞书长连接使用集群式事件分发；同一个应用同时运行多个长连接客户端可能导致事件随机分流。

## 安装

在目标 DSH profile 中安装 GitHub 仓库：

```bash
dsh plugin --profile web add github:yangwuan55/dsh-feishu-integration
```

其他 profile 例如：

```bash
dsh plugin --profile headless add github:yangwuan55/dsh-feishu-integration
```

安装完成后重启对应的 DSH profile。插件自带 `dsh.bundle.patch`，会自动进入 profile；默认不会开启入站长连接。

安装后可在：

```text
设置 → 插件 → 飞书
```

查看当前绑定状态并扫码绑定。绑定状态和二维码由 DSH 设置页提供，不要求先使用 CLI。

## 启用入站回复路由

如果需要“回复飞书总结 → 路由回对应 DSH 会话”，先确认旧飞书长连接插件已禁用，再在 profile patch 中覆盖配置：

```yaml
- id: xmanrui-dsh-feishu
  disabled: true

- id: dsh-feishu-integration
  config:
    takeoverInbound: true
    replyTimeoutMs: 600000
```

配置文件通常是：

```text
$DSH_HOME/profiles/web/cordis.patch.yml
```

也可以使用全局 patch：

```text
$DSH_HOME/cordis.patch.yml
```

修改 patch 后可热重载配置；插件代码或依赖变化需要重启 DSH Web。

## CLI 管理

设置页是推荐入口。CLI 仍然保留，方便自动化和无 UI 环境：

```bash
fsum-admin list
fsum-admin bind
fsum-admin bind --app-id cli_xxx --app-secret xxx --owner ou_xxx
fsum-admin verify --app-id cli_xxx
fsum-admin set-owner --app-id cli_xxx --open-id ou_xxx
fsum-admin unbind --app-id cli_xxx
```

二维码绑定使用飞书 SDK 的设备授权流程。凭据优先通过 DSH loopback credentials RPC 写入；在 DSH Web 未运行时才回退到本地 credential 文件。

## 数据与兼容性

插件保留旧 `@xmanrui/dsh-feishu` 的本地数据布局，以便迁移时延续已有绑定和固定会话：

```text
$DSH_HOME/integrations/dsh-feishu/config.json
$DSH_HOME/integrations/dsh-feishu/reply-map.json
$DSH_HOME/integrations/dsh-feishu/bots/<bot-id>/state.json
```

敏感的 `app_secret` 使用 DSH credential store，不写入公开配置文件。

## 路由行为

1. DSH 完成一次会话回合；
2. 插件向飞书发送文本总结；
3. 插件记录 `message_id → sessionId` 映射；
4. 用户在飞书中回复该总结；
5. 插件根据 `parent_id/root_id` 查找映射；
6. 命中后以 queue 模式把文本注入对应 DSH session；
7. 最终回答回帖到原飞书线程。

由飞书回复触发的 DSH 回合带有 `fsum-` RPC 标记，不会再次生成总结，从而避免回环。

## 验证

```bash
dsh web --dump-config
node --check lib/index.js
node --check lib/client.js
```

检查启动后的 Web 页面 `window.__DSH_BOOT__.entries` 是否包含 `dsh-feishu-integration`。如果设置页没有「飞书」，优先检查：

1. package.json 是否保留 `exports["./package.json"]`；
2. 旧飞书插件是否被禁用；
3. DSH profile 是否已经重启；
4. `dsh web --dump-config` 是否包含新插件 entry。

## 开发

```bash
git clone https://github.com/yangwuan55/dsh-feishu-integration.git
cd dsh-feishu-integration
pnpm install
node --check lib/index.js
node --check lib/client.js
```

## English

`dsh-feishu-integration` connects Feishu/Lark and DeepSeek Harness in both directions:

- Send completed DSH turn summaries to Feishu;
- Route a reply to a summary back to the DSH session that produced it;
- Preserve fixed p2p/group sessions for unmatched messages;
- Provide a DSH settings tab with binding status, QR binding, reconnect, disconnect, and delete actions;
- Support QR provisioning and the `fsum-admin` CLI;
- Support both Feishu and Lark domains.

### Safe default

The package defaults to `takeoverInbound: false`. Enable inbound takeover only after disabling every other Feishu long-connection plugin in the same profile:

```yaml
- id: xmanrui-dsh-feishu
  disabled: true

- id: dsh-feishu-integration
  config:
    takeoverInbound: true
```

Feishu long connections use clustered event delivery. Running multiple clients for the same app can split events unpredictably.

### Install

```bash
dsh plugin --profile web add github:yangwuan55/dsh-feishu-integration
```

The package ships a `dsh.bundle.patch`, so it is automatically mounted into the profile. Restart DSH after installation, then open:

```text
Settings → Plugins → Feishu
```

The settings UI is the preferred way to inspect binding status and scan a QR code.

### CLI

```bash
fsum-admin list
fsum-admin bind
fsum-admin verify --app-id cli_xxx
fsum-admin unbind --app-id cli_xxx
```

### Compatibility

The plugin intentionally keeps the legacy local data paths under `$DSH_HOME/integrations/dsh-feishu/`, so existing bindings, reply maps, and fixed-session state can be reused during migration.

### Official discovery

DeepSeek Harness currently recommends publishing a public GitHub repository and adding the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic for discovery. This repository follows that convention.

## License

MIT. See [`LICENSE`](./LICENSE).
