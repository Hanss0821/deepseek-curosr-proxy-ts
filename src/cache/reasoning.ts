import type {AssistantMessage,Message} from "../types/openai.js"
const cache = new Map<string,{value:string,expiresAt:number}>();
const TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_SIZE = Number(process.env.REASONING_CACHE_MAX_SIZE) || 500;

function cleanupExpired(now = Date.now()): void {
    for (const [key, entry] of cache) {
        if (now > entry.expiresAt) {
            cache.delete(key)
        }
    }
}

function trimCache(): void {
    cleanupExpired()
    while (cache.size > MAX_CACHE_SIZE) {
        const oldestKey = cache.keys().next().value
        if (!oldestKey) break
        cache.delete(oldestKey)
    }
}

export function setReasoning(key: string, value: string): void {
    if (!key || !value) return
    cache.set(key, {
        value,
        expiresAt: Date.now() + TTL_MS
    })
    trimCache()
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
