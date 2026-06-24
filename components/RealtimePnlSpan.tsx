import React, { useEffect, useRef } from 'react';
import { priceRegistry } from '../services/priceRegistry';

interface Props {
    symbol: string;
    entryPrice: number;
    amount: number;
    side: 'LONG' | 'SHORT';
    isPct: boolean;
    className?: string;
    fallbackValue?: number;
}

export const RealtimePnlSpan: React.FC<Props> = ({
    symbol,
    entryPrice,
    amount,
    side,
    isPct,
    className = '',
    fallbackValue
}) => {
    const spanRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!spanRef.current) return;

        const unsubscribe = priceRegistry.registerPnlElement(symbol, spanRef.current, {
            entryPrice,
            amount,
            side,
            isPct
        });

        return unsubscribe;
    }, [symbol, entryPrice, amount, side, isPct]);

    let initialText = '...';
    if (fallbackValue !== undefined && !isNaN(fallbackValue)) {
        initialText = isPct 
            ? `${fallbackValue >= 0 ? '+' : ''}${fallbackValue.toFixed(2)}%`
            : `${fallbackValue >= 0 ? '+' : ''}${fallbackValue.toFixed(2)}`;
    }

    return (
        <span ref={spanRef} className={`${className} transition-all duration-150`}>
            {initialText}
        </span>
    );
};
