/**
 * ==============================================================================
 * Cache & Storage Management Service (全域缓存与存储垃圾自动清理引擎)
 * ==============================================================================
 * 专门用于监控和自动清理长期运行产生的各种缓存、IndexedDB 临时 K 线数据、
 * localStorage 历史冗余、以及浏览器 CacheStorage，防止 C 盘和浏览器缓存爆炸。
 * 
 * 核心安全铁律：
 * 绝不清理用户的核心策略参数、API 密钥以及系统关键配置！
 */

import { backtestDb } from './backtest/db';

export interface StorageEstimateInfo {
    usageBytes: number;
    quotaBytes: number;
    usageMB: number;
    quotaMB: number;
    percent: number;
    localStorageKB: number;
    localStorageCount: number;
    lastCleanTime: number;
}

// 核心保护白名单（绝对不可删除的用户关键数据）
const PROTECTED_KEY_PREFIXES = [
    'SAVIOR_SETTINGS',
    'BINANCE_API_KEY',
    'BINANCE_SECRET_KEY',
    'SAVIOR_LICENSE',
    'SCANNER_STRATEGIES_LIST',
    'SCANNER_SELECTED_STRATEGY_ID',
    'SCANNER_ACTIVE_MODE',
    'SCANNER_ROTATION',
    'SCANNER_CONFIG_',
    'SCANNER_LIST2_CONFIG_',
    'SCANNER_LIST3_CONFIG_',
    'SCANNER_LIST4_CONFIG_',
    'SCANNER_ACTION_CONFIG_',
    'SAVIOR_TRADE_LOGS',
    'SAVIOR_IS_SIMULATING',
    'SAVIOR_AUTO_CLEAN_INTERVAL',
    'SAVIOR_LAST_AUTO_CLEAN_TIME',
    'FIREBASE_'
];

class CacheManagerService {
    private autoCleanIntervalMinutes: number = 30; // 默认 30 分钟自动清理一次
    private timerId: any = null;
    private listeners: Set<(info: StorageEstimateInfo) => void> = new Set();
    private isCleaning: boolean = false;

    constructor() {
        this.loadSettings();
        this.startAutoCleanTimer();
    }

    private loadSettings() {
        if (typeof window === 'undefined') return;
        try {
            const savedInterval = localStorage.getItem('SAVIOR_AUTO_CLEAN_INTERVAL');
            if (savedInterval !== null) {
                const parsed = parseInt(savedInterval, 10);
                this.autoCleanIntervalMinutes = isNaN(parsed) ? 30 : parsed;
            }
        } catch (_) {}
    }

    public getAutoCleanInterval(): number {
        return this.autoCleanIntervalMinutes;
    }

    public setAutoCleanInterval(minutes: number) {
        this.autoCleanIntervalMinutes = minutes;
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem('SAVIOR_AUTO_CLEAN_INTERVAL', minutes.toString());
            } catch (_) {}
        }
        this.startAutoCleanTimer();
    }

    public getLastCleanTime(): number {
        if (typeof window === 'undefined') return 0;
        try {
            const last = localStorage.getItem('SAVIOR_LAST_AUTO_CLEAN_TIME');
            return last ? parseInt(last, 10) || 0 : 0;
        } catch (_) {
            return 0;
        }
    }

    private setLastCleanTime(ts: number) {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem('SAVIOR_LAST_AUTO_CLEAN_TIME', ts.toString());
        } catch (_) {}
    }

    /**
     * 获取当前存储与缓存使用统计估算
     */
    public async getStorageEstimate(): Promise<StorageEstimateInfo> {
        let usageBytes = 0;
        let quotaBytes = 0;

        if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
            try {
                const est = await navigator.storage.estimate();
                usageBytes = est.usage || 0;
                quotaBytes = est.quota || 0;
            } catch (_) {}
        }

        // 计算 LocalStorage 占用
        let lsBytes = 0;
        let lsCount = 0;
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                lsCount = localStorage.length;
                for (let i = 0; i < lsCount; i++) {
                    const key = localStorage.key(i);
                    if (key) {
                        const val = localStorage.getItem(key) || '';
                        lsBytes += (key.length + val.length) * 2; // UTF-16 bytes approx
                    }
                }
            } catch (_) {}
        }

        const usageMB = +(usageBytes / (1024 * 1024)).toFixed(2);
        const quotaMB = +(quotaBytes / (1024 * 1024)).toFixed(2);
        const percent = quotaBytes > 0 ? +((usageBytes / quotaBytes) * 100).toFixed(2) : 0;
        const localStorageKB = +(lsBytes / 1024).toFixed(1);

        return {
            usageBytes,
            quotaBytes,
            usageMB,
            quotaMB,
            percent,
            localStorageKB,
            localStorageCount: lsCount,
            lastCleanTime: this.getLastCleanTime()
        };
    }

    /**
     * 执行缓存清理
     * @param mode 'LIGHT' (轻量自动清理) | 'DEEP' (深度一键清理)
     */
    public async clearCache(mode: 'LIGHT' | 'DEEP' = 'LIGHT'): Promise<{ freedMB: number, details: string[] }> {
        if (this.isCleaning) {
            return { freedMB: 0, details: ['正在清理中，请勿重复操作'] };
        }
        this.isCleaning = true;
        const details: string[] = [];
        const initialEstimate = await this.getStorageEstimate();

        try {
            // 1. 清理 LocalStorage 中的临时垃圾和非核心缓存
            if (typeof window !== 'undefined' && window.localStorage) {
                const keysToRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key) continue;

                    // 检查是否受保护
                    const isProtected = PROTECTED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
                    if (isProtected) {
                        // 如果是日志类受保护数据，但体积过大，进行截断而非删除
                        if (key === 'SAVIOR_SYSTEM_MONITOR_LOGS' || key === 'SAVIOR_LOGS') {
                            try {
                                const raw = localStorage.getItem(key);
                                if (raw && raw.length > 50000) {
                                    const parsed = JSON.parse(raw);
                                    if (Array.isArray(parsed)) {
                                        localStorage.setItem(key, JSON.stringify(parsed.slice(0, 50)));
                                        details.push(`压缩截断日志记录: ${key}`);
                                    }
                                }
                            } catch (_) {}
                        }
                        continue;
                    }

                    // 临时行情、缓存地图、多余历史记录、错误日志堆积均列入清理
                    if (
                        key.startsWith('SCANNER_RAW_DATA') ||
                        key.startsWith('SCANNER_LIST2_CACHE') ||
                        key.startsWith('SCANNER_LIST3_CACHE') ||
                        key.startsWith('SCANNER_LIST4_RESULTS') ||
                        key.startsWith('scanner_history_') ||
                        key.startsWith('SAVIOR_COOLDOWNS') ||
                        key.startsWith('TEMP_') ||
                        key.includes('cache') ||
                        mode === 'DEEP'
                    ) {
                        keysToRemove.push(key);
                    }
                }

                keysToRemove.forEach(k => {
                    try {
                        localStorage.removeItem(k);
                    } catch (_) {}
                });
                if (keysToRemove.length > 0) {
                    details.push(`清理 LocalStorage 临时缓存项 ${keysToRemove.length} 个`);
                }
            }

            // 2. 清理 CacheStorage 浏览器静态请求缓存
            if (typeof window !== 'undefined' && 'caches' in window) {
                try {
                    const cacheKeys = await window.caches.keys();
                    for (const cacheKey of cacheKeys) {
                        await window.caches.delete(cacheKey);
                    }
                    if (cacheKeys.length > 0) {
                        details.push(`清空 CacheStorage 缓存池 (${cacheKeys.length} 个)`);
                    }
                } catch (_) {}
            }

            // 3. 深度清理模式下：清空 IndexedDB 中的回测 K 线临时数据库 (大文件核心来源)
            if (mode === 'DEEP') {
                try {
                    await backtestDb.init();
                    await backtestDb.clearData();
                    details.push('已彻底清空 IndexedDB 回测 K 线历史数据库');
                } catch (e) {
                    console.warn('[CacheManager] IndexedDB clean error:', e);
                }
            }

            // 4. 清理全局 window 上的临时图表缓存与对象池
            if (typeof window !== 'undefined') {
                try {
                    delete (window as any).__KLINE_CACHE__;
                    delete (window as any).__PRICE_HISTORY_CACHE__;
                    delete (window as any).__TEMP_CHART_TICKS__;
                } catch (_) {}
            }

            // 更新上次清理时间
            const now = Date.now();
            this.setLastCleanTime(now);

            const finalEstimate = await this.getStorageEstimate();
            const freedMB = Math.max(0, +(initialEstimate.usageMB - finalEstimate.usageMB).toFixed(2));

            this.notifyListeners(finalEstimate);
            return { freedMB, details };
        } catch (err: any) {
            console.error('[CacheManager] Clean failed:', err);
            return { freedMB: 0, details: [`清理异常: ${err?.message || String(err)}`] };
        } finally {
            this.isCleaning = false;
        }
    }

    private startAutoCleanTimer() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }

        // 如果设置为 0，表示用户关闭了自动清理
        if (this.autoCleanIntervalMinutes <= 0) {
            return;
        }

        // 每 60 秒检查一次是否到达设定的清理间隔
        this.timerId = setInterval(async () => {
            const now = Date.now();
            const lastClean = this.getLastCleanTime();
            const intervalMs = this.autoCleanIntervalMinutes * 60 * 1000;

            if (now - lastClean >= intervalMs) {
                console.log(`[CacheManager] 达到自动清理周期 (${this.autoCleanIntervalMinutes}分钟)，正在执行轻量自动释放...`);
                const res = await this.clearCache('LIGHT');
                console.log(`[CacheManager] 自动清理完成:`, res.details);

                // 发送全局自定义事件，方便通知界面
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('savior_auto_cache_cleaned', {
                        detail: { timestamp: now, freedMB: res.freedMB }
                    }));
                }
            }
        }, 60000);
    }

    public subscribe(listener: (info: StorageEstimateInfo) => void) {
        this.listeners.add(listener);
        this.getStorageEstimate().then(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners(info: StorageEstimateInfo) {
        this.listeners.forEach(fn => fn(info));
    }
}

export const cacheManager = new CacheManagerService();
