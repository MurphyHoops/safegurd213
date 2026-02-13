
import React, { useState } from 'react';
import { ScanConfig } from '../scannerTypes';
import { Globe, Lock, List, PlusCircle, Target, Trash2 } from 'lucide-react';

interface Props {
    scanConfig: ScanConfig;
    setScanConfig: React.Dispatch<React.SetStateAction<ScanConfig>>;
    fixedModeView: 'MONITOR' | 'SEARCH';
    setFixedModeView: (v: 'MONITOR' | 'SEARCH') => void;
    onClearWatchlist?: () => void;
}

export const WatchlistSection: React.FC<Props> = ({ scanConfig, setScanConfig, fixedModeView, setFixedModeView, onClearWatchlist }) => {
    const [manualInput, setManualInput] = useState('');

    const handleAddSymbol = () => { 
        if (!manualInput) return; 
        const inputs = manualInput.toUpperCase().split(/[\s,]+/).filter(s => s); 
        const current = scanConfig.customSymbols.split(',').map(s => s.trim()).filter(s => s); 
        const set = new Set(current); 
        inputs.forEach(val => { 
            const cleanVal = val.replace('USDT', ''); 
            if (cleanVal) set.add(cleanVal); 
        }); 
        setScanConfig(p => ({ ...p, customSymbols: Array.from(set).join(', ') })); 
        setManualInput(''); 
    };

    return (
        <div className="space-y-3">
            {/* Mode Switch */}
            <div className="flex bg-slate-800 p-1 rounded border border-slate-700">
                <button onClick={() => setScanConfig(p => ({...p, useCustomOnly: false}))} className={`flex-1 py-2 text-[10px] font-bold rounded transition-all flex items-center justify-center gap-2 ${!scanConfig.useCustomOnly ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}><Globe size={12} /> 自动选币</button>
                <button onClick={() => { setScanConfig(p => ({...p, useCustomOnly: true})); setFixedModeView('MONITOR'); }} className={`flex-1 py-2 text-[10px] font-bold rounded transition-all flex items-center justify-center gap-2 ${scanConfig.useCustomOnly ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}><Lock size={12} /> 固定选币</button>
            </div>

            {/* Watchlist Body */}
            {scanConfig.useCustomOnly && (
                <div className="space-y-3 pt-3 border-t border-slate-800 animate-in fade-in slide-in-from-right-2 duration-300">
                    <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700/50">
                        <button onClick={() => setFixedModeView('MONITOR')} className={`flex-1 py-1.5 text-[9px] font-bold rounded transition-all flex items-center justify-center gap-1 ${fixedModeView === 'MONITOR' ? 'bg-cyan-900/50 text-cyan-400 border-cyan-500/30' : 'text-slate-500'}`}><List size={10} /> 监控列表</button>
                        <button onClick={() => setFixedModeView('SEARCH')} className={`flex-1 py-1.5 text-[9px] font-bold rounded transition-all flex items-center justify-center gap-1 ${fixedModeView === 'SEARCH' ? 'bg-orange-900/50 text-orange-400 border-orange-500/30' : 'text-slate-500'}`}><PlusCircle size={10} /> 市场搜索</button>
                    </div>
                    
                    {fixedModeView === 'MONITOR' ? (
                        <div className="bg-cyan-900/10 border border-cyan-500/30 rounded p-3 text-center animate-in fade-in zoom-in-95 relative group">
                            <div className="text-cyan-400 font-bold text-xs mb-2 flex items-center justify-center gap-2"><Target size={14} /> 重点监控池</div>
                            <div className="flex gap-1 mb-2">
                                <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()} placeholder="输入币名 (如 DOGE)" className="flex-1 bg-slate-900 border border-cyan-500/30 rounded px-2 py-1 text-xs text-white focus:border-cyan-400 outline-none uppercase"/>
                                <button onClick={handleAddSymbol} className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 rounded text-xs font-bold transition-colors shadow-lg shadow-cyan-900/20"><PlusCircle size={14} /></button>
                            </div>
                            <textarea value={scanConfig.customSymbols} onChange={e => setScanConfig(p => ({...p, customSymbols: e.target.value}))} placeholder="BTC, ETH, SOL..." className="w-full bg-slate-900 border border-cyan-500/50 rounded p-2 text-xs text-white focus:outline-none h-16 font-mono resize-none focus:border-cyan-400 transition-colors"/>
                            <div className="flex justify-between items-center text-[9px] text-slate-500 mt-1 px-1">
                                <span>数量: <span className="text-white font-mono">{scanConfig.customSymbols.split(',').filter(s=>s.trim()).length}</span></span>
                                {onClearWatchlist && <button type="button" onClick={(e) => { e.preventDefault(); onClearWatchlist(); }} className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors hover:bg-red-900/20 px-1.5 py-0.5 rounded active:scale-95"><Trash2 size={10}/> 清空</button>}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-orange-900/10 border border-orange-500/30 rounded p-2 animate-in fade-in zoom-in-95">
                            <div className="text-[9px] text-orange-300 text-center font-bold mb-1">勾选下方币种以添加至监控</div>
                            <div className="text-[8px] text-slate-500 text-center">使用上方过滤器来查找币种</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
