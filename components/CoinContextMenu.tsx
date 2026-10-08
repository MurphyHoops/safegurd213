import React, { useEffect, useRef } from 'react';
import { Search, Zap, X, ShieldAlert, TrendingUp, TrendingDown } from 'lucide-react';

export interface CoinContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    symbol: string;
    chineseName?: string;
    currentPrice?: number;
    direction?: 'LONG' | 'SHORT';
}

interface Props {
    menuState: CoinContextMenuState;
    onClose: () => void;
    onTriggerDiagnosis: (symbol: string) => void;
    onTriggerOpenPosition: (symbol: string, direction?: 'LONG' | 'SHORT', price?: number) => void;
}

export const CoinContextMenu: React.FC<Props> = ({
    menuState,
    onClose,
    onTriggerDiagnosis,
    onTriggerOpenPosition
}) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuState.visible) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', onClose, true);

        return () => {
            window.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', onClose, true);
        };
    }, [menuState.visible, onClose]);

    if (!menuState.visible) return null;

    // Adjust position to avoid screen overflow
    const menuWidth = 190;
    const menuHeight = 135;
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;

    let posX = menuState.x;
    let posY = menuState.y;

    if (posX + menuWidth > screenWidth - 10) {
        posX = screenWidth - menuWidth - 10;
    }
    if (posY + menuHeight > screenHeight - 10) {
        posY = screenHeight - menuHeight - 10;
    }

    const cleanSymbol = menuState.symbol.replace('USDT', '').toUpperCase();

    return (
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                left: `${posX}px`,
                top: `${posY}px`,
                zIndex: 9999
            }}
            className="w-48 bg-slate-900/95 border border-indigo-500/40 rounded-lg shadow-2xl shadow-black/80 backdrop-blur-md text-xs text-slate-200 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-100 select-none"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
            {/* Header info */}
            <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
                <div className="flex items-center gap-1.5 truncate">
                    <span className="font-black text-indigo-400">{cleanSymbol}</span>
                    {menuState.chineseName && (
                        <span className="text-[10px] text-slate-400 font-medium truncate">
                            {menuState.chineseName}
                        </span>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="text-slate-500 hover:text-slate-300 p-0.5"
                >
                    <X size={12} />
                </button>
            </div>

            {/* Menu options */}
            <div className="py-1 space-y-0.5">
                {/* 1. Deep Diagnosis */}
                <button
                    onClick={() => {
                        onClose();
                        onTriggerDiagnosis(menuState.symbol);
                    }}
                    className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors group cursor-pointer"
                >
                    <Search size={14} className="text-indigo-400 group-hover:scale-110 transition-transform" />
                    <div className="flex flex-col">
                        <span className="font-bold text-slate-100 group-hover:text-indigo-200">一键深度诊断</span>
                        <span className="text-[9px] text-slate-400 leading-tight">4阶段全链路规则穿透</span>
                    </div>
                </button>

                {/* 2. Quick Open Position */}
                <button
                    onClick={() => {
                        onClose();
                        onTriggerOpenPosition(menuState.symbol, menuState.direction, menuState.currentPrice);
                    }}
                    className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-amber-600/20 hover:text-amber-300 transition-colors group cursor-pointer"
                >
                    <Zap size={14} className="text-amber-400 group-hover:scale-110 transition-transform" />
                    <div className="flex flex-col">
                        <span className="font-bold text-slate-100 group-hover:text-amber-200">快速开仓</span>
                        <span className="text-[9px] text-slate-400 leading-tight">做多 / 做空极速下单</span>
                    </div>
                </button>
            </div>
        </div>
    );
};
