import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, Copy, Check, ShieldAlert, Activity, Cpu, Layers, HardDrive } from 'lucide-react';

export interface ForensicRecord {
    timestamp: number;
    timeStr: string;
    serverRssMB: number;
    serverHeapMB: number;
    clientHeapMB?: number;
    domNodeCount?: number;
    activeWsCount?: number;
    customNote?: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const ForensicReportModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const [records, setRecords] = useState<ForensicRecord[]>([]);
    const [totalRecords, setTotalRecords] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [copied, setCopied] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

    const fetchRecords = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/telemetry/last-forensic', { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
                const data = await res.json();
                if (data && data.success) {
                    setRecords(data.lastRecords || []);
                    setTotalRecords(data.totalRecords || 0);
                } else {
                    setError(data?.error || '获取法医指标失败');
                }
            } else {
                setError(`HTTP ${res.status}: 请求失败`);
            }
        } catch (err: any) {
            setError(err?.message || '网络连接超时或服务未就绪');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(fetchRecords, 0);

        let interval: any = null;
        if (autoRefresh) {
            interval = setInterval(() => {
                fetchRecords();
            }, 2000);
        }

        return () => {
            clearTimeout(timer);
            if (interval) clearInterval(interval);
        };
    }, [isOpen, autoRefresh]);

    const handleCopyReport = () => {
        if (records.length === 0) return;
        const header = `=== 🔍 【法医级崩溃前时序指标诊断报告】 (共 ${totalRecords} 条，回放最后 ${records.length} 秒) ===\n生成时间: ${new Date().toLocaleString()}\n`;
        const lines = records.map((r, i) => {
            const isLast = i === records.length - 1;
            const tag = isLast ? '🚨[临终前最后一秒]' : `⏱️[T-${records.length - 1 - i}s]`;
            return `${tag} [${r.timeStr}] | 节点DOM数: ${r.domNodeCount ?? 0} | 客户端Heap: ${r.clientHeapMB ?? 0}MB | 服务端RSS: ${r.serverRssMB ?? 0}MB | 服务端Heap: ${r.serverHeapMB ?? 0}MB | 状态: ${r.customNote || 'NORMAL'}`;
        }).join('\n');

        const fullText = `${header}\n${lines}\n\n=== 诊断建议分析 ===\n1. 检查临终前 3 秒内 DOM 节点数或客户端 Heap 是否陡增；\n2. 检查服务端 RSS 是否逼近 1000MB 物理熔断水位；\n3. 检查 customNote 记录的最后路由/动作。`;

        navigator.clipboard.writeText(fullText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        }).catch(() => {
            alert('复制失败，请手动选取文本');
        });
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="bg-[#0b0e14] border border-indigo-500/30 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-slate-200 font-mono text-xs">
                {/* Header */}
                <div className="px-4 py-3 bg-[#111622] border-b border-indigo-500/20 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-indigo-950 border border-indigo-500/40 text-cyan-400">
                            <Activity size={16} className="animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-sm tracking-wide">
                                    🛡️ 法医级高频时序指标雷达回放
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                                    秒级物理追加写盘
                                </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                                存储位置: <span className="text-indigo-300">data/forensic_metrics.jsonl</span> (累计记录: {totalRecords} 条)
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setAutoRefresh(prev => !prev)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold border transition-all cursor-pointer ${
                                autoRefresh
                                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-400'
                            }`}
                            title={autoRefresh ? "自动刷新已开启（每2秒，点击关闭）" : "自动刷新已关闭（点击开启）"}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                            <span>{autoRefresh ? '自动刷新:开' : '自动刷新:关'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={fetchRecords}
                            disabled={isLoading}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer"
                        >
                            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                            <span>刷新</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleCopyReport}
                            disabled={records.length === 0}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold transition-all border cursor-pointer ${
                                copied
                                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-950'
                                    : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-950'
                            }`}
                        >
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copied ? '✅ 诊断报告已复制' : '一键复制诊断报告到剪贴板'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all cursor-pointer ml-1"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Body Table */}
                <div className="p-4 overflow-y-auto flex-1 custom-scrollbar space-y-3">
                    {error && (
                        <div className="p-3 bg-red-950/50 border border-red-500/50 rounded-lg text-red-300 flex items-center gap-2 text-xs">
                            <ShieldAlert size={14} className="shrink-0 text-red-400" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Stats Summary Bar */}
                    {records.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                            <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                                <span className="text-slate-400 flex items-center gap-1"><Layers size={11} className="text-cyan-400" /> 最新 DOM 节点:</span>
                                <span className="font-bold text-cyan-300">{records[records.length - 1]?.domNodeCount ?? 0}</span>
                            </div>
                            <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                                <span className="text-slate-400 flex items-center gap-1"><Cpu size={11} className="text-purple-400" /> 客户端堆内存:</span>
                                <span className="font-bold text-purple-300">{records[records.length - 1]?.clientHeapMB ?? 0} MB</span>
                            </div>
                            <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                                <span className="text-slate-400 flex items-center gap-1"><HardDrive size={11} className="text-emerald-400" /> 服务端 RSS:</span>
                                <span className="font-bold text-emerald-300">{records[records.length - 1]?.serverRssMB ?? 0} MB</span>
                            </div>
                            <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                                <span className="text-slate-400 flex items-center gap-1"><HardDrive size={11} className="text-amber-400" /> 服务端堆内存:</span>
                                <span className="font-bold text-amber-300">{records[records.length - 1]?.serverHeapMB ?? 0} MB</span>
                            </div>
                        </div>
                    )}

                    {/* Records Table */}
                    <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/40">
                        {records.length === 0 && !isLoading ? (
                            <div className="text-center py-12 text-slate-500 text-xs">
                                暂无法医时序指标数据，请稍后刷新重试...
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-[10px] border-collapse">
                                    <thead>
                                        <tr className="bg-[#131926] text-slate-400 border-b border-slate-800 font-bold">
                                            <th className="py-2 px-2.5 w-12 text-center">序号</th>
                                            <th className="py-2 px-2.5">记录时刻 (ISO / Time)</th>
                                            <th className="py-2 px-2.5 text-right">DOM 节点数</th>
                                            <th className="py-2 px-2.5 text-right">客户端 Heap</th>
                                            <th className="py-2 px-2.5 text-right">服务端 RSS</th>
                                            <th className="py-2 px-2.5 text-right">服务端 Heap</th>
                                            <th className="py-2 px-2.5">运行备注 / 轨迹</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/60 font-mono">
                                        {records.map((r, idx) => {
                                            const isLast = idx === records.length - 1;
                                            const rowBg = isLast
                                                ? 'bg-rose-950/30 text-rose-200 font-bold'
                                                : idx % 2 === 0 ? 'bg-slate-900/20' : 'bg-transparent';

                                            return (
                                                <tr key={idx} className={`${rowBg} hover:bg-indigo-950/20 transition-colors`}>
                                                    <td className="py-1.5 px-2.5 text-center">
                                                        {isLast ? (
                                                            <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-bold text-[9px] animate-pulse">
                                                                末秒
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-500">{idx + 1}</span>
                                                        )}
                                                    </td>
                                                    <td className="py-1.5 px-2.5 text-slate-300">
                                                        {r.timeStr}
                                                    </td>
                                                    <td className="py-1.5 px-2.5 text-right font-bold text-cyan-300">
                                                        {(r.domNodeCount ?? 0).toLocaleString()}
                                                    </td>
                                                    <td className="py-1.5 px-2.5 text-right text-purple-300 font-bold">
                                                        {r.clientHeapMB ?? 0} MB
                                                    </td>
                                                    <td className="py-1.5 px-2.5 text-right text-emerald-300 font-bold">
                                                        {r.serverRssMB ?? 0} MB
                                                    </td>
                                                    <td className="py-1.5 px-2.5 text-right text-amber-300 font-bold">
                                                        {r.serverHeapMB ?? 0} MB
                                                    </td>
                                                    <td className="py-1.5 px-2.5 text-slate-400 truncate max-w-[200px]" title={r.customNote}>
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 text-slate-300 text-[9px]">
                                                            {r.customNote || 'NORMAL'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Tips */}
                <div className="px-4 py-2.5 bg-[#0f131d] border-t border-slate-800 flex items-center justify-between text-[9px] text-slate-400 shrink-0">
                    <span className="text-slate-400">
                        💡 <b>法医鉴定提示</b>：数据由独立的每秒物理探针直写硬盘，即使遇进程强杀亦不丢失末秒记录。点击右上角【一键复制】可发送给 AI 进行毫秒级故障诊断。
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold transition-all cursor-pointer"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
