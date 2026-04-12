
import React, { useState } from 'react';
import { X, BookOpen, Shield, Target, Zap, Activity, HelpCircle, AlertTriangle, Layers, Repeat, MousePointer2, Cpu, Anchor, GitMerge } from 'lucide-react';

interface Props {
  onClose: () => void;
}

const UserManualModal: React.FC<Props> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState('PHILOSOPHY');

  const TABS = [
    { id: 'PHILOSOPHY', label: '0. 核心哲学', icon: Cpu },
    { id: 'START', label: '1. 快速入门', icon: MousePointer2 },
    { id: 'HEDGE', label: '2. 防爆对冲 (核心)', icon: Shield },
    { id: 'RESCUE', label: '3. 盈利解套 (进阶)', icon: Target },
    { id: 'MARTIN', label: '4. 智能马丁', icon: Repeat },
    { id: 'FAQ', label: '5. 常见问题', icon: HelpCircle },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-lg shadow-indigo-900/50">
              <BookOpen size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">救世之星操作指南 (Operational Manual)</h2>
              <p className="text-xs text-slate-500">Ultimate Risk Control System v12.25</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-48 bg-slate-900 border-r border-slate-800 flex flex-col py-4 overflow-y-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-4 py-3 text-xs font-bold transition-all border-l-2 ${
                    activeTab === tab.id
                      ? 'bg-indigo-900/20 text-indigo-400 border-indigo-500'
                      : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Content Area */}
          <div className="flex-1 bg-slate-950/50 p-6 overflow-y-auto custom-scrollbar text-slate-300">
            
            {/* TAB 0: PHILOSOPHY (New) */}
            {activeTab === 'PHILOSOPHY' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="border-b border-slate-800 pb-4">
                  <h3 className="text-xl font-bold text-white mb-2 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                    系统核心哲学: 从绝对防守到主动出击
                  </h3>
                  <p className="text-sm text-slate-400 font-mono">
                    System Philosophy: From Absolute Defense to Active Strike
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-6">
                    {/* 1. Physics of Price */}
                    <div className="bg-slate-900 p-5 rounded border border-slate-800 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5">
                            <Activity size={100} />
                        </div>
                        <h4 className="text-indigo-400 font-bold text-base mb-3 flex items-center gap-2">
                            <Shield size={18} /> 1. 价格行为物理学 (The Physics of Price Action)
                        </h4>
                        <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
                            <p>
                                绝大多数交易系统关注“收盘价”(Close)，但收盘价只是时间切片的人为结果，容易被主力做盘欺骗。本系统核心算法（List 4 动能审计）严格锁定 K 线的 <b>物理边界 (High/Low)</b>。
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                <div className="bg-slate-950/50 p-3 rounded border border-slate-800">
                                    <span className="text-emerald-400 font-bold block mb-1 flex items-center gap-1"><Anchor size={12}/> 绝对防守 (Midline Defense)</span>
                                    <p className="text-xs text-slate-400">
                                        锚定信号 K 线的极值（多头看顶 High，空头看底 Low）。我们允许价格像呼吸一样回撤一定比例（基于振幅计算），但绝不允许“踩漏”关键物理支撑。一旦跌破防守线，立即判定结构破坏 (INVALID)。
                                    </p>
                                </div>
                                <div className="bg-slate-950/50 p-3 rounded border border-slate-800">
                                    <span className="text-amber-400 font-bold block mb-1 flex items-center gap-1"><Zap size={12}/> 主动出击 (Active Strike)</span>
                                    <p className="text-xs text-slate-400">
                                        仅仅不破位是不够的。我们要求价格必须<b>突破</b>信号 K 线的极值（Breakout），形成“离弦之箭”的动能，才确认为有效触发 (TRIGGERED) 并执行开仓。
                                    </p>
                                </div>
                            </div>
                            <div className="bg-indigo-900/20 p-2 rounded text-xs text-indigo-300 mt-2 border-l-2 border-indigo-500">
                                <b>结论：</b> 我们不贪图买在最低点，也不空在最高点。我们只在“趋势确认”且“结构完整”的瞬间进场，通过牺牲极小的点位来换取极高的确定性。
                            </div>
                        </div>
                    </div>

                    {/* 2. Explosion-proof Logic */}
                    <div className="bg-slate-900 p-5 rounded border border-slate-800">
                        <h4 className="text-emerald-400 font-bold text-base mb-3 flex items-center gap-2">
                            <Layers size={18} /> 2. 防爆仓救世逻辑 (The Savior Logic)
                        </h4>
                        <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
                            <p>
                                交易最大的敌人是“归零”。只要活着，就有机会。
                            </p>
                            <p>
                                <b>对冲 (Hedging)</b> 是本系统的核心盾牌。当行情判断错误时，系统不进行传统的割肉止损（因为割肉会损耗本金），而是建立反向仓位“锁住亏损”。
                            </p>
                            <p>
                                随后，利用 <b>解套策略 (Module 4)</b> —— 无论是通过“富豪救子”（顺势覆盖），还是“蚂蚁搬家”（震荡收割），将亏损的时间转化为利润的空间。这不仅仅是风控，更是一种转败为胜的战术。
                            </p>
                        </div>
                    </div>

                    {/* 3. Parallel Processing (New) */}
                    <div className="bg-slate-900 p-5 rounded border border-slate-800 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5">
                            <GitMerge size={100} />
                        </div>
                        <h4 className="text-blue-400 font-bold text-base mb-3 flex items-center gap-2">
                            <Cpu size={18} /> 3. 平行时空独立计算 (Parallel Processing)
                        </h4>
                        <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
                            <p>
                                人类交易员常因“大周期看跌、小周期看涨”而纠结，导致操作变形。本系统采用 <b>多线程独立审计</b> 机制。
                            </p>
                            <p>
                                对于系统而言，<code>BTC-15m-Long</code> 和 <code>BTC-4h-Short</code> 是两个完全独立的任务进程，拥有各自唯一的“身份证 ID”。系统绝不会混淆，而是利用这种 <b>多空并存</b> 的特性，构建完美的战术组合：
                            </p>
                            <ul className="list-disc list-inside pl-2 space-y-1 text-xs text-slate-400">
                                <li>在大周期的空头趋势中（持空单），精准捕捉小周期的反弹（开多单）。</li>
                                <li>利用小周期多单的利润，来抵消空单的持仓成本或浮亏（对冲）。</li>
                                <li>当多空信号同时触发时，系统自动进入“双向持仓”模式，将单边赌博转化为波动率套利。</li>
                            </ul>
                        </div>
                    </div>
                </div>
              </div>
            )}

            {/* TAB 1: QUICK START */}
            {activeTab === 'START' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="bg-gradient-to-r from-indigo-900/40 to-slate-900 p-4 rounded-lg border border-indigo-500/30">
                  <h3 className="text-lg font-bold text-white mb-2">欢迎来到“防爆仓救世之星”</h3>
                  <p className="text-sm leading-relaxed">
                    这是一个集成了<b>全自动风控、模拟演练、策略回测</b>的交易系统。即使你是小白，也可以通过这里的模拟功能，无风险地体验顶级交易员的操盘策略。
                  </p>
                </div>

                <div>
                  <h4 className="text-white font-bold mb-3 flex items-center gap-2"><Zap size={16} className="text-yellow-400"/> 第一步：启动系统</h4>
                  <ul className="space-y-2 text-sm list-decimal list-inside bg-slate-900 p-4 rounded border border-slate-800">
                    <li>点击右上角的 <b><Activity size={12} className="inline"/> 运行中/已暂停</b> 按钮，确保系统处于运行状态。</li>
                    <li>确保 <b>模块 1. 智能监控</b> 已开启（听到语音提示即为正常）。</li>
                  </ul>
                </div>

                <div>
                  <h4 className="text-white font-bold mb-3 flex items-center gap-2"><Layers size={16} className="text-blue-400"/> 第二步：模拟开仓 (体验功能)</h4>
                  <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-3 text-sm">
                    <p>在左侧设置面板找到 <b>模块 6. 模拟开仓</b>：</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-slate-800/50 p-3 rounded">
                        <span className="text-emerald-400 font-bold block mb-1">方法 A：批量随机</span>
                        点击“执行模拟开仓”，系统会从全市场筛选热门币种，自动帮你开出多单或空单。
                      </div>
                      <div className="bg-slate-800/50 p-3 rounded">
                        <span className="text-cyan-400 font-bold block mb-1">方法 B：智能扫描</span>
                        点击 <b>模块 5</b> 中的“打开智能扫描器”，系统会自动分析市场，你可以点击扫描结果后的“开仓”按钮。
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-900/20 p-4 rounded border border-amber-500/30">
                  <h4 className="text-amber-400 font-bold text-sm mb-1 flex items-center gap-2"><AlertTriangle size={14}/> 注意事项</h4>
                  <p className="text-xs text-amber-200/80">
                    当前默认为<b>模拟模式</b>。在未配置 Binance API Key 之前，所有资金和交易均为虚拟演练，请放心大胆地测试各种极端行情下的策略表现。
                  </p>
                </div>
              </div>
            )}

            {/* TAB 2: HEDGING */}
            {activeTab === 'HEDGE' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="border-b border-slate-800 pb-4">
                  <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Shield className="text-indigo-400"/> 模块 3：防爆对冲 (你的绝对防线)
                  </h3>
                  <p className="text-sm text-slate-400">
                    当你看错方向，亏损越来越大时，传统做法是“割肉止损”。但本系统采用“对冲锁仓”——<b>不割肉，而是反向开单锁住亏损</b>，等待反转机会。
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="bg-slate-900 p-4 rounded border border-slate-800">
                    <h4 className="font-bold text-indigo-300 mb-2 text-sm">触发机制</h4>
                    <ul className="text-sm space-y-2 text-slate-400">
                      <li className="flex justify-between">
                        <span>亏损触发值:</span>
                        <span className="text-white">默认 -1%</span>
                      </li>
                      <li className="flex justify-between">
                        <span>持仓门槛:</span>
                        <span className="text-white">默认 1000 U</span>
                      </li>
                      <p className="pt-2 text-xs text-slate-500 bg-slate-950 p-2 rounded">
                        解释：当你有一个 1000U 以上的仓位，亏损达到 1% 时，系统会自动帮你开一个<b>反方向</b>的单子（对冲单），防止亏损继续扩大。
                      </p>
                    </ul>
                  </div>

                  <div className="bg-slate-900 p-4 rounded border border-slate-800">
                    <h4 className="font-bold text-orange-400 mb-2 text-sm flex items-center gap-2">
                      <Activity size={14}/> 5. 震荡磨损保护 (熔断机制)
                    </h4>
                    <p className="text-sm text-slate-400 mb-2">
                      如果在震荡行情中，价格上下乱窜，频繁触发对冲会产生高手续费（磨损）。
                    </p>
                    <div className="text-xs bg-orange-900/10 text-orange-200 p-2 rounded border border-orange-500/20">
                      <b>工作原理：</b> 如果连续对冲失败（被打止损）超过 <b>3次</b>（可设置），系统会<b>熔断</b>，暂停该币种的对冲功能，防止反复左右打脸。
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: RESCUE STRATEGIES */}
            {activeTab === 'RESCUE' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="border-b border-slate-800 pb-4">
                  <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Target className="text-red-400"/> 模块 4：盈利出局 (转败为胜)
                  </h3>
                  <p className="text-sm text-slate-400">
                    对冲只是“止血”，模块 4 才是“回血”。系统提供了三种策略，自动判断行情来帮你解套。
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="bg-blue-900/10 border border-blue-500/30 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-blue-400 text-sm">4.1 原仓盈利解套 (V型反转)</h4>
                      <span className="text-[10px] bg-blue-900 px-2 py-0.5 rounded text-white">富豪救子</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      <b>场景：</b> 行情只是假突破，马上又回到了你原本看对的方向。<br/>
                      <b>逻辑：</b> 原仓位（富豪）赚的钱，足以覆盖对冲单（败家子）的亏损，并多赚一部分时，系统自动把两个单子都平掉，落袋为安。
                    </p>
                  </div>

                  <div className="bg-indigo-900/10 border border-indigo-500/30 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-indigo-400 text-sm">4.2 对冲盈利解套 (顺势爆发)</h4>
                      <span className="text-[10px] bg-indigo-900 px-2 py-0.5 rounded text-white">将错就错</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      <b>场景：</b> 行情彻底反转了，一去不回头。<br/>
                      <b>逻辑：</b> 对冲单（现在变成了顺势单）赚的钱，足以覆盖原仓位（死扛单）的亏损，并多赚一部分时，系统全平。
                    </p>
                  </div>

                  <div className="bg-amber-900/10 border border-amber-500/30 p-4 rounded-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-2 opacity-10">
                        <Target size={64}/>
                    </div>
                    <div className="flex items-center justify-between mb-2 relative z-10">
                      <h4 className="font-bold text-amber-400 text-sm">4.3 回调盈利清仓 (滚动收割)</h4>
                      <span className="text-[10px] bg-amber-900 px-2 py-0.5 rounded text-white">蚂蚁搬家</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed relative z-10">
                      <b>场景：</b> 行情震荡上行或下行，不是直线运动。<br/>
                      <b>逻辑：</b> 
                      1. 对冲单赚钱了，先平掉赚钱的部分（攒子弹）。<br/>
                      2. 等行情回调，再开对冲单。<br/>
                      3. 反复操作，用攒下的“子弹”慢慢填平原仓位的亏损，直到整体盈利出局。<br/>
                      <span className="text-amber-500 mt-1 block font-bold">* 这是最强大的策略，适合绝大多数行情。</span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: MARTINGALE */}
            {activeTab === 'MARTIN' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="border-b border-slate-800 pb-4">
                  <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Repeat className="text-pink-400"/> 模块 7：智能马丁 (主动出击)
                  </h3>
                  <p className="text-sm text-slate-400">
                    马丁策略 (Martingale) 是一种“越跌越买”的策略，用于拉低持仓均价。
                  </p>
                </div>

                <div className="bg-slate-900 p-5 rounded border border-slate-800">
                  <h4 className="font-bold text-pink-400 mb-3 text-sm">操作步骤</h4>
                  <ol className="list-decimal list-inside space-y-3 text-sm text-slate-300">
                    <li>
                      <b>开启开关：</b> 在左侧菜单点击 <b>模块 7. 智能马丁</b>。
                    </li>
                    <li>
                      <b>点击运行：</b> 点击“运行状态”按钮，使其变为绿色 <span className="text-emerald-400">Running</span>。
                    </li>
                    <li>
                      <b>设置参数：</b>
                      <ul className="list-disc list-inside pl-4 mt-1 text-xs text-slate-500 space-y-1">
                        <li><b>补仓跌幅：</b> 跌多少加仓？（默认 1%）</li>
                        <li><b>补仓倍数：</b> 每次加多少？（默认 1.5倍，即 100 &rarr; 150 &rarr; 225...）</li>
                        <li><b>最大次数：</b> 防止无限加仓爆仓（默认 5次）。</li>
                      </ul>
                    </li>
                  </ol>
                  <div className="mt-4 p-3 bg-red-900/20 border border-red-500/20 rounded text-xs text-red-300">
                    ⚠️ <b>风险提示：</b> 马丁策略属于高风险策略。如果行情单边下跌不回头，可能会导致仓位过重。建议配合 <b>模块 2 止损</b> 或 <b>模块 3 对冲</b> 一起使用。
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: FAQ */}
            {activeTab === 'FAQ' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <h3 className="text-lg font-bold text-white mb-4">常见问题解答</h3>
                
                <div className="space-y-4">
                  <div className="bg-slate-900 p-4 rounded border border-slate-800">
                    <h4 className="font-bold text-white text-sm mb-1">Q: 这个软件真的能赚钱吗？</h4>
                    <p className="text-xs text-slate-400">
                      A: 软件只是工具（武器），能赋予你强大的风控能力和执行力。但能否赚钱取决于使用者的策略设置。本系统核心价值在于<b>“活着”</b>——只要不爆仓，就永远有机会回本。
                    </p>
                  </div>

                  <div className="bg-slate-900 p-4 rounded border border-slate-800">
                    <h4 className="font-bold text-white text-sm mb-1">Q: 为什么对冲单开了之后，马上又平了？</h4>
                    <p className="text-xs text-slate-400">
                      A: 这可能是触发了 <b>4.4 熔断保护</b> 或者 <b>止盈/止损</b>。请检查日志（Logs），系统会详细记录每一笔操作的原因（如 "Strategy 4.2", "Fuse Triggered" 等）。
                    </p>
                  </div>

                  <div className="bg-slate-900 p-4 rounded border border-slate-800">
                    <h4 className="font-bold text-white text-sm mb-1">Q: 模拟盘和实盘有什么区别？</h4>
                    <p className="text-xs text-slate-400">
                      A: 逻辑完全一致。模拟盘使用的是实时的市场价格（Ticker），但资金是虚拟的。实盘需要您在 <b>模块 8. 系统设置</b> 中填入 Binance API Key。建议先在模拟盘跑通策略，盈利稳定后再上实盘。
                    </p>
                  </div>

                  <div className="bg-slate-900 p-4 rounded border border-slate-800">
                    <h4 className="font-bold text-white text-sm mb-1">Q: 页面关闭了，策略还会运行吗？</h4>
                    <p className="text-xs text-slate-400">
                      A: <b>不会。</b> 本系统是运行在浏览器端的。您必须保持网页开启。建议点击顶部的 <b>“屏幕常亮”</b> 和 <b>“后台保活”</b> 按钮，防止手机锁屏导致系统休眠。
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default UserManualModal;
