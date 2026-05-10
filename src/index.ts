import Fastify from 'fastify'
import type {ChatCompletionRequest} from "./types/openai.js"
import {callDeepSeek} from "./upstream/deepseek.js"
const app = Fastify({
  logger: true,
})

app.get('/health', async () => {
  return { status: 'ok' }
})

app.get('/v1/models',async (request, reply)=>{
  return {
    "object": "list",
     data: []
  }
})

app.post<{Body: ChatCompletionRequest}>('/v1/chat/completions',async(request, reply)=>{
  try{
    const reqParams = request.body;
    return callDeepSeek(reqParams);
  }catch(err) {
    reply.code(502);
    return { error: err instanceof Error ? err.message : 'upstream error' }
  }
})

const port = Number(process.env.PORT) || 3000

app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`Proxy listening on ${address}`)
})