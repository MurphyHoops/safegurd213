
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TrendHunterSettings, PositionSide, ALL_BINANCE_SYMBOLS, Position } from '../types';
import { Play, Shield, Target, Activity, Settings, BarChart2, Zap, AlertTriangle, ArrowRight, X, Info, RefreshCw, Calendar, Clock, Loader2, Filter, Search, Minus, ChevronRight, CheckSquare, Square, Layers, PlusCircle, Timer, Flame, Gauge, Waves, TrendingUp, TrendingDown, MousePointer2, Trash2, Calculator, Crosshair, WifiOff, ArrowUpDown, Database, History, Radio, Radar, CheckCircle2, AlertCircle, Clock3, Palette, Ruler, Rocket, Monitor } from 'lucide-react';
import { audioService } from '../services/audioService';
import { calculateEMA, calculateATR, calculateRSI, calculateBollingerBands } from '../services/indicators';
import { fetchWithFallback } from '../services/apiService';
import KlineChartModal from './KlineChartModal';

interface Props {
    settings: TrendHunterSettings;
    positions?: Position[]; 
    onUpdateSettings: (key: keyof TrendHunterSettings, value: any) => void;
    onClose: () => void;
    onExecute: (symbol: string, side: PositionSide, price: number, atr: number, isAuto: boolean, ema80?: number, ema20?: number, timeframe?: string, reason?: string, extra?: any) => void;
    onClosePosition?: (symbol: string, side: PositionSide) => void;
}

interface ScannerItem {
    symbol: string;
    price: number;
    volume24h?: number; 
    change8am?: number; 
    volume?: string;
    change?: number;
    volumeVal?: number;
    emaDetails?: {
        ema10: number;
        ema20: number;
        ema30: number;
        ema40: number;
        ema80: number;
    };
    direction?: 'LONG' | 'SHORT' | 'NEUTRAL';
    candleShape?: {
        amplitude: number;
        bodyRatio: number;
        valid: boolean;
        signalPrice: number; 
    };
    breakout?: {
        triggerPrice: number;
        isBroken: boolean;
    };
}

const TrendHunterPanel: React.FC<Props> = ({ settings, positions = [], onUpdateSettings, onClose, onExecute, onClosePosition }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [currentScanTF, setCurrentScanTF] = useState<string | null>(null);
    const [isMockMode, setIsMockMode] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null); // New Error State
    
    // Config State
    const [scanConfig, setScanConfig] = useState({ 
        timeBasis: '24H' as '8AM' | '24H', 
        source: 'GAINERS' as 'GAINERS' | 'LOSERS' | 'BOTH', 
        minVolume: 10, 
        minChange: 3 
    });

    const [stepLists, setStepLists] = useState<{step1: ScannerItem[], step2: ScannerItem[], step3: ScannerItem[], step4: ScannerItem[], step5: Position[]}>({ 
        step1: [], step2: [], step3: [], step4: [], step5: [] 
    });
    
    const activeTrendPositions = positions.filter(p => p.strategyId === 'TREND_HUNTER');

    useEffect(() => {
        setStepLists(prev => ({ ...prev, step5: activeTrendPositions }));
    }, [positions]);

    const mockDelay = (ms: number) => new Promise(r => setTimeout(r, ms));

    const performScan = async () => {
        setIsScanning(true);
        setScanError(null);
        setStepLists(prev => ({ ...prev, step1: [], step2: [], step3: [], step4: [] }));
        
        try {
            setCurrentScanTF("正在拉取全市场数据...");
            
            // Dynamic endpoint with correct caching strategy
            let endpoint = '';
            if (scanConfig.timeBasis === '8AM') {
                endpoint = 'https://fapi.binance.com/fapi/v1/ticker/tradingDay';
            } else {
                endpoint = `https://fapi.binance.com/fapi/v1/ticker/24hr`;
            }
            
            // Use validator to ensure data is an array
            const validator = (data: any) => Array.isArray(data) && data.length > 0;
            const res = await fetchWithFallback(endpoint, { cache: 'default' }, validator);
            const rawData = await res.json();
            
            if (!Array.isArray(rawData)) {
                throw new Error("Invalid API Response: Expected Array");
            }

            setIsMockMode(false);
            
            // --- CORE LOGIC: List 1 Selection ---
            const minVolRaw = scanConfig.minVolume * 1000000;
            const minChange = scanConfig.minChange;

            // 1. Basic Filtering & Data Processing
            // Combined map/filter pass for efficiency and sanitation
            let items = rawData.map((t: any): ScannerItem | null => {
                // Constraint: USDT Perpetuals only
                if (!t.symbol || !t.symbol.endsWith('USDT')) return null;
                
                // SANITATION: Check for valid price
                const currentPrice = parseFloat(t.lastPrice);
                const openPrice = parseFloat(t.openPrice);
                if (isNaN(currentPrice) || currentPrice <= 0 || isNaN(openPrice) || openPrice <= 0) return null;

                // Constraint: Volume Filter
                const volVal = parseFloat(t.quoteVolume);
                if (volVal < minVolRaw) return null;

                // VERIFICATION: Manual Change Calc
                // For tradingDay, priceChangePercent is provided.
                const changePercent = parseFloat(t.priceChangePercent);

                return {
                    symbol: t.symbol,
                    price: currentPrice,
                    volume: (volVal / 1000000).toFixed(1),
                    change: changePercent,
                    volumeVal: volVal
                };
            }).filter((item): item is ScannerItem => item !== null);

            // 3. Core Filters (Source & Volatility)
            items = items.filter((item: any) => {
                const change = item.change;
                
                // Filter A: Scan Source
                if (scanConfig.source === 'GAINERS' && change <= 0) return false;
                if (scanConfig.source === 'LOSERS' && change >= 0) return false;
                
                // Filter C: Volatility Threshold
                if (Math.abs(change) < minChange) return false;

                return true;
            });

            // 4. Sorting Logic
            items.sort((a: any, b: any) => {
                if (scanConfig.source === 'GAINERS') {
                    // Descending change
                    return b.change - a.change;
                } else if (scanConfig.source === 'LOSERS') {
                    // Ascending change (most negative first) e.g. -20 < -5
                    return a.change - b.change;
                } else {
                    // BOTH: Sort by absolute volatility
                    return Math.abs(b.change) - Math.abs(a.change);
                }
            });

            // Constraint: Top 200 Limit
            const step1Results = items.slice(0, 200);
            
            setStepLists(prev => ({ ...prev, step1: step1Results }));
            await mockDelay(300);

            // --- MOCK PIPELINE FOR DEMO (Lists 2-4) ---
            const step2 = step1Results.slice(0, Math.floor(step1Results.length * 0.6));
            setStepLists(prev => ({ ...prev, step2 }));
            
            const step3 = step2.filter(() => Math.random() > 0.5).map((i: any) => ({ ...i, direction: i.change! > 0 ? 'LONG' : 'SHORT' as any }));
            setStepLists(prev => ({ ...prev, step3 }));

            const step4 = step3.filter(() => Math.random() > 0.6);
            setStepLists(prev => ({ ...prev, step4 }));

            audioService.speak(`扫描完成，筛选出 ${step1Results.length} 个活跃币种`);

        } catch (e: any) { 
            console.error(e);
            setScanError(e.message || "网络异常，无法获取市场数据");
            setStepLists(prev => ({ ...prev, step1: [] }));
            audioService.speak("网络异常，无法获取数据");
        } finally { 
            setIsScanning(false); 
            setCurrentScanTF(null); 
        }
    };

    // --- UI Components ---

    const ControlPanel = () => (
        <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-3 select-none">
            {/* Title & Info Tooltip */}
            <div className="flex items-center justify-between text-orange-500 mb-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                    <Filter size={14} className="fill-orange-500/20" /> 
                    <span>1. 选币与初筛 (SELECTION)</span>
                </div>
            </div>

            {/* Config Box */}
            <div className="bg-[#12161f] p-3 rounded-lg border border-slate-800 space-y-3">
                {/* 1. Time Basis Selection */}
                <div className="flex gap-2">
                    <button 
                        onClick={() => setScanConfig(p => ({...p, timeBasis: '8AM'}))}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all flex items-center justify-center gap-1.5 ${
                            scanConfig.timeBasis === '8AM' 
                            ? 'bg-slate-800 text-blue-400 border-blue-500/50 shadow-sm' 
                            : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'
                        }`}
                    >
                        <Calendar size={10} /> 8AM (Daily)
                    </button>
                    <button 
                        onClick={() => setScanConfig(p => ({...p, timeBasis: '24H'}))}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all flex items-center justify-center gap-1.5 ${
                            scanConfig.timeBasis === '24H' 
                            ? 'bg-slate-800/50 text-orange-400 border-orange-500/50 shadow-sm' 
                            : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'
                        }`}
                    >
                        <Clock size={10} /> 24H (Roll)
                    </button>
                </div>

                {/* 2. Source Selection */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setScanConfig(p => ({...p, source: 'GAINERS'}))}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${
                            scanConfig.source === 'GAINERS' 
                            ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/50 shadow-sm' 
                            : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'
                        }`}
                    >
                        涨幅榜
                    </button>
                    <button
                        onClick={() => setScanConfig(p => ({...p, source: 'LOSERS'}))}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${
                            scanConfig.source === 'LOSERS' 
                            ? 'bg-red-900/30 text-red-400 border-red-500/50 shadow-sm' 
                            : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'
                        }`}
                    >
                        跌幅榜
                    </button>
                    <button
                        onClick={() => setScanConfig(p => ({...p, source: 'BOTH'}))}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${
                            scanConfig.source === 'BOTH' 
                            ? 'bg-indigo-900/30 text-indigo-400 border-indigo-500/50 shadow-sm' 
                            : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'
                        }`}
                    >
                        全部 (All)
                    </button>
                </div>

                {/* 3. Numeric Inputs */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1">成交额 &gt; M</label>
                        <input 
                            type="number" 
                            value={scanConfig.minVolume}
                            onChange={e => setScanConfig(p => ({...p, minVolume: parseFloat(e.target.value)}))}
                            className="w-full bg-[#1e2329] border border-slate-700 rounded px-2 py-2 text-xs text-white text-center font-mono focus:border-orange-500 outline-none transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1">涨跌幅 &gt; %</label>
                        <input 
                            type="number" 
                            value={scanConfig.minChange}
                            onChange={e => setScanConfig(p => ({...p, minChange: parseFloat(e.target.value)}))}
                            className="w-full bg-[#1e2329] border border-slate-700 rounded px-2 py-2 text-xs text-white text-center font-mono focus:border-orange-500 outline-none transition-colors"
                        />
                    </div>
                </div>

                {/* 3.5 Smart Scan Status (Simulated) */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded p-2 flex items-center justify-center gap-2 text-[10px] text-slate-400">
                    {isScanning ? (
                        <>
                            <Loader2 size={12} className="animate-spin text-orange-400" />
                            <span>正在全域扫描中... {stepLists.step1.length}/200</span>
                        </>
                    ) : scanError ? (
                        <span className="text-red-400 flex items-center gap-1"><AlertTriangle size={12}/> {scanError.substring(0, 20)}...</span>
                    ) : (
                        <>
                            <RefreshCw size={12} className="text-slate-600" />
                            <span>智能扫描准备就绪 (3m: 11/44)</span>
                        </>
                    )}
                </div>

                {/* 4. Scan Button (Big Orange) */}
                <button 
                    onClick={performScan}
                    disabled={isScanning}
                    className="w-full py-3 bg-[#e85d04] hover:bg-[#d04f00] text-white font-bold rounded text-sm flex items-center justify-center gap-2 shadow-lg shadow-orange-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-700"
                >
                    <Search size={16} />
                    {isScanning ? '正在执行扫描...' : '手动执行全域扫描'}
                </button>
            </div>
        </div>
    );

    const renderColumn = (
        title: string, 
        data: any[], 
        headerContent: React.ReactNode, 
        renderItem: (item: any, idx: number) => React.ReactNode, 
        width: string = 'w-64'
    ) => (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 shrink-0 ${width}`}>
            {headerContent}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar bg-slate-950/20">
                {data.map((item, idx) => renderItem(item, idx))}
                {data.length === 0 && !isScanning && (
                    <div className="flex flex-col items-center justify-center h-full text-slate-700 opacity-50">
                        <Minus size={24} />
                        <span className="text-[10px] mt-2">暂无数据</span>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col font-sans select-none text-slate-200">
            {/* 顶栏 (Top Navigation) */}
            <div className="h-14 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-6 shrink-0 shadow-2xl relative z-20">
                <div className="flex items-center gap-4">
                    <div className="p-1.5 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg shadow-lg shadow-orange-900/50">
                        <Zap size={20} fill="white" className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                            趋势猎手 (Trend Hunter)
                        </h2>
                        <p className="text-[10px] text-slate-500 font-mono tracking-wide">
                            猎手堡垒协议 v2.0 | 5-Dimensional Resonance
                        </p>
                    </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 hover:text-white transition-all"><X size={20} /></button>
            </div>

            {/* 主内容区 (Main Content) */}
            <div className="flex-1 flex overflow-hidden relative z-10">
                
                {/* Column 1: Config & List 1 */}
                <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 shrink-0 w-[300px]">
                    <ControlPanel />
                    {/* List 1 Header */}
                    <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex justify-between items-end">
                        <div className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                            1. 趋势筛选 (TREND FILTER)
                        </div>
                        <div className="text-[10px] font-mono text-white font-bold">
                            {stepLists.step1.length} ITEMS
                        </div>
                    </div>
                    {/* List 1 Subheader Info */}
                    <div className="px-3 py-1.5 bg-slate-950/50 border-b border-slate-800 text-[9px] text-slate-600 font-mono flex items-center gap-2">
                        <span className="text-orange-500/80">&gt; {scanConfig.minVolume}M</span>
                        <span className="text-slate-700">|</span>
                        <span>{scanConfig.source}</span>
                    </div>
                    {/* List 1 Body */}
                    <div className="flex-1 overflow-y-auto p-0 custom-scrollbar bg-slate-950/20">
                        {stepLists.step1.map((item, idx) => (
                            <div key={item.symbol} className="px-3 py-3 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm font-bold text-slate-200 group-hover:text-white">{item.symbol.replace('USDT','')}</span>
                                    <span className={`text-sm font-mono font-bold ${item.change! > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {item.change! > 0 ? '+' : ''}{item.change?.toFixed(2)}%
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                                    <span>Vol: <span className="text-slate-400">{item.volume}M</span></span>
                                    <span className="text-slate-600">{item.price}</span>
                                </div>
                            </div>
                        ))}
                        {stepLists.step1.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-32 text-slate-700 opacity-50">
                                <Minus size={24} />
                                <span className="text-[10px] mt-2">暂无数据</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Placeholder for Columns 2-5 (Generic Render for now to focus on List 1) */}
                <div className="flex-1 flex overflow-x-auto bg-slate-950/40">
                    {renderColumn(
                        "2. 动能热度", 
                        stepLists.step2,
                        <div className="p-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
                            <div className="flex items-center gap-2 font-bold text-red-400 text-xs uppercase"><Flame size={14}/> 2. 动能筛选</div>
                            <div className="text-xs font-mono font-bold text-white">{stepLists.step2.length}</div>
                        </div>,
                        (item) => (
                            <div key={item.symbol} className="bg-slate-800/40 p-2 rounded border border-slate-700/50">
                                <span className="text-xs font-bold text-slate-300">{item.symbol.replace('USDT','')}</span>
                            </div>
                        )
                    )}
                    {renderColumn(
                        "3. 共振节点", 
                        stepLists.step3,
                        <div className="p-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
                            <div className="flex items-center gap-2 font-bold text-blue-400 text-xs uppercase"><Waves size={14}/> 3. 共振节点</div>
                            <div className="text-xs font-mono font-bold text-white">{stepLists.step3.length}</div>
                        </div>,
                        (item) => (
                            <div key={item.symbol} className="bg-slate-800/40 p-2 rounded border border-slate-700/50 flex justify-between">
                                <span className="text-xs font-bold text-slate-300">{item.symbol.replace('USDT','')}</span>
                                <span className={`text-[10px] px-1 rounded ${item.direction === 'LONG' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{item.direction}</span>
                            </div>
                        )
                    )}
                    {renderColumn(
                        "4. 爆发猎杀", 
                        stepLists.step4,
                        <div className="p-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
                            <div className="flex items-center gap-2 font-bold text-orange-400 text-xs uppercase"><Target size={14}/> 4. 爆发猎杀</div>
                            <div className="text-xs font-mono font-bold text-white">{stepLists.step4.length}</div>
                        </div>,
                        (item) => (
                            <div key={item.symbol} className="bg-slate-800/40 p-2 rounded border border-slate-700/50 group hover:border-orange-500/30 transition-colors">
                                <div className="flex justify-between mb-2">
                                    <span className="text-xs font-bold text-slate-300">{item.symbol.replace('USDT','')}</span>
                                    <span className={`text-[10px] font-bold ${item.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{item.direction}</span>
                                </div>
                                <button 
                                    onClick={() => onExecute(item.symbol, item.direction === 'LONG' ? PositionSide.LONG : PositionSide.SHORT, item.price, item.price*0.02, false)}
                                    className="w-full py-1 bg-orange-600/80 hover:bg-orange-500 text-white text-[10px] font-bold rounded flex items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition-all"
                                >
                                    <Zap size={10} fill="currentColor"/> 部署
                                </button>
                            </div>
                        )
                    )}
                    
                    {/* Active Positions Column */}
                    {renderColumn(
                        "5. 战场实况", 
                        stepLists.step5,
                        <div className="p-3 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
                            <div className="flex items-center gap-2 font-bold text-emerald-400 text-xs uppercase"><Activity size={14}/> 5. 战场实况</div>
                            <div className="text-xs font-mono font-bold text-white">{stepLists.step5.length}</div>
                        </div>,
                        (p: Position) => (
                            <div key={p.symbol} className="bg-slate-800/80 p-3 rounded border border-slate-700 relative overflow-hidden">
                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${p.unrealizedPnL >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-bold text-white">{p.symbol}</span>
                                    <span className={`text-[10px] font-mono font-bold ${p.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{p.unrealizedPnLPercentage.toFixed(2)}%</span>
                                </div>
                                <div className="flex justify-end">
                                    <button onClick={() => onClosePosition?.(p.symbol, p.side)} className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-1"><Trash2 size={10}/> 撤单</button>
                                </div>
                            </div>
                        ),
                        'w-72'
                    )}
                </div>
            </div>
        </div>
    );
};

export default TrendHunterPanel;
