/**
 * @file modules/positions-list/components/ReopenControlDropdown.tsx
 * @description 平仓后自动复开 (Reopen) 控制面板 (嵌入在“当前持仓”顶部栏，位于“智能补仓”右侧)
 */

import React, { useState, useEffect } from 'react';
import { RefreshCw, ShieldCheck, Zap, X, HelpCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { ActionConfig } from '../../../components/Scanner/scannerTypes';

const DEFAULT_ACTION_CONFIG: ActionConfig = { 
    enabled: true, 
    openAmount: 10, 
    maxOpenSymbols: 200,
    maxTotalValue: 100000,
    breakoutBuffer: 0.2, 
    autoExecute: true, 
    maxExposurePercent: 95,
    minHealthPercent: 0,
    positionSizeMode: 'FIXED', 
    variablePercentage: 2, 
    variableMaxLimit: 200,
    breakerConfig: {
        enabled: false,
        triggerMinutes: 15,
        minDropPercent: 3,
        minCoinsPercent: 50,
        autoRecoverMinutes: 30
    },
    autoReopenEnabled: false,
    reopenBullBearFilter: '1h_ema80',
    reopenPullbackLimitPct: 3.0,
    reopenTakeProfitOnly: true,
    reopenMaxConsecutiveLosses: 2,
    reopenLongLimitEnabled: true,
    reopenLongLimitDays: 3,
    reopenLongLimitPct: 20,
    reopenShortLimitEnabled: true,
    reopenShortLimitDays: 3,
    reopenShortLimitPct: 20
};

interface InlineProps {
    onClose?: () => void;
}

/**
 * 🔄 平仓后自动复开 (Reopen) 嵌入式面板组件
 */
export const ReopenInlineCard: React.FC<InlineProps> = ({ onClose }) => {
    const [config, setConfigState] = useState<ActionConfig>(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const raw = localStorage.getItem('SCANNER_ACTION_CONFIG');
                if (raw) return { ...DEFAULT_ACTION_CONFIG, ...JSON.parse(raw) };
            } catch (e) {}
        }
        return DEFAULT_ACTION_CONFIG;
    });

    const updateConfig = (updater: (prev: ActionConfig) => ActionConfig) => {
        setConfigState(prev => {
            const next = updater(prev);
            if (typeof window !== 'undefined' && window.localStorage) {
                try {
                    localStorage.setItem('SCANNER_ACTION_CONFIG', JSON.stringify(next));

                    // 同步复开配置到所有策略专属的 SCANNER_ACTION_CONFIG_* Key (如 SCANNER_ACTION_CONFIG_LIST1)
                    const reopenFields = {
                        autoReopenEnabled: next.autoReopenEnabled,
                        reopenBullBearFilter: next.reopenBullBearFilter,
                        reopenPullbackLimitPct: next.reopenPullbackLimitPct,
                        reopenTakeProfitOnly: next.reopenTakeProfitOnly,
                        reopenMaxConsecutiveLosses: next.reopenMaxConsecutiveLosses,
                        reopenLongLimitEnabled: next.reopenLongLimitEnabled,
                        reopenLongLimitDays: next.reopenLongLimitDays,
                        reopenLongLimitPct: next.reopenLongLimitPct,
                        reopenShortLimitEnabled: next.reopenShortLimitEnabled,
                        reopenShortLimitDays: next.reopenShortLimitDays,
                        reopenShortLimitPct: next.reopenShortLimitPct,
                    };

                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && key.startsWith('SCANNER_ACTION_CONFIG_')) {
                            try {
                                const item = localStorage.getItem(key);
                                if (item) {
                                    const parsed = JSON.parse(item);
                                    const updated = { ...parsed, ...reopenFields };
                                    localStorage.setItem(key, JSON.stringify(updated));
                                }
                            } catch (e) {}
                        }
                    }

                    window.dispatchEvent(new Event('storage'));
                    window.dispatchEvent(new CustomEvent('scanner_action_config_updated', { detail: next }));
                } catch (e) {}
            }
            return next;
        });
    };

    useEffect(() => {
        const handleStorageChange = () => {
            if (typeof window !== 'undefined' && window.localStorage) {
                try {
                    const raw = localStorage.getItem('SCANNER_ACTION_CONFIG');
                    if (raw) setConfigState({ ...DEFAULT_ACTION_CONFIG, ...JSON.parse(raw) });
                } catch (e) {}
            }
        };
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('scanner_action_config_updated', handleStorageChange as EventListener);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('scanner_action_config_updated', handleStorageChange as EventListener);
        };
    }, []);

    const isEnabled = !!config.autoReopenEnabled;

    return (
        <div className="w-full max-w-[760px] mx-auto bg-[#0d1017] border border-indigo-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans select-none my-1 transition-all">
            
            {/* 1. 面板头部 */}
            <div className="p-2.5 px-3 bg-[#121620] border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <div className="p-1 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                        <RefreshCw size={14} className={isEnabled ? 'animate-spin-slow text-indigo-400' : 'text-slate-500'} />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-white flex items-center gap-1.5">
                            平仓后自动复开策略面板
                            <span className="text-[8px] font-mono text-indigo-400 bg-indigo-950/60 border border-indigo-800/50 px-1 py-0.1 rounded">
                                REOPEN GUARDIAN
                            </span>
                        </div>
                        <div className="text-[9px] text-slate-400">
                            平仓止盈后无缝再战 • 动能波段续航 • 趋势离场保护
                        </div>
                    </div>
                </div>

                {/* 总开关与关闭按键 */}
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => updateConfig(p => ({ ...p, autoReopenEnabled: !p.autoReopenEnabled }))}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-1.5 border ${
                            isEnabled
                                ? 'bg-indigo-600 text-white border-indigo-400 font-extrabold shadow-md shadow-indigo-500/20'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
                        {isEnabled ? '复开策略已开启' : '复开策略已暂停'}
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
                            title="收起自动复开面板"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* 2. 参数设置与风控门禁区 */}
            <div className="p-3 space-y-2.5 text-xs text-slate-200 bg-[#0d1017] max-h-[75vh] overflow-y-auto pb-8 custom-scrollbar">
                
                {/* A. 趋势门禁 & 止盈门禁 */}
                <div className="grid grid-cols-2 gap-2">
                    {/* 牛熊趋势门禁 */}
                    <div className="p-2 rounded-md bg-slate-900/80 border border-slate-800 space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 flex items-center justify-between">
                            <span>牛熊趋势门禁</span>
                            <span className="text-[8px] text-indigo-400 font-mono">EMA 周期</span>
                        </label>
                        <select
                            value={config.reopenBullBearFilter ?? '1h_ema80'}
                            onChange={e => updateConfig(p => ({ ...p, reopenBullBearFilter: e.target.value }))}
                            className="w-full bg-slate-950 border border-slate-700 text-indigo-300 text-[10px] font-mono font-bold rounded px-1.5 py-1 outline-none focus:border-indigo-400"
                        >
                            <option value="1h_ema80">1h EMA80 上多/下空</option>
                            <option value="1h_ema200">1h EMA200 强牛熊轴</option>
                            <option value="4h_ema80">4h EMA80 大周期门禁</option>
                            <option value="15m_ema80">15m EMA80 敏捷门禁</option>
                            <option value="OFF">关闭趋势门禁</option>
                        </select>
                        <div className="text-[8px] text-slate-500 leading-tight pt-0.5">
                            开仓方向需与选定的 EMA 均线多空趋势保持一致。
                        </div>
                    </div>

                    {/* 仅限止盈平仓复开 */}
                    <div className="p-2 rounded-md bg-slate-900/80 border border-slate-800 space-y-1 flex flex-col justify-between">
                        <label className="text-[10px] font-bold text-slate-400 flex items-center justify-between">
                            <span>平仓触发模式</span>
                            <span className="text-[8px] text-emerald-400 font-mono">安全门禁</span>
                        </label>
                        <button
                            type="button"
                            onClick={() => updateConfig(p => ({ ...p, reopenTakeProfitOnly: !(p.reopenTakeProfitOnly ?? true) }))}
                            className={`w-full py-1 rounded text-[10px] font-bold border transition-colors flex items-center justify-center gap-1 ${
                                (config.reopenTakeProfitOnly ?? true)
                                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-bold'
                                    : 'bg-slate-800 border-slate-700 text-slate-400'
                            }`}
                        >
                            {(config.reopenTakeProfitOnly ?? true) ? '仅限止盈平仓复开' : '任意平仓允许复开'}
                        </button>
                        <div className="text-[8px] text-slate-500 leading-tight">
                            {(config.reopenTakeProfitOnly ?? true) ? '对冲或止损平仓不触发复开' : '允许包含止损或对冲解套平仓'}
                        </div>
                    </div>
                </div>

                {/* B. 高点回调熔断 & 连亏熔断 */}
                <div className="grid grid-cols-2 gap-2">
                    {/* 高点回调偏离熔断 % */}
                    <div className="p-2 rounded-md bg-slate-900/80 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                            <span>高点回调熔断 %</span>
                            <span className="text-amber-300 font-mono font-bold">{config.reopenPullbackLimitPct ?? 3.0}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="10"
                                value={config.reopenPullbackLimitPct ?? 3.0}
                                onChange={e => updateConfig(p => ({ ...p, reopenPullbackLimitPct: parseFloat(e.target.value) || 3.0 }))}
                                className="w-14 bg-slate-950 border border-slate-700 text-amber-300 text-xs font-mono font-bold rounded px-1 py-0.5 text-center outline-none focus:border-amber-400"
                            />
                            <div className="flex gap-0.5 flex-1">
                                {[1, 2, 3, 5].map(v => (
                                    <button
                                        key={v}
                                        type="button"
                                        onClick={() => updateConfig(p => ({ ...p, reopenPullbackLimitPct: v }))}
                                        className={`flex-1 py-0.5 rounded font-mono text-[8px] border ${
                                            (config.reopenPullbackLimitPct ?? 3.0) === v ? 'bg-amber-500/30 text-amber-300 border-amber-500/50 font-bold' : 'bg-slate-800 text-slate-500 border-slate-700'
                                        }`}
                                    >
                                        {v}%
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="text-[8px] text-slate-500 leading-tight">
                            若自高点/低点反向偏离超过此比例，暂停复开。
                        </div>
                    </div>

                    {/* 单币连亏熔断次数 */}
                    <div className="p-2 rounded-md bg-slate-900/80 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                            <span>单币连亏熔断</span>
                            <span className="text-red-400 font-mono font-bold">{config.reopenMaxConsecutiveLosses ?? 2} 次</span>
                        </div>
                        <div className="flex gap-1 pt-0.5">
                            {[1, 2, 3, 5].map(cnt => (
                                <button
                                    key={cnt}
                                    type="button"
                                    onClick={() => updateConfig(p => ({ ...p, reopenMaxConsecutiveLosses: cnt }))}
                                    className={`flex-1 py-1 rounded text-[9px] font-bold font-mono border ${
                                        (config.reopenMaxConsecutiveLosses ?? 2) === cnt 
                                            ? 'bg-red-950/60 text-red-300 border-red-500/50 font-extrabold' 
                                            : 'bg-slate-800 text-slate-500 border-slate-700'
                                    }`}
                                >
                                    {cnt}次
                                </button>
                            ))}
                        </div>
                        <div className="text-[8px] text-slate-500 leading-tight">
                            单币连续亏损达到该次数后自动熔断该币复开。
                        </div>
                    </div>
                </div>

                {/* C. 做多与做空 N 天内拉升/下跌限制 */}
                <div className="space-y-1.5 pt-0.5">
                    {/* 做多 N天内上涨 % 不再复开 */}
                    <div className="p-2 rounded-md bg-emerald-950/20 border border-emerald-800/40 space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-emerald-400">做多 N天拉升极值限制</span>
                            <button
                                type="button"
                                onClick={() => updateConfig(p => ({ ...p, reopenLongLimitEnabled: !(p.reopenLongLimitEnabled ?? true) }))}
                                className={`px-2 py-0.5 rounded text-[8px] font-bold border transition-colors ${
                                    (config.reopenLongLimitEnabled ?? true)
                                        ? 'bg-emerald-600 text-white border-emerald-400'
                                        : 'bg-slate-800 border-slate-700 text-slate-500'
                                }`}
                            >
                                {(config.reopenLongLimitEnabled ?? true) ? '已开启' : '已关闭'}
                            </button>
                        </div>
                        {(config.reopenLongLimitEnabled ?? true) && (
                            <div className="flex items-center gap-1.5 text-[9px] text-slate-300 pt-0.5">
                                <span>做多在</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="30"
                                    value={config.reopenLongLimitDays ?? 3}
                                    onChange={e => updateConfig(p => ({ ...p, reopenLongLimitDays: parseInt(e.target.value) || 1 }))}
                                    className="w-10 bg-slate-950 border border-slate-700 text-emerald-300 text-xs font-mono font-bold rounded px-1 py-0.5 text-center outline-none focus:border-emerald-400"
                                />
                                <span>天内已累计上涨达</span>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    max="500"
                                    value={config.reopenLongLimitPct ?? 20}
                                    onChange={e => updateConfig(p => ({ ...p, reopenLongLimitPct: parseFloat(e.target.value) || 0 }))}
                                    className="w-12 bg-slate-950 border border-slate-700 text-emerald-300 text-xs font-mono font-bold rounded px-1 py-0.5 text-center outline-none focus:border-emerald-400"
                                />
                                <span>% 时，拦截做多复开</span>
                            </div>
                        )}
                    </div>

                    {/* 做空 N天内下跌 % 不再复开 */}
                    <div className="p-2 rounded-md bg-rose-950/20 border border-rose-800/40 space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-rose-400">做空 N天下跌极值限制</span>
                            <button
                                type="button"
                                onClick={() => updateConfig(p => ({ ...p, reopenShortLimitEnabled: !(p.reopenShortLimitEnabled ?? true) }))}
                                className={`px-2 py-0.5 rounded text-[8px] font-bold border transition-colors ${
                                    (config.reopenShortLimitEnabled ?? true)
                                        ? 'bg-rose-600 text-white border-rose-400'
                                        : 'bg-slate-800 border-slate-700 text-slate-500'
                                }`}
                            >
                                {(config.reopenShortLimitEnabled ?? true) ? '已开启' : '已关闭'}
                            </button>
                        </div>
                        {(config.reopenShortLimitEnabled ?? true) && (
                            <div className="flex items-center gap-1.5 text-[9px] text-slate-300 pt-0.5">
                                <span>做空在</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="30"
                                    value={config.reopenShortLimitDays ?? 3}
                                    onChange={e => updateConfig(p => ({ ...p, reopenShortLimitDays: parseInt(e.target.value) || 1 }))}
                                    className="w-10 bg-slate-950 border border-slate-700 text-rose-300 text-xs font-mono font-bold rounded px-1 py-0.5 text-center outline-none focus:border-rose-400"
                                />
                                <span>天内已累计下跌达</span>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    max="500"
                                    value={config.reopenShortLimitPct ?? 20}
                                    onChange={e => updateConfig(p => ({ ...p, reopenShortLimitPct: parseFloat(e.target.value) || 0 }))}
                                    className="w-12 bg-slate-950 border border-slate-700 text-rose-300 text-xs font-mono font-bold rounded px-1 py-0.5 text-center outline-none focus:border-rose-400"
                                />
                                <span>% 时，拦截做空复开</span>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* 3. 底栏 */}
            <div className="p-2.5 bg-[#0a0c10] border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
                <div className="flex items-center gap-1.5 text-indigo-400 font-bold">
                    <CheckCircle2 size={12} />
                    <span>自动开仓引擎联动有效 • 即时离场锁保护</span>
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
