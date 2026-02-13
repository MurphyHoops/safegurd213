
import React from 'react';
import { ScanConfig } from '../scannerTypes';
import { SmartNumberInput, MarketSentimentWidget } from '../ScannerUIHelpers';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    marketStats: any;
}

export const FilterSection: React.FC<Props> = ({ scanConfig, setScanConfig, marketStats }) => {
    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
            {/* Mode Switcher - Updates activeMode in parent, triggering independent config load */}
            <div className="flex gap-2">
                <button 
                    onClick={() => setScanConfig(p => ({...p, timeBasis: '8AM'}))} 
                    className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${scanConfig.timeBasis === '8AM' ? 'bg-slate-800 text-blue-400 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'}`}
                >
                    8AM (独立配置)
                </button>
                <button 
                    onClick={() => setScanConfig(p => ({...p, timeBasis: '24H'}))} 
                    className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${scanConfig.timeBasis === '24H' ? 'bg-slate-800 text-orange-400 border-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-[#1e2329] text-slate-500 border-slate-700 hover:border-slate-600'}`}
                >
                    24H (独立配置)
                </button>
            </div>
            
            <MarketSentimentWidget stats={marketStats}/>
            
            <div className="flex gap-2">
                {['GAINERS','LOSERS','BOTH'].map(s => (
                    <button key={s} onClick={() => setScanConfig(p => ({...p, source: s as any}))} className={`flex-1 py-1.5 text-[10px] font-bold rounded border transition-all ${scanConfig.source === s ? 'bg-indigo-900/30 text-indigo-400 border-indigo-500/50' : 'bg-[#1e2329] text-slate-500 border-slate-700'}`}>{s==='BOTH'?'全部':s==='GAINERS'?'涨幅榜':'跌幅榜'}</button>
                ))}
            </div>
            
            <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#1e2329] border border-slate-700 rounded p-1.5 flex items-center justify-between px-2">
                    <span className="text-[9px] text-slate-500">成交 &gt; M</span>
                    <SmartNumberInput 
                        value={scanConfig.minVolume} 
                        onChange={val => setScanConfig(p => ({...p, minVolume: val}))} 
                        className="w-8 bg-transparent text-right font-mono text-white text-xs outline-none select-text"
                    />
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
                    <span className="text-[9px] text-slate-500">数量限制</span>
                    <SmartNumberInput 
                        value={scanConfig.limit} 
                        onChange={val => setScanConfig(p => ({...p, limit: val}))} 
                        className="w-8 bg-transparent text-right font-mono text-white text-xs outline-none select-text"
                    />
                </div>
            </div>
        </div>
    );
};
