import { timingSafeEqual } from 'node:crypto'
import Fastify, { FastifyReply, FastifyRequest } from 'fastify'
import type { ChatCompletionRequest, ContentPart, MessageContent } from "./types/openai.js"
import { callDeepSeek, callDeepSeekStream } from "./upstream/deepseek.js"
import { proxyStream } from "./transform/sse.js"
import { setReasoning, getReasoning } from './cache/reasoning.js'

const proxyApiKey = process.env.PROXY_API_KEY

const app = Fastify({
  logger: true,
})

function timingSafeStringEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function isAuthorized(request: FastifyRequest): boolean {
  if (!proxyApiKey) return true

  const authorization = request.headers.authorization
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''

  return timingSafeStringEqual(token, proxyApiKey)
}

app.addHook('preHandler', async (request, reply) => {
  if (request.url === '/health') return
  if (isAuthorized(request)) return

  reply.code(401)
  return reply.send({ error: 'unauthorized' })
})

if (!proxyApiKey) {
  app.log.warn('PROXY_API_KEY is not set. Client authentication is disabled.')
}

function createClientAbortController(reply: FastifyReply): AbortController {
  const controller = new AbortController()
  reply.raw.on('close', () => {
    if (!reply.raw.writableEnded) {
      controller.abort()
    }
  })
  return controller
}

function normalizeContent(content: MessageContent | null): string | null {
  if (content === null || typeof content === 'string') {
    return content
  }

  const parts = content
    .map((part: ContentPart) => {
      if (part.type === 'text') {
        return part.text
      }
      if (part.type === 'image_url') {
        return '[Image omitted: DeepSeek chat models do not support image input through this proxy.]'
      }
      return `[Unsupported content part omitted: ${part.type}]`
    })
    .filter(Boolean)

  return parts.join('\n')
}

function normalizeMessages(reqParams: ChatCompletionRequest): ChatCompletionRequest {
  return {
    ...reqParams,
    messages: reqParams.messages.map(m => {
      const content = normalizeContent(m.content)
      return content === null ? m : { ...m, content }
    })
  }
}

function hydrateReasoning(reqParams: ChatCompletionRequest): ChatCompletionRequest {
  return {
    ...reqParams,
    messages: reqParams.messages.map(m => {
      if (
        m.role === 'assistant' &&
        (m.tool_calls?.length ?? 0) > 0 &&
        !m.reasoning_content
      ) {
        const toolCallId = m.tool_calls?.[0]?.id
        const cached = toolCallId ? getReasoning(toolCallId) : undefined
        return { ...m, reasoning_content: cached ?? '' }
      }
      return m
    })
  }
}

const chatHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  let hijacked = false
  const abortController = createClientAbortController(reply)

  try {
    let reqParams = normalizeMessages(request.body as ChatCompletionRequest)

    if (reqParams.stream) {
      reqParams = hydrateReasoning(reqParams)

      reply.hijack()
      hijacked = true
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')

      const res = await callDeepSeekStream(reqParams, abortController.signal)
      await proxyStream(
        res,
        (data) => {
          if (!reply.raw.destroyed) {
            reply.raw.write(data)
          }
        },
        () => {
          if (!reply.raw.destroyed && !reply.raw.writableEnded) {
            reply.raw.end()
          }
        },
        ({ reasoning, toolCallId }) => {
          if (reasoning && toolCallId) {
            setReasoning(toolCallId, reasoning)
          }
        },
        abortController.signal
      )
      return
    }

    return await callDeepSeek(reqParams, abortController.signal)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'upstream error'
    request.log.error({ err }, '[handler] request failed')

    if (abortController.signal.aborted) {
      return
    }

    if (hijacked) {
      try {
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 502
          reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
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

app.get('/v1/models', async () => {
  return {
    object: 'list',
    data: [
      { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
      { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
    ]
  }
})

app.post<{ Body: ChatCompletionRequest }>('/v1/chat/completions', chatHandler)
app.post<{ Body: ChatCompletionRequest }>('/chat/completions', chatHandler)

const port = Number(process.env.PORT) || 3000

app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`Proxy listening on ${address}`)
})
