import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadState, saveState } from '../utils/persistence';

export function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const defaultValueRef = useRef(defaultValue);
    defaultValueRef.current = defaultValue;

    const [state, setStateInternal] = useState<{ key: string; value: T }>(() => ({
        key,
        value: loadState(key, defaultValue)
    }));

    const prevKeyRef = useRef(key);

    // Synchronize the state ONLY if key actually changes to avoid render-phase state updates and mount loops
    useEffect(() => {
        if (prevKeyRef.current !== key) {
            prevKeyRef.current = key;
            setStateInternal({
                key,
                value: loadState(key, defaultValueRef.current)
            });
        }
    }, [key]);

    // Only save when the state key matches the current key and value actually changed
    const lastSavedValueRef = useRef<T>(state.value);
    useEffect(() => {
        if (state.key === key && !Object.is(lastSavedValueRef.current, state.value)) {
            lastSavedValueRef.current = state.value;
            saveState(key, state.value);
        }
    }, [key, state.key, state.value]);

    const setValue = useCallback((valueOrFn: React.SetStateAction<T>) => {
        setStateInternal(prev => {
            const nextValue = typeof valueOrFn === 'function' 
                ? (valueOrFn as (prev: T) => T)(prev.value) 
                : valueOrFn;
            if (Object.is(prev.value, nextValue)) {
                return prev;
            }
            return {
                key,
                value: nextValue
            };
        });
    }, [key]);

    // Derive the returned value during render if the key has changed but state is not synced yet
    const currentValue = state.key === key ? state.value : loadState(key, defaultValue);

    return [currentValue, setValue];
}

