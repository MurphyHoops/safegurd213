import React, { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { audioService } from '../../../services/audioService';

interface Props {
    settings: any;
    onChange: (key: string, value: any) => void;
}

export const SymbolBlacklistPanel: React.FC<Props> = ({ settings, onChange }) => {
    
    const handleAdd = (val: string) => {
        const cleaned = val.trim().toUpperCase();
        if (cleaned) {
            const currentList = settings.symbolBlacklist || [];
            if (!currentList.includes(cleaned)) {
                onChange('symbolBlacklist', [...currentList, cleaned]);
                audioService.speak(`已将 ${cleaned} 加入黑名单`);
            }
        }
    };

    const handleRemove = (sym: string) => {
        const newList = (settings.symbolBlacklist || []).filter((s: string) => s !== sym);
        onChange('symbolBlacklist', newList);
        audioService.speak(`已移出 ${sym}`);
    };

    return (
        <div className="pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-indigo-400 flex items-center gap-1">
                    <AlertTriangle size={10} className="text-amber-500" /> 2. 异常币种黑名单 (Symbol Blacklist)
                </span>
                <span className="text-[9px] text-slate-500">
                    共 {settings.symbolBlacklist?.length || 0} 个币
                </span>
            </div>
            
            {/* Input box */}
            <div className="flex gap-2 mb-2">
                <input 
                    type="text"
                    id="new-blacklist-symbol-input"
                    placeholder="例如: XMR"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 outline-none placeholder-slate-600 font-mono uppercase"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            const input = e.currentTarget;
                            handleAdd(input.value);
                            input.value = '';
                        }
                    }}
                />
                <button
                    onClick={() => {
                        const el = document.getElementById('new-blacklist-symbol-input') as HTMLInputElement;
                        if (el) {
                            handleAdd(el.value);
                            el.value = '';
                        }
                    }}
                    className="px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded transition-colors"
                >
                    添加
                </button>
            </div>

            {/* Badges container */}
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto bg-slate-900/40 p-2 rounded border border-slate-800">
                {(!settings.symbolBlacklist || settings.symbolBlacklist.length === 0) ? (
                    <span className="text-[9px] text-slate-500 italic">暂无黑名单币种</span>
                ) : (
                    settings.symbolBlacklist.map((sym: string) => (
                        <span key={sym} className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[9px] px-1.5 py-0.5 rounded">
                            {sym}
                            <button
                                onClick={() => handleRemove(sym)}
                                className="text-slate-500 hover:text-red-400 font-bold ml-1 transition-colors"
                            >
                                ×
                            </button>
                        </span>
                    ))
                )}
            </div>
            <p className="text-[9px] text-slate-500 leading-tight mt-1">
                黑名单中的币种，在实盘与模拟盘中都将拒绝开仓。输入后按 Enter 或点击添加。
            </p>
        </div>
    );
};
