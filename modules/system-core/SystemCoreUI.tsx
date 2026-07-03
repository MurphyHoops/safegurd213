
import React, { useRef } from 'react';
import { SystemCoreProps } from './types';
import { Download, Upload, Code, AlertTriangle } from 'lucide-react';
import { SubscriptionPanel } from './components/SubscriptionPanel';
import { NetworkSettingsPanel } from './components/NetworkSettingsPanel';
import { ApiConfigPanel } from './components/ApiConfigPanel';

export const SystemCoreModule: React.FC<SystemCoreProps> = ({ settings, onChange, onOpenManual, onViewSource, onFactoryReset, onExportSettings, onImportSettings }) => {
    const [backupName, setBackupName] = React.useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <div className="p-4 bg-slate-800/30 space-y-5 border-b border-slate-800">
             <SubscriptionPanel />
             <NetworkSettingsPanel settings={settings} onChange={onChange} />
             <ApiConfigPanel settings={settings} onChange={onChange} />

             {/* Hidden File Input for Restore */}
             <input 
                type="file" 
                ref={fileInputRef}
                onChange={onImportSettings}
                accept=".json"
                className="hidden"
             />

             <div className="pt-2 border-t border-slate-800/50 space-y-2">
                <input
                    type="text"
                    value={backupName}
                    onChange={(e) => setBackupName(e.target.value)}
                    placeholder="请输入备份名称 (可选)"
                    className="w-full py-1 px-2 text-[10px] bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500"
                />
                <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={() => onExportSettings(backupName)}
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
