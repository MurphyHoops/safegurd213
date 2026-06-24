import React from 'react';
import { Crown } from 'lucide-react';
import { subscriptionService } from '../../../services/subscriptionService';

export const SubscriptionPanel: React.FC = () => {
    const remainingDays = subscriptionService.getDaysRemaining();

    return (
        <div className="bg-gradient-to-r from-slate-900 to-indigo-900/20 p-3 rounded border border-indigo-500/20">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    <Crown size={14} className="text-amber-400"/>
                    <span className="text-xs font-bold text-white">会员订阅服务</span>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${remainingDays > 0 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
                    {remainingDays > 0 ? '活跃' : '已过期'}
                </span>
            </div>
            <div className="flex justify-between items-end">
                <div>
                    <div className="text-[9px] text-slate-500">剩余天数</div>
                    <div className="text-lg font-mono font-bold text-white">{remainingDays} 天</div>
                </div>
                <button 
                    onClick={() => alert("请联系管理员续费")} 
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded shadow-lg shadow-amber-900/20"
                >
                    {remainingDays > 0 ? '立即续费' : '立即开通'}
                </button>
            </div>
        </div>
    );
};
