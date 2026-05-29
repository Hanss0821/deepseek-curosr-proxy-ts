
import type {ChatCompletionRequest, ChatCompletionResponse, ContentPart, MessageContent } from "../types/openai.js";
// 获取请求地址和API key
const apiKey = process.env.DEEPSEEK_API_KEY;
const apiUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const upstreamTimeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS) || 120_000;
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set in environment')
const apiPath = `${apiUrl}/chat/completions`;
const DATA_IMAGE_URL_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g

function withTimeout(signal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(upstreamTimeoutMs)
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function stripInlineImageData(content: string): string {
    return content.replace(DATA_IMAGE_URL_RE, '[Inline image data omitted]')
}

function normalizeContent(content: MessageContent | null): string | null {
    if (content === null) {
        return content
    }

    if (typeof content === 'string') {
        return stripInlineImageData(content)
    }

    return content
        .map((part: ContentPart) => {
            if (part.type === 'text') {
                return stripInlineImageData(part.text)
            }
            if (part.type === 'image_url') {
                return '[Image omitted: DeepSeek chat completions only accept text content.]'
            }
            return `[Unsupported content part omitted: ${part.type}]`
        })
        .filter(Boolean)
        .join('\n')
}

function normalizeRequestForDeepSeek(request: ChatCompletionRequest): ChatCompletionRequest {
    return {
        ...request,
        messages: request.messages.map(message => {
            const content = normalizeContent(message.content)
            return content === null ? message : { ...message, content }
        })
    }
}

function getRequestTextSize(request: ChatCompletionRequest): number {
    return request.messages.reduce((total, message) => {
        return total + (typeof message.content === 'string' ? message.content.length : 0)
    }, 0)
}

export async function callDeepSeek(
    request: ChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
        const normalizedRequest = normalizeRequestForDeepSeek(request)
        console.log('[upstream] normalized request text chars =', getRequestTextSize(normalizedRequest))
        const body ={
            ...normalizedRequest,
            stream: false
        }
        const res = await fetch(apiPath, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: withTimeout(signal)
        });
        // fetch不处理 400 500 报错
        if(!res.ok) {
            const errorText = await res.text()        // 用 text，避免 JSON.parse 报错盖住真因
            throw new Error(`DeepSeek API error: ${res.status} ${res.statusText} - ${errorText}`)
        }
        // 走成功路径
        return await res.json() as ChatCompletionResponse
  }

// 用于流式调用
export async function callDeepSeekStream(
        request: ChatCompletionRequest,
        signal?: AbortSignal
    ): Promise<Response> {
        const normalizedRequest = normalizeRequestForDeepSeek(request)
        console.log('[upstream] normalized stream request text chars =', getRequestTextSize(normalizedRequest))
        const { stream_options, ...restRequest } = normalizedRequest as any
        const body = {
            ...restRequest,
            stream: true,
            temperature: undefined,       // 思维链模式下必须去掉
            thinking: { type: 'enabled' },
            reasoning_effort: 'low',

        };
        const res = await fetch(apiPath, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal: withTimeout(signal)
        })

        if(!res.ok) {
            const errorText = await res.text()        // 用 text，避免 JSON.parse 报错盖住真因
            throw new Error(`DeepSeek API error: ${res.status} ${res.statusText} - ${errorText}`)
        }

        // 走成功路径
        return res
  }
