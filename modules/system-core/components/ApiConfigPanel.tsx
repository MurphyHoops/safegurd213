import React from 'react';
import { Key } from 'lucide-react';
import { audioService } from '../../../services/audioService';

interface Props {
    settings: any;
    onChange: (key: string, value: any) => void;
}

export const ApiConfigPanel: React.FC<Props> = ({ settings, onChange }) => {
    return (
        <div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 uppercase mb-2">
                <Key size={10} /> 1. API 配置 (Binance Connection)
            </div>
            <div className="space-y-2">
                <div>
                    <label className="text-[10px] text-slate-500 block mb-1">API Key</label>
                    <input 
                        type="text" 
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 outline-none"
                        value={settings.binanceApiKey || ''}
                        onChange={(e) => onChange('binanceApiKey', e.target.value)}
                        placeholder="Enter Binance API Key"
                    />
                </div>
                <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Secret Key</label>
                    <input 
                        type="password" 
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 outline-none"
                        value={settings.binanceApiSecret || ''}
                        onChange={(e) => onChange('binanceApiSecret', e.target.value)}
                        placeholder="Enter Secret Key"
                    />
                </div>

                <div className="pt-2 border-t border-slate-800/60 mt-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-[10px] font-bold text-slate-300">实盘交易模式 (Real API Trading)</span>
                            <p className="text-[9px] text-slate-500 leading-normal">
                                {settings.realTrading ? '🟢 当前为 API 实盘对接模式，开平仓指令同步至币安' : '⚪ 当前为模拟盘模式，所有资金与交易均为虚拟'}
                            </p>
                        </div>
                        <div 
                            onClick={() => {
                                const newVal = !settings.realTrading;
                                onChange('realTrading', newVal);
                                if (newVal) {
                                    audioService.speak("实盘交易模式已开启，请确保API密钥正确填写");
                                } else {
                                    audioService.speak("已切回模拟交易模式");
                                }
                            }} 
                            className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${settings.realTrading ? 'bg-emerald-600' : 'bg-slate-700'}`}
                        >
                            <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.realTrading ? 'translate-x-5' : 'translate-x-0'}`}/>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
