
import type {ChatCompletionRequest, ChatCompletionResponse } from "../types/openai.js";
// 获取请求地址和API key
const apiKey = process.env.DEEPSEEK_API_KEY;
const apiUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const upstreamTimeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS) || 120_000;
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set in environment')
const apiPath = `${apiUrl}/chat/completions`;

function withTimeout(signal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(upstreamTimeoutMs)
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

export async function callDeepSeek(
    request: ChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
        const body ={
            ...request,
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
        const { stream_options, ...restRequest } = request as any
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
