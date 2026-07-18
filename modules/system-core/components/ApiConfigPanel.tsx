import React, { useState, useEffect } from 'react';
import { Key, ShieldCheck, ShieldAlert, Loader2, X } from 'lucide-react';
import { audioService } from '../../../services/audioService';

interface Props {
    settings: any;
    onChange: (key: string, value: any) => void;
    onUpdateBinanceRealBalance?: (balance: number, realPositions?: any[]) => void;
}

export const ApiConfigPanel: React.FC<Props> = ({ settings, onChange, onUpdateBinanceRealBalance }) => {
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState<{
        show: boolean;
        success: boolean;
        message: string;
        marginBalance?: number;
    } | null>(null);

    const handleValidate = async (silent = false) => {
        if (!settings.binanceApiKey || !settings.binanceApiSecret) {
            if (!silent) {
                setValidationResult({
                    show: true,
                    success: false,
                    message: '❌ 请先在左侧输入 API Key 和 Secret Key！'
                });
                audioService.speak('请输入币安 API 密钥', true);
            }
            return;
        }

        if (!silent) {
            setIsValidating(true);
            audioService.speak('正在校验币安 API 连接');
        }

        try {
            const response = await fetch('/api/binance/validate-and-balance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    apiKey: settings.binanceApiKey,
                    apiSecret: settings.binanceApiSecret
                })
            });

            const data = await response.json();
            if (response.ok && data.success) {
                if (!silent) {
                    setValidationResult({
                        show: true,
                        success: true,
                        message: `🟢 ${data.message}\n• 钱包总可用余额: ${data.walletBalance?.toFixed(2)} USDT\n• 币安合约保证金: ${data.marginBalance?.toFixed(2)} USDT`,
                        marginBalance: data.marginBalance
                    });
                    audioService.speak('API 校验成功！');
                } else {
                    console.log(`🛡️ [System API Sync] Successfully synced Binance Balance in background: ${data.marginBalance} USDT, active positions: ${data.activePositions?.length || 0}`);
                }

                // Trigger callback to display it above the account display bar's balance and positions list
                if (onUpdateBinanceRealBalance && typeof data.marginBalance === 'number') {
                    onUpdateBinanceRealBalance(data.marginBalance, data.activePositions || []);
                }
            } else {
                if (!silent) {
                    setValidationResult({
                        show: true,
                        success: false,
                        message: `❌ 校验失败: ${data.error || '未知网络错误'}`
                    });
                    audioService.speak('API 校验失败', true);
                }
            }
        } catch (err: any) {
            if (!silent) {
                setValidationResult({
                    show: true,
                    success: false,
                    message: `❌ 校验发生网络异常: ${err.message || err}`
                });
                audioService.speak('API 连接异常', true);
            }
        } finally {
            if (!silent) {
                setIsValidating(false);
            }
        }
    };

    return (
        <div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 uppercase mb-2">
                <Key size={10} /> 1. API 配置 (Binance Connection)
            </div>
            
            {/* Split row: Inputs on Left, Validation Button on Right */}
            <div className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-8 space-y-2">
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-0.5">API Key</label>
                        <input 
                            type="text" 
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 outline-none"
                            value={settings.binanceApiKey || ''}
                            onChange={(e) => onChange('binanceApiKey', e.target.value)}
                            placeholder="Enter Binance API Key"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 block mb-0.5">Secret Key</label>
                        <input 
                            type="password" 
                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 outline-none"
                            value={settings.binanceApiSecret || ''}
                            onChange={(e) => onChange('binanceApiSecret', e.target.value)}
                            placeholder="Enter Secret Key"
                        />
                    </div>
                </div>
                <div className="col-span-4 flex flex-col h-full justify-end pt-4">
                    <button
                        onClick={() => handleValidate(false)}
                        disabled={isValidating}
                        className={`w-full py-4 px-2 rounded font-bold text-[11px] flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 border cursor-pointer
                            ${isValidating 
                                ? 'bg-indigo-900/30 border-indigo-700/50 text-indigo-300' 
                                : 'bg-gradient-to-b from-indigo-900/40 to-indigo-900/10 hover:from-indigo-800/50 hover:to-indigo-800/20 border-indigo-500/30 hover:border-indigo-500/60 text-indigo-200'
                            }`}
                    >
                        {isValidating ? (
                            <>
                                <Loader2 size={16} className="animate-spin text-indigo-400" />
                                <span>正在校验</span>
                            </>
                        ) : (
                            <>
                                <ShieldCheck size={16} className="text-indigo-400" />
                                <span>API 校验</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="pt-2 border-t border-slate-800/60 mt-3">
                <div className="flex items-center justify-between">
                    <div>
                        <span className="text-[10px] font-bold text-slate-300">实盘交易模式 (Real API Trading)</span>
                        <p className="text-[9px] text-slate-500 leading-normal">
                            {settings.realTrading ? '🟢 当前为 API 实盘对接模式，开平仓指令同步至币安' : '⚪ 当前为模拟盘模式，所有资金与交易均为虚拟'}
                        </p>
                    </div>
                    <div 
                        onClick={() => {
                            const newVal = !settings.realTrading;
                            onChange('realTrading', newVal);
                            if (newVal) {
                                audioService.speak("实盘交易模式已开启，请确保API密钥正确填写");
                            } else {
                                audioService.speak("已切回模拟交易模式");
                            }
                        }} 
                        className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${settings.realTrading ? 'bg-emerald-600' : 'bg-slate-700'}`}
                    >
                        <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.realTrading ? 'translate-x-5' : 'translate-x-0'}`}/>
                    </div>
                </div>
            </div>

            {/* Verification Results Modal */}
            {validationResult && validationResult.show && (
                <div className="fixed inset-0 z-[10000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-lg p-4 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
                        <button 
                            onClick={() => setValidationResult(null)}
                            className="absolute top-2 right-2 p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                        >
                            <X size={16} />
                        </button>
                        
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
                            {validationResult.success ? (
                                <ShieldCheck size={20} className="text-emerald-400" />
                            ) : (
                                <ShieldAlert size={20} className="text-red-400" />
                            )}
                            <h3 className="text-xs font-bold text-white">API 校验结果</h3>
                        </div>

                        <div className="bg-slate-950/50 p-3 rounded border border-slate-800 font-mono text-[11px] text-slate-300 whitespace-pre-line leading-relaxed">
                            {validationResult.message}
                        </div>

                        {validationResult.success && validationResult.marginBalance !== undefined && (
                            <p className="mt-2 text-[9px] text-slate-500 text-center">
                                已同步币安保证金余额，可在帐户显示栏中查看
                            </p>
                        )}

                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={() => setValidationResult(null)}
                                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold rounded transition-colors"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
