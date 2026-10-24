/**
 * @file modules/positions-list/components/DcaControlDropdown.tsx
 * @description 智能补仓 / DCA 策略控制组件与嵌入式下方展开面板 (嵌入在当前持仓正下方，不遮挡任何内容)
 * @status STRICTLY LOCKED - ATOMIC MODULE
 */

import React, { useState, useRef, useEffect } from 'react';
import { AppSettings, MartingaleSettings, Position } from '../../../types';
import { Zap, ShieldAlert, Sliders, Layers, Clock, AlertTriangle, CheckCircle2, RefreshCw, X, HelpCircle, ArrowUpRight } from 'lucide-react';

interface Props {
    settings: AppSettings;
    onUpdateSettings?: (section: keyof AppSettings, key: string, value: any) => void;
    activePositions?: Position[];
    realPrices?: Record<string, number>;
    onManualDca?: (position: Position, amountUsdt: number) => void;
    isOpen?: boolean;
    onToggle?: () => void;
}

interface InlineProps {
    settings: AppSettings;
    onUpdateSettings?: (section: keyof AppSettings, key: string, value: any) => void;
    activePositions?: Position[];
    realPrices?: Record<string, number>;
    onManualDca?: (position: Position, amountUsdt: number) => void;
    onClose?: () => void;
}

/**
 * ⚡ 智能补仓 (DCA) 嵌入式卡片面板 (嵌入在“当前持仓”列表正下方，完全不遮挡持仓与顶栏)
 */
export const DcaInlineCard: React.FC<InlineProps> = ({
    settings,
    onUpdateSettings,
    activePositions = [],
    realPrices = {},
    onManualDca,
    onClose
}) => {
    const [activeTab, setActiveTab] = useState<'TRIGGER' | 'CAPITAL' | 'SAFETY' | 'MONITOR'>('TRIGGER');
    const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

    const cfg: MartingaleSettings = settings?.martingale || {
        enabled: false,
        triggerMode: 'LOSS_PCT',
        triggerLossPercent: 2.0,
        emaPeriod: 30,
        callbackPercent: 1.0,
        enableStepDca: true,
        baseRef: 'INITIAL_QTY',
        ratioPercent: 100,
        maxCount: 2,
        maxTotalUsdt: 500,
        cooldownSeconds: 30,
        hedgeSafeDistancePercent: 1.0,
        circuitBreakerVolPercent: 3.0,
        breakevenTakeProfitPercent: 0.5,
        dynamicHedgeShiftEnabled: true
    };

    const updateCfg = (updates: Partial<MartingaleSettings>) => {
        if (onUpdateSettings) {
            Object.entries(updates).forEach(([key, value]) => {
                onUpdateSettings('martingale', key, value);
            });
        }
    };

    const mainPositions = activePositions.filter(p => !p.isHedge && !p.isHedged);

    return (
        <div className="w-full max-w-[760px] mx-auto bg-[#0d1017] border border-amber-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans select-none my-1 transition-all">
            
            {/* 1. 面板头部 */}
            <div className="p-2.5 px-3 bg-[#121620] border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <div className="p-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400">
                        <Zap size={14} />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                            智能补仓策略面板
                            <span className="text-[8px] font-mono text-amber-400 bg-amber-950/60 border border-amber-800/50 px-1 py-0.1 rounded">
                                DCA GUARDIAN
                            </span>
                        </div>
                        <div className="text-[9px] text-slate-400">
                            拉低持仓均价 • 降低对冲磨损 • 微利快速解套
                        </div>
                    </div>
                </div>

                {/* 总开关与关闭按键 */}
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => updateCfg({ enabled: !cfg.enabled })}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all flex items-center gap-1 border ${
                            cfg.enabled
                                ? 'bg-amber-500 text-black border-amber-400 font-extrabold shadow-md shadow-amber-500/20'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.enabled ? 'bg-black animate-pulse' : 'bg-slate-500'}`} />
                        {cfg.enabled ? '策略已开启' : '策略已暂停'}
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
                            title="收起补仓策略面板"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* 2. 4 大 Tab 导航键 */}
            <div className="flex border-b border-slate-800 bg-[#0a0d12] text-[10px] font-bold p-0.5 gap-1">
                <button
                    onClick={() => setActiveTab('TRIGGER')}
                    className={`flex-1 py-1 px-1.5 rounded-md flex items-center justify-center gap-1 transition-all border ${
                        activeTab === 'TRIGGER'
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-extrabold shadow-sm'
                            : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                >
                    <Sliders size={12} />
                    <span>1. 触发条件</span>
                </button>
                <button
                    onClick={() => setActiveTab('CAPITAL')}
                    className={`flex-1 py-1 px-1.5 rounded-md flex items-center justify-center gap-1 transition-all border ${
                        activeTab === 'CAPITAL'
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-extrabold shadow-sm'
                            : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                >
                    <Layers size={12} />
                    <span>2. 资金与次数</span>
                </button>
                <button
                    onClick={() => setActiveTab('SAFETY')}
                    className={`flex-1 py-1 px-1.5 rounded-md flex items-center justify-center gap-1 transition-all border ${
                        activeTab === 'SAFETY'
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-extrabold shadow-sm'
                            : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                >
                    <ShieldAlert size={12} />
                    <span>3. 风控护城河</span>
                </button>
                <button
                    onClick={() => setActiveTab('MONITOR')}
                    className={`flex-1 py-1 px-1.5 rounded-md flex items-center justify-center gap-1 transition-all border ${
                        activeTab === 'MONITOR'
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-extrabold shadow-sm'
                            : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                >
                    <Clock size={12} />
                    <span>4. 持仓 ({mainPositions.length})</span>
                </button>
            </div>

            {/* 3. Tab 内容区 (扩高 max-h-[75vh] 增加底部内边距 pb-16，确保底边功能 100% 完整可见不被遮挡) */}
            <div className="p-3 space-y-2.5 text-xs text-slate-200 bg-[#0d1017] max-h-[75vh] overflow-y-auto pb-16 custom-scrollbar">

                {/* TAB 1: 触发条件 */}
                {activeTab === 'TRIGGER' && (
                    <div className="space-y-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 flex items-center justify-between">
                                <span>补仓触发模式</span>
                                <span className="text-[9px] text-amber-400 font-normal">支持逻辑组合</span>
                            </label>
                            <div className="grid grid-cols-2 gap-1.5">
                                {[
                                    { id: 'LOSS_PCT', label: '亏损比例达到 %', desc: '按价格偏离幅度触发' },
                                    { id: 'EMA_CROSS', label: '均线相交触发', desc: '价格穿越 EMA 均线' },
                                    { id: 'DIVERGENCE', label: '均线二次发散', desc: '浮亏中再次发散重确立' },
                                    { id: 'MIXED_OR', label: '混合 OR 模式', desc: '满足亏损% 或 均线发散' },
                                    { id: 'MIXED_AND', label: '混合 AND 模式', desc: '需同时满足亏损% 与 均线' },
                                ].map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => updateCfg({ triggerMode: item.id as any })}
                                        className={`p-1.5 px-2 rounded-md border text-left transition-all ${
                                            cfg.triggerMode === item.id
                                                ? 'bg-amber-950/40 border-amber-500/60 text-amber-300 shadow-sm'
                                                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                                        }`}
                                    >
                                        <div className="font-bold text-[10px]">{item.label}</div>
                                        <div className="text-[8px] opacity-70 mt-0">{item.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-0.5">
                            <div className="space-y-0.5">
                                <label className="text-[9px] font-bold text-slate-400 flex justify-between">
                                    <span>亏损触发阈值 %</span>
                                    <span className="text-amber-300 font-mono font-bold">{cfg.triggerLossPercent}%</span>
                                </label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    max="10"
                                    value={cfg.triggerLossPercent ?? 2.0}
                                    onChange={e => updateCfg({ triggerLossPercent: parseFloat(e.target.value) || 2.0 })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                                />
                                <div className="flex gap-1 pt-0.5">
                                    {[1.0, 1.5, 2.0, 3.0].map(v => (
                                        <button
                                            key={v}
                                            onClick={() => updateCfg({ triggerLossPercent: v })}
                                            className={`flex-1 py-0.5 text-[8px] rounded font-mono border ${
                                                cfg.triggerLossPercent === v ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                                            }`}
                                        >
                                            {v}%
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-0.5">
                                <label className="text-[9px] font-bold text-slate-400 flex justify-between">
                                    <span>均线周期相交</span>
                                    <span className="text-amber-300 font-mono font-bold">EMA {cfg.emaPeriod ?? 30}</span>
                                </label>
                                <div className="grid grid-cols-4 gap-1 pt-0.5">
                                    {[20, 30, 40, 80].map(period => (
                                        <button
                                            key={period}
                                            onClick={() => updateCfg({ emaPeriod: period })}
                                            className={`py-0.5 text-[9px] font-bold rounded font-mono border ${
                                                cfg.emaPeriod === period ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                                            }`}
                                        >
                                            {period}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-0.5 bg-slate-900/60 p-1.5 px-2 rounded-md border border-slate-800">
                            <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
                                <span>回调 / 反弹确认比例 %</span>
                                <span className="text-amber-300 font-mono font-bold">{cfg.callbackPercent}%</span>
                            </div>
                            <div className="flex items-center gap-1.5 pt-0.5">
                                <input
                                    type="range"
                                    min="0"
                                    max="2.0"
                                    step="0.1"
                                    value={cfg.callbackPercent ?? 1.0}
                                    onChange={e => updateCfg({ callbackPercent: parseFloat(e.target.value) })}
                                    className="flex-1 accent-amber-400 h-1"
                                />
                                <span className="text-[9px] text-slate-400 font-mono min-w-[28px]">{cfg.callbackPercent}%</span>
                            </div>
                            <div className="text-[8px] text-slate-500 leading-tight">
                                触及补仓线后，需自极端低点反弹（做多）或自高点回调（做空）达标下单。
                            </div>
                        </div>

                        {/* 🛡️ 防接飞刀极值确认开关 */}
                        <div className="p-1.5 px-2 rounded-md bg-blue-950/30 border border-blue-800/40 flex items-center justify-between gap-1.5">
                            <div>
                                <div className="text-[10px] font-bold text-blue-300 flex items-center gap-1">
                                    <span>防接飞刀极值确认</span>
                                    <span className="text-[8px] bg-blue-500/20 text-blue-300 px-1 rounded font-mono">护城河</span>
                                </div>
                                <div className="text-[8px] text-slate-400 leading-tight">
                                    {cfg.enableFallingKnifeGuard !== false 
                                        ? '【防急跌】需动态记录最低针尖，反弹达标后下单。'
                                        : '【极速模式】跳过针尖追踪，满足亏损与回调门槛立即补仓。'
                                    }
                                </div>
                            </div>
                            <button
                                onClick={() => updateCfg({ enableFallingKnifeGuard: cfg.enableFallingKnifeGuard === false ? true : false })}
                                className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all whitespace-nowrap border ${
                                    cfg.enableFallingKnifeGuard !== false
                                        ? 'bg-blue-600 text-white border-blue-400 font-extrabold shadow-sm'
                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                                }`}
                            >
                                {cfg.enableFallingKnifeGuard !== false ? '开启 (防急跌)' : '关闭 (极速补)'}
                            </button>
                        </div>

                        {/* 场景 B 连续阶梯追补开关 */}
                        <div className="p-1.5 px-2 rounded-md bg-amber-950/30 border border-amber-800/40 flex items-center justify-between gap-1.5">
                            <div>
                                <div className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                                    <span>连续阶梯追补 (场景 B 支持)</span>
                                    <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1 rounded font-mono">NEW</span>
                                </div>
                                <div className="text-[8px] text-slate-400 leading-tight">
                                    沿途无新低时，若自上次补仓价再反弹达标，自动追加第2/3次补仓。
                                </div>
                            </div>
                            <button
                                onClick={() => updateCfg({ enableStepDca: cfg.enableStepDca === false ? true : false })}
                                className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all whitespace-nowrap border ${
                                    cfg.enableStepDca !== false
                                        ? 'bg-amber-500 text-black border-amber-400 font-extrabold shadow-sm'
                                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                                }`}
                            >
                                {cfg.enableStepDca !== false ? '已开启' : '已关闭'}
                            </button>
                        </div>
                    </div>
                )}

                {/* TAB 2: 资金与次数 */}
                {activeTab === 'CAPITAL' && (
                    <div className="space-y-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400">补仓参考基准</label>
                            <div className="grid grid-cols-2 gap-1.5">
                                <button
                                    onClick={() => updateCfg({ baseRef: 'INITIAL_QTY' })}
                                    className={`p-1.5 px-2 rounded-md border text-left ${
                                        cfg.baseRef === 'INITIAL_QTY' || !cfg.baseRef
                                            ? 'bg-amber-950/40 border-amber-500/60 text-amber-300'
                                            : 'bg-slate-900/60 border-slate-800 text-slate-400'
                                    }`}
                                >
                                    <div className="font-bold text-[10px]">原开仓数量 (Initial)</div>
                                    <div className="text-[8px] opacity-70 mt-0">每次均按初始开仓金额比例补仓</div>
                                </button>
                                <button
                                    onClick={() => updateCfg({ baseRef: 'TOTAL_QTY' })}
                                    className={`p-1.5 px-2 rounded-md border text-left ${
                                        cfg.baseRef === 'TOTAL_QTY'
                                            ? 'bg-amber-950/40 border-amber-500/60 text-amber-300'
                                            : 'bg-slate-900/60 border-slate-800 text-slate-400'
                                    }`}
                                >
                                    <div className="font-bold text-[10px]">合计持仓数量 (Cumulative)</div>
                                    <div className="text-[8px] opacity-70 mt-0">按当前累计持仓金额比例加倍补仓</div>
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-0.5">
                            <div className="space-y-0.5">
                                <label className="text-[9px] font-bold text-slate-400 flex justify-between">
                                    <span>补仓比例 %</span>
                                    <span className="text-amber-300 font-mono font-bold">{cfg.ratioPercent}%</span>
                                </label>
                                <input
                                    type="number"
                                    step="10"
                                    min="10"
                                    max="300"
                                    value={cfg.ratioPercent ?? 100}
                                    onChange={e => updateCfg({ ratioPercent: parseInt(e.target.value) || 100 })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                                />
                                <div className="flex gap-1 pt-0.5">
                                    {[50, 100, 150, 200].map(r => (
                                        <button
                                            key={r}
                                            onClick={() => updateCfg({ ratioPercent: r })}
                                            className={`flex-1 py-0.5 text-[8px] rounded font-mono border ${
                                                cfg.ratioPercent === r ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                                            }`}
                                        >
                                            {r}%
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-0.5">
                                <label className="text-[9px] font-bold text-slate-400 flex justify-between">
                                    <span>补仓次数限制</span>
                                    <span className="text-amber-300 font-mono font-bold">{cfg.maxCount ?? 2} 次</span>
                                </label>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    max="20"
                                    value={cfg.maxCount ?? 2}
                                    onChange={e => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val) && val >= 1) {
                                            updateCfg({ maxCount: val });
                                        }
                                    }}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                                    placeholder="输入补仓次数"
                                />
                                <div className="flex gap-1 pt-0.5">
                                    {[1, 2, 3, 5].map(cnt => (
                                        <button
                                            key={cnt}
                                            type="button"
                                            onClick={() => updateCfg({ maxCount: cnt })}
                                            className={`flex-1 py-0.5 text-[8px] rounded font-mono border ${
                                                cfg.maxCount === cnt ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold' : 'bg-slate-800 text-slate-400 border-slate-700'
                                            }`}
                                        >
                                            {cnt} 次
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* 双视角组合防护：持仓单体上限 与 账户总容量占比 (左右双列并排) */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-0.5 bg-slate-900/60 p-1.5 px-2 rounded-md border border-slate-800">
                                <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
                                    <span>持仓总数量限制 (USDT)</span>
                                    <span className="text-amber-300 font-mono font-bold">${cfg.maxTotalUsdt ?? 500} USDT</span>
                                </div>
                                <input
                                    type="number"
                                    step="50"
                                    min="50"
                                    max="10000"
                                    value={cfg.maxTotalUsdt ?? 500}
                                    onChange={e => updateCfg({ maxTotalUsdt: parseInt(e.target.value) || 500 })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                                />
                                <div className="text-[8px] text-slate-500 leading-tight">
                                    硬性安全阈值：单个持仓补仓后的总本金绝对不能超过此上限。
                                </div>
                            </div>

                            <div className="space-y-0.5 bg-slate-900/60 p-1.5 px-2 rounded-md border border-slate-800">
                                <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
                                    <span>持仓总量占可用余额%上限</span>
                                    <span className="text-amber-300 font-mono font-bold">{cfg.maxPositionToBalancePercent ?? 80}%</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <input
                                        type="number"
                                        step="5"
                                        min="10"
                                        max="100"
                                        value={cfg.maxPositionToBalancePercent ?? 80}
                                        onChange={e => updateCfg({ maxPositionToBalancePercent: Math.min(100, Math.max(10, parseInt(e.target.value) || 80)) })}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                                    />
                                    <span className="text-xs text-slate-400 font-mono">%</span>
                                </div>
                                <div className="text-[8px] text-slate-500 leading-tight">
                                    综合限制：总持仓占可用余额超过该百分比时停止继续补仓。
                                </div>
                            </div>
                        </div>

                        {/* 🛡️ 全盘同时补仓币种数限制与最亏优先 */}
                        <div className="p-2 rounded-md bg-amber-950/30 border border-amber-800/50 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                                    <span>最大同时补仓币种数限制</span>
                                    <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1 rounded font-mono">配额风控</span>
                                </label>
                                <span className="text-[9px] font-mono text-amber-400 font-bold">
                                    已占额度: {mainPositions.filter(p => (p.dcaCount || 0) > 0).length} / {(cfg.maxAddingCoinsCount && cfg.maxAddingCoinsCount > 0) ? `${cfg.maxAddingCoinsCount} 币` : '不限'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    step="1"
                                    value={cfg.maxAddingCoinsCount ?? 0}
                                    onChange={e => updateCfg({ maxAddingCoinsCount: Math.max(0, parseInt(e.target.value) || 0) })}
                                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                                    placeholder="0表示不限制"
                                />
                                <span className="text-[9px] text-slate-400 font-mono whitespace-nowrap">币 (0不限)</span>
                            </div>
                            <div className="flex gap-1 pt-0.5">
                                {[0, 3, 5, 10].map(num => (
                                    <button
                                        key={num}
                                        type="button"
                                        onClick={() => updateCfg({ maxAddingCoinsCount: num })}
                                        className={`flex-1 py-0.5 text-[8px] rounded font-mono border ${
                                            (cfg.maxAddingCoinsCount ?? 0) === num ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold' : 'bg-slate-800 text-slate-400 border-slate-700'
                                        }`}
                                    >
                                        {num === 0 ? '不限制' : `${num} 个币`}
                                    </button>
                                ))}
                            </div>

                            {/* 最亏优先竞逐模式 */}
                            <div className="pt-1 border-t border-slate-800/80 space-y-1">
                                <label className="text-[9px] font-bold text-slate-400 flex justify-between">
                                    <span>多币触发时优先级竞逐标准</span>
                                    <span className="text-amber-400 font-mono text-[8px]">最亏优先铁律</span>
                                </label>
                                <div className="grid grid-cols-2 gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => updateCfg({ addPriorityMetric: 'pnl_usdt' })}
                                        className={`p-1 px-2 rounded border text-left transition-all ${
                                            (cfg.addPriorityMetric || 'pnl_usdt') === 'pnl_usdt'
                                                ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                                                : 'bg-slate-900/60 border-slate-800 text-slate-400'
                                        }`}
                                    >
                                        <div className="text-[9px] font-bold">1. 浮亏金额最大优先 (USDT)</div>
                                        <div className="text-[7.5px] opacity-70">优先补亏损 USDT 最大的持仓</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateCfg({ addPriorityMetric: 'pnl_percent' })}
                                        className={`p-1 px-2 rounded border text-left transition-all ${
                                            cfg.addPriorityMetric === 'pnl_percent'
                                                ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                                                : 'bg-slate-900/60 border-slate-800 text-slate-400'
                                        }`}
                                    >
                                        <div className="text-[9px] font-bold">2. 跌幅比例最大优先 (%)</div>
                                        <div className="text-[7.5px] opacity-70">优先补价格跌幅百分比最大的持仓</div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 3: 风控护城河 */}
                {activeTab === 'SAFETY' && (
                    <div className="space-y-2">
                        <div className="space-y-0.5">
                            <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
                                <span>补仓最小时间间隔 (冷却)</span>
                                <span className="text-amber-300 font-mono font-bold">{(cfg.cooldownSeconds === 0) ? '0秒 (无冷却)' : `${cfg.cooldownSeconds ?? 30} 秒`}</span>
                            </div>
                            <div className="flex gap-1 pt-0.5">
                                {[0, 10, 30, 60].map(sec => (
                                    <button
                                        key={sec}
                                        onClick={() => updateCfg({ cooldownSeconds: sec })}
                                        className={`flex-1 py-0.5 text-[8px] font-bold rounded font-mono border ${
                                            cfg.cooldownSeconds === sec ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold' : 'bg-slate-800 text-slate-400 border-slate-700'
                                        }`}
                                    >
                                        {sec === 0 ? '0秒(无冷却)' : `${sec}秒`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-0.5 bg-slate-900/60 p-1.5 px-2 rounded-md border border-slate-800">
                            <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
                                <span>离防爆对冲线安全距离隔离带 %</span>
                                <span className="text-amber-300 font-mono font-bold">{cfg.hedgeSafeDistancePercent ?? 1.0}%</span>
                            </div>
                            <input
                                type="range"
                                min="0.3"
                                max="3.0"
                                step="0.1"
                                value={cfg.hedgeSafeDistancePercent ?? 1.0}
                                onChange={e => updateCfg({ hedgeSafeDistancePercent: parseFloat(e.target.value) })}
                                className="w-full accent-amber-400 h-1"
                            />
                            <div className="text-[8px] text-slate-500 leading-tight">
                                防护铁律：若价格已经逼近防爆对冲线（差距小于此比例），停止补仓，直接移交对冲守护。
                            </div>
                        </div>

                        <div className="space-y-0.5 bg-slate-900/60 p-1.5 px-2 rounded-md border border-slate-800">
                            <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
                                <span>极端大阴/大阳单根 K 线波幅熔断 %</span>
                                <span className="text-amber-300 font-mono font-bold">{cfg.circuitBreakerVolPercent ?? 3.0}%</span>
                            </div>
                            <input
                                type="range"
                                min="1.5"
                                max="8.0"
                                step="0.5"
                                value={cfg.circuitBreakerVolPercent ?? 3.0}
                                onChange={e => updateCfg({ circuitBreakerVolPercent: parseFloat(e.target.value) })}
                                className="w-full accent-amber-400 h-1"
                            />
                            <div className="text-[8px] text-slate-500 leading-tight">
                                当遭遇极端黑天鹅或秒级暴跌时（单根 K 线振幅大于此比例），系统暂停补仓。
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 4: 持仓实况监控 */}
                {activeTab === 'MONITOR' && (
                    <div className="space-y-2">
                        <div className="text-[10px] text-slate-400 font-bold flex justify-between">
                            <span>当前监测主持仓 ({mainPositions.length})</span>
                            <span>智能补仓自动调度中</span>
                        </div>

                        {mainPositions.length === 0 ? (
                            <div className="p-6 text-center text-slate-500 text-xs bg-slate-900/40 rounded-lg border border-slate-800">
                                暂无活跃主持仓，智能补仓守护已就绪
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {mainPositions.map(pos => {
                                    const dcaCount = pos.dcaCount || 0;
                                    const maxCount = cfg.maxCount ?? 2;
                                    const unpnlPct = pos.unrealizedPnLPercentage || 0;
                                    const records = pos.dcaRecords || [];
                                    const isExpanded = !!expandedHistory[pos.entryId];

                                    return (
                                        <div key={pos.entryId} className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="font-bold text-white flex items-center gap-1.5">
                                                        <span className={pos.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
                                                            {pos.side === 'LONG' ? '做多' : '做空'}
                                                        </span>
                                                        <span>{pos.symbol}</span>
                                                        <span className="text-[9px] font-mono bg-slate-800 text-slate-300 px-1 rounded">
                                                            ${pos.amount.toFixed(1)} USDT
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5 font-mono">
                                                        <span>均价: ${pos.entryPrice.toFixed(4)}</span>
                                                        <span className={unpnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                            浮亏: {unpnlPct.toFixed(2)}%
                                                        </span>
                                                        <span>补仓: {dcaCount}/{maxCount} 次</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1.5">
                                                    {records.length > 0 && (
                                                        <button
                                                            onClick={() => setExpandedHistory(prev => ({ ...prev, [pos.entryId]: !prev[pos.entryId] }))}
                                                            className="px-2 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 rounded text-[9px] font-bold transition-all flex items-center gap-1"
                                                        >
                                                            📜 详情({records.length})
                                                        </button>
                                                    )}

                                                    {onManualDca && dcaCount < maxCount && (
                                                        <button
                                                            onClick={() => {
                                                                const initialQty = pos.initialAmount !== undefined ? pos.initialAmount : pos.amount;
                                                                const initialPrice = pos.initialEntryPrice || pos.entryPrice;
                                                                const baseUsdt = initialQty * initialPrice;
                                                                const ratio = (cfg.ratioPercent ?? 100) / 100;
                                                                const stepMultiplier = Math.pow(2, dcaCount);
                                                                const amt = Math.round(baseUsdt * ratio * stepMultiplier * 100) / 100;

                                                                // 记录手动补仓的 DcaRecord 详情
                                                                const currentPrice = realPrices[pos.symbol] || pos.markPrice || pos.entryPrice;
                                                                const oldQty = pos.amount;
                                                                const oldPrice = pos.entryPrice;
                                                                const addQty = amt / currentPrice;
                                                                const newAmount = oldQty + addQty;
                                                                const newEntryPrice = (oldQty * oldPrice + amt) / newAmount;

                                                                const manualRecord = {
                                                                    id: `dca_manual_${Date.now()}`,
                                                                    timestamp: Date.now(),
                                                                    count: dcaCount + 1,
                                                                    triggerMode: 'MANUAL',
                                                                    triggerModeLabel: '1键手动',
                                                                    reason: '用户在补仓面板手动点击【1键手动补仓】按钮',
                                                                    signalDetail: `用户手动补仓 $${amt.toFixed(1)} USDT (执行市价 $${currentPrice.toFixed(4)})`,
                                                                    addAmountUsdt: amt,
                                                                    price: currentPrice,
                                                                    oldEntryPrice: oldPrice,
                                                                    newEntryPrice: newEntryPrice,
                                                                    oldAmountTokens: oldQty,
                                                                    newAmountTokens: newAmount
                                                                };

                                                                pos.dcaRecords = [...(pos.dcaRecords || []), manualRecord];
                                                                onManualDca(pos, amt);
                                                            }}
                                                            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-[10px] font-bold flex items-center gap-1 transition-all"
                                                        >
                                                            <Zap size={11} />
                                                            1键手动补仓
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 📜 Expandable DCA Records Timeline */}
                                            {(isExpanded || (records.length > 0 && dcaCount > 0)) && (
                                                <div className="mt-1 pt-2 border-t border-slate-800/80 space-y-1.5 font-mono text-[10px]">
                                                    <div className="text-[9px] font-bold text-amber-400/90 flex items-center justify-between uppercase tracking-wider">
                                                        <span>📜 补仓历史记录与触发信号明细 ({records.length}次)</span>
                                                        <span>已补: {dcaCount}/{maxCount} 次</span>
                                                    </div>

                                                    {records.length === 0 ? (
                                                        <div className="text-slate-500 text-[10px] italic py-1">暂无历史补仓记录</div>
                                                    ) : (
                                                        records.map((rec, idx) => (
                                                            <div key={rec.id || idx} className="p-2 bg-[#090c12] border border-amber-500/30 rounded-md space-y-1">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="px-1.5 py-0.2 bg-amber-500/20 text-amber-300 font-bold rounded text-[9px]">
                                                                            第 {rec.count || (idx + 1)} 次补仓
                                                                        </span>
                                                                        <span className="px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 font-bold rounded text-[9px]">
                                                                            【{rec.triggerModeLabel || rec.triggerMode || '智能触发'}】
                                                                        </span>
                                                                    </div>
                                                                    <span className="text-[9px] text-slate-500 font-mono">
                                                                        {rec.executionTimeStr || new Date(rec.timestamp).toLocaleTimeString()}
                                                                    </span>
                                                                </div>

                                                                <div className="text-slate-300 font-sans text-[10px]">
                                                                    <span className="text-slate-400 font-bold">触发信号: </span>
                                                                    <span className="text-amber-200/90 font-mono font-bold">{rec.signalDetail || rec.reason}</span>
                                                                </div>

                                                                {/* ⚡ 补仓 5 维精准全过程数据核验 */}
                                                                <div className="grid grid-cols-2 gap-1 bg-[#121722] p-1.5 rounded border border-slate-800 text-[9px] font-mono mt-1">
                                                                    <div className="text-red-400">
                                                                        1. 补仓前亏损: <span className="font-bold">{rec.preRefillPnLPct !== undefined ? `${rec.preRefillPnLPct.toFixed(2)}%` : '---'}</span>
                                                                        {rec.preRefillPnLUsdt !== undefined && <span className="text-slate-400 ml-1">(${rec.preRefillPnLUsdt.toFixed(2)} U)</span>}
                                                                    </div>
                                                                    <div className="text-blue-300">
                                                                        2. 极值价格: <span className="font-bold">{rec.extremePrice ? `$${rec.extremePrice.toFixed(4)}` : '---'}</span>
                                                                        <span className="text-slate-400 ml-1">({rec.extremeTimeStr || '---'})</span>
                                                                    </div>
                                                                    <div className="text-amber-300">
                                                                        3. 补仓执行: <span className="font-bold">{rec.price ? `$${rec.price.toFixed(4)}` : '---'}</span>
                                                                        <span className="text-slate-400 ml-1">({rec.executionTimeStr || new Date(rec.timestamp).toLocaleTimeString()})</span>
                                                                    </div>
                                                                    <div className="text-emerald-300">
                                                                        4. 回调/反弹: <span className="font-bold">{rec.pullbackPct !== undefined ? `${rec.pullbackPct >= 0 ? '+' : ''}${rec.pullbackPct.toFixed(2)}%` : '---'}</span>
                                                                    </div>
                                                                    <div className="col-span-2 text-slate-300 pt-0.5 border-t border-slate-800/60 flex items-center justify-between">
                                                                        <span>5. 补仓后摊薄: 均价 <span className="line-through text-slate-500">${rec.oldEntryPrice?.toFixed(4)}</span> ➔ <strong className="text-amber-300">${rec.newEntryPrice?.toFixed(4)}</strong></span>
                                                                        <span className="text-emerald-400 font-bold">新亏损: {rec.postRefillPnLPct !== undefined ? `${rec.postRefillPnLPct.toFixed(2)}%` : '---'}</span>
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center justify-between text-slate-400 text-[9px] pt-0.5 border-t border-slate-800/40">
                                                                    <span>加仓金额: <strong className="text-amber-300">${rec.addAmountUsdt.toFixed(1)} USDT</strong></span>
                                                                    <span>补仓序号: <strong className="text-slate-200">第 {rec.count || 1} 次</strong></span>
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

            </div>

            {/* 4. 底栏 */}
            <div className="p-2.5 bg-[#0a0c10] border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
                <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                    <CheckCircle2 size={12} />
                    <span>代码隔离锁有效 • 自动重算持仓均价</span>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="px-3 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold transition-colors"
                    >
                        收起面板
                    </button>
                )}
            </div>

        </div>
    );
};

export const DcaControlDropdown: React.FC<Props> = ({
    settings,
    onUpdateSettings,
    activePositions = [],
    realPrices = {},
    onManualDca
}) => {
    return null;
};
