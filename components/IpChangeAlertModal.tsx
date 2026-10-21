import React, { useState } from 'react';
import { AlertTriangle, Copy, Check, ExternalLink, X, Globe, ShieldAlert } from 'lucide-react';
import { audioService } from '../services/audioService';

export interface IpChangeAlertData {
    oldIp: string;
    newIp: string;
}

interface Props {
    data: IpChangeAlertData;
    onClose: () => void;
    onAcknowledge: (newIp: string) => void;
}

export const IpChangeAlertModal: React.FC<Props> = ({
    data,
    onClose,
    onAcknowledge
}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (!data.newIp) return;
        navigator.clipboard.writeText(data.newIp);
        setCopied(true);
        audioService.speak('已复制最新出口IP', true);
        setTimeout(() => setCopied(false), 2500);
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl shadow-2xl shadow-amber-950/60 max-w-lg w-full overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-4 bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border-b border-amber-500/30 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <h3 className="font-extrabold text-sm text-amber-300 tracking-wide flex items-center gap-1.5">
                                <span>⚠️ 服务器出口 IP 变动强提醒</span>
                            </h3>
                            <span className="text-[10px] text-amber-400/80 block">检测到云端公网出口 IP 已发生漂移，请及时更新币安白名单</span>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                        title="关闭提示"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5 text-xs text-slate-300 leading-relaxed">
                    {/* IP Comparison Cards */}
                    <div className="grid grid-cols-2 gap-3">
                        {/* Old IP */}
                        <div className="bg-slate-950/80 p-3.5 rounded-xl border border-red-500/30 flex flex-col justify-between">
                            <div className="flex items-center gap-1.5 text-red-400 mb-1">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                                <span className="text-[11px] font-bold">变更前旧 IP</span>
                            </div>
                            <div className="font-mono font-bold text-sm text-slate-400 line-through decoration-red-500 decoration-2 break-all">
                                {data.oldIp || '未记录/初始IP'}
                            </div>
                            <span className="text-[9px] text-red-400/60 mt-1.5">（已失效，币安将拒绝访问）</span>
                        </div>

                        {/* New IP */}
                        <div className="bg-emerald-950/30 p-3.5 rounded-xl border-2 border-emerald-500/60 flex flex-col justify-between relative shadow-lg shadow-emerald-950/40">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5 text-emerald-400">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-500 animate-pulse" />
                                    <span className="text-[11px] font-extrabold text-emerald-300">当前最新出口 IP</span>
                                </div>
                            </div>
                            <div className="font-mono font-extrabold text-base text-emerald-300 break-all py-0.5">
                                {data.newIp}
                            </div>
                            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-emerald-500/20">
                                <span className="text-[9px] text-emerald-400/80">（必须填入币安白名单）</span>
                                <button
                                    onClick={handleCopy}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
                                        copied 
                                            ? 'bg-emerald-500 text-black shadow-md' 
                                            : 'bg-emerald-600/30 hover:bg-emerald-500/50 text-emerald-200 border border-emerald-500/40'
                                    }`}
                                >
                                    {copied ? <Check size={11} /> : <Copy size={11} />}
                                    <span>{copied ? '已复制' : '复制IP'}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Operational Instruction Box */}
                    <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-4 space-y-2.5">
                        <div className="flex items-center gap-2 text-amber-300 font-bold text-[11px]">
                            <Globe size={14} className="text-amber-400" />
                            <span>快速处置指南 (两步恢复正常交易)</span>
                        </div>
                        <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-300 pl-0.5">
                            <li>
                                点击下方 <strong className="text-amber-300">【一键复制最新 IP】</strong> 复制 <code className="bg-slate-900 px-1 py-0.5 rounded text-emerald-400 font-mono font-bold">{data.newIp}</code>。
                            </li>
                            <li>
                                点击 <strong className="text-amber-300">【前往币安 API 管理中心】</strong>，找到您的 API Key 并点击“编辑”，将新 IP 粘贴添加到 IP 白名单中，或设置为“无 IP 限制”并保存。
                            </li>
                            <li>
                                回到本界面，点击 <strong className="text-emerald-300">【我已更新白名单 / 确认已知晓】</strong> 完成确认并解除报警。
                            </li>
                        </ol>
                    </div>

                    {/* Permanent Solution Tip */}
                    <div className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-2.5 flex items-start gap-2 text-blue-200 text-[10px]">
                        <ShieldAlert size={14} className="text-blue-400 shrink-0 mt-0.5" />
                        <div>
                            <strong className="text-blue-300">永久免维护方案：</strong>
                            在币安 API 管理中，将 IP 访问限制勾选为 <strong className="text-white">“无限制 / 允许任意 IP 访问”</strong>，且关闭 API 的“提现”权限仅保留“合约交易”，即可永久免除云端 IP 动态漂移的影响。
                        </div>
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row gap-2.5 justify-between items-center">
                    <div className="flex gap-2 w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shadow-md ${
                                copied
                                    ? 'bg-emerald-500 text-black'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600'
                            }`}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            <span>{copied ? '最新 IP 复制成功' : '一键复制最新 IP'}</span>
                        </button>

                        <a
                            href="https://www.binance.com/zh-CN/my/settings/api-management"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold transition-all"
                        >
                            <ExternalLink size={14} />
                            <span>前往币安 API 管理</span>
                        </a>
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            onAcknowledge(data.newIp);
                        }}
                        className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-extrabold transition-all shadow-lg shadow-emerald-950/50"
                    >
                        <Check size={15} />
                        <span>我已更新白名单 / 确认已知晓</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
