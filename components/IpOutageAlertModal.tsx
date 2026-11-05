import React, { useState, useEffect } from 'react';
import { ShieldAlert, Copy, Check, Volume2, VolumeX, RefreshCw, AlertOctagon, Wifi, Server, CheckCircle2 } from 'lucide-react';

export interface IncidentStateData {
  status: 'HEALTHY' | 'IP_DRIFT_LOCK' | 'EXCHANGE_OUTAGE' | 'LOCAL_NETWORK_DOWN';
  currentIp: string;
  oldIp: string;
  timestamp: number;
  reason: string;
}

interface IpOutageAlertModalProps {
  data?: IncidentStateData | null;
  onClose?: () => void;
  onRecovered?: () => void;
}

export const IpOutageAlertModal: React.FC<IpOutageAlertModalProps> = ({
  data: initialData,
  onClose,
  onRecovered
}) => {
  const [incidentData, setIncidentData] = useState<IncidentStateData | null>(initialData || null);
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);

  // Sync state if initialData changes
  useEffect(() => {
    if (initialData) {
      setIncidentData(initialData);
    }
  }, [initialData]);

  // Poll server for system incident status
  useEffect(() => {
    const fetchHealthStatus = async () => {
      try {
        const res = await fetch('/api/system/health');
        if (res.ok) {
          const json = await res.json();
          if (json && json.status && json.status !== 'HEALTHY') {
            setIncidentData(json);
          } else if (json && json.status === 'HEALTHY' && incidentData) {
            setIncidentData(null);
            if (onRecovered) onRecovered();
          }
        }
      } catch (_) {}
    };

    fetchHealthStatus();
    const interval = setInterval(fetchHealthStatus, 4000);

    const handleCustomEvent = (e: any) => {
      if (e.detail) {
        setIncidentData(e.detail);
      }
    };
    window.addEventListener('savior_system_incident', handleCustomEvent);

    return () => {
      clearInterval(interval);
      window.removeEventListener('savior_system_incident', handleCustomEvent);
    };
  }, [incidentData, onRecovered]);

  // 核心铁律：若原 IP 与当前最新 IP 相同（未发生 IP 漂移），绝不弹出此白名单告警遮罩（严格遵循用户指令：都是同一个IP就不要弹出了）
  const isSameIp = Boolean(
    incidentData &&
    incidentData.currentIp &&
    incidentData.oldIp &&
    incidentData.currentIp !== '未检测到' &&
    incidentData.oldIp !== '未检测到' &&
    incidentData.currentIp.trim() === incidentData.oldIp.trim()
  );

  if (!incidentData || incidentData.status === 'HEALTHY' || isSameIp) {
    return null;
  }

  const handleCopyIp = async () => {
    if (!incidentData.currentIp) return;
    try {
      await navigator.clipboard.writeText(incidentData.currentIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      // Fallback text copy
      const el = document.createElement('textarea');
      el.value = incidentData.currentIp;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggleMute = async () => {
    try {
      const endpoint = isMuted ? '/api/system/unmute-siren' : '/api/system/mute-siren';
      await fetch(endpoint, { method: 'POST' });
      setIsMuted(!isMuted);
    } catch (_) {
      setIsMuted(!isMuted);
    }
  };

  const handleRetryRecovery = async () => {
    setIsRecovering(true);
    setRecoverMessage('正在验证币安接口连通性并释放受控挂起锁...');

    try {
      const res = await fetch('/api/system/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();

      if (res.ok && result.success) {
        setRecoverMessage('🟢 验证通过！系统已安全恢复正常运行。');
        setTimeout(() => {
          setIncidentData(null);
          setIsRecovering(false);
          setRecoverMessage(null);
          if (onRecovered) onRecovered();
          if (onClose) onClose();
        }, 1200);
      } else {
        const errMsg = result.message || '连通失败：币安接口依然拒绝请求 (-2015)，请检查白名单是否已填对并生效！';
        setRecoverMessage(`❌ ${errMsg}`);
        setIsRecovering(false);
      }
    } catch (err: any) {
      setRecoverMessage(`❌ 请求发送失败: ${err.message || '网络连接超时'}`);
      setIsRecovering(false);
    }
  };

  const isIpDrift = incidentData.status === 'IP_DRIFT_LOCK';
  const isExchangeOutage = incidentData.status === 'EXCHANGE_OUTAGE';
  const isLocalDown = incidentData.status === 'LOCAL_NETWORK_DOWN';

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-red-950/90 backdrop-blur-md p-4 animate-fadeIn">
      {/* Dynamic Pulsing Border Mask */}
      <div className="absolute inset-0 border-8 border-red-600/80 pointer-events-none animate-pulse" />

      <div className="relative w-full max-w-2xl bg-slate-950 border-2 border-red-500 rounded-xl shadow-2xl shadow-red-900/50 overflow-hidden text-slate-100 p-6 md:p-8 space-y-6">

        {/* Header Header Status Bar */}
        <div className="flex items-start justify-between border-b border-red-900/60 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-red-600/20 border border-red-500 rounded-lg text-red-500 animate-bounce">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 text-xs font-bold uppercase rounded bg-red-600 text-white tracking-wider">
                  {incidentData.status}
                </span>
                <span className="text-xs text-red-400 font-mono">
                  {new Date(incidentData.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <h2 className="text-xl font-bold text-red-100 mt-1">
                {isIpDrift && '🚨 告警：服务器出口 IP 漂移受控挂起锁'}
                {isExchangeOutage && '⚡ 告警：交易所拔网线/接口响应熔断'}
                {isLocalDown && '🌐 告警：本地与第三方网络连通中断'}
              </h2>
            </div>
          </div>

          <button
            onClick={handleToggleMute}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
              isMuted
                ? 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                : 'bg-amber-950 text-amber-300 border-amber-800 hover:bg-amber-900'
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-amber-400 animate-pulse" />}
            <span>{isMuted ? '已静音' : '蜂鸣中'}</span>
          </button>
        </div>

        {/* Safe Notice */}
        <div className="bg-red-950/40 border border-red-800/80 rounded-lg p-3 text-xs text-red-200 flex items-center space-x-2">
          <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
          <span>
            <strong>防爆仓保护生效中：</strong> 交易引擎已安全挂起，未捕获异常已被拦截，<strong>全系统绝无爆仓风险</strong>，恢复后将自动清除积压重试队列，严禁误下旧单！
          </span>
        </div>

        {/* IP Display Box */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider flex items-center space-x-1.5">
              <Server className="w-4 h-4 text-sky-400" />
              <span>当前最新公网 IP (最新漂移出口)</span>
            </span>
            <span className="text-xs text-slate-500 font-mono">
              原 IP: {incidentData.oldIp || '未知'}
            </span>
          </div>

          <div className="flex items-center justify-between bg-slate-950 border border-sky-500/40 rounded-lg p-3">
            <span className="text-2xl md:text-3xl font-mono font-bold text-sky-400 tracking-wider">
              {incidentData.currentIp || '正在探测中...'}
            </span>

            <button
              onClick={handleCopyIp}
              className={`flex items-center space-x-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all border ${
                copied
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-sky-600 hover:bg-sky-500 text-white border-sky-400 active:scale-95'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>已复制 IP</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>一键复制 IP</span>
                </>
              )}
            </button>
          </div>

          <div className="text-xs text-slate-400 space-y-1 bg-slate-950/50 p-3 rounded-lg border border-slate-800">
            <p className="text-amber-300 font-semibold flex items-center space-x-1">
              <span>故障发生根因：</span>
              <span className="font-mono text-amber-200">{incidentData.reason}</span>
            </p>
          </div>
        </div>

        {/* Action Steps */}
        <div className="space-y-2 text-xs text-slate-300">
          <h4 className="font-bold text-slate-200 flex items-center space-x-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>热自愈修复指引：</span>
          </h4>
          <ol className="list-decimal list-inside space-y-1 bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-slate-300">
            <li>在上面点击 <strong className="text-sky-300">【一键复制 IP】</strong> 获得最新的服务器公网 IP。</li>
            <li>登录币安 API 管理面板，将新 IP 粘贴填入白名单列表中并保存。</li>
            <li>完成白名单保存后，点击下方 <strong className="text-emerald-400">【重试连通 / 白名单已加】</strong> 按钮。</li>
          </ol>
        </div>

        {/* Recover Status Message */}
        {recoverMessage && (
          <div className="p-3 text-xs font-mono rounded-lg border bg-slate-900 border-slate-700 text-slate-200">
            {recoverMessage}
          </div>
        )}

        {/* Modal Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => {
              setIncidentData(null);
              if (onClose) onClose();
            }}
            className="w-full sm:w-auto px-4 py-3 text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-all cursor-pointer"
            title="跳过 IP 限制，直接进入主界面使用模拟运行功能"
          >
            跳过 / 暂不修改 (进入主界面)
          </button>

          <button
            onClick={handleRetryRecovery}
            disabled={isRecovering}
            className="w-full sm:w-auto flex-1 flex items-center justify-center space-x-2 px-6 py-3 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl transition-all shadow-lg shadow-emerald-950 border border-emerald-400 active:scale-95 cursor-pointer"
          >
            <RefreshCw className={`w-5 h-5 ${isRecovering ? 'animate-spin' : ''}`} />
            <span>{isRecovering ? '正在重试验证连通...' : '重试连通 / 白名单已加'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default IpOutageAlertModal;
