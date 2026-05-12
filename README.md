# DeepSeek Cursor Proxy

让 Cursor 原生显示 DeepSeek V4 的思维链。

---

## 解决什么问题

Cursor 调用 DeepSeek 时无法开启思维链模式。DeepSeek 返回的 `reasoning_content` 被 Cursor 丢弃 —— 你在编辑器里看不到模型的推理过程。

这个代理做两件事：

- **格式转换**：把 `reasoning_content` 包进 Cursor 可渲染的 `<think>...</think>` 标签
- **推理缓存**：模型先思考再调工具时，思考内容会丢失。代理缓存 reasoning，后续请求自动回填

## 效果展示

> **这里放截图。** 打开 Cursor，发一条会触发思考的指令，把 `<think>...</think>` 渲染效果截下来。
>
> ⚠️ 没有截图 = 没人会装。

## 工作原理

```
Cursor → Proxy → DeepSeek
              ↑
         注入 <think>
         缓存 reasoning
```

1. 拦截 DeepSeek 返回的 SSE 流，按 `\n\n` 拆帧，逐 chunk 解析 JSON
2. 状态机追踪 `idle → thinking → answering`，在 reasoning 开头自动插入 `<think>`，content 开头插入 `</think>`
3. 流结束时，若存在 `tool_call`，以 `tool_call_id` 为 key 缓存完整 reasoning（TTL 10 分钟）。下一次请求遍历所有 assistant tool_call 消息，命中缓存则回填 `reasoning_content`

## 快速开始

**前置条件**：Node.js ≥ 20，DeepSeek API Key

[申请 Key](https://platform.deepseek.com/api_keys)

```bash
git clone https://github.com/your-username/deepseek-cursor-proxy-ts.git
cd deepseek-cursor-proxy-ts
pnpm install
cp .env.example .env
# 编辑 .env，填入你的 KEY
pnpm dev
```

**Cursor 配置**：

```
OpenAI Base URL:  http://localhost:3000/v1 (需要是公网地址)
API Key:          （任意非空值）
Model:            deepseek-v4-pro
```

## 配置项说明


| 变量                  | 说明               | 默认值                        |
| ------------------- | ---------------- | -------------------------- |
| `DEEPSEEK_API_KEY`  | DeepSeek API Key | 无（必填）                      |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址  | `https://api.deepseek.com` |
| `PORT`              | 代理端口             | `3000`                     |


## 技术栈

Node 20 / TypeScript / Fastify / ngrok（可选）