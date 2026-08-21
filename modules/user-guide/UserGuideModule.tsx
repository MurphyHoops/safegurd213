import React from 'react';
import { BookOpen, Monitor, Smartphone, Download, Package } from 'lucide-react';

interface Props {
    onOpenManual: () => void;
}

export const UserGuideModule: React.FC<Props> = ({ onOpenManual }) => {
    return (
        <div className="p-4 bg-slate-800/30 border-b border-slate-800 animate-in fade-in space-y-3">
            {/* 客户端与 APP 下载专区 */}
            <div className="p-3 bg-slate-900 border border-blue-500/40 rounded-xl space-y-2 shadow-lg">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Download size={14} className="text-blue-400" />
                        📥 客户端安装包直接下载 (小白专属)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                        免配置一键运行
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <a
                        href="/api/download-pc-installer"
                        download="0211自动找币防爆仓救世之星_PC电脑安装版.zip"
                        className="py-2.5 px-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-lg text-[11px] flex items-center justify-center gap-2 shadow-md shadow-blue-900/40 border border-blue-400/40 transition-all cursor-pointer text-center no-underline"
                    >
                        <Monitor size={15} />
                        <span>💻 下载【电脑端安装版】</span>
                    </a>

                    <a
                        href="/api/download-mobile-app"
                        download="0211自动找币防爆仓救世之星_手机APP安装包.zip"
                        className="py-2.5 px-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-lg text-[11px] flex items-center justify-center gap-2 shadow-md shadow-emerald-900/40 border border-emerald-400/40 transition-all cursor-pointer text-center no-underline"
                    >
                        <Smartphone size={15} />
                        <span>📱 下载【手机端 APP】</span>
                    </a>
                </div>
            </div>

            <button 
                onClick={onOpenManual}
                className="w-full py-3 flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg transition-all shadow-lg shadow-indigo-900/30 font-bold"
            >
                <BookOpen size={18} /> 📘 打开操作说明书
            </button>
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-center">
                    <span className="text-[10px] text-slate-400 block mb-1">快速入门</span>
                    <span className="text-[9px] text-slate-500">3分钟上手全攻略</span>
                </div>
                <div className="bg-slate-900/50 p-2 rounded border border-slate-700/50 text-center">
                    <span className="text-[10px] text-slate-400 block mb-1">策略详解</span>
                    <span className="text-[9px] text-slate-500">防爆与解套逻辑</span>
                </div>
            </div>
        </div>
    );
};
