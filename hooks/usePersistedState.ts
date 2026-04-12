import React, { useState, useEffect } from 'react';

export function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setState] = useState<T>(() => {
        try {
            const saved = localStorage.getItem(key);
            if (saved !== null) {
                const parsed = JSON.parse(saved);
                if (parsed === null) {
                    return defaultValue;
                }
                if (Array.isArray(defaultValue)) {
                    return Array.isArray(parsed) ? parsed : defaultValue;
                }
                if (typeof defaultValue === 'object' && defaultValue !== null) {
                    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                        return defaultValue;
                    }
                    return { ...defaultValue, ...parsed };
                }
                if (typeof parsed !== typeof defaultValue) {
                    return defaultValue;
                }
                return parsed;
            }
        } catch (e) {
            console.error(`Failed to load state for ${key}`, e);
        }
        return defaultValue;
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (e) {
            console.error(`Failed to save state for ${key}`, e);
        }
    }, [key, state]);

    return [state, setState];
}
