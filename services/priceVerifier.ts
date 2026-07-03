import { fetchWithFallback } from './apiService';
import { normalizeSymbol } from './symbolUtils';
import { priceRegistry } from './priceRegistry';

// Cache structure for batch prices
let cachedPrices: Record<string, number> = {};
let lastFetchTime = 0;
let activeFetchPromise: Promise<Record<string, number>> | null = null;

async function fetchAllPrices(): Promise<Record<string, number>> {
    const now = Date.now();
    
    // If we have a fresh cache (less than 10 seconds old), return it
    if (now - lastFetchTime < 10000 && Object.keys(cachedPrices).length > 0) {
        return cachedPrices;
    }
    
    // If there is already an active request, share it
    if (activeFetchPromise) {
        return activeFetchPromise;
    }
    
    activeFetchPromise = (async () => {
        try {
            const url = `https://fapi.binance.com/fapi/v1/ticker/price?_t=${Date.now()}`;
            const res = await fetchWithFallback(url, { timeout: 45000, priority: 'HIGH' }, undefined, false);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    const newPrices: Record<string, number> = {};
                    const updates: Record<string, number> = {};
                    
                    data.forEach((item: any) => {
                        const symbol = normalizeSymbol(item.symbol);
                        const price = parseFloat(item.price);
                        if (symbol && price > 0) {
                            newPrices[symbol] = price;
                            updates[symbol] = price;
                        }
                    });
                    
                    // Bulk update the priceRegistry
                    priceRegistry.updatePrices(updates);
                    
                    cachedPrices = newPrices;
                    lastFetchTime = Date.now();
                    return newPrices;
                }
            }
            throw new Error(`Failed to fetch prices, status: ${res.status}`);
        } catch (e: any) {
            console.warn('[PriceFix] Batch fetch failed, returning stale cache if available:', e.message || e);
            return cachedPrices;
        } finally {
            activeFetchPromise = null;
        }
    })();
    
    return activeFetchPromise;
}

export async function verifyAndFixSymbolPrice(symbol: string) {
    const clean = normalizeSymbol(symbol);
    try {
        const prices = await fetchAllPrices();
        const realPrice = prices[clean];
        if (realPrice && realPrice > 0) {
            const currentPrice = priceRegistry.getPrice(clean);
            if (currentPrice && Math.abs(currentPrice - realPrice) / realPrice > 0.05) {
                console.warn(`[PriceFix] Price discrepancy detected for ${clean}: ${currentPrice} vs ${realPrice}. Fixing...`);
                priceRegistry.forceUpdatePrice(clean, realPrice);
            }
        }
    } catch (e: any) {
        console.warn(`[PriceFix] Failed to verify price for ${clean}:`, e.message || e);
    }
}
