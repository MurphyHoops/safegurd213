
import React from 'react';
import { Zap } from 'lucide-react';
import { ActionConfig, COLUMN_WIDTH_CLASS } from './scannerTypes';
import { List6Control } from './List6/Control';
import { List6ActionGroup } from './List6/ActionGroup';

interface Props {
    config: ActionConfig;
    setConfig: React.Dispatch<React.SetStateAction<ActionConfig>>;
    currentStats: { symbolCount: number; totalValue: number; totalPnl: number };
    onPanicSell: () => void;
    onSecureProfit: () => void;
    onCutLosses: () => void;
    onCloseLongs: () => void;
    onCloseShorts: () => void;
}

const List6_Action: React.FC<Props> = ({ 
    config, setConfig, currentStats, 
    onPanicSell, onSecureProfit, onCutLosses, onCloseLongs, onCloseShorts 
}) => {
    return (
        <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 ${COLUMN_WIDTH_CLASS}`}>
            <List6Control config={config} setConfig={setConfig} currentStats={currentStats} />
            
            <div className="px-3 py-2 bg-orange-950/30 border-b border-slate-800 flex justify-between items-center sticky top-0">
                <div className="text-[10px] font-bold text-orange-500 uppercase flex items-center gap-1"><Zap size={12}/> 手动干预 (MANUAL)</div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar bg-slate-950/20">
                <List6ActionGroup 
                    onPanicSell={onPanicSell}
                    onSecureProfit={onSecureProfit}
                    onCutLosses={onCutLosses}
                    onCloseLongs={onCloseLongs}
                    onCloseShorts={onCloseShorts}
                />
                <div className="mt-4 p-2 rounded bg-slate-800/30 border border-slate-800 text-[9px] text-slate-500 text-center">
                    所有手动操作将立即执行，请谨慎操作。<br/>此模块用于应对非系统性风险。
                </div>
            </div>
        </div>
    );
};

export default List6_Action;
