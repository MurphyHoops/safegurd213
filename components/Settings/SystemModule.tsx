
import React, { useRef } from 'react';
import { SystemSettings } from '../../types';
import { Crown, Key, Download, Upload, Code, AlertTriangle, Zap } from 'lucide-react';
import { subscriptionService } from '../../services/subscriptionService';
import { audioService } from '../../services/audioService';

interface Props {
    settings: SystemSettings;
    onChange: (key: string, value: any) => void;
    onOpenManual: () => void;
    onViewSource: () => void;
    onFactoryReset: () => void;
    onExportSettings: () => void;
    onImportSettings: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const SystemModule: React.FC<Props> = ({ settings, onChange, onOpenManual, onViewSource, onFactoryReset, onExportSettings, onImportSettings }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const remainingDays = subscriptionService.getDaysRemaining();

    return (
        <div className="p-4 bg-slate-800/30 space-y-5 border-b border-slate-800">
             {/* Subscription Info Panel */}
             <div className="bg-gradient-to-r from-slate-900 to-indigo-900/20 p-3 rounded border border-indigo-500/20">
                 <div className="flex justify-between items-center mb-2">
                     <div className="flex items-center gap-2">
                         <Crown size={14} className="text-amber-400"/>
                         <span className="text-xs font-bold text-white">会员订阅服务</span>
                     </div>
                     <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${remainingDays > 0 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
                         {remainingDays > 0 ? '活跃' : '已过期'}
                     </span>
                 </div>
                 <div className="flex justify-between items-end">
                     <div>
                         <div className="text-[9px] text-slate-500">剩余天数</div>
                         <div className="text-lg font-mono font-bold text-white">{remainingDays} 天</div>
                     </div>
                     <button 
                        onClick={() => window.location.reload()} // Trigger app reload to show modal again if expired
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded shadow-lg shadow-amber-900/20"
                     >
                         {remainingDays > 0 ? '立即续费' : '立即开通'}
                     </button>
                 </div>
             </div>

             {/* Network Settings (New) */}
             <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                 <div className="flex items-center justify-between mb-1">
                     <span className="text-[10px] font-bold text-white flex items-center gap-1"><Zap size={10} className={settings.directMode ? 'text-yellow-400' : 'text-slate-500'} /> 直连模式 (Direct Mode)</span>
                     <div onClick={() => onChange('directMode', !settings.directMode)} className={`w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer ${settings.directMode ? 'bg-yellow-600' : 'bg-slate-700'}`}>
                         <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${settings.directMode ? 'translate-x-4' : 'translate-x-0'}`}/>
                     </div>
                 </div>
                 <p className="text-[9px] text-slate-500 leading-tight">
                     开启后将不经过代理直接连接交易所。需自备海外网络环境 (VPN)。<br/>
                     <span className="text-emerald-500 font-bold">优势：极速加载，解决 8AM 列表卡顿。</span>
                 </p>
             </div>

             {/* 1. API Configuration */}
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

             {/* Hidden File Input for Restore */}
             <input 
                type="file" 
                ref={fileInputRef}
                onChange={onImportSettings}
                accept=".json"
                className="hidden"
             />

             <div className="pt-2 border-t border-slate-800/50 space-y-2">
                
                {/* Redundant Manual Button Removed - Now in Module 6 */}

                <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={onExportSettings}
                        className="w-full py-2 flex items-center justify-center gap-2 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors border border-slate-700"
                    >
                        <Download size={12} /> 📤 导出备份配置
                    </button>
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-2 flex items-center justify-center gap-2 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors border border-slate-700"
                    >
                        <Upload size={12} /> 📥 导入恢复配置
                    </button>
                </div>

                <button 
                    onClick={onViewSource}
                    className="w-full py-2 flex items-center justify-center gap-2 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors border border-slate-700"
                >
                    <Code size={12} /> 查看/备份所有源码 (View Source)
                </button>

                <button 
                    onClick={onFactoryReset}
                    className="w-full py-2 flex items-center justify-center gap-2 text-[10px] text-slate-600 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors"
                >
                    <AlertTriangle size={10} /> 重置所有设置 (Factory Reset)
                </button>
             </div>
        </div>
    );
};

export default SystemModule;
