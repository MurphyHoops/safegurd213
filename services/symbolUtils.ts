
/**
 * // 🔒 @LOCKED_MODULE: Symbol Formatting, Validation & Price Resolution Engine
 * // CRITICAL: Standardized symbol formatting, validation whitelist, and price scaling logic are STRICTLY LOCKED.
 */
import { resolveSymbolFromInput } from './coinNames';

/**
 * Normalizes trading symbols to a common format for consistent lookup.
 * Removes common suffixes and prefixes, converts to uppercase, handles Chinese names and strips special characters.
 */
export const normalizeSymbol = (s: string): string => {
    if (!s || typeof s !== 'string') return s || '';
    
    let target = s.trim();

    // If string contains parenthesized Chinese like "BTC (比特币)" or "龙虾 (龙虾)", resolve via Chinese dictionary first
    if (target.includes('(') || target.includes('（')) {
        const resolved = resolveSymbolFromInput(target);
        if (resolved && resolved.symbol) {
            target = resolved.symbol;
        } else {
            target = target.replace(/[\(（][^\)）]*[\)）]/g, '');
        }
    }

    const cleaned = target.toUpperCase()
        .replace(/_PREP$/, '')
        .replace(/USDT$/, '')
        .replace(/[^A-Z0-9\u4e00-\u9fa5]/g, '');

    return cleaned || target.toUpperCase().trim();
};

export const isMemeScaledCoin = (symbol: string): boolean => {
    if (!symbol) return false;
    const clean = symbol.toUpperCase().replace(/^1000/, '').replace(/USDT$/, '').trim();
    const scaleMemeSymbols = ['PEPE', 'SHIB', 'BONK', 'FLOKI', 'LUNC', 'SATS', 'RATS', 'XEC', 'BABYDOGE', 'CATI', 'CAT'];
    return scaleMemeSymbols.includes(clean);
};

export const isMajorCoin = (symbol: string): boolean => {
    return !isMemeScaledCoin(symbol);
};


/**
 * Formats any input symbol into standard Binance USDT pair format (e.g. "BTC" -> "BTCUSDT", "STG/" -> "STGUSDT", "龙虾" -> "龙虾USDT")
 */
export const formatToBinanceSymbol = (s: string): string => {
    if (!s || typeof s !== 'string') return '';
    let clean = s.toUpperCase().trim();
    // Strip parenthesized annotations like "(比特币)" or "(龙虾)"
    if (clean.includes('(') || clean.includes('（')) {
        const resolved = resolveSymbolFromInput(clean);
        if (resolved && resolved.symbol) {
            clean = resolved.symbol.toUpperCase();
        } else {
            clean = clean.replace(/[\(（][^\)）]*[\)）]/g, '');
        }
    }
    // Strip trailing slashes, dashes, colons, underscores
    clean = clean.replace(/[\/\s_-]/g, '');
    clean = clean.replace(/_PREP$/, '');
    if (!clean) return '';
    if (clean.endsWith('USDT')) {
        return clean;
    }
    return clean + 'USDT';
};

/**
 * Basic syntax validation for trading symbols (supports standard Binance pairs and Chinese symbols like 龙虾USDT)
 */
export const isValidSymbolFormat = (s: string): boolean => {
    if (!s || typeof s !== 'string') return false;
    let clean = s.toUpperCase().trim();
    if (clean.includes('(') || clean.includes('（')) {
        const resolved = resolveSymbolFromInput(clean);
        if (resolved && resolved.symbol) {
            clean = resolved.symbol.toUpperCase();
        } else {
            clean = clean.replace(/[\(（][^\)）]*[\)）]/g, '');
        }
    }
    clean = clean.replace(/[\/\s_-]/g, '').replace(/USDT$/, '');
    // Must be alphanumeric or Chinese characters, length 1-20
    return /^[A-Z0-9\u4e00-\u9fa5]{1,20}$/.test(clean);
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

    // 1. Try exact match from realPrices FIRST (it's real-time!)
    if (realPrices[symbol] !== undefined) foundPrice = realPrices[symbol];
    else if (realPrices[upper] !== undefined) foundPrice = realPrices[upper];
    else if (realPrices[normalized] !== undefined) foundPrice = realPrices[normalized];

    // 2. Fallback to fallbackPrice if still nothing
    if (foundPrice === undefined && fallbackPrice && fallbackPrice > 0) foundPrice = fallbackPrice;
    
    const isMajorCoinVal = isMajorCoin(normalized);

    // 3. Try variations from realPrices
    if (foundPrice === undefined) {
        const withUsdt = upper.endsWith('USDT') ? upper : upper + 'USDT';
        if (realPrices[withUsdt] !== undefined) foundPrice = realPrices[withUsdt];
    }

    if (foundPrice === undefined) {
        // Only try 1000x variants for non-major coins
        const checkSymbols = isMajorCoinVal ? [normalized + 'USDT'] : [
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

    // 4. Fallback to provided price if still nothing
    if (foundPrice === undefined) return fallbackPrice || 0;

    // 5. Critical: Auto-scale magnitude to match fallbackPrice (entry price)
    // This fixes cases where symbol is "PEPE" but account uses "1000PEPE" scale or vice versa
    if (fallbackPrice && fallbackPrice > 0 && foundPrice > 0) {
        const ratio = foundPrice / fallbackPrice;
        
        // If it's a major coin, we are very careful
        if (isMajorCoinVal) {
            // ONLY scale if it's a blatant mistake (ratio ~1000 or ~0.001)
            // AND scaling it makes it match the fallback almost perfectly.
            if (ratio > 500 || ratio < 0.002) {
                const corrected = ratio > 500 ? foundPrice / 1000 : foundPrice * 1000;
                const correctedRatio = corrected / fallbackPrice;
                if (correctedRatio > 0.8 && correctedRatio < 1.2) {
                    console.log(`[Price Resolve] Corrected ${symbol}: ${foundPrice} -> ${corrected} (Ratio: ${typeof ratio === 'number' && isFinite(ratio) ? ratio.toFixed(2) : ratio})`);
                    return corrected;
                }
            }
            return foundPrice;
        }

        if (ratio > 500) {
            const corrected = foundPrice / 1000;
            const correctedRatio = corrected / fallbackPrice;
            if (correctedRatio > 0.8 && correctedRatio < 1.2) {
                console.log(`[Price Resolve] Scaling down ${symbol}: ${foundPrice} -> ${corrected}`);
                return corrected;
            }
            return foundPrice;
        }
        if (ratio < 0.002) {
            const corrected = foundPrice * 1000;
            const correctedRatio = corrected / fallbackPrice;
            if (correctedRatio > 0.8 && correctedRatio < 1.2) {
                console.log(`[Price Resolve] Scaling up ${symbol}: ${foundPrice} -> ${corrected}`);
                return corrected;
            }
            return foundPrice;
        }
    }

    console.log(`[Price Resolve] ${symbol}: Returning foundPrice ${foundPrice} (Fallback: ${fallbackPrice})`);
    return foundPrice;
};

/**
 * Smart price formatting that adjusts decimals based on magnitude.
 * Ideal for high-precision tokens like PEPE, SHIB.
 */
export const formatPrice = (price: number | null | undefined): string => {
    if (price === null || price === undefined || typeof price !== 'number' || isNaN(price) || !isFinite(price)) return '--';
    if (price === 0) return '0.00';
    
    const absPrice = Math.abs(price);
    if (absPrice >= 1000) return price.toFixed(2);
    if (absPrice >= 10) return price.toFixed(3);
    if (absPrice >= 1) return price.toFixed(4);
    if (absPrice >= 0.1) return price.toFixed(5);
    if (absPrice >= 0.01) return price.toFixed(6);
    if (absPrice >= 0.001) return price.toFixed(7);
    return price.toFixed(8);
};
