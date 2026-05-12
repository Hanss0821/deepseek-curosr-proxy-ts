import type {ChatCompletionChunk} from "../types/openai.js"
type ReasoningState = 'idle' | 'thinking' | 'answering'

// 解析单个 SSE event 字符串，提取 data 字段并 JSON.parse
// 返回 null 表示"跳过这个 event"（比如 [DONE] 或空行）
// 示例数据："data: {\"id\":\"xxx\",\"choices\":[{\"delta\":{\"reasoning_content\":\"嗯\"}}]}"
function parseSSEEvent(event: string): ChatCompletionChunk | null {
    if(!event || event === 'data: [DONE]') return null;
    if(event.startsWith('data: ')) {
       event = event.slice('data: '.length);
    }
    return JSON.parse(event); // JSON.parse默认返回any，需要用zod来做运行时结构校验
}


// 把一个 chunk 根据当前状态改写，返回改写后的 SSE 字符串
// 同时更新状态
function transformChunk(
    chunk: ChatCompletionChunk,
    state: { current: ReasoningState }  // 用对象包裹，让函数内部能修改它
    // null 表示这个 chunk 不需要输出任何内容
  ): string | null  {
    const delta = chunk.choices[0]?.delta;
    if (!delta) return null; // early return
    const {content,reasoning_content} = delta;
    let newContent:string | null = null;
    // 标记思维链开始
    if(reasoning_content) {
        if(state.current === 'idle') {
            state.current  = 'thinking';
            newContent = `<think>${reasoning_content}`
        } else {
            newContent = reasoning_content
        }
        
    }
    // 标志思维结束
    if(content) {
        if(state.current === 'thinking') {
            state.current  = 'answering';
            newContent = `</think>${content}`; 
        }else {
            newContent = content;
        }
    }

    if(newContent === null) {
        return null;
    }

    const newChunk = {
        ...chunk,
        choices: [{
            ...chunk.choices[0],
            delta: { content: newContent }  // 新 delta，只留 content
        }]
    }
    return "data: " + JSON.stringify(newChunk);
  }
  
  // 主函数：消费 DeepSeek 的流，改写后推给 Cursor
  export async function proxyStream(
    upstreamResponse: Response,
    write: (data: string) => void,  // 调用方传入的"写出函数"
    end: () => void                 // 调用方传入的"结束函数"
  ): Promise<void>{
    const decoder = new TextDecoder();
    let buffer = ''
    const state = { current: 'idle' as ReasoningState }

    for await (const rawChunk of upstreamResponse.body!) {
        buffer += decoder.decode(rawChunk)
    
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
            if (!event.trim()) continue
            
            const chunk = parseSSEEvent(event)
            if (!chunk) continue
            
            const output = transformChunk(chunk, state)
            if (output) write(output + '\n\n')
          }
    }
    
    write('data: [DONE]\n\n')
    end()
  }