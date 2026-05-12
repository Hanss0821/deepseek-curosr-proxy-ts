import Fastify,{FastifyRequest, FastifyReply } from 'fastify'
import type {ChatCompletionRequest} from "./types/openai.js"
import {callDeepSeek, callDeepSeekStream  } from "./upstream/deepseek.js"
import {proxyStream} from "./transform/sse.js"
import { setReasoning, getReasoning, findCacheKey } from './cache/reasoning.js'
const app = Fastify({
  logger: true,
})

const chatHandler = async(request:FastifyRequest, reply:FastifyReply)=>{
  try{
    let reqParams = request.body as ChatCompletionRequest;
    if(reqParams.stream) {
      const cacheKey = findCacheKey(reqParams.messages);
      if(cacheKey) {
        const cachedReasoning = getReasoning(cacheKey);
        if (cachedReasoning) {
          reqParams = {
            ...reqParams,
            messages: reqParams.messages.map(m => {
              if (
                m.role === 'assistant' &&
                m.tool_calls?.[0]?.id === cacheKey
              ) {
                return { ...m, reasoning_content: cachedReasoning }
              }
              return m
            })
          }
        }
      }
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      const res = await callDeepSeekStream(reqParams);
      await proxyStream(
        res, 
        (data) => reply.raw.write(data),
        () => reply.raw.end(),
        ({reasoning,toolCallId})=>{
          if(reasoning && toolCallId) {
            setReasoning(toolCallId,reasoning);
          }
        }
      );
    }else {
      return callDeepSeek (reqParams);
    }
  }catch(err) {
    reply.code(502);
    return { error: err instanceof Error ? err.message : 'upstream error' }
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