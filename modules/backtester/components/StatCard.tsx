import React from 'react';
import { motion } from 'motion/react';

interface Props {
    label: string;
    value: any;
    icon: any;
    color: string;
    index: number;
}

export const StatCard: React.FC<Props> = ({ label, value, icon: Icon, color, index }) => {
    return (
        <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-slate-800/50 border border-slate-700 p-3 rounded-lg"
        >
            <div className="flex items-center gap-2 mb-1">
                <Icon size={12} className="text-slate-500" />
                <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">{label}</span>
            </div>
            <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
        </motion.div>
    );
};
