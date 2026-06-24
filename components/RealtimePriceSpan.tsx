import React, { useEffect, useRef } from 'react';
import { priceRegistry } from '../services/priceRegistry';
import { formatPrice } from '../services/symbolUtils';

interface Props {
    symbol: string;
    decimals?: number;
    prefix?: string;
    suffix?: string;
    className?: string;
    fallbackPrice?: number;
    flashColor?: boolean;
}

export const RealtimePriceSpan: React.FC<Props> = ({
    symbol,
    decimals = 4,
    prefix = '',
    suffix = '',
    className = '',
    fallbackPrice,
    flashColor = true
}) => {
    const spanRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!spanRef.current) return;
        
        const unsubscribe = priceRegistry.registerPriceElement(symbol, spanRef.current, {
            decimals,
            prefix,
            suffix,
            flashColor
        });

        return unsubscribe;
    }, [symbol, decimals, prefix, suffix, flashColor]);

    const initialText = fallbackPrice !== undefined && !isNaN(fallbackPrice)
        ? `${prefix}${formatPrice(fallbackPrice)}${suffix}`
        : '...';

    return (
        <span ref={spanRef} className={`${className} transition-colors duration-200`}>
            {initialText}
        </span>
    );
};
