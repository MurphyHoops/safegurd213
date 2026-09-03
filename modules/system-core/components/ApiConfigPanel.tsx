import React, { useState, useEffect } from 'react';
import { Key, ShieldCheck, ShieldAlert, Loader2, X, Globe, Copy, RefreshCw } from 'lucide-react';
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

    const [serverIp, setServerIp] = useState<string>('');
    const [isLoadingIp, setIsLoadingIp] = useState<boolean>(false);
    const [copied, setCopied] = useState<boolean>(false);

    const [manualTransferAmount, setManualTransferAmount] = useState<string>('100');
    const [isTransferringManual, setIsTransferringManual] = useState<boolean>(false);

    const handleManualTransfer = async (direction: 'futures_to_spot' | 'spot_to_futures') => {
        const amount = parseFloat(manualTransferAmount);
        if (isNaN(amount) || amount <= 0) {
            alert("请输入大于 0.00 的有效划转金额！");
            return;
        }

        if (!settings.binanceApiKey || !settings.binanceApiSecret) {
            setValidationResult({
                show: true,
                success: false,
                message: '❌ 请先输入 API Key 和 Secret Key！'
            });
            return;
        }

        setIsTransferringManual(true);
        audioService.speak("正在提交资产划转申请，请稍候...");

        try {
            const type = direction === 'futures_to_spot' ? 'UMFUTURE_MAIN' : 'MAIN_UMFUTURE';
            const response = await fetch('/api/binance/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: settings.binanceApiKey,
                    apiSecret: settings.binanceApiSecret,
                    asset: 'USDT',
                    amount: amount,
                    type: type
                })
            });

            const data = await response.json();
            if (response.ok && data.success) {
                setValidationResult({
                    show: true,
                    success: true,
                    message: `🟢 划转成功！\n\n• 方向: ${direction === 'futures_to_spot' ? '【合约 ➡️ 现货】' : '【现货 ➡️ 合约】'}\n• 币种: USDT\n• 金额: ${amount.toFixed(2)} USDT\n• 流水号 (TranId): ${data.tranId}\n\n资金到账可能需要数秒延迟。`
                });
                audioService.speak(`手动划转成功，已划转 ${amount} 美元`);
                // Force a sync to update balances
                setTimeout(() => handleValidate(true), 1500);
            } else {
                setValidationResult({
                    show: true,
                    success: false,
                    message: `❌ 划转失败！\n\n原因: ${data.error || '未知网络原因'}`
                });
                audioService.speak("资金划转失败，请查看 API 校验报错");
            }
        } catch (e: any) {
            setValidationResult({
                show: true,
                success: false,
                message: `❌ 划转连接异常: ${e.message || e}`
            });
            audioService.speak("资金划转发生异常");
        } finally {
            setIsTransferringManual(false);
        }
    };

    const fetchServerIp = async () => {
        setIsLoadingIp(true);
        try {
            const res = await fetch('/api/server-ip');
            const data = await res.json();
            if (data.success) {
                setServerIp(data.ip);
            } else {
                setServerIp('获取失败');
            }
        } catch (e) {
            setServerIp('获取异常');
        } finally {
            setIsLoadingIp(false);
        }
    };

    useEffect(() => {
        fetchServerIp();
    }, []);

    const handleCopyIp = () => {
        if (!serverIp || serverIp === '获取失败' || serverIp === '获取异常') return;
        navigator.clipboard.writeText(serverIp);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        audioService.speak('已复制服务器 IP');
    };

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
                    apiKey: (settings.binanceApiKey || '').trim(),
                    apiSecret: (settings.binanceApiSecret || '').trim(),
                    force: !silent,
                    bypassCache: !silent
                })
            });

            const rawText = await response.text();
            let data: any = {};
            try {
                data = JSON.parse(rawText);
            } catch (e) {
                data = {
                    success: false,
                    error: response.status === 502 || response.status === 503 || response.status === 504 
                        ? '服务节点正在连接就绪中，请稍候 2 秒后再次点击校验' 
                        : (rawText && rawText.length < 150 ? rawText : '网络通信瞬时中断，请重试')
                };
            }
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

            {/* Outbound IP Whitelist Display */}
            <div className="mt-3 bg-slate-950/40 border border-slate-800/80 rounded p-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-slate-400">
                    <Globe size={12} className="text-indigo-400 shrink-0" />
                    <div className="flex flex-col">
                        <span className="text-[9px] text-slate-500 font-medium">服务器出口 IP (用于币安 API 白名单)</span>
                        <span className="text-[11px] font-mono font-bold text-slate-300">
                            {isLoadingIp ? '获取中...' : serverIp || '未知'}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={fetchServerIp}
                        disabled={isLoadingIp}
                        className="p-1 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors"
                        title="重新获取"
                    >
                        <RefreshCw size={11} className={isLoadingIp ? "animate-spin" : ""} />
                    </button>
                    {serverIp && serverIp !== '获取失败' && serverIp !== '获取异常' && (
                        <button
                            type="button"
                            onClick={handleCopyIp}
                            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-indigo-300 hover:text-white rounded text-[9px] font-bold flex items-center gap-1 transition-all"
                        >
                            <Copy size={9} />
                            <span>{copied ? '已复制' : '复制 IP'}</span>
                        </button>
                    )}
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

            {/* 合约与现货资金划转管理 */}
            <div className="pt-3 border-t border-slate-800/60 mt-3 space-y-3">
                <div>
                    <span className="text-xs font-bold text-slate-300">⚙️ 合约与现货资金划转 (Asset Transfer)</span>
                    <p className="text-[10px] text-slate-500 leading-normal">
                        币安主账户内资金互转，不产生手续费。支持手动互转与智能超额自动归集。
                    </p>
                </div>

                {/* 自动资金划转开关与规则 */}
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-[11px] font-bold text-slate-200">🤖 开启超额自动划转</span>
                            <p className="text-[10px] text-slate-500">当合约余额充裕时，自动归集收益至现货</p>
                        </div>
                        <div 
                            onClick={() => {
                                const newVal = !settings.enableAutoTransfer;
                                onChange('enableAutoTransfer', newVal);
                                if (newVal) {
                                    audioService.speak("已开启超额自动划转功能");
                                } else {
                                    audioService.speak("已关闭超额自动划转功能");
                                }
                            }} 
                            className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${settings.enableAutoTransfer ? 'bg-emerald-600' : 'bg-slate-700'}`}
                        >
                            <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.enableAutoTransfer ? 'translate-x-5' : 'translate-x-0'}`}/>
                        </div>
                    </div>

                    {settings.enableAutoTransfer && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60 animate-in slide-in-from-top-1 duration-150">
                            <div className="space-y-1">
                                <label className="text-[11px] text-slate-400 font-medium">当合约账户金额 ＞</label>
                                <div className="relative flex items-center">
                                    <input 
                                        type="number" 
                                        value={settings.autoTransferThreshold || 1000}
                                        onChange={(e) => onChange('autoTransferThreshold', parseFloat(e.target.value) || 0)}
                                        className="w-full py-1 px-2 text-xs bg-slate-950 border border-slate-800 rounded font-bold text-slate-200 focus:outline-none focus:border-cyan-600"
                                        placeholder="1000"
                                    />
                                    <span className="absolute right-2 text-[9px] text-slate-500 font-bold">USDT</span>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[11px] text-slate-400 font-medium">自动划转出金额</label>
                                <div className="relative flex items-center">
                                    <input 
                                        type="number" 
                                        value={settings.autoTransferAmount || 200}
                                        onChange={(e) => onChange('autoTransferAmount', parseFloat(e.target.value) || 0)}
                                        className="w-full py-1 px-2 text-xs bg-slate-950 border border-slate-800 rounded font-bold text-slate-200 focus:outline-none focus:border-cyan-600"
                                        placeholder="200"
                                    />
                                    <span className="absolute right-2 text-[9px] text-slate-500 font-bold">USDT</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 手动资金划转 */}
                <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-800/80 space-y-2">
                    <span className="text-[11px] font-bold text-slate-400">⚡ 手动即时互转 (Instant Manual Transfer)</span>
                    
                    <div className="flex gap-2">
                        <div className="relative flex-1 flex items-center">
                            <input 
                                type="number" 
                                value={manualTransferAmount}
                                onChange={(e) => setManualTransferAmount(e.target.value)}
                                className="w-full py-1.5 px-2 text-xs bg-slate-950 border border-slate-800 rounded font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-600"
                                placeholder="划转金额"
                            />
                            <span className="absolute right-2 text-[10px] text-slate-500 font-bold">USDT</span>
                        </div>

                        <div className="flex gap-1.5">
                            <button
                                disabled={isTransferringManual}
                                onClick={() => handleManualTransfer('futures_to_spot')}
                                className="px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-400 text-xs font-bold rounded border border-cyan-800/50 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                                {isTransferringManual ? <Loader2 size={12} className="animate-spin" /> : '合约 ➡️ 现货'}
                            </button>
                            <button
                                disabled={isTransferringManual}
                                onClick={() => handleManualTransfer('spot_to_futures')}
                                className="px-3 py-1.5 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-400 text-xs font-bold rounded border border-emerald-800/50 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                                {isTransferringManual ? <Loader2 size={12} className="animate-spin" /> : '现货 ➡️ 合约'}
                            </button>
                        </div>
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
