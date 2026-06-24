
import React, { useState, useEffect } from 'react';
import { X, Database, History, Play } from 'lucide-react';
import { TradeDNA, AppSettings } from '../types';
import { saviorLabService } from '../services/saviorLabService';
import { auth } from '../firebase';
import { motion } from 'motion/react';
import { TradeDnaList } from './SaviorLab/TradeDnaList';
import { BacktestEngineConfig } from './SaviorLab/BacktestEngineConfig';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    settings: AppSettings;
    initialTab?: 'DNA' | 'BACKTEST';
}

export const SaviorLab: React.FC<Props> = ({ isOpen, onClose, settings, initialTab = 'DNA' }) => {
    const [activeTab, setActiveTab] = useState<'DNA' | 'BACKTEST'>(initialTab);
    const [dnaList, setDnaList] = useState<TradeDNA[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen && activeTab === 'DNA') {
            loadDNA();
        }
    }, [isOpen, activeTab]);

    const loadDNA = async () => {
        setIsLoading(true);
        const data = await saviorLabService.fetchTradeDNA();
        setDnaList(data);
        setIsLoading(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0b0e11] border border-slate-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/20 rounded-lg">
                            <Database className="text-purple-400" size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white tracking-tight">Savior Lab <span className="text-purple-400 text-xs ml-2 font-normal">救世实验室 v1.0</span></h2>
                            <p className="text-[10px] text-slate-500">AI 驱动的交易进化 system：数据复盘与参数对撞</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-800 bg-slate-900/20 p-1 gap-1">
                    <button 
                        onClick={() => setActiveTab('DNA')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'DNA' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                    >
                        <History size={14} />
                        DNA 深度复盘
                    </button>
                    <button 
                        onClick={() => setActiveTab('BACKTEST')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'BACKTEST' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}
                    >
                        <Play size={14} />
                        启动回测引擎
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {activeTab === 'DNA' ? (
                        <TradeDnaList isLoading={isLoading} dnaList={dnaList} />
                    ) : (
                        <BacktestEngineConfig />
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] text-slate-400 font-medium">云端 DNA 采集器已就绪</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                            <span className="text-[10px] text-slate-400 font-medium">Firebase 实时同步中</span>
                        </div>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                        UID: {auth.currentUser?.uid?.substring(0, 8)}...
                    </div>
                </div>
            </motion.div>
        </div>
    );
};
