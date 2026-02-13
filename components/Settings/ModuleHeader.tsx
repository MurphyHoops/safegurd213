
import React from 'react';

interface ModuleHeaderProps {
    id: number;
    icon: any;
    title: string;
    subtitle: string;
    active: boolean;
    colorClass: string;
    onClick: (id: number) => void;
}

const ModuleHeader: React.FC<ModuleHeaderProps> = ({ id, icon: Icon, title, subtitle, active, colorClass, onClick }) => (
    <button 
        onClick={() => onClick(id)}
        className={`w-full flex items-center justify-between p-4 border-b border-slate-800 transition-all duration-200 ${active ? 'bg-slate-800' : 'bg-slate-900 hover:bg-slate-800/50'}`}
        type="button"
    >
        <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded flex items-center justify-center border border-white/10 ${active ? colorClass : 'bg-slate-800 text-slate-500'}`}>
                <Icon size={16} />
            </div>
            <div className="text-left">
                <div className={`text-xs font-bold ${active ? 'text-white' : 'text-slate-400'}`}>{id}. {title}</div>
                <div className="text-[10px] text-slate-600">{subtitle}</div>
            </div>
        </div>
        <div className={`text-xs font-mono transition-transform duration-200 ${active ? 'rotate-90 text-slate-300' : 'text-slate-600'}`}>
            {active ? '▼' : '▶'}
        </div>
    </button>
);

export default ModuleHeader;
