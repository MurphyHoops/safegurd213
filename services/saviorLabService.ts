
import { db, auth } from '../firebase';
import { collection, query, where, getDocs, orderBy, limit, addDoc, Timestamp } from 'firebase/firestore';
import { TradeDNA } from '../types';

export const saviorLabService = {
    async fetchTradeDNA(symbol?: string, limitCount: number = 50): Promise<TradeDNA[]> {
        if (!auth.currentUser) return [];
        
        try {
            const dnaRef = collection(db, 'trade_dna');
            let q = query(
                dnaRef, 
                where('uid', '==', auth.currentUser.uid),
                orderBy('exitTime', 'desc'),
                limit(limitCount)
            );
            
            if (symbol) {
                q = query(
                    dnaRef,
                    where('uid', '==', auth.currentUser.uid),
                    where('symbol', '==', symbol),
                    orderBy('exitTime', 'desc'),
                    limit(limitCount)
                );
            }
            
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as TradeDNA));
        } catch (error) {
            console.error("Failed to fetch Trade DNA:", error);
            return [];
        }
    },

    async saveBacktestResult(result: any) {
        if (!auth.currentUser) return;
        
        try {
            await addDoc(collection(db, 'backtests'), {
                uid: auth.currentUser.uid,
                timestamp: Timestamp.now(),
                ...result
            });
        } catch (error) {
            console.error("Failed to save backtest result:", error);
        }
    }
};
