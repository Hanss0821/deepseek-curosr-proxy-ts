import Fastify,{FastifyRequest, FastifyReply } from 'fastify'
import type {ChatCompletionRequest} from "./types/openai.js"
import {callDeepSeek, callDeepSeekStream  } from "./upstream/deepseek.js"
import {proxyStream} from "./transform/sse.js"
import { setReasoning, getReasoning } from './cache/reasoning.js'
const app = Fastify({
  logger: true,
})

const chatHandler = async(request:FastifyRequest, reply:FastifyReply)=>{
  // 标记是否已 hijack，catch 中用来决定走 raw 还是走 reply.send
  let hijacked = false
  try{
    let reqParams = request.body as ChatCompletionRequest;
    if(reqParams.stream) {
      console.log('[handler] 进入流式分支')
      // DeepSeek v4 thinking 模式要求：每一条带 tool_calls 的 assistant 历史消息
      // 都必须把 reasoning_content 传回。Cursor 会丢弃这个字段，
      // 因此我们对所有 tool_calls assistant 消息都尝试从缓存回填。
      reqParams = {
        ...reqParams,
        messages: reqParams.messages.map(m => {
          if (
            m.role === 'assistant' &&
            (m.tool_calls?.length ?? 0) > 0 &&
            !m.reasoning_content
          ) {
            const toolCallId = m.tool_calls?.[0]?.id
            const cached = toolCallId ? getReasoning(toolCallId) : undefined
            // 即使没命中缓存也要给一个占位的空字符串，避免上游 400
            return { ...m, reasoning_content: cached ?? '' }
          }
          return m
        })
      }
      // 接管底层 response，避免 Fastify 在 handler 结束后再次调用 send
      reply.hijack()
      hijacked = true
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      const res = await callDeepSeekStream(reqParams);
      await proxyStream(
        res, 
          (data) => {
            reply.raw.write(data)
        },
        () => {
            reply.raw.end()
        },
        ({reasoning,toolCallId})=>{
          if(reasoning && toolCallId) {
            setReasoning(toolCallId,reasoning);
          }
        }
      );
      return
    }else {
      console.log('[handler] 进入非流式分支，stream =', reqParams.stream)
      return await callDeepSeek (reqParams);
    }
  }catch(err) {
    const msg = err instanceof Error ? err.message : 'upstream error'
    request.log.error({ err }, '[handler] 处理失败')
    // 流式分支已 hijack，必须直接通过 raw 写错误并结束，否则 Fastify 不会再帮我们发响应
    if (hijacked) {
      try {
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 502
          reply.raw.setHeader('Content-Type', 'text/event-stream')
        }
        reply.raw.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
        reply.raw.write('data: [DONE]\n\n')
      } catch {}
      try { reply.raw.end() } catch {}
      return
    }
    reply.code(502)
    return { error: msg }
  }
}

app.get('/health', async () => {
  return { status: 'ok' }
})

// 为了符合curosr的调用规范,不是真的要去查模型
app.get('/v1/models',async (request, reply)=>{
  return {
    object: 'list',
    // 模拟数据
    data: [
      { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
      { id: 'deepseek-v4-pro',   object: 'model', owned_by: 'deepseek' },
    ]
  }
})

app.post<{Body: ChatCompletionRequest}>('/v1/chat/completions',chatHandler)
app.post<{Body: ChatCompletionRequest}>('/chat/completions',chatHandler)

const port = Number(process.env.PORT) || 3000

app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`Proxy listening on ${address}`)
})