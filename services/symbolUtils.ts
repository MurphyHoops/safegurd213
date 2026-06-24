
/**
 * Normalizes trading symbols to a common format for consistent lookup.
 * Removes common suffixes and prefixes, converts to uppercase and strips special characters.
 */
export const normalizeSymbol = (s: string): string => {
    if (!s || typeof s !== 'string') return s || '';
    
    return s.toUpperCase()
        .trim()
        .replace(/_PREP$/, '')
        .replace(/USDT$/, '') // Only remove if it's at the end
        .replace(/[^A-Z0-9]/g, '');
};

/**
 * Robust price resolver that handles various symbol formats (with/without USDT, with/without 1000).
 * Handles the 1000x scaling factor for meme coins like LUNC, PEPE, SHIB, FLOKI.
 */
export const resolvePrice = (symbol: string, realPrices: Record<string, number>, fallbackPrice?: number): number => {
    if (!symbol) return fallbackPrice || 0;
    
    const upper = symbol.toUpperCase();
    const normalized = normalizeSymbol(symbol);
    
    let foundPrice: number | undefined;

    // 1. Try exact match
    if (realPrices[symbol] !== undefined) foundPrice = realPrices[symbol];
    else if (realPrices[upper] !== undefined) foundPrice = realPrices[upper];
    else if (realPrices[normalized] !== undefined) foundPrice = realPrices[normalized];
    
    const noScaleSymbols = ['XMR', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'DOT', 'LTC', 'BCH', 'ETC', 'LINK'];
    const isMajorCoin = noScaleSymbols.includes(normalized);

    // 2. Try variations
    if (foundPrice === undefined) {
        const withUsdt = upper.endsWith('USDT') ? upper : upper + 'USDT';
        if (realPrices[withUsdt] !== undefined) foundPrice = realPrices[withUsdt];
    }

    if (foundPrice === undefined) {
        // Only try 1000x variants for non-major coins
        const checkSymbols = isMajorCoin ? [normalized + 'USDT'] : [
            '1000' + normalized + 'USDT',
            '1000' + normalized,
            normalized + 'USDT'
        ];
        for (const s of checkSymbols) {
            if (realPrices[s] !== undefined) {
                foundPrice = realPrices[s];
                break;
            }
        }
    }

    // 3. Fallback to provided price if still nothing
    if (foundPrice === undefined) return fallbackPrice || 0;

    // 4. Critical: Auto-scale magnitude to match fallbackPrice (entry price)
    // This fixes cases where symbol is "PEPE" but account uses "1000PEPE" scale or vice versa
    if (fallbackPrice && fallbackPrice > 0 && foundPrice > 0) {
        const ratio = foundPrice / fallbackPrice;
        
        // If it's a major coin, we are very careful
        if (isMajorCoin) {
            // ONLY scale if it's a blatant mistake (ratio ~1000 or ~0.001)
            // AND scaling it makes it match the fallback almost perfectly.
            if (ratio > 500 || ratio < 0.002) {
                const corrected = ratio > 500 ? foundPrice / 1000 : foundPrice * 1000;
                const correctedRatio = corrected / fallbackPrice;
                if (correctedRatio > 0.8 && correctedRatio < 1.2) {
                    return corrected;
                }
            }
            return foundPrice;
        }

        if (ratio > 500) return foundPrice / 1000; // Found price is 1000x too big
        if (ratio < 0.002) return foundPrice * 1000; // Found price is 1000x too small
    }

    return foundPrice;
};

/**
 * Smart price formatting that adjusts decimals based on magnitude.
 * Ideal for high-precision tokens like PEPE, SHIB.
 */
export const formatPrice = (price: number): string => {
    if (price === 0) return '0.00';
    if (isNaN(price) || !isFinite(price)) return '--';
    
    const absPrice = Math.abs(price);
    if (absPrice >= 1000) return price.toFixed(2);
    if (absPrice >= 10) return price.toFixed(3);
    if (absPrice >= 1) return price.toFixed(4);
    if (absPrice >= 0.1) return price.toFixed(5);
    if (absPrice >= 0.01) return price.toFixed(6);
    if (absPrice >= 0.001) return price.toFixed(7);
    return price.toFixed(8);
};
