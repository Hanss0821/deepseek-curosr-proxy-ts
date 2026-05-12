
import type {ChatCompletionRequest, ChatCompletionResponse } from "../types/openai.js";
// 获取请求地址和API key
const apiKey = process.env.DEEPSEEK_API_KEY;
const apiUrl = process.env.DEEPSEEK_BASE_URL;
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set in environment')
if (!apiUrl) throw new Error('DEEPSEEK_BASE_URL is not set in environment');
const apiPath = `${apiUrl}/chat/completions`;

export async function callDeepSeek(
    request: ChatCompletionRequest
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
            body: JSON.stringify(body)
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
        request: ChatCompletionRequest
    ): Promise<Response> {
        const body = {
            ...request,
            stream: true
        };
        const res = await fetch(apiPath, {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        })

        if(!res.ok) {
            const errorText = await res.text()        // 用 text，避免 JSON.parse 报错盖住真因
            throw new Error(`DeepSeek API error: ${res.status} ${res.statusText} - ${errorText}`)
        }

        // 走成功路径
        return res
  }