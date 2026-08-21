
import React, { useRef, useState } from 'react';
import { SystemCoreProps } from './types';
import { Download, Upload, Code, AlertTriangle, Package } from 'lucide-react';
import { SubscriptionPanel } from './components/SubscriptionPanel';
import { NetworkSettingsPanel } from './components/NetworkSettingsPanel';
import { ApiConfigPanel } from './components/ApiConfigPanel';
import { SymbolBlacklistPanel } from './components/SymbolBlacklistPanel';
import { VoiceBroadcastPanel } from './components/VoiceBroadcastPanel';

export const SystemCoreModule: React.FC<SystemCoreProps> = ({ settings, onChange, onOpenManual, onViewSource, onFactoryReset, onExportSettings, onImportSettings, onUpdateBinanceRealBalance }) => {
    const [backupName, setBackupName] = React.useState('');
    const [downloadingZip, setDownloadingZip] = useState(false);
    const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDownloadZip = async () => {
        setDownloadingZip(true);
        setDownloadStatus('正在打包所有源码中...');
        try {
            const response = await fetch('/api/export-project');
            if (!response.ok) {
                throw new Error(`服务器响应失败 (${response.status})`);
            }
            setDownloadStatus('正在传输压缩包...');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'CryptoScanner_FullSource.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            setDownloadStatus(`下载成功 (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
            setTimeout(() => setDownloadStatus(null), 4000);
        } catch (err: any) {
            console.error('下载源码失败:', err);
            setDownloadStatus(`下载失败: ${err.message || '网络异常'}`);
            setTimeout(() => setDownloadStatus(null), 5000);
        } finally {
            setDownloadingZip(false);
        }
    };

    return (
        <div className="p-4 bg-slate-800/30 space-y-5 border-b border-slate-800">
             {/* 🌟 顶部醒目安装包下载专区 (小白专属直接下载) */}
             <div className="p-3 bg-slate-900 border border-blue-500/40 rounded-xl space-y-2.5 shadow-lg">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Download size={15} className="text-blue-400" />
                        📥 客户端安装包直接下载 (小白专属)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                        点击立即下载
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* 1. 电脑端安装包直接下载 */}
                    <a
                        href="/api/download-pc-installer"
                        download="0211自动找币防爆仓救世之星_PC电脑安装版.zip"
                        className="py-3 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40 border border-blue-400/40 transition-all cursor-pointer text-center no-underline"
                    >
                        <Package size={16} />
                        <div className="text-left">
                            <div className="leading-tight font-bold">💻 一键下载【PC电脑安装版】</div>
                            <div className="text-[10px] text-blue-200 font-normal mt-0.5">解压双击即可在电脑上运行</div>
                        </div>
                    </a>

                    {/* 2. 手机端 APP 直接安装/下载 */}
                    <a
                        href="/api/download-mobile-app"
                        download="0211自动找币防爆仓救世之星_手机APP安装包.zip"
                        className="py-3 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/40 border border-emerald-400/40 transition-all cursor-pointer text-center no-underline"
                    >
                        <Download size={16} />
                        <div className="text-left">
                            <div className="leading-tight font-bold">📱 一键下载【手机端APP】</div>
                            <div className="text-[10px] text-emerald-200 font-normal mt-0.5">安卓与苹果手机直接安装</div>
                        </div>
                    </a>
                </div>
             </div>

             <SubscriptionPanel />
             <NetworkSettingsPanel settings={settings} onChange={onChange} />
             <VoiceBroadcastPanel settings={settings} onChange={onChange} />
             <ApiConfigPanel settings={settings} onChange={onChange} onUpdateBinanceRealBalance={onUpdateBinanceRealBalance} />
             <SymbolBlacklistPanel settings={settings} onChange={onChange} />

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
                    onClick={handleDownloadZip}
                    disabled={downloadingZip}
                    className="w-full py-2 flex items-center justify-center gap-2 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded transition-colors border border-slate-700"
                >
                    <Package size={12} className={downloadingZip ? 'animate-bounce text-emerald-400' : ''} />
                    {downloadStatus || (downloadingZip ? '正在打包中...' : '📦 备用：下载完整源码压缩包 (ZIP)')}
                </button>

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
