import React, { useEffect, useState, useRef } from 'react';
import { db, auth } from '../../../firebase';
import { collection, query, where, orderBy, getDocs, limit, addDoc, doc, updateDoc } from 'firebase/firestore';
import { X } from 'lucide-react';

export interface HistoryRecord {
    id: string;
    symbol: string;
    direction: string;
    price: number;
    timestamp: number;
    reason: string;
    itemData: any;
    disappearedAt?: number;
    signalTime?: number;
    disappearanceReason?: string;
}

interface HistoryModalProps {
    onClose: () => void;
    listType: string;
    setChartData?: (data: any) => void;
}

// Module-level in-memory cache to support ultra-fast instant load
const memoryCache: Record<string, HistoryRecord[]> = {};
const cacheLoaded: Record<string, boolean> = {};

export const getMemoryCache = (listType: string, uid: string): HistoryRecord[] => {
    const activeUid = uid || 'default';
    const key = `${listType}_${activeUid}`;
    if (memoryCache[key]) {
        return memoryCache[key];
    }
    try {
        const cached = localStorage.getItem(`scanner_history_${listType}_${activeUid}`);
        if (cached) {
            const parsed = JSON.parse(cached);
            memoryCache[key] = parsed;
            cacheLoaded[key] = true;
            return parsed;
        }
    } catch (e) {
        console.error('Failed to parse history cache from localStorage', e);
    }
    if (activeUid === 'default') {
        cacheLoaded[key] = true;
    }
    memoryCache[key] = [];
    return [];
};

export const setMemoryCache = (listType: string, uid: string, records: HistoryRecord[]) => {
    const activeUid = uid || 'default';
    const key = `${listType}_${activeUid}`;
    memoryCache[key] = records;
    cacheLoaded[key] = true;
    
    try {
        localStorage.setItem(`scanner_history_${listType}_${activeUid}`, JSON.stringify(records));
    } catch (e) {
        console.warn(`[History Cache] Failed to save 100% of history to localStorage for ${key}, trying with 25 records limit...`, e);
        try {
            const smallerRecords = records.slice(0, 25);
            localStorage.setItem(`scanner_history_${listType}_${activeUid}`, JSON.stringify(smallerRecords));
        } catch (innerErr) {
            console.error(`[History Cache] Failed to write even 25 records to localStorage for ${key}. Relying on in-memory cache only.`, innerErr);
        }
    }
    
    // Dispatch a custom event so any open modal is instantly notified
    const event = new CustomEvent('scanner_history_updated', { detail: { listType, records } });
    window.dispatchEvent(event);
};

// Background Pre-Loader: Fetch all lists in parallel
export const preloadAllHistories = async (uid: string) => {
    const activeUid = uid || 'default';
    const listTypes: ('LIST2' | 'LIST3' | 'LIST4')[] = ['LIST2', 'LIST3', 'LIST4'];
    
    console.log(`[History Cache] Starting background preloading for lists: ${listTypes.join(', ')}`);
    
    if (activeUid === 'default') {
        listTypes.forEach((listType) => {
            getMemoryCache(listType, activeUid);
            const key = `${listType}_${activeUid}`;
            cacheLoaded[key] = true;
        });
        return;
    }
    
    // Fetch each in parallel to avoid blocking
    listTypes.forEach(async (listType) => {
        try {
            const q = query(
                collection(db, 'momentum_history'),
                where('uid', '==', activeUid),
                where('listType', '==', listType),
                orderBy('timestamp', 'desc'),
                limit(100)
            );
            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HistoryRecord));
            setMemoryCache(listType, activeUid, data);
            console.log(`[History Cache] Preloaded ${data.length} records for ${listType}`);
        } catch (e) {
            console.error(`[History Cache] Failed to preload history for ${listType}:`, e);
            const key = `${listType}_${activeUid}`;
            cacheLoaded[key] = true;
        }
    });
};

// Write-through logging function: writes to local cache instantly, then to Firestore
export const logSignalToHistory = async (
    listType: 'LIST2' | 'LIST3' | 'LIST4',
    item: any,
    reason: string,
    uid: string
) => {
    const activeUid = uid || 'default';
    
    const symbol = item.symbol || '';
    const direction = item.direction || 'LONG';
    const price = item.price || 0;
    const timestamp = Date.now();
    const signalTime = item.signalTime || timestamp;
    const itemData = {
        symbol: item.symbol || '',
        price: item.price || 0,
        tf: item.tf || item.timeframe || '',
        direction: item.direction || ''
    };
    
    // Create new record
    const newRecord: HistoryRecord = {
        id: `temp_${timestamp}_${Math.random().toString(36).substring(2, 11)}`,
        symbol,
        direction,
        price,
        timestamp,
        reason,
        itemData,
        signalTime
    };
    
    // 1. Instantly update in-memory cache and localStorage
    let records = getMemoryCache(listType, activeUid);
    
    // Prepend to show most recent first, limit to 100
    records = [newRecord, ...records].slice(0, 100);
    setMemoryCache(listType, activeUid, records);
    
    if (activeUid === 'default') {
        return;
    }
    
    // 2. Asynchronously write to Firestore
    try {
        const docRef = await addDoc(collection(db, 'momentum_history'), {
            symbol,
            direction,
            price,
            timestamp,
            signalTime,
            listType,
            uid: activeUid,
            reason,
            itemData
        });
        
        // Update temp ID with real Firestore ID in cache
        const currentRecords = getMemoryCache(listType, activeUid);
        const updatedRecords = currentRecords.map(r => r.id === newRecord.id ? { ...r, id: docRef.id } : r);
        setMemoryCache(listType, activeUid, updatedRecords);
        console.log(`[History Cache] Successfully synced ${symbol} log to Firestore.`);
    } catch (e) {
        console.error(`[History Cache] Failed to save history for ${listType} to Firestore:`, e);
    }
};

// Update record when signal disappears
export const markSignalDisappeared = async (
    listType: 'LIST2' | 'LIST3' | 'LIST4',
    symbol: string,
    tf: string,
    direction: string,
    uid: string,
    disappearanceReason?: string
) => {
    const activeUid = uid || 'default';
    const records = getMemoryCache(listType, activeUid);
    
    // Find the most recent record matching symbol, tf, and direction that doesn't have disappearedAt yet
    const targetIdx = records.findIndex(r => {
        const recordTf = r.itemData?.tf || r.itemData?.timeframe || '';
        return r.symbol === symbol &&
               r.direction === direction &&
               recordTf === tf &&
               !r.disappearedAt;
    });
    
    // Fallback: if all have disappearedAt, just find the most recent one of this signal
    const idxToUpdate = targetIdx !== -1 ? targetIdx : records.findIndex(r => {
        const recordTf = r.itemData?.tf || r.itemData?.timeframe || '';
        return r.symbol === symbol &&
               r.direction === direction &&
               recordTf === tf;
    });
    
    if (idxToUpdate !== -1) {
        const record = records[idxToUpdate];
        const disappearedAt = Date.now();
        const finalDisReason = disappearanceReason || '指标不满足持续监控条件，自动消失';
        
        // Update local memory cache & localStorage
        const updatedRecord = { ...record, disappearedAt, disappearanceReason: finalDisReason };
        const newRecords = [...records];
        newRecords[idxToUpdate] = updatedRecord;
        setMemoryCache(listType, activeUid, newRecords);
        
        // Update in Firestore if not default/temp
        if (activeUid !== 'default' && record.id && !record.id.startsWith('temp_')) {
            try {
                const docRef = doc(db, 'momentum_history', record.id);
                await updateDoc(docRef, { disappearedAt, disappearanceReason: finalDisReason });
                console.log(`[History Cache] Marked ${symbol} (${tf} ${direction}) as disappeared in Firestore.`);
            } catch (e) {
                console.error(`[History Cache] Failed to mark signal as disappeared in Firestore:`, e);
            }
        }
    }
};

// Migrate memoryCache and localStorage from 'default' to real uid
export const migrateDefaultHistoryToUser = async (uid: string) => {
    if (!uid || uid === 'default') return;
    const listTypes: ('LIST2' | 'LIST3' | 'LIST4')[] = ['LIST2', 'LIST3', 'LIST4'];
    
    for (const listType of listTypes) {
        const defaultKey = `${listType}_default`;
        const defaultRecords = memoryCache[defaultKey] || [];
        
        // Also check localStorage
        let localDefault: string | null = null;
        try {
            localDefault = localStorage.getItem(`scanner_history_${listType}_default`);
        } catch (e) {
            console.warn('[History Cache] Failed to read default history from localStorage:', e);
        }
        let defaultParsed: HistoryRecord[] = [];
        if (localDefault) {
            try {
                defaultParsed = JSON.parse(localDefault);
            } catch (e) {
                console.error(e);
            }
        }
        
        const mergedDefault = [...defaultRecords, ...defaultParsed];
        if (mergedDefault.length === 0) continue;
        
        // Remove duplicates within merged default records
        const seen = new Set<string>();
        const uniqueDefault: HistoryRecord[] = [];
        mergedDefault.forEach(r => {
            const uniqKey = `${r.symbol}_${r.timestamp}_${r.direction}`;
            if (!seen.has(uniqKey)) {
                seen.add(uniqKey);
                uniqueDefault.push(r);
            }
        });
        
        // Get existing user records
        const userRecords = getMemoryCache(listType, uid);
        const finalMerged = [...uniqueDefault, ...userRecords]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100);
            
        setMemoryCache(listType, uid, finalMerged);
        
        // Clean up default key
        memoryCache[defaultKey] = [];
        try {
            localStorage.removeItem(`scanner_history_${listType}_default`);
        } catch (e) {
            console.warn('[History Cache] Failed to remove default history from localStorage:', e);
        }
        
        // Asynchronously write any newly migrated records to Firestore
        for (const r of uniqueDefault) {
            if (r.id.startsWith('temp_')) {
                try {
                    await addDoc(collection(db, 'momentum_history'), {
                        symbol: r.symbol,
                        direction: r.direction,
                        price: r.price,
                        timestamp: r.timestamp,
                        signalTime: r.signalTime || r.timestamp,
                        listType,
                        uid,
                        reason: r.reason,
                        itemData: r.itemData || null,
                        disappearedAt: r.disappearedAt || null,
                        disappearanceReason: r.disappearanceReason || null
                    });
                } catch (e) {
                    console.error('Failed to sync migrated record to Firestore:', e);
                }
            }
        }
    }
};

// Hook to monitor when items enter a list and auto-log them
export const useAutoHistoryLogger = (
    listType: 'LIST2' | 'LIST3' | 'LIST4',
    currentItems: any[],
    activePositions?: any[]
) => {
    const prevItemsRef = useRef<string[]>([]);
    const prevItemsStrRef = useRef<string>('');
    const prevFullItemsRef = useRef<Record<string, any>>({});
    const activePositionsRef = useRef<any[]>([]);
    const isFirstRunRef = useRef<boolean>(true);
    
    useEffect(() => {
        activePositionsRef.current = activePositions || [];
    }, [activePositions]);
    
    useEffect(() => {
        if (!currentItems) return;
        
        // Prevent unnecessary runs if the content hasn't changed
        const currentItemsStr = JSON.stringify(currentItems);
        if (currentItemsStr === prevItemsStrRef.current) return;
        prevItemsStrRef.current = currentItemsStr;

        const userId = auth.currentUser?.uid || 'default';
        
        // 1. Extract flat signals from currentItems based on listType
        const flatSignals: Array<{
            symbol: string;
            tf: string;
            direction: string;
            price: number;
            originalItem: any;
            signalTime: number;
        }> = [];
        
        currentItems.forEach(item => {
            if (!item || !item.symbol) return;
            
            if (listType === 'LIST2') {
                const grouped = item.groupedResults || [];
                grouped.forEach((res: any) => {
                    const times = res.crossingTimes || [];
                    const crossTime = times.length > 0 ? times[times.length - 1] : (item.lastUpdated || Date.now());
                    flatSignals.push({
                        symbol: item.symbol,
                        tf: res.tf || '15m',
                        direction: res.direction || 'LONG',
                        price: res.price || item.price || 0,
                        originalItem: item,
                        signalTime: crossTime
                    });
                });
            } else if (listType === 'LIST3') {
                const list3Res = item.list3Results || [];
                list3Res.forEach((res: any) => {
                    const structTime = res.structure?.signalTime || item.structure?.signalTime || (item.lastUpdated || Date.now());
                    flatSignals.push({
                        symbol: item.symbol,
                        tf: res.tf || '15m',
                        direction: res.direction || 'LONG',
                        price: res.price || item.price || 0,
                        originalItem: item,
                        signalTime: structTime
                    });
                });
            } else if (listType === 'LIST4') {
                const momTime = item.enterList4Time || (item.lastUpdated || Date.now());
                flatSignals.push({
                    symbol: item.symbol,
                    tf: item.tf || item.timeframe || '15m',
                    direction: item.direction || 'LONG',
                    price: item.price || 0,
                    originalItem: item,
                    signalTime: momTime
                });
            }
        });
        
        // 2. Generate unique identifiers for current flat signals
        const currentIds = flatSignals.map(sig => {
            return `${sig.symbol}-${sig.tf}-${sig.direction}`;
        });
        
        // Save current items into full details map
        flatSignals.forEach(sig => {
            const uniqueId = `${sig.symbol}-${sig.tf}-${sig.direction}`;
            prevFullItemsRef.current[uniqueId] = sig.originalItem;
        });
        
        // 3. On the very first run (mount/load), initialize prevItemsRef with all current signals
        // to prevent double-logging cached items on page refresh.
        if (isFirstRunRef.current) {
            prevItemsRef.current = currentIds;
            isFirstRunRef.current = false;
            return;
        }
        
        // 4. Find newly added flat signals
        const newSignals = flatSignals.filter(sig => {
            const uniqueId = `${sig.symbol}-${sig.tf}-${sig.direction}`;
            return !prevItemsRef.current.includes(uniqueId);
        });
        
        // 5. Log newly added signals
        newSignals.forEach(sig => {
            let reason = '';
            if (listType === 'LIST2') {
                const matchedGroup = sig.originalItem.groupedResults?.find((g: any) => g.tf === sig.tf);
                const isSqueeze = matchedGroup?.isSqueeze || sig.originalItem.isSqueeze || false;
                const crossingCount = matchedGroup?.crossingCount || sig.originalItem.crossingCount || 0;
                const isAligned = matchedGroup?.isAligned || false;
                reason = `均线交叉对齐触发 [周期: ${sig.tf}, 交叉数: ${crossingCount}, ${isAligned ? '均线多空排列对齐' : '处于交叉期'}${isSqueeze ? ', 伴随通道收窄(Squeeze)' : ''}]`;
            } else if (listType === 'LIST3') {
                const matchedRes = sig.originalItem.list3Results?.find((r: any) => r.tf === sig.tf && r.direction === sig.direction);
                const struct = matchedRes?.structure || sig.originalItem.structure || {};
                const isStrictTrend = struct.isStrictTrend ? "主趋势多空排列对齐" : "一般趋势";
                const bbw = struct.bbw ? `布林带带宽: ${(struct.bbw * 100).toFixed(2)}%` : "";
                const rsiStr = struct.rsi ? `RSI: ${struct.rsi.toFixed(1)}` : "";
                const locStr = struct.locationPct !== undefined ? `通道位置: ${(struct.locationPct * 100).toFixed(1)}%` : "";
                reason = `结构审计通过 [周期: ${sig.tf}, 方向: ${sig.direction}, ${isStrictTrend}, ${rsiStr}, ${bbw}, ${locStr}]`;
            } else if (listType === 'LIST4') {
                const mom = sig.originalItem.momentum || {};
                const purity = mom.purityValid ? "动能纯度达标" : "动能纯度不满足";
                const breakout = mom.breakoutValid ? "实体产生突破" : "等待突破触发";
                const status = mom.status || 'TRIGGERED';
                reason = `动能审计确认 [周期: ${sig.tf}, 方向: ${sig.direction}, 状态: ${status}, ${purity}, ${breakout}]`;
            }
            
            console.log(`[Auto Logger] New signal entering ${listType}: ${sig.symbol} (${sig.tf} ${sig.direction}), triggering auto-log...`);
            
            // Construct pseudo item for logging
            const pseudoItem = {
                symbol: sig.symbol,
                price: sig.price,
                tf: sig.tf,
                timeframe: sig.tf,
                direction: sig.direction,
                signalTime: sig.signalTime
            };
            
            logSignalToHistory(listType, pseudoItem, reason, userId);
        });
        
        // Find disappeared flat signals
        const disappearedIds = prevItemsRef.current.filter(id => !currentIds.includes(id));
        disappearedIds.forEach(id => {
            const [symbol, tf, direction] = id.split('-');
            if (symbol && tf && direction) {
                console.log(`[Auto Logger] Signal disappeared from ${listType}: ${symbol} (${tf} ${direction}), updating history...`);
                
                const prevUniqueId = `${symbol}-${tf}-${direction}`;
                const prevItem = prevFullItemsRef.current[prevUniqueId];
                
                let disappearanceReason = '未满足持续监控条件 (指标变动自动消失)';
                
                if (prevItem) {
                    if (listType === 'LIST4') {
                        // Check if position is active for this symbol/direction
                        const hasPosition = activePositionsRef.current?.some(p => p.symbol === symbol && p.side === direction);
                        if (hasPosition) {
                            disappearanceReason = '动能激活成功，系统已自动开仓交易';
                        } else if (prevItem.removalReason) {
                            disappearanceReason = prevItem.removalReason;
                        } else if (prevItem.fuseBlocked) {
                            disappearanceReason = `触发防追高熔断/高级过滤保护被清除: ${prevItem.fuseReason || '熔断拦截'}`;
                        } else if (prevItem.momentum?.status === 'INVALID') {
                            disappearanceReason = `动能审计失效 / 趋势结构破坏 (${prevItem.momentum?.invalidReason || '多空方向反转'})`;
                        } else {
                            disappearanceReason = '超出信号有效期，周期K线到期自动衰减';
                        }
                    } else if (listType === 'LIST3') {
                        const matchedRes = prevItem.list3Results?.find((r: any) => r.tf === tf && r.direction === direction);
                        const struct = matchedRes?.structure || prevItem.structure || {};
                        if (struct.isStrictTrend === false) {
                            disappearanceReason = '主趋势多头/空头排列被打破，不再满足趋势共振';
                        } else if (struct.isColorValid === false) {
                            disappearanceReason = '信号K线实体颜色与预测方向相反，结构失效';
                        } else {
                            disappearanceReason = '信号生命周期耗尽，未触发后续动能审计，超出 Validity Period 自动衰减';
                        }
                    } else if (listType === 'LIST2') {
                        const matchedGroup = prevItem.groupedResults?.find((g: any) => g.tf === tf);
                        if (matchedGroup && !matchedGroup.isSqueeze) {
                            disappearanceReason = '波动性(Squeeze)挤压状态释放，通道变宽，不满足低波安全建仓';
                        } else {
                            disappearanceReason = '均线交叉结束 / 均线排列对齐形态失效';
                        }
                    }
                }
                
                // If the coin is completely gone from screener
                const symbolStillInScreener = currentItems.some(item => item && item.symbol === symbol);
                if (!symbolStillInScreener) {
                    disappearanceReason = '该币种的24H交易额/涨跌幅低于筛选阈值，被移出系统全局扫描候选池';
                }
                
                markSignalDisappeared(listType, symbol, tf, direction, userId, disappearanceReason);
            }
        });
        
        // 6. Update prevItemsRef for subsequent renders
        prevItemsRef.current = currentIds;
    }, [currentItems, listType]);
};

export const ScannerHistoryModal: React.FC<HistoryModalProps> = ({ onClose, listType, setChartData }) => {
    const [userId, setUserId] = useState<string>(() => auth.currentUser?.uid || '');
    const [records, setRecords] = useState<HistoryRecord[]>(() => getMemoryCache(listType, userId));
    const [loading, setLoading] = useState(() => {
        const key = `${listType}_${userId || 'default'}`;
        return !cacheLoaded[key];
    });

    // 1. Listen for background updates
    useEffect(() => {
        const handleUpdate = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail && customEvent.detail.listType === listType) {
                setRecords(customEvent.detail.records);
                setLoading(false);
            }
        };
        window.addEventListener('scanner_history_updated', handleUpdate);
        return () => window.removeEventListener('scanner_history_updated', handleUpdate);
    }, [listType]);

    // 2. Track auth state
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId('default');
            }
        });
        return () => unsubscribe();
    }, []);

    // 3. Keep records and loading in sync when userId changes, and fetch from Firestore in the background
    useEffect(() => {
        const activeUid = userId || 'default';
        const key = `${listType}_${activeUid}`;
        const cached = getMemoryCache(listType, userId);
        setRecords(cached);
        
        const loaded = cacheLoaded[key];
        setLoading(!loaded);

        if (activeUid === 'default') {
            setLoading(false);
            return;
        }

        let isMounted = true;
        const fetchHistory = async () => {
            try {
                const q = query(
                    collection(db, 'momentum_history'),
                    where('uid', '==', activeUid),
                    where('listType', '==', listType),
                    orderBy('timestamp', 'desc'),
                    limit(100)
                );
                const snapshot = await getDocs(q);
                if (!isMounted) return;

                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HistoryRecord));
                
                // Update memory cache and state
                setMemoryCache(listType, activeUid, data);
                setRecords(data);
            } catch (e) {
                console.error('Failed to fetch history in background:', e);
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };
        fetchHistory();

        return () => {
            isMounted = false;
        };
    }, [listType, userId]);

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl max-h-[80vh] flex flex-col rounded shadow-xl animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between p-3 border-b border-slate-800">
                    <h2 className="text-sm font-bold text-slate-200">{listType} 历史审计</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors cursor-pointer p-1 rounded hover:bg-slate-800">
                        <X size={16} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                    {loading && records.length === 0 ? (
                        <div className="text-center text-slate-500 py-10 text-xs font-medium">加载中...</div>
                    ) : records.length === 0 ? (
                        <div className="text-center text-slate-500 py-10 text-xs font-medium">暂无历史记录</div>
                    ) : (
                        records.map(r => (
                            <div key={r.id} className="bg-slate-800/80 hover:bg-slate-800 p-3 rounded text-[10px] text-slate-300 border border-slate-700/60 transition-colors">
                                <div className="flex justify-between font-bold text-slate-100 mb-1">
                                    <span 
                                        className={`text-emerald-400 font-bold text-[11px] ${setChartData ? 'cursor-pointer hover:underline hover:text-emerald-300' : ''}`}
                                        onClick={() => {
                                            if (setChartData) {
                                                setChartData({
                                                    symbol: r.symbol,
                                                    tf: r.itemData?.tf || r.itemData?.timeframe || '15m',
                                                    appearedTime: r.timestamp,
                                                    disappearedTime: r.disappearedAt || null,
                                                    signals: [{ time: r.timestamp, type: r.direction as any }],
                                                    currentPrice: r.price,
                                                    showAuditLines: true
                                                });
                                            }
                                        }}
                                    >
                                        📈 {r.symbol} ({r.direction}) <span className="text-[9px] text-slate-400 font-normal ml-1">({r.itemData?.tf || r.itemData?.timeframe || '15m'} 周期, 点击看图)</span>
                                    </span>
                                    <span className="text-slate-400 font-mono text-[9px] bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/30">
                                        进入价格: <span className="text-emerald-400 font-bold">{r.price}</span>
                                    </span>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 border-t border-slate-700/30 pt-2 text-[9px] font-mono text-slate-400">
                                    <div>
                                        <span className="text-slate-500 font-sans">信号发生时间:</span>{' '}
                                        <span className="text-emerald-400 font-bold">
                                            {new Date(r.signalTime || r.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 font-sans">进入列表时间:</span>{' '}
                                        <span className="text-blue-400 font-bold">
                                            {new Date(r.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="md:col-span-2">
                                        <span className="text-slate-500 font-sans block mb-0.5">信号发生条件 (触发):</span>
                                        <span className="text-amber-300 block bg-slate-900/30 p-1.5 rounded border border-slate-700/20 leading-relaxed whitespace-pre-wrap">
                                            {r.reason}
                                        </span>
                                    </div>
                                    <div className="md:col-span-2 border-t border-slate-800/40 pt-1.5 mt-0.5">
                                        <span className="text-slate-500 font-sans">消失时间:</span>{' '}
                                        {r.disappearedAt ? (
                                            <span className="text-rose-400 font-bold bg-rose-500/10 px-1 py-0.5 rounded">
                                                {new Date(r.disappearedAt).toLocaleString()}
                                            </span>
                                        ) : (
                                            <span className="text-emerald-500 font-bold animate-pulse bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                ● 监测活跃中 (Active)
                                            </span>
                                        )}
                                    </div>
                                    <div className="md:col-span-2">
                                        <span className="text-slate-500 font-sans block mb-0.5">信号消失原因 (消除):</span>
                                        <span className={`${r.disappearedAt ? 'text-rose-300 bg-rose-950/20' : 'text-slate-500 bg-slate-900/10'} block p-1.5 rounded border border-slate-700/10 leading-relaxed whitespace-pre-wrap`}>
                                            {r.disappearedAt ? (r.disappearanceReason || '不满足持续监控条件，自动消失') : '持续符合指标条件，正在实时扫描监测中'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
