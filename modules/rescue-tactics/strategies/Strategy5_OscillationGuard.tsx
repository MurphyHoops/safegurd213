
import React from 'react';
import { StopLossSettings } from '../../../types';
import { Activity } from 'lucide-react';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
}

const Strategy5_OscillationGuard: React.FC<Props> = ({ settings, onChange }) => {
    return (
        <div className="space-y-2 border border-slate-700/50 rounded bg-slate-900/30 p-2">
             <div className="flex items-center justify-between pb-1 border-b border-slate-700/50 mb-2">
                 <div className="flex items-center gap-2">
                     <span className="text-xs font-bold text-orange-400 flex items-center gap-1">
                         <Activity size={12}/> 5. 震荡磨损保护 (熔断机制)
                     </span>
                 </div>
                 <div 
                    onClick={() => onChange('fuseEnabled', !settings.fuseEnabled)} 
                    className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.fuseEnabled ? 'bg-orange-600' : 'bg-slate-700'}`}
                 >
                     <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.fuseEnabled ? 'translate-x-4' : 'translate-x-0'}`}/>
                 </div>
             </div>
             {settings.fuseEnabled && (
                 <div className="space-y-2 animate-in fade-in">
                     <div>
                         <label className="text-[10px] text-slate-500 block mb-1">最大允许连续对冲失败次数 (Max Retries)</label>
                         <input 
                            type="number" 
                            min="1" 
                            max="10" 
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-orange-500" 
                            value={Number.isNaN(settings.maxHedgeRetries) ? '' : (settings.maxHedgeRetries || 3)} 
                            onChange={(e) => onChange('maxHedgeRetries', parseFloat(e.target.value))} 
                         />
                     </div>
                     <div className="mt-2">
                         <label className="text-[10px] text-slate-500 block mb-1">
                             熔断后强制止损 (Fail Stop) %
                             <span className="text-red-400 ml-1 text-[9px]">(Optional)</span>
                         </label>
                         <input 
                            type="number" 
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-red-400 focus:border-red-500" 
                            value={Number.isNaN(settings.fuseFailStopPercent) ? '' : (settings.fuseFailStopPercent || 30)} 
                            onChange={(e) => onChange('fuseFailStopPercent', parseFloat(e.target.value))} 
                         />
                         <p className="text-[9px] text-slate-600 mt-1">
                             当达到最大重试次数停止对冲后，若原仓位继续亏损达到此比例，将强制平仓防止归零。
                         </p>
                     </div>
                 </div>
             )}
        </div>
    );
};

export default Strategy5_OscillationGuard;
