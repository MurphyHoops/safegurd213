
import React from 'react';
import { ScanConfig } from '../../../components/Scanner/scannerTypes';
import { SmartNumberInput, MarketSentimentWidget } from '../../../components/Scanner/ScannerUIHelpers';

import { MajorTrendSection } from './MajorTrendSection';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    marketStats: any;
    // Major Trend Props
    isMajorScanning?: boolean;
    majorProgress?: { current: number, total: number };
    runMajorTrendDiscovery?: () => void;
}

export const FilterSection: React.FC<Props> = ({ 
    scanConfig, setScanConfig, marketStats, 
    isMajorScanning, majorProgress, runMajorTrendDiscovery 
}) => {
    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
            {/* Mode Switcher - Updates activeMode in parent, triggering independent config load */}
            <div className="flex gap-2">
                <button 
                    onClick={() => setScanConfig(p => ({
                        ...p, 
                        timeBasis: '8AM',
                        majorTrend: p.majorTrend 
                            ? { ...p.majorTrend, enabled: false } 
                            : { enabled: false, updateIntervalHours: 4, requestPerMinute: 20, lookbackDays: 300, minHistoryDrop: 50, minHistoryPump: 100, maxExtremeDistance: 5, sidewaysDays: 7, sidewaysMaxPump: 10, sidewaysMaxDrop: 10, autoTransfer: false, enableLong: true, enableShort: true, enableSideways: true, maxExtremeDistanceLong: 5, maxExtremeDistanceShort: 5, minExtremeDistanceLong: 0, minExtremeDistanceShort: 0, extremeDaysMinLong: 0, extremeDaysMaxLong: 300, extremeDaysMinShort: 0, extremeDaysMaxShort: 300 }
                    }))} 
                    className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${scanConfig.timeBasis === '8AM' ? 'bg-slate-800 text-blue-400 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'}`}
                >
                    配置 A (常规模式)
                </button>
                <button 
                    onClick={() => setScanConfig(p => ({
                        ...p, 
                        timeBasis: '24H',
                        majorTrend: p.majorTrend 
                            ? { ...p.majorTrend, enabled: true } 
                            : { enabled: true, updateIntervalHours: 4, requestPerMinute: 20, lookbackDays: 300, minHistoryDrop: 50, minHistoryPump: 100, maxExtremeDistance: 5, sidewaysDays: 7, sidewaysMaxPump: 10, sidewaysMaxDrop: 10, autoTransfer: false, enableLong: true, enableShort: true, enableSideways: true, maxExtremeDistanceLong: 5, maxExtremeDistanceShort: 5, minExtremeDistanceLong: 0, minExtremeDistanceShort: 0, extremeDaysMinLong: 0, extremeDaysMaxLong: 300, extremeDaysMinShort: 0, extremeDaysMaxShort: 300 }
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
                        {/* Dual Volume Range Selector */}
                        <div className="col-span-2 bg-[#1e2329] border border-slate-700 rounded p-2 flex flex-col gap-2">
                            <div className="text-[9px] text-slate-500 font-bold border-b border-slate-800 pb-1 flex justify-between items-center">
                                <span>成交范围过滤 (Volume Filter)</span>
                                <span className="text-[8px] text-slate-500 font-normal">可单选或全选</span>
                            </div>
                            
                            {/* 24H Volume Row */}
                            <div className="flex items-center justify-between gap-3 bg-black/10 p-1 rounded border border-slate-800/40">
                                <div className="flex items-center gap-1.5">
                                    <button 
                                        onClick={() => setScanConfig(p => ({...p, enableVol24h: p.enableVol24h === false ? true : false}))}
                                        className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none ${scanConfig.enableVol24h !== false ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${scanConfig.enableVol24h !== false ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                                    </button>
                                    <span className="text-[9px] font-bold text-slate-300">24H 交易额 (M)</span>
                                </div>
                                <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 w-28 justify-center">
                                    <SmartNumberInput
                                        value={scanConfig.minVolume}
                                        onChange={val => {
                                            if (scanConfig.enableVol24h !== false) {
                                                setScanConfig(p => ({...p, minVolume: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${scanConfig.enableVol24h === false ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                    <span className="text-slate-500 text-[8px]">~</span>
                                    <SmartNumberInput
                                        value={scanConfig.maxVolume}
                                        onChange={val => {
                                            if (scanConfig.enableVol24h !== false) {
                                                setScanConfig(p => ({...p, maxVolume: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${scanConfig.enableVol24h === false ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                </div>
                            </div>

                            {/* 8AM Volume Row */}
                            <div className="flex items-center justify-between gap-3 bg-black/10 p-1 rounded border border-slate-800/40">
                                <div className="flex items-center gap-1.5">
                                    <button 
                                        onClick={() => setScanConfig(p => ({...p, enableVol8am: !p.enableVol8am}))}
                                        className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none ${scanConfig.enableVol8am ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${scanConfig.enableVol8am ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                                    </button>
                                    <span className="text-[9px] font-bold text-slate-300">早上8点起 (M)</span>
                                </div>
                                <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 w-28 justify-center">
                                    <SmartNumberInput
                                        value={scanConfig.minVolume8am ?? 1}
                                        onChange={val => {
                                            if (scanConfig.enableVol8am) {
                                                setScanConfig(p => ({...p, minVolume8am: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${!scanConfig.enableVol8am ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                    <span className="text-slate-500 text-[8px]">~</span>
                                    <SmartNumberInput
                                        value={scanConfig.maxVolume8am ?? 0}
                                        onChange={val => {
                                            if (scanConfig.enableVol8am) {
                                                setScanConfig(p => ({...p, maxVolume8am: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${!scanConfig.enableVol8am ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                </div>
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
                        <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex items-center justify-between px-2">
                            <span className="text-[9px] text-slate-500">列表1默认K线周期</span>
                            <select className="w-16 bg-transparent font-mono text-[10px] text-right outline-none text-white" value={scanConfig.list1DefaultTf || '1d'} onChange={e => setScanConfig(p => ({...p, list1DefaultTf: e.target.value}))}>
                                <option value="1d">天</option>
                                <option value="1w">周</option>
                            </select>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-3 animate-in fade-in slide-in-from-right-2 duration-300">
                    {/* Simplified Filters for Major Trend Mode (Stage 2) */}
                    <div className="grid grid-cols-2 gap-2">
                        {/* Dual Volume Range Selector */}
                        <div className="col-span-2 bg-[#1e2329] border border-slate-700 rounded p-2 flex flex-col gap-2">
                            <div className="text-[9px] text-slate-500 font-bold border-b border-slate-800 pb-1 flex justify-between items-center">
                                <span>Stage 2: 成交范围过滤 (Volume Filter)</span>
                                <span className="text-[8px] text-slate-500 font-normal">可单选或全选</span>
                            </div>
                            
                            {/* 24H Volume Row */}
                            <div className="flex items-center justify-between gap-3 bg-black/10 p-1 rounded border border-slate-800/40">
                                <div className="flex items-center gap-1.5">
                                    <button 
                                        onClick={() => setScanConfig(p => ({...p, enableVol24h: p.enableVol24h === false ? true : false}))}
                                        className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none ${scanConfig.enableVol24h !== false ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${scanConfig.enableVol24h !== false ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                                    </button>
                                    <span className="text-[9px] font-bold text-slate-300">24H 交易额 (M)</span>
                                </div>
                                <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 w-28 justify-center">
                                    <SmartNumberInput
                                        value={scanConfig.minVolume}
                                        onChange={val => {
                                            if (scanConfig.enableVol24h !== false) {
                                                setScanConfig(p => ({...p, minVolume: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${scanConfig.enableVol24h === false ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                    <span className="text-slate-500 text-[8px]">~</span>
                                    <SmartNumberInput
                                        value={scanConfig.maxVolume}
                                        onChange={val => {
                                            if (scanConfig.enableVol24h !== false) {
                                                setScanConfig(p => ({...p, maxVolume: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${scanConfig.enableVol24h === false ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                </div>
                            </div>

                            {/* 8AM Volume Row */}
                            <div className="flex items-center justify-between gap-3 bg-black/10 p-1 rounded border border-slate-800/40">
                                <div className="flex items-center gap-1.5">
                                    <button 
                                        onClick={() => setScanConfig(p => ({...p, enableVol8am: !p.enableVol8am}))}
                                        className={`relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none ${scanConfig.enableVol8am ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform duration-200 ${scanConfig.enableVol8am ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                                    </button>
                                    <span className="text-[9px] font-bold text-slate-300">早上8点起 (M)</span>
                                </div>
                                <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 w-28 justify-center">
                                    <SmartNumberInput
                                        value={scanConfig.minVolume8am ?? 1}
                                        onChange={val => {
                                            if (scanConfig.enableVol8am) {
                                                setScanConfig(p => ({...p, minVolume8am: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${!scanConfig.enableVol8am ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                    <span className="text-slate-500 text-[8px]">~</span>
                                    <SmartNumberInput
                                        value={scanConfig.maxVolume8am ?? 0}
                                        onChange={val => {
                                            if (scanConfig.enableVol8am) {
                                                setScanConfig(p => ({...p, maxVolume8am: val}));
                                            }
                                        }}
                                        className={`w-10 bg-transparent text-center font-mono text-[9px] outline-none transition-colors ${!scanConfig.enableVol8am ? 'text-slate-600 cursor-not-allowed opacity-50' : 'text-white'}`}
                                    />
                                </div>
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
                        onRunDiscovery={runMajorTrendDiscovery}
                        isPrimaryMode={true}
                    />
                </div>
            )}
        </div>
    );
};
