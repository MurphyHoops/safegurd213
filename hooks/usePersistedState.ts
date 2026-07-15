import React, { useState, useEffect, useCallback } from 'react';
import { loadState, saveState } from '../utils/persistence';

export function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setStateInternal] = useState<{ key: string; value: T }>(() => ({
        key,
        value: loadState(key, defaultValue)
    }));

    // If key changes, update internal state during render to trigger an immediate rerender
    if (state.key !== key) {
        setStateInternal({
            key,
            value: loadState(key, defaultValue)
        });
    }

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

    return [state.value, setValue];
}
