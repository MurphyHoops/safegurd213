
import React, { useState, useMemo, useEffect } from 'react';
import { Position, PositionSide } from '../../../types';
import { Activity, ArrowUp, ArrowDown, Filter, Layers, TrendingUp, TrendingDown, CheckCircle2, AlertCircle, RefreshCw, Plus } from 'lucide-react';
import { COLUMN_WIDTH_CLASS } from '../../../components/Scanner/scannerTypes';
import { normalizeSymbol, resolvePrice, isMajorCoin } from '../../../services/symbolUtils';
import { LivePositionRow } from './PositionRow';
import { fetchWithFallback } from '../../../services/apiService';

/**
 * 🔒 [CODE LOCK - MANUAL TRADING ENGINE FOR LIST 5]
 * CRITICAL: The manual order opening engine, symbol checker, and UI are now locked.
 * Do NOT modify this section unless explicitly instructed to fix a critical regression.
 */

interface List5Props {
    moduleStats: {
        symbolCount: number;
        totalValue: number;
        totalPnl: number;
        symbolsWithNoPrice?: number;
        missingSymbols?: string[];
    };
    sortedActivePositions: Position[];
    realPrices: Record<string, number>;
    setChartData: (data: any) => void;
    onClosePosition: (symbol: string, side: PositionSide) => void;
    list5Sort: 'DESC' | 'ASC';
    setList5Sort: (v: 'DESC' | 'ASC') => void;
}

const List5_Live: React.FC<List5Props> = ({ 
    moduleStats, sortedActivePositions, realPrices, setChartData, onClosePosition,
    list5Sort, setList5Sort
}) => {
    const [filterSide, setFilterSide] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
    const [filterPnL, setFilterPnL] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
    const [serverIp, setServerIp] = useState<string>("Loading...");

    useEffect(() => {
        fetch("/api/network/ip")
            .then(res => res.json())
            .then(data => setServerIp(data.ip))
            .catch(() => setServerIp("Failed"));
    }, []);

    // Manual Trading panel states
    const [manualSymbol, setManualSymbol] = useState('');
    const [manualSide, setManualSide] = useState<PositionSide>(PositionSide.LONG);
    const [manualAmount, setManualAmount] = useState<number | undefined>(undefined);
    const [verifyStatus, setVerifyStatus] = useState<'unverified' | 'verifying' | 'verified' | 'failed'>('unverified');
    const [verifiedPrice, setVerifiedPrice] = useState<number | null>(null);

    const filteredList = useMemo(() => {
        return sortedActivePositions.filter(p => {
            // Side Filter
            if (filterSide === 'LONG' && p.side !== PositionSide.LONG) return false;
            if (filterSide === 'SHORT' && p.side !== PositionSide.SHORT) return false;
            
            // PnL Filter
            if (filterPnL === 'WIN' && p.unrealizedPnL <= 0) return false;
            if (filterPnL === 'LOSS' && p.unrealizedPnL >= 0) return false;
            
            return true;
        });
    }, [sortedActivePositions, filterSide, filterPnL]);

    // Verify symbol on Binance Exchange (futures REST API check)
    const handleVerifySymbol = async () => {
        if (!manualSymbol.trim()) {
            setVerifyStatus('failed');
            return;
        }
        
        setVerifyStatus('verifying');
        setVerifiedPrice(null);
        
        const clean = manualSymbol.trim().toUpperCase();
        const candidates = [clean];
        if (!clean.endsWith('USDT')) {
            candidates.push(clean + 'USDT');
        }
        
        const isMajor = isMajorCoin(clean);
        if (!isMajor && !clean.startsWith('1000')) {
            candidates.push('1000' + clean + 'USDT');
            candidates.push('1000' + clean);
        }

        // 1. Instant check against local prices
        for (const cand of candidates) {
            if (realPrices && realPrices[cand]) {
                setVerifiedPrice(realPrices[cand]);
                setVerifyStatus('verified');
                return;
            }
        }

        // 2. Network verification with proxy support
        for (const cand of candidates) {
            try {
                const symbolParam = cand.endsWith('USDT') ? cand : cand + 'USDT';
                const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbolParam}`;
                const response = await fetchWithFallback(url);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.symbol === symbolParam) {
                        const price = parseFloat(data.price);
                        if (price && !isNaN(price)) {
                            setVerifiedPrice(price);
                            setVerifyStatus('verified');
                            return;
                        }
                    }
                }
            } catch (err) {
                console.warn('[Verify] Symbol check failed for: ' + cand, err);
            }
        }

        setVerifyStatus('failed');
    };

    // Fast order execution
    const handleImmediateOpen = () => {
        if (!manualSymbol.trim()) {
            alert('请输入币名！');
            return;
        }
        if (!manualAmount || manualAmount <= 0) {
            alert('请输入合法的开仓金额 (U)！');
            return;
        }

        const cleanSymbol = normalizeSymbol(manualSymbol);
        const price = verifiedPrice || realPrices[cleanSymbol] || realPrices[manualSymbol];
        
        if (!price || price <= 0) {
            alert('未能获取当前价格，无法进行U值计算，请先核验币种！');
            return;
        }

        const quantity = manualAmount / price;

        if (typeof (window as any).openPositionManual === 'function') {
            (window as any).openPositionManual(cleanSymbol, manualSide, quantity);
            alert(`已向模拟器发送手动极速开仓信号:\n代币: ${cleanSymbol}\n方向: ${manualSide === PositionSide.LONG ? '多 (LONG)' : '空 (SHORT)'}\n金额: ${manualAmount} U\n计算数量: ${quantity.toFixed(4)}`);
            
            // Clear panel inputs on success
            setManualSymbol('');
            setManualAmount(undefined);
            setVerifyStatus('unverified');
            setVerifiedPrice(null);
        } else {
            alert('系统开仓核心接口尚未就绪，请刷新重试！');
        }
    };

    // Expose setter for K-line transfer button
    useEffect(() => {
        (window as any).setManualSymbol = setManualSymbol;
        return () => { delete (window as any).setManualSymbol; };
    }, []);

    return (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS}`}>
            <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2 shrink-0">
                <div className="font-bold text-emerald-400 text-sm flex items-center gap-2">
                    <Activity size={14}/> 5. 战场实况 (LIVE)
                    <button 
                        onClick={() => {
                            navigator.clipboard.writeText(serverIp);
                            alert(`已复制 IP: ${serverIp}`);
                        }}
                        className="ml-auto text-[10px] text-slate-500 hover:text-white bg-slate-800 px-1.5 py-0.5 rounded transition-colors"
                        title="点击复制当前连接IP"
                    >
                        IP: {serverIp}
                    </button>
                </div>
                <div className="bg-slate-800/50 p-2 rounded border border-slate-700 flex justify-between items-center text-[10px]">
                    <span className="text-slate-500">总持仓: <span className="text-white font-bold">{moduleStats.symbolCount}</span></span>
                    <span className="text-slate-500">浮盈: <span className={`font-bold ${moduleStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{moduleStats.totalPnl.toFixed(1)}</span></span>
                </div>
                {moduleStats.symbolsWithNoPrice && moduleStats.symbolsWithNoPrice > 0 && (
                    <div className="bg-red-900/20 text-red-500 text-[10px] p-1.5 rounded border border-red-500/30 flex flex-col gap-1 animate-pulse">
                        <div className="flex items-center gap-1.5 font-bold">
                            <AlertCircle size={12} />
                            <span>警告: {moduleStats.symbolsWithNoPrice} 个币种缺少价格</span>
                        </div>
                        <div className="text-[9px] opacity-80 grid grid-cols-2 gap-x-2 px-4 italic">
                            {moduleStats.missingSymbols?.map(s => <span key={s}>• {s}</span>)}
                        </div>
                        <div className="mt-1 px-4 text-[8px] text-red-400/60 leading-tight">
                            提示: 请尝试点击上方“抓取价格”或“重连WS”
                        </div>
                    </div>
                )}
            </div>

            {/* 🔒 Manual Trading Component Area */}
            <div className="p-3 bg-slate-950/40 border-b border-slate-800 space-y-2.5 shrink-0">
                <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                    <span className="flex items-center gap-1"><Plus size={12} className="text-emerald-400" /> 手动极速开仓</span>
                    <span className="text-[9px] text-slate-500 font-normal">直接挂接模拟引擎</span>
                </div>
                
                <div className="space-y-2">
                    {/* Symbol input + verify button */}
                    <div className="flex gap-1.5">
                        <div className="relative flex-1">
                            <input 
                                type="text"
                                value={manualSymbol}
                                onChange={(e) => {
                                    setManualSymbol(e.target.value);
                                    setVerifyStatus('unverified');
                                }}
                                placeholder="代币 (如: BTC, SOL)"
                                className="w-full bg-slate-950/80 border border-slate-800 focus:border-slate-700 rounded px-2.5 py-1 text-xs text-white uppercase placeholder-slate-600 font-bold tracking-wide"
                            />
                            {verifyStatus === 'verifying' && (
                                <span className="absolute right-2 top-2 text-[9px] text-amber-500 animate-pulse font-sans">检测中...</span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={handleVerifySymbol}
                            disabled={verifyStatus === 'verifying'}
                            className={`px-2 py-1 text-[10px] font-bold rounded flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                                verifyStatus === 'verified' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30' :
                                verifyStatus === 'failed' ? 'bg-red-950/80 text-red-400 border border-red-500/30' :
                                'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-750 hover:text-white'
                            }`}
                            title="验证币安交易所是否存在此合约"
                        >
                            <RefreshCw size={11} className={verifyStatus === 'verifying' ? 'animate-spin' : ''} />
                            {verifyStatus === 'verified' ? '已确认' : verifyStatus === 'failed' ? '未找到' : '核验'}
                        </button>
                    </div>

                    {/* Show verified price or warning */}
                    {verifyStatus === 'verified' && verifiedPrice !== null && (
                        <div className="text-[9px] text-emerald-400/90 flex items-center gap-1 px-1.5 bg-emerald-950/20 py-0.5 rounded border border-emerald-500/10">
                            <span className="font-bold">✓ 币安存在:</span>
                            <span className="font-mono">参考价: ${verifiedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
                        </div>
                    )}
                    {verifyStatus === 'failed' && (
                        <div className="text-[9px] text-red-400 flex items-center gap-1 px-1.5 bg-red-950/20 py-0.5 rounded border border-red-500/10">
                            <span>✗ 币安未找到此币种（请检查或稍后核验）</span>
                        </div>
                    )}

                    {/* Side Toggle + Qty Input */}
                    <div className="flex gap-2 items-center">
                        {/* Side selector */}
                        <div className="flex bg-slate-950/50 rounded border border-slate-800 p-0.5 flex-1">
                            <button
                                type="button"
                                onClick={() => setManualSide(PositionSide.LONG)}
                                className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                                    manualSide === PositionSide.LONG 
                                        ? 'bg-emerald-600 text-white font-black shadow-sm' 
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                多 (Long)
                            </button>
                            <button
                                type="button"
                                onClick={() => setManualSide(PositionSide.SHORT)}
                                className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                                    manualSide === PositionSide.SHORT 
                                        ? 'bg-red-600 text-white font-black shadow-sm' 
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                空 (Short)
                            </button>
                        </div>

                        {/* Amount Input */}
                        <div className="w-[100px]">
                            <input 
                                type="number"
                                step="any"
                                value={manualAmount ?? ''}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setManualAmount(isNaN(val) ? undefined : val);
                                }}
                                placeholder="金额 (U)"
                                className="w-full bg-slate-950/80 border border-slate-800 focus:border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 font-bold text-right font-mono"
                            />
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="button"
                        onClick={handleImmediateOpen}
                        className="w-full py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] transition-all text-white font-bold text-xs rounded shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <span>立即开仓</span>
                    </button>
                </div>
            </div>
            
            {/* Control Bar */}
            <div className="px-2 py-2 bg-emerald-950/20 border-b border-slate-800 flex flex-col gap-2 sticky top-0 z-10">
                <div className="flex justify-between items-center">
                    <div className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-1">
                        <Filter size={10} /> 筛选与排序
                    </div>
                    {/* Sort Toggle */}
                    <button 
                        onClick={() => setList5Sort(list5Sort === 'DESC' ? 'ASC' : 'DESC')} 
                        className="flex items-center gap-1 text-[9px] bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-slate-300 hover:text-white transition-colors"
                    >
                        {list5Sort === 'DESC' ? '盈亏: 高→低' : '盈亏: 低→高'}
                        {list5Sort === 'DESC' ? <ArrowDown size={10}/> : <ArrowUp size={10}/>}
                    </button>
                </div>

                {/* Filters Row */}
                <div className="flex gap-1">
                    {/* Side Filter */}
                    <div className="flex bg-slate-800 rounded p-0.5 border border-slate-700 flex-1">
                        <button onClick={() => setFilterSide('ALL')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterSide === 'ALL' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>全</button>
                        <button onClick={() => setFilterSide('LONG')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterSide === 'LONG' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-emerald-500'}`}>多</button>
                        <button onClick={() => setFilterSide('SHORT')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterSide === 'SHORT' ? 'bg-red-600 text-white' : 'text-slate-500 hover:text-red-500'}`}>空</button>
                    </div>
                    
                    {/* PnL Filter */}
                    <div className="flex bg-slate-800 rounded p-0.5 border border-slate-700 flex-1">
                        <button onClick={() => setFilterPnL('ALL')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterPnL === 'ALL' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>全</button>
                        <button onClick={() => setFilterPnL('WIN')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterPnL === 'WIN' ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-500/30' : 'text-slate-500 hover:text-emerald-400'}`}>盈</button>
                        <button onClick={() => setFilterPnL('LOSS')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${filterPnL === 'LOSS' ? 'bg-red-900/50 text-red-400 border border-red-500/30' : 'text-slate-500 hover:text-red-400'}`}>亏</button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-emerald-900/5">
                {filteredList.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 text-slate-500">
                        <Activity size={40} className="mb-2"/>
                        <span className="text-[10px] font-bold">无符合条件的持仓</span>
                    </div>
                )}
                {filteredList.map((pos, idx) => (
                    <LivePositionRow 
                        key={`${pos.entryId}-${idx}`} 
                        position={pos} 
                        realPrice={resolvePrice(pos.symbol, realPrices, pos.markPrice || pos.entryPrice)}
                        setChartData={setChartData}
                        onClosePosition={onClosePosition}
                    />
                ))}
            </div>
        </div>
    );
};

export default List5_Live;

