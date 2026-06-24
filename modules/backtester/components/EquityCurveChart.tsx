import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface Props {
    data: any[];
}

export const EquityCurveChart: React.FC<Props> = ({ data }) => {
    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 h-[250px]"
        >
            <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-bold text-slate-400 flex items-center gap-2 uppercase tracking-widest">
                    <TrendingUp size={12} /> 权益曲线 (Equity Curve)
                </h4>
            </div>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis 
                        dataKey="time" 
                        hide 
                    />
                    <YAxis 
                        domain={['auto', 'auto']} 
                        stroke="#64748b" 
                        fontSize={10} 
                        tickFormatter={(val) => `${val.toFixed(0)}`}
                    />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', fontSize: '10px' }}
                        labelFormatter={(label) => new Date(label).toLocaleString()}
                    />
                    <Area type="monotone" dataKey="balance" stroke="#6366f1" fillOpacity={1} fill="url(#colorBalance)" strokeWidth={2} />
                </AreaChart>
            </ResponsiveContainer>
        </motion.div>
    );
};
