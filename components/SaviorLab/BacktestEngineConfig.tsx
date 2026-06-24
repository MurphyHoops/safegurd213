import React from 'react';
import { Play, TrendingUp, Cpu } from 'lucide-react';

export const BacktestEngineConfig: React.FC = () => {
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <h3 className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                        <Play size={14} />
                        回测参数设置
                    </h3>
                    <div className="space-y-3 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">回测币种</label>
                            <select className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-white outline-none focus:border-emerald-500">
                                <option>BTCUSDT</option>
                                <option>ETHUSDT</option>
                                <option>SOLUSDT</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 block mb-1">回测周期</label>
                            <select className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-white outline-none focus:border-emerald-500">
                                <option>15m</option>
                                <option>1h</option>
                                <option>4h</option>
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">灵敏度对撞范围</label>
                                <div className="flex items-center gap-2">
                                    <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" defaultValue={3} />
                                    <span className="text-slate-600">-</span>
                                    <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" defaultValue={8} />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">贪婪度对撞范围</label>
                                <div className="flex items-center gap-2">
                                    <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" defaultValue={4} />
                                    <span className="text-slate-600">-</span>
                                    <input type="number" className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white" defaultValue={9} />
                                </div>
                            </div>
                        </div>
                    </div>
                    <button className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2">
                        <Play size={16} />
                        开始对撞回测
                    </button>
                </div>

                <div className="space-y-4">
                    <h3 className="text-xs font-bold text-purple-400 flex items-center gap-2">
                        <TrendingUp size={14} />
                        AI 优化报告 (预览)
                    </h3>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 h-full min-h-[200px] flex flex-col items-center justify-center text-center gap-3">
                        <div className="p-3 bg-purple-500/10 rounded-full">
                            <Cpu size={24} className="text-purple-400 opacity-50" />
                        </div>
                        <p className="text-[10px] text-slate-500 max-w-[200px]">
                            运行回测后，AI 将分析数千种参数组合，为您推荐当前行情下的最优配置。
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
