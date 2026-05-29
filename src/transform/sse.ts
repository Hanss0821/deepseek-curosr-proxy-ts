import type {ChatCompletionChunk} from "../types/openai.js"

type ReasoningState = 'idle' | 'thinking' | 'answering'

interface ParsedSSEEvent {
    done: boolean
    chunk: ChatCompletionChunk | null
}

function parseSSEEvent(event: string): ParsedSSEEvent {
    const dataLines = event
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice('data:'.length).trimStart())

    if (dataLines.length === 0) {
        return { done: false, chunk: null }
    }

    const data = dataLines.join('\n')
    if (!data || data === '[DONE]') {
        return { done: data === '[DONE]', chunk: null }
    }

    return { done: false, chunk: JSON.parse(data) as ChatCompletionChunk }
}

function toSSEData(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}`
}

function transformChunk(
    chunk: ChatCompletionChunk,
    state: { current: ReasoningState }
): string | null {
    const delta = chunk.choices[0]?.delta
    if (!delta) return null

    const { content, reasoning_content } = delta
    let newContent: string | null = null

    if (reasoning_content) {
        if (state.current === 'idle') {
            state.current = 'thinking'
            newContent = `<think>${reasoning_content}`
        } else {
            newContent = reasoning_content
        }
    }

    if (content) {
        if (state.current === 'thinking') {
            state.current = 'answering'
            newContent = `</think>${content}`
        } else {
            newContent = content
        }
    }

    if (delta.tool_calls) {
        return toSSEData(chunk)
    }

    if (newContent === null) {
        return null
    }

    const newChunk = {
        ...chunk,
        choices: [{
            ...chunk.choices[0],
            delta: { content: newContent }
        }]
    }

    return toSSEData(newChunk)
}

function closeThinkingChunk(sourceChunk: ChatCompletionChunk): string {
    const choice = sourceChunk.choices[0] ?? { delta: {}, finish_reason: null }
    return toSSEData({
        ...sourceChunk,
        choices: [{
            ...choice,
            delta: { content: '</think>' },
            finish_reason: null
        }]
    })
}

export async function proxyStream(
    upstreamResponse: Response,
    write: (data: string) => void,
    end: () => void,
    onReasoningComplete?: (result: { reasoning: string; toolCallId: string }) => void,
    signal?: AbortSignal
): Promise<void> {
    if (!upstreamResponse.body) {
        throw new Error('DeepSeek stream response body is empty')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let reasoning = ''
    let toolCallId = ''
    let lastChunk: ChatCompletionChunk | null = null
    const state = { current: 'idle' as ReasoningState }
    let done = false

    const writeSSE = (data: string) => write(`${data}\n\n`)

    try {
        for await (const rawChunk of upstreamResponse.body) {
            if (signal?.aborted || done) break

            buffer += decoder.decode(rawChunk, { stream: true })
            const events = buffer.split(/\n\n|\r\n\r\n/)
            buffer = events.pop() ?? ''

            for (const event of events) {
                if (signal?.aborted) break
                if (!event.trim()) continue

                const parsed = parseSSEEvent(event)
                if (parsed.done) {
                    done = true
                    break
                }
                if (!parsed.chunk) continue

                const chunk = parsed.chunk
                lastChunk = chunk

                const delta = chunk.choices[0]?.delta
                if (delta?.reasoning_content) {
                    reasoning += delta.reasoning_content
                }
                const firstToolCall = delta?.tool_calls?.[0]
                if (!toolCallId && firstToolCall?.id) {
                    toolCallId = firstToolCall.id
                }

                const output = transformChunk(chunk, state)
                if (output) writeSSE(output)
            }
        }

        buffer += decoder.decode()
        if (!done && buffer.trim()) {
            const parsed = parseSSEEvent(buffer)
            if (parsed.chunk) {
                lastChunk = parsed.chunk
                const output = transformChunk(parsed.chunk, state)
                if (output) writeSSE(output)
            }
        }
    } catch (err) {
        if (!signal?.aborted) {
            try {
                writeSSE(toSSEData({
                    id: 'error',
                    object: 'chat.completion.chunk',
                    choices: [{
                        index: 0,
                        delta: { content: '\n\n> 连接中断，请重试' },
                        finish_reason: 'stop'
                    }]
                }))
            } catch {}
        }
    }

    if (!signal?.aborted) {
        if (state.current === 'thinking' && lastChunk) {
            writeSSE(closeThinkingChunk(lastChunk))
        }
        write('data: [DONE]\n\n')
    }

    if (!signal?.aborted) {
        onReasoningComplete?.({ reasoning, toolCallId })
    }
    end()
}
