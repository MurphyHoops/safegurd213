
import React from 'react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput, MarketSentimentWidget } from '../../../components/Scanner/ScannerUIHelpers';

import { MajorTrendSection } from './MajorTrendSection';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    marketStats: any;
    // Major Trend Props
    majorTrendCandidates?: Set<string>;
    isMajorScanning?: boolean;
    majorProgress?: { current: number, total: number };
    runMajorTrendDiscovery?: () => void;
}

export const FilterSection: React.FC<Props> = ({ 
    scanConfig, setScanConfig, marketStats, 
    majorTrendCandidates, isMajorScanning, majorProgress, runMajorTrendDiscovery 
}) => {
    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
            {/* Mode Switcher - Updates activeMode in parent, triggering independent config load */}
            <div className="flex gap-2">
                <button 
                    onClick={() => setScanConfig(p => ({
                        ...p, 
                        timeBasis: '8AM',
                        majorTrend: p.majorTrend ? { ...p.majorTrend, enabled: false } : p.majorTrend
                    }))} 
                    className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${scanConfig.timeBasis === '8AM' ? 'bg-slate-800 text-blue-400 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'}`}
                >
                    配置 A (常规模式)
                </button>
                <button 
                    onClick={() => setScanConfig(p => ({
                        ...p, 
                        timeBasis: '24H',
                        majorTrend: p.majorTrend ? { ...p.majorTrend, enabled: true } : p.majorTrend
                    }))} 
                    className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${scanConfig.timeBasis === '24H' ? 'bg-slate-800 text-indigo-400 border-indigo-500/50 shadow-[0_0_10px_rgba(99,102,241,0.3)]' : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'}`}
                >
                    大行情发现模式
                </button>
            </div>
            
            <MarketSentimentWidget stats={marketStats}/>
            
            {/* Conditional Content based on Mode */}
            {scanConfig.timeBasis === '8AM' ? (
                <div className="space-y-3 animate-in fade-in slide-in-from-left-2 duration-300">
                    <div className="flex gap-2">
                        {['GAINERS','LOSERS','BOTH'].map(s => (
                            <button key={s} onClick={() => setScanConfig(p => ({...p, source: s as any}))} className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${scanConfig.source === s ? 'bg-indigo-900/30 text-indigo-400 border-indigo-500/50' : 'bg-[#1e2329] text-slate-500 border-slate-700'}`}>{s==='BOTH'?'全部':s==='GAINERS'?'涨幅榜':'跌幅榜'}</button>
                        ))}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex flex-col justify-between px-2">
                            <span className="text-[9px] text-slate-500">成交范围 (M)</span>
                            <div className="flex items-center gap-1 mt-0.5">
                                <SmartNumberInput
                                    value={scanConfig.minVolume}
                                    onChange={val => setScanConfig(p => ({...p, minVolume: val}))}
                                    className="w-full bg-transparent text-center font-mono text-white text-[10px] outline-none border-b border-slate-600 focus:border-indigo-500 p-0"
                                />
                                <span className="text-slate-500 text-[8px]">~</span>
                                <SmartNumberInput
                                    value={scanConfig.maxVolume}
                                    onChange={val => setScanConfig(p => ({...p, maxVolume: val}))}
                                    className="w-full bg-transparent text-center font-mono text-white text-[10px] outline-none border-b border-slate-600 focus:border-indigo-500 p-0"
                                />
                            </div>
                        </div>
                        <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex items-center justify-between px-2">
                            <span className="text-[9px] text-slate-500">涨跌 &gt; %</span>
                            <SmartNumberInput 
                                value={scanConfig.minChange} 
                                onChange={val => setScanConfig(p => ({...p, minChange: val}))} 
                                className="w-8 bg-transparent text-right font-mono text-white text-xs outline-none select-text"
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-3 animate-in fade-in slide-in-from-right-2 duration-300">
                    {/* Simplified Filters for Major Trend Mode (Stage 2) */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex flex-col justify-between px-2">
                            <span className="text-[9px] text-slate-500">Stage 2: 成交范围 (M)</span>
                            <div className="flex items-center gap-1 mt-0.5">
                                <SmartNumberInput
                                    value={scanConfig.minVolume}
                                    onChange={val => setScanConfig(p => ({...p, minVolume: val}))}
                                    className="w-full bg-transparent text-center font-mono text-white text-[10px] outline-none border-b border-slate-600 focus:border-indigo-500 p-0"
                                />
                                <span className="text-slate-500 text-[8px]">~</span>
                                <SmartNumberInput
                                    value={scanConfig.maxVolume}
                                    onChange={val => setScanConfig(p => ({...p, maxVolume: val}))}
                                    className="w-full bg-transparent text-center font-mono text-white text-[10px] outline-none border-b border-slate-600 focus:border-indigo-500 p-0"
                                />
                            </div>
                        </div>
                        <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex items-center justify-between px-2">
                            <span className="text-[9px] text-slate-500">Stage 2: 振幅 &gt; %</span>
                            <SmartNumberInput 
                                value={scanConfig.minChange} 
                                onChange={val => setScanConfig(p => ({...p, minChange: val}))} 
                                className="w-8 bg-transparent text-right font-mono text-white text-xs outline-none select-text"
                            />
                        </div>
                    </div>

                    {/* Major Trend Section - Primary Focus here */}
                    <MajorTrendSection 
                        config={scanConfig.majorTrend}
                        setConfig={(cfg) => setScanConfig(p => ({...p, majorTrend: cfg}))}
                        isMajorScanning={isMajorScanning}
                        majorProgress={majorProgress}
                        candidateCount={majorTrendCandidates?.size || 0}
                        onRunDiscovery={runMajorTrendDiscovery}
                        isPrimaryMode={true}
                    />

                    {/* Stage 1 Results Display (Bottom) */}
                    <div className="pt-2 border-t border-slate-800 flex flex-col h-full min-h-0">
                        <div className="flex items-center justify-between mb-1 gap-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Stage 1 锁定币种 ({majorTrendCandidates?.size || 0})</span>
                            {majorTrendCandidates && majorTrendCandidates.size > 0 && (
                                <button 
                                    onClick={() => {
                                        const candidatesList = Array.from(majorTrendCandidates).map(s => s.replace('USDT', ''));
                                        const currentSymbols = (scanConfig.customSymbols || '').split(',').map(s => s.trim()).filter(Boolean);
                                        const currentSet = new Set(currentSymbols);
                                        candidatesList.forEach(sym => currentSet.add(sym));
                                        setScanConfig(p => ({
                                            ...p,
                                            customSymbols: Array.from(currentSet).join(', ')
                                        }));
                                    }}
                                    className="text-[8px] text-indigo-400 hover:text-indigo-300 font-bold px-1 py-0.5 rounded border border-indigo-500/20 bg-indigo-500/5 transition-all flex items-center shrink-0"
                                    title="一键将大行情发现的所有币种追加移入监控列表"
                                >
                                    ➕ 移入全部
                                </button>
                            )}
                            <div className="h-px flex-1 bg-slate-800" />
                        </div>
                        <div className="bg-black/40 rounded border border-slate-800/30 p-1.5 flex-1 min-h-[50px] max-h-[160px] overflow-y-auto custom-scrollbar">
                            {majorTrendCandidates && majorTrendCandidates.size > 0 ? (
                                <div className="grid grid-cols-4 gap-1">
                                    {Array.from(majorTrendCandidates).sort().map((symbol, idx) => (
                                        <div key={`${symbol}-${idx}`} className="px-1 py-0.5 bg-indigo-500/5 text-indigo-400 border border-indigo-500/10 rounded-[2px] text-[9px] font-mono text-center">
                                            {symbol.replace('USDT', '')}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center py-4 text-center">
                                    <div className="text-[9px] text-slate-600">暂无大行情币种</div>
                                    <div className="text-[8px] text-slate-700 italic">请运行“大行情发现”</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
