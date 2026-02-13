
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
    customSymbolSet: Set<string>
): { list1: ScannerItem[], stats: MarketStats } {
    
    let up = 0, down = 0, btcChange = 0;
    const allCandidates: ScannerItem[] = [];

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

        const price = parseFloat(t.lastPrice);
        const volume = parseFloat(t.quoteVolume); // Raw volume

        // SANITATION
        if (isNaN(price) || price <= 0) return;

        // Use API provided change percent directly (Handles both 24hr and tradingDay logic automatically)
        // tradingDay endpoint returns 'priceChangePercent' relative to 00:00 UTC
        const change = parseFloat(t.priceChangePercent);
        
        // Convert Volume to Millions
        const volumeM = volume / 1000000;

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
            isNew: false 
        });
    });

    // 2. Filter Logic
    let filtered = allCandidates.filter(i => (i.volume24h || 0) >= config.minVolume);

    if (config.source === 'GAINERS') {
        filtered = filtered.filter(i => (i.change || 0) > 0);
    } else if (config.source === 'LOSERS') {
        filtered = filtered.filter(i => (i.change || 0) < 0);
    }

    // Volatility Filter (Absolute change >= minChange)
    filtered = filtered.filter(i => Math.abs(i.change || 0) >= config.minChange);

    // Custom Symbol Filter
    if (config.useCustomOnly) {
        filtered = filtered.filter(i => {
            const rawSym = i.symbol.replace('USDT', '');
            return customSymbolSet.has(rawSym);
        });
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
