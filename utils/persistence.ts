export const deepMerge = (target: any, source: any): any => {
    if (source === null || source === undefined) return target;
    if (target === null || target === undefined) return source;
    
    // Type mismatch check - if source is different type, overwrite unless it is an object mismatch
    if (typeof target !== typeof source) return source; 
    
    // Primitive handling
    if (typeof target !== 'object') return source; 
    
    // Array handling - we overwrite arrays rather than merging them to avoid duplicates/corruption
    if (Array.isArray(target) || Array.isArray(source)) return source;
    
    const output = { ...target };
    
    try {
        for (const key of Object.keys(source)) {
            const sourceValue = source[key];
            
            if (sourceValue === undefined || sourceValue === null) {
                continue;
            }
            
            if (key in target) {
                const targetValue = target[key];
                if (typeof targetValue === 'object' && targetValue !== null && !Array.isArray(targetValue)) {
                    output[key] = deepMerge(targetValue, sourceValue);
                } else {
                    output[key] = sourceValue;
                }
            } else {
                output[key] = sourceValue;
            }
        }
    } catch (e) {
        console.error("[Persistence] Recovery failed during deepMerge, using raw source", e);
        return source;
    }
    
    return output;
};

export const loadState = <T,>(key: string, defaultVal: T): T => {
    try {
        if (typeof window === 'undefined') return defaultVal;
        
        const saved = localStorage.getItem(key);
        if (!saved) return defaultVal;
        
        let parsed;
        try {
            parsed = JSON.parse(saved);
        } catch (parseError) {
            console.error(`[Persistence] JSON parse error for key "${key}". Clearing corrupted data.`, parseError);
            localStorage.removeItem(key);
            return defaultVal;
        }
        
        if (parsed === null || parsed === undefined) return defaultVal;

        // If it's a primitive, just return it
        if (typeof defaultVal !== 'object' || defaultVal === null) {
            return (typeof parsed === typeof defaultVal) ? parsed : defaultVal;
        }
        
        // Array handling
        if (Array.isArray(defaultVal)) {
            return (Array.isArray(parsed) ? parsed : defaultVal) as T;
        }
        
        // Complex Object Deep Merge
        return deepMerge(defaultVal, parsed) as T;
    } catch (e) {
        console.warn(`[Persistence] Unexpected error loading ${key}`, e);
        return defaultVal;
    }
};

/**
 * Clean helper to strip massive historical arrays from candidate payloads before saving to localStorage.
 * Transient high/low arrays (over 1000 items) are kept in memory but stripped from persistent disk storage.
 */
const cleanPayloadForPersistence = (key: string, data: any): any => {
    if (!data) return data;
    try {
        const cleanItem = (item: any): any => {
            if (!item || typeof item !== 'object') return item;
            
            const newItem = { ...item };
            
            // Clean historyExtremes (heavy raw array lists over 1000+ floats)
            if (newItem.historyExtremes && typeof newItem.historyExtremes === 'object') {
                newItem.historyExtremes = {
                    scalars: newItem.historyExtremes.scalars
                };
            }
            return newItem;
        };

        if (key.includes('SCANNER_LIST2') || key.includes('SCANNER_LIST3') || key.includes('SCANNER_LIST4')) {
            if (Array.isArray(data)) {
                return data.map(item => {
                    if (item && typeof item === 'object') {
                        if ('key' in item && 'value' in item) {
                            return { key: item.key, value: cleanItem(item.value) };
                        }
                        return cleanItem(item);
                    }
                    return item;
                });
            } else if (typeof data === 'object') {
                return cleanItem(data);
            }
        }
    } catch (e) {
        console.error('[Persistence] Error cleaning payload', e);
    }
    return data;
};

/**
 * Saves data to localStorage with a safety check for quota and size.
 * If quota is exceeded, it attempts to clear non-critical caches.
 */
export const saveState = (key: string, data: any, maxSizeRows: number = 800): boolean => {
    let payload = cleanPayloadForPersistence(key, data);
    try {
        // Capping strategy: if it's an array, we slice it to prevent infinite growth
        if (Array.isArray(payload)) {
            // Positions are CRITICAL, we keep all of them (they are usually few anyway)
            if (key === 'SAVIOR_POSITIONS') {
                // No cap for positions unless they are truly massive
            } else if (payload.length > maxSizeRows) {
                payload = payload.slice(0, maxSizeRows);
            }
        }
        
        const serialized = JSON.stringify(payload);
        
        // Basic size check (roughly 2.5MB limit per entry)
        if (serialized.length > 2.5 * 1024 * 1024) {
            console.warn(`[Persistence] Payload for ${key} is too large (${(serialized.length / 1024).toFixed(1)}KB). Capping...`);
            if (Array.isArray(payload) && key !== 'SAVIOR_POSITIONS') {
                payload = payload.slice(0, Math.floor(payload.length / 2));
            }
        }
        
        localStorage.setItem(key, JSON.stringify(payload));
        return true;
    } catch (e: any) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22) {
            console.warn(`[Persistence] LocalStorage Quota Exceeded for ${key}! Attempting Emergency Cleanup...`);
            
            // PRIORITY CLEANUP:
            // 1. All non-config Scanner Caches (Temporary data that gets rebuilt)
            const scannerKeys = Object.keys(localStorage).filter(k => 
                (k.startsWith('SCANNER_') && k.includes('CACHE')) || 
                k.includes('CACHE_MAP') || 
                k.includes('RESULTS') || 
                k.includes('EXPIRED') || 
                k.includes('CAPTURED')
            );
            scannerKeys.forEach(k => {
                if (!k.includes('CONFIG') && !k.includes('BLACKLIST')) {
                    try { localStorage.removeItem(k); } catch (_) {}
                }
            });
            
            // 2. Old Logs (SAVIOR_LOGS)
            try { localStorage.removeItem('SAVIOR_LOGS'); } catch (_) {}
            
            // 3. Trade logs (Only if still needed, but keep at least 50)
            const tradeLogs = localStorage.getItem('SAVIOR_TRADELOGS');
            if (tradeLogs) {
                try {
                    const parsed = JSON.parse(tradeLogs);
                    if (Array.isArray(parsed) && parsed.length > 50) {
                        localStorage.setItem('SAVIOR_TRADELOGS', JSON.stringify(parsed.slice(0, 50)));
                    }
                } catch(err) {
                    localStorage.removeItem('SAVIOR_TRADELOGS');
                }
            }

            // 4. Try saving the CRITICAL data again
            try {
                localStorage.setItem(key, JSON.stringify(payload));
                return true;
            } catch(inner) {
                console.warn(`[Persistence] Emergency cleanup failed to free enough space for ${key}`);
                return false;
            }
        } else {
            console.error(`[Persistence] Failed to save ${key}`, e);
        }
        return false;
    }
};
