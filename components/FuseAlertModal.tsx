import React from 'react';
import { AlertTriangle, ShieldAlert, X, Zap, RefreshCw, EyeOff } from 'lucide-react';
import { normalizeSymbol } from '../services/symbolUtils';

export interface FuseAlertData {
    symbol: string;
    count: number;
    mode: 'MANUAL' | 'AUTO_CLOSE';
}

interface Props {
    data: FuseAlertData;
    onClose: () => void;
    onCloseAll: (symbol: string) => void;
    onResetAndResume: (symbol: string) => void;
}

export const FuseAlertModal: React.FC<Props> = ({
    data,
    onClose,
    onCloseAll,
    onResetAndResume
}) => {
    const cleanSym = normalizeSymbol(data.symbol);
    const isManual = data.mode === 'MANUAL';

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
                {/* Header */}
                <div className={`p-4 border-b flex items-center justify-between ${
                    isManual ? 'bg-amber-950/40 border-amber-500/30' : 'bg-red-950/40 border-red-500/30'
                }`}>
                    <div className="flex items-center gap-2">
                        {isManual ? (
                            <AlertTriangle className="text-amber-400 animate-bounce" size={20} />
                        ) : (
                            <ShieldAlert className="text-red-400" size={20} />
                        )}
                        <h3 className={`font-bold text-sm ${isManual ? 'text-amber-300' : 'text-red-300'}`}>
                            {isManual ? '⚠️ 震荡磨损保护预警 (人工接管)' : '🚨 震荡磨损熔断 (已自动清仓止损)'}
                        </h3>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 text-xs text-slate-300 leading-relaxed">
                    <div className="flex items-center justify-between bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                        <div>
                            <span className="text-[10px] text-slate-400 block">触发交易对</span>
                            <span className="text-base font-bold text-white font-mono">{cleanSym}</span>
                        </div>
                        <div className="text-right">
                            <span className="text-[10px] text-slate-400 block">累计补仓次数</span>
                            <span className="text-base font-bold text-orange-400 font-mono">{data.count} 次</span>
                        </div>
                    </div>

                    {isManual ? (
                        <div className="space-y-2 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg text-amber-200">
                            <p className="font-semibold text-[11px]">
                                📢 提示：{cleanSym} 防爆对冲已达到 <span className="font-bold underline">{data.count}</span> 次补仓！
                            </p>
                            <p className="text-[10px] text-amber-300/80 leading-normal">
                                当前行情处于剧烈拉锯震荡阶段，系统已<strong>立即停止自动砍仓与补仓</strong>，防止反复摩擦损耗本金。请选择后续处置方式：
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2 bg-red-500/10 border border-red-500/20 p-3 rounded-lg text-red-200">
                            <p className="font-semibold text-[11px]">
                                📢 提示：{cleanSym} 防爆对冲已达到 <span className="font-bold underline">{data.count}</span> 次补仓！
                            </p>
                            <p className="text-[10px] text-red-300/80 leading-normal">
                                系统已根据预设规则，<strong>毫秒级市价全平该币双向对冲仓位</strong>，并撤销全部挂单以保全剩余资金。
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div className="p-4 bg-slate-900/90 border-t border-slate-800 flex flex-col sm:flex-row gap-2 justify-end">
                    {isManual ? (
                        <>
                            <button
                                type="button"
                                onClick={() => {
                                    onCloseAll(data.symbol);
                                    onClose();
                                }}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold transition-colors shadow-lg shadow-red-900/30"
                            >
                                <Zap size={14} />
                                <span>一键全平该币 (市价清仓)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    onResetAndResume(data.symbol);
                                    onClose();
                                }}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold transition-colors"
                            >
                                <RefreshCw size={14} />
                                <span>重置计数并继续托管</span>
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex items-center justify-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors border border-slate-700"
                            >
                                <EyeOff size={14} />
                                <span>暂不处理 (保持锁定)</span>
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold transition-colors"
                        >
                            我知道了
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FuseAlertModal;
