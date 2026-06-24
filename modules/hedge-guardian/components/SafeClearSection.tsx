import React from 'react';

interface Props {
    settings: any;
    onChange: (key: string, value: any) => void;
}

export const SafeClearSection: React.FC<Props> = ({ settings, onChange }) => {
    return (
        <div className="mt-3 border-t border-slate-700/50 pt-3">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-indigo-300">防爆对冲安全止损清仓</span>
                <div onClick={() => onChange('safeClearEnabled', !settings.safeClearEnabled)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.safeClearEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                    <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.safeClearEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                </div>
            </div>
            
            {settings.safeClearEnabled && (
                <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-1">
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1">任一盈利 &ge; %</label>
                        <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400" value={Number.isNaN(settings.safeClearProfit) ? '' : settings.safeClearProfit} onChange={(e) => onChange('safeClearProfit', parseFloat(e.target.value))} />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-1">任一亏损 &ge; %</label>
                        <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400" value={Number.isNaN(settings.safeClearLoss) ? '' : settings.safeClearLoss} onChange={(e) => onChange('safeClearLoss', parseFloat(e.target.value))} />
                    </div>
                </div>
            )}
        </div>
    );
};
