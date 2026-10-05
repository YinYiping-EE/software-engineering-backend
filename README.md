# 算数记 · 后端

Node.js + Express + SQLite 计算器 API。后端验证并解析表达式，执行计算，保存结果和时间，查询分页历史并删除指定记录。使用递归下降解析器，未使用 `eval`、`Function` 或任意代码执行。

## 在线演示与仓库

**[前端与后端服务公开演示：https://47.117.170.115/](https://47.117.170.115/)**

本仓库：[https://github.com/YinYiping-EE/software-engineering-backend](https://github.com/YinYiping-EE/software-engineering-backend)。

## 环境、安装和启动

Node.js 24.12 或更高版本，npm。SQLite 使用 Node 内置的 `node:sqlite`，无需安装数据库服务或原生编译工具。

```powershell
npm ci
npm run dev
```

默认地址：`http://127.0.0.1:3001`。生产模式用 `npm start`；本机开发模式自动监视代码变化并重启。

## 配置和数据库初始化

可复制 `.env.example` 为 `.env`。配置项：

| 名称 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 本机监听地址 |
| `PORT` | `3001` | API 端口 |
| `DATABASE_PATH` | 本仓库 `.local/calculator.sqlite` | 可自定义数据库文件；相对路径以运行目录为准 |
| `TRUST_PROXY` | 关闭 | 设置为 `loopback` 时，只信任本机代理；其他值不启用 |
| `NODE_ENV` | 开发模式 | `production` 时启用 Secure Cookie，并强制要求下面两个配置 |
| `SESSION_SECRET` | 本机自动生成并保存到 `.local/session-secret` | 生产必须使用至少 32 字符的随机密钥，并在更新、重启时保留 |
| `PUBLIC_ORIGIN` | 开发请求的协议和 Host | 生产网站来源，例如 `https://47.117.170.115`；拒绝其他 Origin |

首次启动自动创建数据库目录和 `calculations` 表，无需手动建表。字段为 `id`（文本 UUID 主键）、`expression`（文本）、`result`（文本）、`created_at`（ISO 时间文本）。结果以字符串返回以便统一呈现；时间按 UTC 保存，前端按浏览器当地时间显示。

新增 `client_info`（可空 JSON 文本）保存提交时的 IP、IP 归属地、浏览器、操作系统和设备类型。已有数据库通过增加字段原地升级，原记录保持完整；之前未采集的来源信息返回 `client: null`。

SQLite 文件和 `.env` 均不进入 Git。重启、更新应用代码时保留数据库文件；备份运行中的数据库时应使用 SQLite 支持的备份方式，或在停止服务后备份数据库文件。

## API

所有业务响应使用 JSON。成功响应有 `success: true`，错误响应有 `success: false` 和 `message`；删除成功返回 204，无响应体。

| 方法 | 地址 | 状态码 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 200 | 服务连通检查 |
| GET | `/api/status` | 200 / 429 / 500 | 实时服务器 CPU、内存、运行时间与采样时间；数据库健康检查 |
| POST | `/api/calculations` | 201 / 400 | 请求字段 `expression`，计算成功即入库 |
| GET | `/api/calculations?limit=20&offset=0` | 200 / 400 | 返回 `items` 和 `total`；每页 1–100 条 |
| DELETE | `/api/calculations/{id}` | 204 / 404 | 真正删除指定数据库记录 |

计算请求：

```json
{ "expression": "(1+2)*3" }
```

成功响应包含 `success`、`id`、`expression`、`result`（此例为 `"9"`）、`createdAt`。非法输入、除零、超范围结果均返回 400，不产生历史记录。表达式最多 200 个字符，请求体最多 2KB。

接口首次访问设置签名的 HttpOnly、SameSite=Strict Cookie，生产环境再加 Secure。历史按该浏览器身份隔离，服务端 `owner_id` 不接受客户端输入。读写需保留 Cookie；POST / DELETE 还需请求头 `X-Calculator-Request: 1`，POST 使用 `Content-Type: application/json`。拒绝跨站请求，不开放 CORS。每个来源 IP 每分钟最多 120 次业务请求、30 次写请求，超限返回 429 和 Retry-After。健康检查不计入此配额。

这不是账号登录：同一浏览器的同源标签页共享记录，清除 Cookie、换设备或 180 天身份到期后不能通过网页恢复之前记录。旧版没有所属浏览器的记录原样留在数据库，公开 API 不展示；可由服务器管理员离线管理。首次公网部署使用新的服务器数据库，不上传本机历史。

成功响应及历史条目还包含 `client`，例如：

```json
{
  "ip": "127.0.0.1",
  "location": "本机访问",
  "locationType": "local",
  "browser": "Chrome",
  "os": "Windows",
  "device": "电脑"
}
```

来源信息由后端根据请求获取，不接受请求体中的自报 IP 或所在地。`locationType` 为 `local`（本机）、`private`（内网）、`estimated`（公网估算）或 `unknown`（未知）。浏览器和设备由 User-Agent 粗略识别，可能受客户端修改影响，不能用于身份认证。当前应用没有账号系统，这些字段代表提交计算时的访问来源，并非登录审计。

公网 IP 使用 [geoip-lite](https://github.com/geoip-lite/node-geoip) 的本地数据库查询，不把访客 IP 发往第三方服务。数据包含 MaxMind GeoLite 信息；包内数据可能较旧，公网正式使用前按该库说明更新数据，需要自己的 MaxMind 许可密钥。查询结果仅代表 IP 网络归属地，可能缺失或偏离实际位置；未命中时显示未知。

本产品包含由 [MaxMind](https://www.maxmind.com/) 创建的 GeoLite 数据（This product includes GeoLite data created by MaxMind）。

前端通过 Vite 的 `/api` 代理连接，开发时无需开放跨域。公网部署时保持 API 监听本机地址，由网站反向代理转发请求。

部署到本机 Nginx 等代理后，为获取访客公网 IP，可配置 `TRUST_PROXY=loopback`，同时在代理上用 `proxy_set_header X-Forwarded-For $remote_addr;` 覆盖客户端自带来源头。API 应只监听回环地址并由该可信代理访问。默认忽略转发头，避免客户端直接伪造地址；本机预览会记录回环 IP。

## 测试与模块

`system-status.js` 从操作系统读取指标，以 CPU 累计时间的差值计算采样区间平均使用率；Linux 内存采用 MemAvailable，计入可回收缓存。指标最多缓存 5 秒，前端每 30 秒读取；本机环境 provider 为 local，已部署生产环境为 aliyun。该接口沿用同源校验与 IP 限流，返回 no-store；仅公开指标，不返回主机名、进程列表、文件路径、环境变量或记录内容。状态请求不创建或轮换浏览器历史 Cookie，避免首次加载时的并发身份竞争。SQLite SELECT 1 失败返回通用 500 错误。独立测试覆盖采样、缓存、边界、数据库异常和限流。

```powershell
npm test
```

测试覆盖四则运算、优先级、括号、小数、一元运算、非法输入、除零、真实 HTTP 接口、SQLite 重启持久化、分页及持久删除。测试使用单独的临时数据库，不读写用户数据库。

来源信息测试还覆盖 IPv4 / IPv6、本机和内网分类、公网数据库查询、设备识别、转发头与请求体伪造、可信代理链、元信息重启持久化，以及旧数据库迁移后记录保留。

- `src/calculator.js`：分词和递归下降解析。
- `src/history-store.js`：SQLite 建表、参数化读写和删除。
- `src/client-info.js`：来源 IP、离线归属地查询和设备信息识别。
- `src/app.js`：HTTP 路由、验证和响应。
- `src/protection.js`：浏览器身份、跨站防护、限流及安全响应头。
- `src/server.js`：环境配置、服务启动和退出。
- `codestyle.md`：代码规范。

小数计算使用 JavaScript Number，通常按 15 位有效数字呈现；安全整数保持原值。本项目不是任意精度数学引擎。

本目录作为独立后端仓库维护，远程地址为 https://github.com/YinYiping-EE/software-engineering-backend 。

## 作业博客与安全检查

[中文博客](https://github.com/YinYiping-EE/software-engineering/blob/main/docs/assignment/blog-zh.md) · [English blog](https://github.com/YinYiping-EE/software-engineering/blob/main/docs/assignment/blog-en.md) · [公开前安全检查](docs/security-review.md)。博客包含公网地址、PSP、17 张实际演示截图和两张结构图。
