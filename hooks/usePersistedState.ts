import React, { useState, useEffect } from 'react';
import { loadState, saveState } from '../utils/persistence';

export function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setState] = useState<T>(() => loadState(key, defaultValue));

    useEffect(() => {
        saveState(key, state);
    }, [key, state]);

    return [state, setState];
}
