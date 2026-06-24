
import { ScanConfig, ScannerItem } from '../../components/Scanner/scannerTypes';

export interface MarketStats {
    up: number;
    down: number;
    total: number;
    btcChange: number;
}

export function processMarketData(
    rawData: any[], 
    config: ScanConfig,
    customSymbolSet: Set<string>,
    fixedModeView: 'MONITOR' | 'SEARCH' = 'MONITOR',
    majorTrendCandidates?: Set<string>
): { list1: ScannerItem[], stats: MarketStats } {
    
    let up = 0, down = 0, btcChange = 0;
    const allCandidates: ScannerItem[] = [];

    const isMajorTrendActive = config.majorTrend?.enabled && majorTrendCandidates && majorTrendCandidates.size > 0 && !config.useCustomOnly;

    // Safety check: if rawData is not an array (e.g. API error object), return empty
    if (!Array.isArray(rawData)) {
        return {
            list1: [],
            stats: { up: 0, down: 0, total: 0, btcChange: 0 }
        };
    }

    // 1. First Pass: Stats & Normalization
    rawData.forEach((t: any) => {
        if (!t.symbol || !t.symbol.endsWith('USDT')) return;
        
        // Major Trend Filter (Stage 2)
        if (isMajorTrendActive && !majorTrendCandidates.has(t.symbol)) {
            return;
        }

        const price = parseFloat(t.lastPrice) || 0;
        const volume = parseFloat(t.quoteVolume) || 0; // Raw volume

        // SANITATION
        if (isNaN(price) || price <= 0) return;

        // Use API provided change percent directly
        const change = parseFloat(t.priceChangePercent) || 0;
        
        // Convert Volume to Millions
        const volumeM = volume / 1000000;

        const openPrice = parseFloat(t.openPrice) || price;
        const highPrice = parseFloat(t.highPrice) || price;
        const lowPrice = parseFloat(t.lowPrice) || price;

        if (change > 0) up++; else if (change < 0) down++;
        if (t.symbol === 'BTCUSDT') btcChange = change;

        // Optimization: Pre-filter zero volume or very small volume
        if (volume <= 0) return;

        allCandidates.push({
            symbol: t.symbol,
            price: price,
            volume24h: volumeM,
            change8am: change, 
            change: change,    
            isNew: false,
            openPrice,
            highPrice,
            lowPrice
        });
    });

    // 2. Filter Logic
    let filtered: ScannerItem[] = [];
    const upperCustomSymbolSet = new Set(Array.from(customSymbolSet || []).map(s => s.trim().toUpperCase()));

    if (config.useCustomOnly && fixedModeView === 'MONITOR') {
        // [BYPASS] If we are in "监控列表" view of "固定选币", we bypass standard change & volume filters
        // to ensure manual coins typed by the user always display below.
        filtered = allCandidates.filter(i => {
            const rawSym = i.symbol.replace('USDT', '').toUpperCase();
            return upperCustomSymbolSet.has(rawSym);
        });

        // Ensure ALL custom symbols are represented, even if Binance returned empty elements or stats are not loaded
        const presentSet = new Set(filtered.map(f => f.symbol.replace('USDT', '').toUpperCase()));
        upperCustomSymbolSet.forEach(sym => {
            if (!presentSet.has(sym)) {
                filtered.push({
                    symbol: `${sym}USDT`,
                    price: 0,
                    volume24h: 0,
                    change8am: 0,
                    change: 0,
                    isNew: false,
                    openPrice: 0,
                    highPrice: 0,
                    lowPrice: 0
                });
            }
        });
    } else {
        // Standard Filters apply ONLY to coins NOT in the Major Trend Candidate list, 
        // OR if Major Trend is not active at all.
        // If Major Trend IS active, these candidates represent a different selection logic.
        filtered = allCandidates.filter(i => {
            // Basic Volume filter usually applies to everyone for safety
            if ((i.volume24h || 0) < config.minVolume) return false;
            if (config.maxVolume > 0 && (i.volume24h || 0) > config.maxVolume) return false;

            // If this symbol is part of the Major Trend discovery, it BYPASSES regular change filters
            if (isMajorTrendActive && majorTrendCandidates.has(i.symbol)) return true;

            // Regular filters for Config A / Standard Mode
            if (config.source === 'GAINERS' && (i.change || 0) <= 0) return false;
            if (config.source === 'LOSERS' && (i.change || 0) >= 0) return false;
            if (Math.abs(i.change || 0) < config.minChange) return false;

            return true;
        });

        // Custom Symbol Filter for other views
        if (config.useCustomOnly && fixedModeView !== 'SEARCH') {
            filtered = filtered.filter(i => {
                const rawSym = i.symbol.replace('USDT', '').toUpperCase();
                return upperCustomSymbolSet.has(rawSym);
            });
        }
    }

    // 3. Sorting
    filtered.sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0));

    // 4. Limit
    if (config.limit > 0 && filtered.length > config.limit) {
        filtered = filtered.slice(0, config.limit);
    }

    return {
        list1: filtered,
        stats: { up, down, total: up + down, btcChange }
    };
}
