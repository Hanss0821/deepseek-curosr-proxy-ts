export interface TextContentPart {
    type: 'text';
    text: string;
}

export interface ImageUrlContentPart {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    } | string;
}

export type ContentPart = TextContentPart | ImageUrlContentPart | {
    type: string;
    [key: string]: unknown;
};

export type MessageContent = string | ContentPart[];

// 系统提示词
export interface SystemMessage {
    role: 'system';
    content: MessageContent;
}
// 用户消息
export interface UserMessage {
    role: 'user';
    content: MessageContent;
}
// AI 回复
export interface AssistantMessage {
    role: 'assistant';
    content: MessageContent | null; // 在调用工具进行回复的时候可以是null
    reasoning_content?: string;
    tool_calls? :ToolCall[];

}
// 工具调用结果
export interface ToolMessage {
    role: 'tool';
    content: MessageContent;
    tool_call_id: string;
}

export type Message = UserMessage | SystemMessage | AssistantMessage | ToolMessage;

// 协议请求体
export interface ChatCompletionRequest {
    model: string;   
    messages: Message[]; 
    stream?: boolean;   
    temperature?: number; // 0 | 1 | 2  0 ~ 2 还包括0.1,0.2等值 
}

// 响应体
export interface ChatCompletionResponse  {
    id: string;
    choices: ChatCompletionChoice[];
  }

export interface ChatCompletionChoice {
    message: AssistantMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null ;
}

// 流式返回结构
export interface ChatCompletionChunk {
    id: string;
    choices: ChunkChoice[]
}

export interface ChunkChoice {
    delta: Delta;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
}

export interface Delta {
    role?: 'assistant',
    content?: string,
    reasoning_content?: string,
    tool_calls?: ToolCall[]
}

export interface ToolCall {
    id: string;
    type:"function";
    function: {
        name:string;
        arguments:string;
    }
}
