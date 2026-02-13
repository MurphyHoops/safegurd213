
import React, { useState } from 'react';
import { PLANS, subscriptionService } from '../services/subscriptionService';
import { Shield, Check, Zap, Lock, Gift, Coins, QrCode, Copy, CheckCircle, Loader2 } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onSuccess: () => void;
    isLocked?: boolean; // If true, user cannot close without paying
    onClose?: () => void;
}

// Configuration for your wallet addresses
const WALLET_ADDRESSES = {
    TRC20: "T9yD14Nj9j7xAB4dbGeiX9h8veH521...", // Replace with your real TRON address
    BEP20: "0x71C7656EC7ab88b098defB751B...", // Replace with your real BSC address
    ERC20: "0x71C7656EC7ab88b098defB751B..."  // Replace with your real ETH address
};

type PaymentMethod = 'WECHAT' | 'CRYPTO';
type CryptoNetwork = 'TRC20' | 'BEP20' | 'ERC20';

const SubscriptionModal: React.FC<Props> = ({ isOpen, onSuccess, isLocked, onClose }) => {
    const [selectedPlanId, setSelectedPlanId] = useState<string>(PLANS[1].id);
    const [step, setStep] = useState<'PLANS' | 'PAYMENT'>('PLANS');
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CRYPTO');
    const [network, setNetwork] = useState<CryptoNetwork>('TRC20');
    const [isProcessing, setIsProcessing] = useState(false);
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const selectedPlan = PLANS.find(p => p.id === selectedPlanId);

    const handleSelect = (id: string) => setSelectedPlanId(id);

    const handleProceedToPay = () => {
        setStep('PAYMENT');
    };

    const handleCopyAddress = () => {
        navigator.clipboard.writeText(WALLET_ADDRESSES[network]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSimulatePayment = () => {
        setIsProcessing(true);
        // Simulate network verifying the blockchain transaction
        setTimeout(() => {
            subscriptionService.simulatePaymentSuccess(selectedPlanId);
            setIsProcessing(false);
            setStep('PLANS'); // Reset for next time
            onSuccess();
        }, 2000);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row relative">
                
                {/* Close Button (Only if not locked) */}
                {!isLocked && onClose && (
                    <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white z-10">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                )}

                {/* Left Side: Branding */}
                <div className="w-full md:w-1/3 bg-gradient-to-br from-indigo-900 to-slate-900 p-8 flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                        <div className="absolute top-10 left-10 w-32 h-32 bg-blue-500 rounded-full blur-3xl"></div>
                        <div className="absolute bottom-10 right-10 w-40 h-40 bg-purple-500 rounded-full blur-3xl"></div>
                    </div>
                    
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center shadow-lg">
                                <Shield size={18} className="text-white" />
                            </div>
                            <h2 className="text-xl font-bold text-white tracking-wide">防爆仓救世之星</h2>
                        </div>
                        <h1 className="text-3xl font-bold text-white mb-2">
                            {isLocked ? "服务已到期" : "升级您的交易系统"}
                        </h1>
                        <p className="text-indigo-200 text-sm leading-relaxed">
                            {isLocked ? "您的订阅已过期，请续费以恢复自动化交易权限。" : "解锁全自动防爆策略，马丁补仓，以及实时风险监控。"}
                        </p>
                    </div>

                    <div className="space-y-3 mt-8">
                        <div className="flex items-center gap-3 text-sm text-indigo-100">
                            <div className="p-1 bg-indigo-500/20 rounded-full"><Check size={12} /></div>
                            <span>策略 4.2/4.3 核心算法</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-indigo-100">
                            <div className="p-1 bg-indigo-500/20 rounded-full"><Check size={12} /></div>
                            <span>毫秒级行情扫描与执行</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-indigo-100">
                            <div className="p-1 bg-indigo-500/20 rounded-full"><Check size={12} /></div>
                            <span>7x24小时云端守护</span>
                        </div>
                    </div>
                </div>

                {/* Right Side: Plans or Payment */}
                <div className="w-full md:w-2/3 p-8 bg-slate-900 flex flex-col">
                    {step === 'PLANS' ? (
                        <>
                            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                                <Gift size={18} className="text-pink-500"/> 选择您的方案
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                                {PLANS.map(plan => {
                                    const isSelected = selectedPlanId === plan.id;
                                    return (
                                        <div 
                                            key={plan.id}
                                            onClick={() => handleSelect(plan.id)}
                                            className={`relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200 flex flex-col justify-between h-40 ${isSelected ? 'border-indigo-500 bg-indigo-900/20 shadow-lg shadow-indigo-900/20' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'}`}
                                        >
                                            {plan.popular && (
                                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-pink-500 to-orange-500 text-white text-[10px] font-bold px-3 py-0.5 rounded-full shadow-lg">
                                                    最受欢迎
                                                </div>
                                            )}
                                            <div>
                                                {plan.tag && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">{plan.tag}</span>}
                                                <h4 className={`font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>{plan.name}</h4>
                                            </div>
                                            <div>
                                                <div className="flex items-baseline gap-1">
                                                    <span className="text-sm text-slate-400">¥</span>
                                                    <span className={`text-2xl font-bold ${isSelected ? 'text-indigo-400' : 'text-white'}`}>{plan.price}</span>
                                                </div>
                                                <div className="text-[10px] text-slate-500 mt-1">
                                                    约 {(plan.price / 7.2).toFixed(0)} USDT
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <div className="absolute top-2 right-2 text-indigo-500"><Check size={16} /></div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-auto">
                                <button 
                                    onClick={handleProceedToPay}
                                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-900/50 transition-all flex items-center justify-center gap-2 text-lg"
                                >
                                    <Lock size={20} /> 立即开通
                                </button>
                                <p className="text-center text-xs text-slate-500 mt-4">
                                    支持 微信支付 / USDT (TRC20/BEP20)。虚拟商品售出不退。
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col h-full">
                            {/* Payment Method Tabs */}
                            <div className="flex bg-slate-800 p-1 rounded-lg mb-6">
                                <button 
                                    onClick={() => setPaymentMethod('WECHAT')}
                                    className={`flex-1 py-2 text-xs font-bold rounded flex items-center justify-center gap-2 transition-all ${paymentMethod === 'WECHAT' ? 'bg-green-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    <div className="w-4 h-4 bg-white rounded-sm flex items-center justify-center"><div className="w-3 h-3 bg-green-600 rounded-sm"></div></div> 微信支付
                                </button>
                                <button 
                                    onClick={() => setPaymentMethod('CRYPTO')}
                                    className={`flex-1 py-2 text-xs font-bold rounded flex items-center justify-center gap-2 transition-all ${paymentMethod === 'CRYPTO' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    <Coins size={14} /> USDT 支付
                                </button>
                            </div>

                            {/* Payment Content */}
                            <div className="flex-1 flex flex-col items-center justify-center">
                                <div className="text-center mb-6">
                                    <p className="text-emerald-400 text-2xl font-mono font-bold">
                                        {paymentMethod === 'CRYPTO' 
                                            ? `${(selectedPlan!.price / 7.2).toFixed(2)} USDT` 
                                            : `¥${selectedPlan!.price}.00`
                                        }
                                    </p>
                                    <p className="text-sm text-slate-500 mt-1">{selectedPlan?.name}</p>
                                </div>

                                {/* QR Code Area */}
                                <div className="w-48 h-48 bg-white p-2 rounded-lg mb-4 relative group shadow-xl">
                                    <div className="w-full h-full bg-slate-200 flex items-center justify-center overflow-hidden">
                                        {/* Simulated QR Code Pattern */}
                                        <div className="grid grid-cols-6 gap-1 w-full h-full p-2 opacity-80">
                                            {[...Array(36)].map((_, i) => (
                                                <div key={i} className={`bg-black ${Math.random() > 0.5 ? 'opacity-100' : 'opacity-0'} rounded-sm`}></div>
                                            ))}
                                        </div>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="bg-white p-1 rounded-full shadow-lg">
                                                {paymentMethod === 'WECHAT' ? (
                                                    <div className="w-8 h-8 bg-green-500 rounded flex items-center justify-center text-white font-bold">We</div>
                                                ) : (
                                                    <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white font-bold">T</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {isProcessing && (
                                        <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center">
                                            <Loader2 size={32} className="text-emerald-600 animate-spin mb-2" />
                                            <span className="text-xs font-bold text-slate-800">正在确认链上交易...</span>
                                        </div>
                                    )}
                                </div>

                                {paymentMethod === 'CRYPTO' && (
                                    <div className="w-full max-w-sm space-y-3">
                                        {/* Network Selector */}
                                        <div className="flex justify-center gap-2">
                                            {(['TRC20', 'BEP20', 'ERC20'] as CryptoNetwork[]).map(net => (
                                                <button
                                                    key={net}
                                                    onClick={() => { setNetwork(net); setCopied(false); }}
                                                    className={`px-3 py-1 rounded text-[10px] font-bold border transition-colors ${network === net ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                                                >
                                                    {net}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Address Box */}
                                        <div className="bg-slate-950 border border-slate-800 rounded p-2 flex items-center justify-between gap-2">
                                            <span className="font-mono text-[10px] text-slate-400 truncate select-all">
                                                {WALLET_ADDRESSES[network]}
                                            </span>
                                            <button 
                                                onClick={handleCopyAddress}
                                                className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                                            >
                                                {copied ? <CheckCircle size={14} className="text-emerald-500"/> : <Copy size={14}/>}
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-slate-500 text-center">请务必使用 <span className="text-amber-400 font-bold">{network}</span> 网络转账，否则资金将丢失。</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 w-full mt-6">
                                <button 
                                    onClick={() => setStep('PLANS')}
                                    disabled={isProcessing}
                                    className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-bold disabled:opacity-50"
                                >
                                    返回修改
                                </button>
                                <button 
                                    onClick={handleSimulatePayment}
                                    disabled={isProcessing}
                                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/20"
                                >
                                    {isProcessing ? '系统查询中...' : '我已完成支付'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SubscriptionModal;
