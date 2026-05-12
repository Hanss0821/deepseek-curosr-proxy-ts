import type {AssistantMessage,Message} from "../types/openai.js"
const cache = new Map<string,{value:string,expiresAt:number}>();
const TTL_MS = 10 * 60 * 1000;

export function setReasoning(key: string, value: string): void {
    cache.set(key, {
        value,
        expiresAt: Date.now() + TTL_MS
    })
}

export function getReasoning(key:string) {
    const entry = cache.get(key);
    if(!entry) return undefined;
    if(Date.now() > entry.expiresAt) {
        cache.delete(key)
        return undefined
    }
    return entry.value
}

export function findCacheKey(list:Message[]) {

     const lastAssistantWithTools =  list.filter((item): item is AssistantMessage => 
        item.role === 'assistant' &&
        (item.tool_calls?.length ?? 0) > 0
     ).at(-1);

     return lastAssistantWithTools?.tool_calls?.[0]?.id
}