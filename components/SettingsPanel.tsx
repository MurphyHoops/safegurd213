
import React, { useState, useRef, useEffect } from 'react';
import { AppSettings, SimulationSettings, StopLossSettings } from '../types';
import { Target, Shield, AlertTriangle, RefreshCw, Settings, Info, X, BookOpen, Sun, Moon, Music, VolumeX, ShieldCheck, History } from 'lucide-react';
import { audioService } from '../services/audioService';

// --- ATOMIC MODULES ---
import { ProfitManagerModule } from '../modules/profit-manager';
import { HedgeGuardianModule } from '../modules/hedge-guardian';
import { RescueTacticsModule } from '../modules/rescue-tactics';
import { AutoPilotModule } from '../modules/auto-pilot';
import { SystemCoreModule } from '../modules/system-core';
import { BacktesterModule } from '../modules/backtester/BacktesterModule';

import ModuleHeader from './Settings/ModuleHeader';

interface Props {
    settings: AppSettings;
    realPrices: Record<string, number>;
    previewData: { symbol: string }[];
    handleChange: (section: keyof AppSettings, key: string, value: any) => void;
    onBatchOpen: (simSettings: SimulationSettings) => void;
    onFactoryReset: () => void;
    onOpenScanner: () => void;
    onToggleSim: () => void;
    isSimulating: boolean;
    systemStats: {
        balance: number;
        positionCount: number;
        tradeCount: number;
        logCount: number;
    };
    onViewSource: () => void;
    onOpenManual: () => void; 
    onRestoreSettings: (settings: AppSettings) => void;
}

const SettingsPanel: React.FC<Props> = React.memo(({ settings, handleChange, onFactoryReset, onOpenScanner, onToggleSim, isSimulating, onViewSource, onOpenManual, onRestoreSettings }) => {
    
    const [expandedModule, setExpandedModule] = useState<number | null>(6); // Default to User Guide
    const [showStrategy43Info, setShowStrategy43Info] = useState(false);
    
    // --- System Guard State (Lifted Up) ---
    const [wakeLock, setWakeLock] = useState<any>(null);
    const [bgModeActive, setBgModeActive] = useState(false);

    // Auto-enable on mount
    useEffect(() => {
        let lock: any = null;
        let isMounted = true;
        let isRequesting = false;

        const requestWakeLock = async () => {
            if (!isMounted || lock || isRequesting || !('wakeLock' in navigator)) return;
            isRequesting = true;
            try {
                lock = await (navigator as any).wakeLock.request('screen');
                if (isMounted) {
                    setWakeLock(lock);
                    lock.addEventListener('release', () => {
                        lock = null;
                        if (isMounted) setWakeLock(null);
                    });
                }
            } catch (err: any) {
                console.warn('Auto wake lock failed:', err.message);
                // If it failed due to NotAllowedError, we can try again on first user interaction
                if (err.name === 'NotAllowedError') {
                    const handleInteraction = async () => {
                        document.removeEventListener('click', handleInteraction);
                        document.removeEventListener('touchstart', handleInteraction);
                        await requestWakeLock();
                    };
                    document.addEventListener('click', handleInteraction);
                    document.addEventListener('touchstart', handleInteraction);
                }
            } finally {
                isRequesting = false;
            }
        };

        const enableGuards = async () => {
            // Enable background keep-alive
            if (!bgModeActive) {
                audioService.enableBackgroundMode();
                setBgModeActive(true);
            }
            
            // Enable screen wake lock
            await requestWakeLock();
        };
        
        enableGuards();
        
        return () => {
            isMounted = false;
            if (lock) {
                lock.release().catch(console.error);
            }
        };
    }, []);

    const toggleModule = (id: number) => {
        setExpandedModule(expandedModule === id ? null : id);
    };

    // Helper: Update Nested Setting (Passed to ProfitManager)
    const updateNested = (section: keyof AppSettings, subsection: string, key: string, value: any) => {
        const currentSection = settings[section] as any;
        const currentSub = currentSection[subsection] || {};
        handleChange(section, subsection, { ...currentSub, [key]: value });
    };
    
    // Helper: Toggle Exclusive Feature for Rescue Module
    const toggleModule3Feature = (feature: keyof StopLossSettings) => {
        const current = settings.stopLoss;
        const willEnable = !current[feature];

        if (willEnable) {
            if (feature === 'hedgeProfitClear') {
                handleChange('stopLoss', 'callbackProfitClear', false);
                handleChange('stopLoss', 'amputationEnabled', false);
            } else if (feature === 'callbackProfitClear') {
                handleChange('stopLoss', 'hedgeProfitClear', false);
                handleChange('stopLoss', 'amputationEnabled', false);
            } else if (feature === 'amputationEnabled') {
                handleChange('stopLoss', 'hedgeProfitClear', false);
                handleChange('stopLoss', 'callbackProfitClear', false);
            }
        }
        
        handleChange('stopLoss', feature as string, willEnable);
    };

    // --- GUARD FUNCTIONS ---
    const toggleWakeLock = async () => {
        if (wakeLock) {
            try {
                await wakeLock.release();
                setWakeLock(null);
                audioService.speak("屏幕常亮已关闭");
            } catch (e) {
                console.error(e);
            }
        } else {
            try {
                if ('wakeLock' in navigator) {
                    const lock = await (navigator as any).wakeLock.request('screen');
                    setWakeLock(lock);
                    audioService.speak("屏幕常亮已开启");
                    lock.addEventListener('release', () => {
                        setWakeLock(null);
                    });
                } else {
                    alert("您的浏览器暂不支持屏幕控制 API，请在手机系统设置中手动将自动锁屏设置为“从不”。");
                }
            } catch (err: any) {
                console.error(`${err.name}, ${err.message}`);
                audioService.speak("开启失败，请检查浏览器权限");
            }
        }
    };

    const toggleBgMode = () => {
        if (!bgModeActive) {
            audioService.enableBackgroundMode();
            setBgModeActive(true);
            audioService.speak("后台保活已激活");
        }
    };

    // --- BACKUP & RESTORE LOGIC ---
    const handleExportSettings = () => {
        const dataStr = JSON.stringify(settings, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `savior_settings_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        audioService.speak('配置已备份导出');
    };

    const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                // Basic validation: check for core sections
                if (json && typeof json === 'object' && (json.profit || json.hedging || json.stopLoss)) {
                    onRestoreSettings(json);
                    audioService.speak("配置已成功导入");
                } else {
                    audioService.speak("配置文件格式错误", true);
                }
            } catch (err) {
                console.error(err);
                audioService.speak("读取配置文件失败", true);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="flex flex-col h-full bg-slate-900 text-slate-300 custom-scrollbar overflow-y-auto select-none relative">
            {/* Strategy Rules Modal */}
            {showStrategy43Info && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-amber-500/50 rounded-lg shadow-2xl w-full max-w-md p-5 animate-in fade-in zoom-in-95">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                                <Info size={16} /> 3.3 回调盈利清仓 (运行规则)
                            </h3>
                            <button onClick={() => setShowStrategy43Info(false)} className="text-slate-500 hover:text-white"><X size={16}/></button>
                        </div>
                        <div className="space-y-3 text-[10px] text-slate-300 leading-relaxed">
                            <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                                <span className="text-blue-400 font-bold block mb-1">1. 触发逻辑 (Entry)</span>
                                初始开仓由【2. 防爆对冲】模块触发。一旦进入回调清仓模式，后续加仓由【价格突破极值】触发。
                            </div>
                            <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                                <span className="text-emerald-400 font-bold block mb-1">2. 循环收割 (Harvest)</span>
                                当对冲仓位盈利达到【对冲盈利目标】且回调【回调比例】时，仅平掉对冲仓位，保留原仓位。盈利计入“总子弹”。
                            </div>
                            <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
                                <span className="text-amber-400 font-bold block mb-1">3. 最终胜利 (Victory)</span>
                                当【历史累计对冲盈利 + 当前对冲浮盈 + 原仓当前浮盈】 &gt; 【最大债务 * (1+覆盖阈值)】时，执行全平。
                            </div>
                        </div>
                        <button onClick={() => setShowStrategy43Info(false)} className="w-full mt-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs">关闭</button>
                    </div>
                </div>
            )}

            {/* --- GLOBAL PROCESS GUARD (PINNED TOP) --- */}
            <div className="p-3 bg-slate-950 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck size={14} className="text-emerald-400"/>
                    <span className="text-xs font-bold text-white">系统运行保障 (Process Guard)</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <button 
                        onClick={toggleWakeLock}
                        className={`flex items-center justify-center gap-2 py-2 rounded border transition-all ${wakeLock ? 'bg-yellow-900/30 border-yellow-500/50 text-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700'}`}
                    >
                        {wakeLock ? <Sun size={14} className="animate-pulse"/> : <Moon size={14}/>}
                        <span className="text-[10px] font-bold">{wakeLock ? '屏幕常亮: ON' : '屏幕常亮: OFF'}</span>
                    </button>
                    
                    <button 
                        onClick={toggleBgMode}
                        className={`flex items-center justify-center gap-2 py-2 rounded border transition-all ${bgModeActive ? 'bg-blue-900/30 border-blue-500/50 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700'}`}
                    >
                        {bgModeActive ? <Music size={14} className="animate-pulse"/> : <VolumeX size={14}/>}
                        <span className="text-[10px] font-bold">{bgModeActive ? '后台保活: ON' : '后台保活: OFF'}</span>
                    </button>
                </div>
            </div>

            {/* MODULE 1: PROFIT MANAGER */}
            <ModuleHeader id={1} icon={Target} title="止盈止损" subtitle="Profit & Stop Loss" active={expandedModule === 1} colorClass="bg-emerald-900/50 text-emerald-400" onClick={toggleModule} />
            {expandedModule === 1 && (
                <ProfitManagerModule 
                    settings={settings.profit} 
                    onChange={(k, v) => handleChange('profit', k, v)} 
                    updateNested={(sub, k, v) => updateNested('profit', sub, k, v)} 
                />
            )}
            
            {/* MODULE 2: HEDGE GUARDIAN */}
            <ModuleHeader id={2} icon={Shield} title="防爆对冲" subtitle="Explosion-proof Hedge" active={expandedModule === 2} colorClass="bg-indigo-900/50 text-indigo-400" onClick={toggleModule} />
            {expandedModule === 2 && (
                <HedgeGuardianModule 
                    settings={settings.hedging} 
                    onChange={(k, v) => handleChange('hedging', k, v)} 
                />
            )}

            {/* MODULE 3: RESCUE TACTICS */}
            <ModuleHeader id={3} icon={AlertTriangle} title="防爆对冲盈利出局" subtitle="Hedge Profit Exit" active={expandedModule === 3} colorClass="bg-red-900/50 text-red-400" onClick={toggleModule} />
            {expandedModule === 3 && (
                <RescueTacticsModule 
                    settings={settings.stopLoss} 
                    onChange={(k, v) => handleChange('stopLoss', k, v)} 
                    toggleFeature={toggleModule3Feature}
                    onShowStrategyInfo={() => setShowStrategy43Info(true)}
                />
            )}

            {/* MODULE 4: AUTO PILOT */}
            <ModuleHeader id={4} icon={RefreshCw} title="自动交易" subtitle="Auto / Sim / Scan" active={expandedModule === 4} colorClass="bg-cyan-900/50 text-cyan-400" onClick={toggleModule} />
            {expandedModule === 4 && (
                <AutoPilotModule 
                    isSimulating={isSimulating} 
                    onToggleSim={onToggleSim} 
                    onOpenScanner={onOpenScanner} 
                    settings={settings}
                />
            )}

            {/* MODULE 5: SYSTEM CORE */}
            <ModuleHeader id={5} icon={Settings} title="系统设置" subtitle="System Settings" active={expandedModule === 5} colorClass="bg-slate-700 text-slate-200" onClick={toggleModule} />
            {expandedModule === 5 && (
                <SystemCoreModule 
                    settings={settings.system} 
                    onChange={(k, v) => handleChange('system', k, v)} 
                    onOpenManual={onOpenManual}
                    onViewSource={onViewSource}
                    onFactoryReset={onFactoryReset}
                    onExportSettings={handleExportSettings}
                    onImportSettings={handleFileImport}
                />
            )}

            {/* MODULE 6: USER GUIDE */}
            <ModuleHeader id={6} icon={BookOpen} title="新手必读" subtitle="User Guide & Manual" active={expandedModule === 6} colorClass="bg-indigo-600 text-white" onClick={toggleModule} />
            {expandedModule === 6 && (
                <div className="p-4 bg-slate-800/30 border-b border-slate-800 animate-in fade-in">
                    <button 
                        onClick={onOpenManual}
                        className="w-full py-4 flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg transition-all shadow-lg shadow-indigo-900/30 font-bold"
                    >
                        <BookOpen size={18} /> 📘 打开操作说明书
                    </button>
                    <div className="mt-3 grid grid-cols-2 gap-2">
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
            )}

            {/* MODULE 7: BACKTESTER */}
            <ModuleHeader id={7} icon={History} title="历史回测" subtitle="Backtesting Engine" active={expandedModule === 7} colorClass="bg-amber-900/50 text-amber-400" onClick={toggleModule} />
            {expandedModule === 7 && (
                <BacktesterModule settings={settings} />
            )}
        </div>
    );
});

export default SettingsPanel;
