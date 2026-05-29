# DeepSeek Cursor Proxy

让 Cursor 原生显示 DeepSeek V4 的思考内容。

## 解决什么问题

Cursor 调用 DeepSeek 时无法直接显示 `reasoning_content`。这个代理做两件事：

- **格式转换**：把 `reasoning_content` 包进 Cursor 可渲染的 `<think>...</think>` 标签
- **推理缓存**：模型先思考再调工具时，缓存 reasoning，后续请求自动回填 `reasoning_content`

## 工作原理

```text
Cursor -> Proxy -> DeepSeek
              ^
       注入 <think>
       缓存 reasoning
```

1. 拦截 DeepSeek 返回的 SSE 流，解析 `data:` 事件并逐 chunk 改写。
2. 状态机跟踪 `idle -> thinking -> answering`，reasoning 开始时插入 `<think>`，正文开始时插入 `</think>`。
3. 如果流在 tool call 前结束且仍处于 thinking 状态，代理会主动补齐 `</think>`。
4. 若存在 `tool_call_id`，以它为 key 缓存完整 reasoning。下次请求遍历 assistant tool call 消息，命中缓存则回填 `reasoning_content`。

## 快速开始

前置条件：Node.js >= 20、pnpm、DeepSeek API Key。

```bash
git clone https://github.com/Hanss0821/deepseek-curosr-proxy-ts.git
cd deepseek-curosr-proxy-ts
pnpm install
cp .env.example .env
pnpm dev
```

编辑 `.env`：

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
PROXY_API_KEY=change-me
PORT=3000
UPSTREAM_TIMEOUT_MS=120000
REASONING_CACHE_MAX_SIZE=500
```

## Cursor 配置

```text
OpenAI Base URL:  http://localhost:3000/v1
API Key:          .env 中的 PROXY_API_KEY
Model:            deepseek-v4-pro
```

如果通过 ngrok、Cloudflare Tunnel 或服务器公网暴露，务必配置一个强 `PROXY_API_KEY`。否则任何拿到代理地址的人都可能消耗你的 DeepSeek API Key。

## 图片输入限制

Cursor 发送图片时会使用 OpenAI 多模态消息格式，其中包含 `image_url`。DeepSeek 当前 chat 接口不接受这个字段，所以代理会在转发前把多模态 `content` 归一化为纯文本：

- `text` part 会保留
- `image_url` part 会替换为图片已省略的文本提示
- 其他未知 part 会替换为不支持的文本提示

这可以避免上游返回 `unknown variant image_url, expected text`，但不能让 DeepSeek 真正读取图片内容。

## 配置项

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | 无，必填 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com` |
| `PROXY_API_KEY` | 客户端访问代理时使用的 Bearer Token | 未配置则关闭鉴权 |
| `PORT` | 代理端口 | `3000` |
| `UPSTREAM_TIMEOUT_MS` | DeepSeek 上游请求超时 | `120000` |
| `REASONING_CACHE_MAX_SIZE` | reasoning 内存缓存最大条数 | `500` |

## 接口

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /chat/completions`

## 技术栈

Node 20 / TypeScript / Fastify
