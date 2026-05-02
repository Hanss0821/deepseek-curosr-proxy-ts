// 系统提示词
interface SystemMessage {
    role: 'system';
    content: string;
}
// 用户消息
interface UserMessage {
    role: 'user';
    content: string;
}
// AI 回复
interface AssistantMessage {
    role: 'assistant';
    content: string | null; // 在调用工具进行回复的时候可以是null
    reasoning_content?: string;
    tool_calls? :unknown[];

}
// 工具调用结果
interface ToolMessage {
    role: 'tool';
    content: string;
    tool_call_id: string;
}

type Message = UserMessage | SystemMessage | AssistantMessage | ToolMessage;

// 协议请求体
interface ChatCompletionRequest {
    model: string;   
    messages: Message[]; 
    stream?: boolean;   
    temperature?: number; // 0 | 1 | 2  0 ~ 2 还包括0.1,0.2等值 
}

// 响应体
interface ChatCompletionResponse  {
    id: string;
    choices: ChatCompletionChoice[];
  }

interface ChatCompletionChoice {
    message: AssistantMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null ;
}