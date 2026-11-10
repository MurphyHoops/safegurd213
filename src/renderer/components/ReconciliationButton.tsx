import React, { useState, useEffect } from 'react';
import { binanceRateLimiter, RateLimiterStatus } from '../../../services/binanceRateLimiter';
import { binanceAxios } from '../../main/api/binanceAxios';

export const ReconciliationButton: React.FC = () => {
  const [limiterStatus, setLimiterStatus] = useState<RateLimiterStatus>(binanceRateLimiter.getStatus());
  const [manualCooldownSec, setManualCooldownSec] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // 1. 订阅全局限频器状态更新（加入结构相等的去重判断，防止无限重渲染）
  useEffect(() => {
    const unsubscribe = binanceRateLimiter.subscribe((status) => {
      setLimiterStatus((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(status)) {
          return prev;
        }
        return status;
      });
    });

    // 本地 1 秒定时器：计算手动点击的 60 秒硬冷却倒计时
    const interval = setInterval(() => {
      const { allowed, remainingSeconds } = binanceRateLimiter.canTriggerManualReconciliation();
      setManualCooldownSec(allowed ? 0 : remainingSeconds);
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // 2. 点击执行深度对账
  const handleReconcile = async () => {
    if (isButtonDisabled) return;

    setIsProcessing(true);
    try {
      await binanceRateLimiter.executeReconciliationWithMutex(async () => {
        console.log('🚀 [UI 手动深度对账] 开始向币安同步资产与持仓...');
        const [accountRes, positionRes] = await Promise.all([
          binanceAxios.get('/fapi/v2/account'),
          binanceAxios.get('/fapi/v2/positionRisk')
        ]);
        console.log('✅ [UI 手动深度对账] 资产持仓核验完成', {
          assets: accountRes.data?.totalWalletBalance,
          positions: positionRes.data?.length
        });
      }, true); // true 标记为手动触发
    } catch (err: any) {
      console.error('❌ 对账失败或被限频拦截:', err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. 计算按钮状态与显示文案
  const isFrozen = limiterStatus.isFrozen && limiterStatus.remainingFrozenSeconds > 0;
  const isCooldown = manualCooldownSec > 0;
  const isMutexLocked = limiterStatus.isReconciling || isProcessing;
  const isButtonDisabled = isFrozen || isCooldown || isMutexLocked;

  const getButtonText = () => {
    if (isFrozen) {
      return `🚨 熔断静默中 (${limiterStatus.remainingFrozenSeconds}s)`;
    }
    if (isMutexLocked) {
      return `⏳ 正在对账比对中...`;
    }
    if (isCooldown) {
      return `⏱️ 冷却等待 (${manualCooldownSec}s)`;
    }
    return `🔄 手动深度对账`;
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <button
        onClick={handleReconcile}
        disabled={isButtonDisabled}
        style={{
          padding: '8px 16px',
          borderRadius: '4px',
          border: '1px solid #333',
          backgroundColor: isButtonDisabled ? '#3a3a3c' : '#0070f3',
          color: isButtonDisabled ? '#8e8e93' : '#ffffff',
          cursor: isButtonDisabled ? 'not-allowed' : 'pointer',
          fontWeight: 600,
          transition: 'all 0.2s ease-in-out'
        }}
      >
        {getButtonText()}
      </button>

      {/* 实时权重监控小标 */}
      <span
        style={{
          fontSize: '12px',
          color: limiterStatus.isHighWeight ? '#ff453a' : '#30d158'
        }}
      >
        权重: {limiterStatus.currentWeight1m}/{limiterStatus.maxWeightLimit} (
        {(limiterStatus.weightUsageRatio * 100).toFixed(0)}%)
      </span>
    </div>
  );
};
