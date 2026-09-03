import React, { useEffect, useRef } from 'react';

interface Props {
    className?: string;
}

export const RealtimeClockSpan: React.FC<Props> = ({ className = 'text-slate-500' }) => {
    const spanRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const updateClock = () => {
            if (spanRef.current) {
                spanRef.current.innerText = new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
            }
        };

        updateClock();
        const timer = setInterval(updateClock, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <span 
            ref={spanRef} 
            className={`${className} font-mono tracking-tighter select-none`}
        >
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </span>
    );
};
