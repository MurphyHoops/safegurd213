
import React from 'react';
import { StopLossSettings } from '../../types';
import { AlertTriangle } from 'lucide-react';
import Strategy2_HedgeProfit from './RescueStrategies/Strategy2_HedgeProfit';
import Strategy3_CallbackProfit from './RescueStrategies/Strategy3_CallbackProfit';
import Strategy4_Amputation from './RescueStrategies/Strategy4_Amputation';
import Strategy5_OscillationGuard from './RescueStrategies/Strategy5_OscillationGuard';
import Strategy6_AIAdvisor from './RescueStrategies/Strategy6_AIAdvisor';

interface Props {
    settings: StopLossSettings;
    onChange: (key: string, value: any) => void;
    toggleFeature: (feature: keyof StopLossSettings) => void;
    onShowStrategyInfo: () => void;
}

const RescueModule: React.FC<Props> = ({ settings, onChange, toggleFeature, onShowStrategyInfo }) => {
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

export default RescueModule;
