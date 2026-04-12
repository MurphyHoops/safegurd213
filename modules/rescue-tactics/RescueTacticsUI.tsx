
import React from 'react';
import { RescueTacticsProps } from './types';
import { AlertTriangle } from 'lucide-react';
// Imports now updated to local strategies
import Strategy2_HedgeProfit from './strategies/Strategy2_HedgeProfit';
import Strategy3_CallbackProfit from './strategies/Strategy3_CallbackProfit';
import Strategy4_Amputation from './strategies/Strategy4_Amputation';
import Strategy5_OscillationGuard from './strategies/Strategy5_OscillationGuard';
import Strategy6_AIAdvisor from './strategies/Strategy6_AIAdvisor';

export const RescueTacticsModule: React.FC<RescueTacticsProps> = ({ settings, onChange, toggleFeature, onShowStrategyInfo }) => {
    return (
        <div className="p-4 bg-slate-800/30 space-y-4 border-b border-slate-800">
            {/* Warning Text */}
            <div className="text-[10px] text-amber-500 bg-amber-900/10 p-2 rounded border border-amber-500/20 flex items-center gap-2">
                <AlertTriangle size={12} />
                此功能需要有丰富交易经验的交易员，使用需谨慎。
            </div>

            <Strategy2_HedgeProfit settings={settings} onChange={onChange} toggleFeature={toggleFeature} />
            <Strategy3_CallbackProfit settings={settings} onChange={onChange} toggleFeature={toggleFeature} onShowStrategyInfo={onShowStrategyInfo} />
            <Strategy4_Amputation settings={settings} onChange={onChange} toggleFeature={toggleFeature} />
            <Strategy5_OscillationGuard settings={settings} onChange={onChange} />
            <Strategy6_AIAdvisor settings={settings} onChange={onChange} />
        </div>
    );
};
