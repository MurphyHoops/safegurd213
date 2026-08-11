import React, { useState, useEffect, useCallback } from 'react';
import { loadState, saveState } from '../utils/persistence';

export function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setStateInternal] = useState<{ key: string; value: T }>(() => ({
        key,
        value: loadState(key, defaultValue)
    }));

    // Synchronize the state if key changes using a useEffect to avoid render-phase state updates
    useEffect(() => {
        setStateInternal({
            key,
            value: loadState(key, defaultValue)
        });
    }, [key]);

    // Only save when the state key matches the current key
    useEffect(() => {
        if (state.key === key) {
            saveState(key, state.value);
        }
    }, [key, state]);

    const setValue = useCallback((valueOrFn: React.SetStateAction<T>) => {
        setStateInternal(prev => {
            const nextValue = typeof valueOrFn === 'function' 
                ? (valueOrFn as (prev: T) => T)(prev.value) 
                : valueOrFn;
            return {
                key: prev.key,
                value: nextValue
            };
        });
    }, []);

    // Derive the returned value during render if the key has changed but state is not synced yet
    const currentValue = state.key === key ? state.value : loadState(key, defaultValue);

    return [currentValue, setValue];
}
