import React from 'react';
import { Key } from 'lucide-react';

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
            </div>
        </div>
    );
};
