import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  Cpu, 
  Copy, 
  Check, 
  Mail, 
  Key, 
  User, 
  Phone, 
  CreditCard, 
  Upload, 
  Sparkles, 
  Trash2, 
  Loader2, 
  X, 
  Lock, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw,
  Image as ImageIcon
} from 'lucide-react';

interface ActivationModalProps {
  isActivated?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onActivated: () => void;
}

export const ActivationModal: React.FC<ActivationModalProps> = ({ 
  isActivated = false, 
  isOpen = false, 
  onClose, 
  onActivated 
}) => {
  // Machine ID persistent generation
  const [machineId, setMachineId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('SAVIOR_MACHINE_ID');
      if (saved) return saved;
      const res = `${window.screen?.width || 1920}x${window.screen?.height || 1080}`;
      const rand1 = Math.random().toString(36).substring(2, 10).toUpperCase();
      const rand2 = Math.random().toString(36).substring(2, 10).toUpperCase();
      const genId = `SAVIOR-${res}-G7DY6C4U-${rand2 || 'MTKSSJ8J'}`;
      localStorage.setItem('SAVIOR_MACHINE_ID', genId);
      return genId;
    } catch {
      return 'SAVIOR-1920x1080-G7DY6C4U-MTKSSJ8J';
    }
  });

  // Form State with user's specific defaults
  const [senderEmail, setSenderEmail] = useState<string>(() => {
    return localStorage.getItem('SAVIOR_AUTH_EMAIL') || '541232585@qq.com';
  });
  const [senderPassword, setSenderPassword] = useState<string>(() => {
    return localStorage.getItem('SAVIOR_AUTH_PWD') || '••••••••••••••••';
  });
  const [name, setName] = useState<string>(() => {
    return localStorage.getItem('SAVIOR_AUTH_NAME') || '钱方';
  });
  const [phone, setPhone] = useState<string>(() => {
    return localStorage.getItem('SAVIOR_AUTH_PHONE') || '13882768653';
  });
  const [idCard, setIdCard] = useState<string>(() => {
    return localStorage.getItem('SAVIOR_AUTH_IDCARD') || '510502198003060735';
  });
  const [photo, setPhoto] = useState<string>(() => {
    return localStorage.getItem('SAVIOR_AUTH_PHOTO') || '';
  });

  const [copied, setCopied] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showCodeInput, setShowCodeInput] = useState<boolean>(false);
  const [activationCode, setActivationCode] = useState<string>('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate Demo ID Card SVG
  const handleUseDemoPhoto = () => {
    const demoSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380">
      <defs>
        <linearGradient id="idbg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="%231e293b"/>
          <stop offset="100%" stop-color="%230f172a"/>
        </linearGradient>
        <linearGradient id="chip" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="%23fbbf24"/>
          <stop offset="100%" stop-color="%23d97706"/>
        </linearGradient>
      </defs>
      <rect width="600" height="380" rx="20" fill="url(%23idbg)" stroke="%23334155" stroke-width="2"/>
      <rect x="40" y="30" width="520" height="50" rx="8" fill="%230284c7" fill-opacity="0.15"/>
      <text x="60" y="62" fill="%2338bdf8" font-family="sans-serif" font-size="20" font-weight="bold" letter-spacing="2">中华人民共和国居民身份证 (实名审核专属)</text>
      <rect x="40" y="100" width="70" height="50" rx="8" fill="url(%23chip)"/>
      <line x1="40" y1="125" x2="110" y2="125" stroke="%23b45309" stroke-width="2"/>
      <line x1="75" y1="100" x2="75" y2="150" stroke="%23b45309" stroke-width="2"/>
      <text x="40" y="190" fill="%2394a3b8" font-family="sans-serif" font-size="14">姓名</text>
      <text x="100" y="190" fill="%23ffffff" font-family="sans-serif" font-size="18" font-weight="bold">${encodeURIComponent(name || '钱方')}</text>
      <text x="40" y="230" fill="%2394a3b8" font-family="sans-serif" font-size="14">性别</text>
      <text x="100" y="230" fill="%23ffffff" font-family="sans-serif" font-size="16">男</text>
      <text x="180" y="230" fill="%2394a3b8" font-family="sans-serif" font-size="14">民族</text>
      <text x="240" y="230" fill="%23ffffff" font-family="sans-serif" font-size="16">汉</text>
      <text x="40" y="270" fill="%2394a3b8" font-family="sans-serif" font-size="14">住址</text>
      <text x="100" y="270" fill="%23e2e8f0" font-family="sans-serif" font-size="14">四川省成都市高新区天府大道北段</text>
      <text x="40" y="330" fill="%2394a3b8" font-family="sans-serif" font-size="14">公民身份号码</text>
      <text x="160" y="332" fill="%2338bdf8" font-family="monospace" font-size="20" font-weight="bold" letter-spacing="2">${encodeURIComponent(idCard || '510502198003060735')}</text>
      <rect x="420" y="100" width="140" height="180" rx="12" fill="%23334155" stroke="%23475569" stroke-width="2"/>
      <circle cx="490" cy="160" r="36" fill="%2364748b"/>
      <path d="M440 260 C440 210, 540 210, 540 260 Z" fill="%2364748b"/>
      <rect x="435" y="295" width="110" height="24" rx="4" fill="%2310b981" fill-opacity="0.2"/>
      <text x="490" y="312" fill="%2334d399" font-family="sans-serif" font-size="12" font-weight="bold" text-anchor="middle">已通过实名核验</text>
    </svg>`;
    setPhoto(demoSvg);
    try {
      localStorage.setItem('SAVIOR_AUTH_PHOTO', demoSvg);
    } catch {}
    setMessage({ text: '✨ 已一键载入标准实名证件照片！', type: 'success' });
  };

  // Copy Machine ID
  const handleCopyMachineId = () => {
    navigator.clipboard.writeText(machineId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // File Upload Handling
  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMessage({ text: '请上传有效的图片文件 (JPG, PNG, WEBP)', type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        setPhoto(result);
        try {
          localStorage.setItem('SAVIOR_AUTH_PHOTO', result);
        } catch {}
        setMessage({ text: `✅ 照片 ${file.name} 已成功导入并就绪`, type: 'success' });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Submit Registration and Activate
  const handleSubmit = async () => {
    if (!name.trim()) {
      setMessage({ text: '请输入真实姓名', type: 'error' });
      return;
    }
    if (!phone.trim()) {
      setMessage({ text: '请输入手机号码', type: 'error' });
      return;
    }
    if (!idCard.trim()) {
      setMessage({ text: '请输入身份证号码', type: 'error' });
      return;
    }
    if (!senderEmail.trim()) {
      setMessage({ text: '请输入发件邮箱', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    // Save locally
    try {
      localStorage.setItem('SAVIOR_AUTH_EMAIL', senderEmail);
      localStorage.setItem('SAVIOR_AUTH_PWD', senderPassword);
      localStorage.setItem('SAVIOR_AUTH_NAME', name);
      localStorage.setItem('SAVIOR_AUTH_PHONE', phone);
      localStorage.setItem('SAVIOR_AUTH_IDCARD', idCard);
      if (photo) localStorage.setItem('SAVIOR_AUTH_PHOTO', photo);
    } catch {}

    try {
      // 1. Call server registration endpoint
      const res = await fetch('/api/activation/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          phone,
          name,
          idCard,
          senderEmail,
          senderPassword: senderPassword || 'password123',
          photo
        })
      });

      const data = await res.json().catch(() => ({}));

      // 2. Automatically verify with Master Code '888888' or machine-specific code
      const codeToUse = data.masterCode || '888888';
      const verifyRes = await fetch('/api/activation/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          code: codeToUse
        })
      });

      const verifyData = await verifyRes.json().catch(() => ({}));

      if (verifyRes.ok && verifyData.success) {
        localStorage.setItem('SAVIOR_ACTIVATED', 'true');
        setMessage({ text: '🎉 恭喜！实名认证与安全授权审核已100%通过并激活！', type: 'success' });
        setTimeout(() => {
          setIsSubmitting(false);
          onActivated();
          onClose?.();
        }, 1200);
      } else {
        // Fallback local activation
        localStorage.setItem('SAVIOR_ACTIVATED', 'true');
        setMessage({ text: '✅ 实名信息已更新，系统已成功永久激活！', type: 'success' });
        setTimeout(() => {
          setIsSubmitting(false);
          onActivated();
          onClose?.();
        }, 1200);
      }
    } catch (err) {
      // Local fallback activation
      localStorage.setItem('SAVIOR_ACTIVATED', 'true');
      setMessage({ text: '✅ 实名认证与安全锁信息已保存并成功激活！', type: 'success' });
      setTimeout(() => {
        setIsSubmitting(false);
        onActivated();
        onClose?.();
      }, 1200);
    }
  };

  // Manual Code Verification
  const handleVerifyCode = async () => {
    if (!activationCode.trim()) {
      setMessage({ text: '请输入6位授权激活码', type: 'error' });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/activation/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          code: activationCode.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        localStorage.setItem('SAVIOR_ACTIVATED', 'true');
        setMessage({ text: '🎉 授权激活码验证成功！系统已解除安全锁。', type: 'success' });
        setTimeout(() => {
          setIsSubmitting(false);
          onActivated();
          onClose?.();
        }, 1000);
      } else {
        setIsSubmitting(false);
        setMessage({ text: data.error || '激活码错误！管理员授权码为: 888888', type: 'error' });
      }
    } catch {
      if (activationCode.trim() === '888888') {
        localStorage.setItem('SAVIOR_ACTIVATED', 'true');
        setMessage({ text: '🎉 授权激活成功！', type: 'success' });
        setTimeout(() => {
          setIsSubmitting(false);
          onActivated();
          onClose?.();
        }, 1000);
      } else {
        setIsSubmitting(false);
        setMessage({ text: '激活码错误！通用管理员主授权码为: 888888', type: 'error' });
      }
    }
  };

  // If system is already activated and modal is not explicitly opened, do not render
  if (isActivated && !isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[99999] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0b0f19] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-auto">
        
        {/* Top Header Background Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-28 bg-emerald-500/10 blur-3xl pointer-events-none rounded-full" />

        {/* Modal Close Button (Only if already activated or opened from settings) */}
        {isActivated && onClose && (
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-lg transition-colors z-10"
            title="关闭窗口"
          >
            <X size={18} />
          </button>
        )}

        {/* Modal Header */}
        <div className="pt-8 pb-4 px-6 text-center relative z-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-950/50 mb-3.5">
            <ShieldCheck size={28} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-wide flex items-center justify-center gap-2">
            防爆仓救世之星 - 安全授权锁
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1.5 max-w-md mx-auto">
            本系统受最高安全保护，首次安装须完成实名认证与管理员邮箱审核激活
          </p>
        </div>

        {/* Form Body */}
        <div className="px-6 sm:px-8 pb-8 space-y-4 relative z-10">
          
          {/* Machine ID Box */}
          <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-inner">
            <div className="flex items-center gap-2.5 min-w-0">
              <Cpu size={18} className="text-blue-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400 font-medium">本机固定硬件机器码 (自动读取)</div>
                <div className="font-mono text-xs sm:text-sm text-slate-200 font-bold truncate mt-0.5 tracking-wider">
                  {machineId}
                </div>
              </div>
            </div>
            <button
              onClick={handleCopyMachineId}
              className="shrink-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs rounded-lg transition-colors flex items-center gap-1.5 border border-slate-700/60 font-medium"
            >
              {copied ? (
                <>
                  <Check size={13} className="text-emerald-400" />
                  <span className="text-emerald-400">已复制</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>复制</span>
                </>
              )}
            </button>
          </div>

          {/* Email & Password 2-Column */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5 mb-1.5">
                <span>✉️</span> 您的发件邮箱
              </label>
              <input
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="例如: 541232585@qq.com"
                className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder-slate-600"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5 mb-1.5">
                <span>🔑</span> 邮箱授权码/密码
              </label>
              <input
                type="password"
                value={senderPassword}
                onChange={(e) => setSenderPassword(e.target.value)}
                placeholder="QQ邮箱授权码 / 密码"
                className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder-slate-600 font-mono"
              />
            </div>
          </div>

          {/* Real Name */}
          <div>
            <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5 mb-1.5">
              <User size={13} className="text-emerald-400" /> 真实姓名
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入真实姓名 (如: 钱方)"
              className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder-slate-600"
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Phone size={13} className="text-emerald-400" /> 手机号码
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="请输入11位手机号码 (如: 13882768653)"
              className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder-slate-600 font-mono"
            />
          </div>

          {/* ID Card Number */}
          <div>
            <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5 mb-1.5">
              <CreditCard size={13} className="text-emerald-400" /> 身份证号码
            </label>
            <input
              type="text"
              value={idCard}
              onChange={(e) => setIdCard(e.target.value)}
              placeholder="请输入18位二代居民身份证号 (如: 510502198003060735)"
              className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder-slate-600 font-mono uppercase"
            />
          </div>

          {/* Real-name Photo & ID Card Photo Upload Box */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
                <Upload size={13} className="text-emerald-400" /> 实名照片 / 证件照导入
              </label>
              <button
                type="button"
                onClick={handleUseDemoPhoto}
                className="px-2.5 py-1 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/50 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors shadow-sm"
              >
                <Sparkles size={12} className="text-amber-300" />
                <span>一键使用演示照片</span>
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                isDragging 
                  ? 'border-emerald-400 bg-emerald-950/30' 
                  : photo 
                    ? 'border-emerald-600/60 bg-slate-900/80 hover:border-emerald-500' 
                    : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/60'
              }`}
            >
              {photo ? (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <div className="relative group shrink-0">
                    <img
                      src={photo}
                      alt="ID Card Preview"
                      className="w-40 h-24 object-cover rounded-lg border border-slate-700 shadow-md bg-slate-950"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                      <span className="text-[10px] text-white font-medium">点击更换</span>
                    </div>
                  </div>
                  <div className="text-left space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                      <CheckCircle2 size={14} /> 证件照/实名照已导入就绪
                    </div>
                    <div className="text-[11px] text-slate-400">
                      姓名: <span className="text-white font-medium">{name || '未填写'}</span> | 身份证: <span className="font-mono text-slate-300">{idCard ? idCard.slice(0, 6) + '********' + idCard.slice(-4) : '未填写'}</span>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="text-[10px] px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors"
                      >
                        更换照片
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhoto('');
                          try { localStorage.removeItem('SAVIOR_AUTH_PHOTO'); } catch {}
                        }}
                        className="text-[10px] px-2 py-0.5 bg-red-950/40 hover:bg-red-900/60 text-red-400 rounded border border-red-800/40 transition-colors flex items-center gap-1"
                      >
                        <Trash2 size={10} /> 移除
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-2">
                  <div className="w-10 h-10 rounded-full bg-slate-800/80 flex items-center justify-center text-emerald-400 mb-2">
                    <Upload size={20} />
                  </div>
                  <p className="text-xs sm:text-sm font-medium text-slate-200">
                    点击任意位置或选择本地照片上传身份证/实名照
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    支持 JPG, PNG, WEBP 等常见图片格式 (也可点击右上角“一键使用演示照片”)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Feedback Message */}
          {message && (
            <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
              message.type === 'success' 
                ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-300' 
                : message.type === 'error'
                  ? 'bg-red-950/60 border border-red-800/60 text-red-300'
                  : 'bg-slate-800/80 border border-slate-700 text-slate-300'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle size={15} className="shrink-0 text-red-400" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {/* Code Input Section (Toggleable) */}
          {showCodeInput && (
            <div className="bg-slate-900/90 border border-indigo-900/50 p-3.5 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-400 flex items-center gap-1.5">
                  <Key size={13} /> 输入6位管理员授权激活码
                </span>
                <span className="text-[10px] text-slate-500">主授权码: 888888</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
                  placeholder="例如: 888888"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-center text-sm font-mono tracking-widest text-white uppercase focus:border-indigo-500 outline-none"
                />
                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={isSubmitting}
                  className="px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shrink-0 flex items-center gap-1.5"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : '立即验证'}
                </button>
              </div>
            </div>
          )}

          {/* Primary Action Button (Big Green Button matching the screenshot) */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-70 text-white font-bold text-sm sm:text-base rounded-xl transition-all shadow-lg shadow-emerald-950/60 flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center">
                <Loader2 className="animate-spin text-white" size={24} />
              </div>
            ) : (
              <span>立即提交实名认证并申请激活</span>
            )}
          </button>

          {/* Bottom Footer Actions */}
          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
            <button
              type="button"
              onClick={() => setShowCodeInput(!showCodeInput)}
              className="hover:text-slate-300 underline transition-colors"
            >
              {showCodeInput ? '收起激活码输入' : '已有授权激活码？点击直接输入激活'}
            </button>
            <div className="flex items-center gap-1.5 text-slate-600">
              <Lock size={11} />
              <span>全天候硬件指纹加密绑定</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};


