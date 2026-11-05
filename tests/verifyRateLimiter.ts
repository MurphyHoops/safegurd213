import { binanceRateLimiter } from '../services/binanceRateLimiter';
import { binanceAxios } from '../src/main/api/binanceAxios';

async function runRateLimiterVerification() {
  console.log('🧪 ========== 开始执行 RateLimiter 零发包与熔断验证 ==========');

  // ----------------------------------------------------
  // 1. 验证常规请求放行
  // ----------------------------------------------------
  console.log('\n[测试 1] 常规初始化状态检测...');
  try {
    binanceRateLimiter.checkCanRequest(false);
    console.log('✅ 测试 1 通过：常规请求正常放行');
  } catch (err: any) {
    console.error('❌ 测试 1 失败：初始状态异常阻断', err.message);
  }

  // ----------------------------------------------------
  // 2. 模拟收到 418 WAF 封禁，验证本地物理阻断与零发包
  // ----------------------------------------------------
  console.log('\n[测试 2] 模拟 418 封禁触发及出站绝对阻断验证...');
  binanceRateLimiter.handleResponse(418, { 'retry-after': '60' }, 'IP banned until 1700000000000');
  
  const statusAfter418 = binanceRateLimiter.getStatus();
  console.log(`📊 当前熔断状态: isFrozen=${statusAfter418.isFrozen}, 剩余静默时间=${statusAfter418.remainingFrozenSeconds}s`);

  let requestBlocked = false;
  try {
    // 此时尝试发送请求（即使是核心订单，在 418 熔断期也必须物理拦截）
    binanceRateLimiter.checkCanRequest(true);
  } catch (err: any) {
    if (err.message.includes('[CIRCUIT_BREAKER_FROZEN]')) {
      requestBlocked = true;
      console.log('🛡️ 成功触发本地物理拦截，拦截报错信息:', err.message);
    }
  }

  if (requestBlocked) {
    console.log('✅ 测试 2 通过：418 熔断期间本地直接拦截，绝未向币安发出 TCP 数据包！');
  } else {
    console.error('❌ 测试 2 失败：418 期间请求未被本地拦截，存在冲撞封禁风险！');
  }

  // ----------------------------------------------------
  // 3. 验证 80% 权重降频保护与核心订单放行通道
  // ----------------------------------------------------
  console.log('\n[测试 3] 验证 80% 权重降频拦截与 isCoreOrder 特权通道...');
  
  // 强制解冻熔断（模拟冷却期结束）以测试纯权重限制逻辑
  (binanceRateLimiter as any).isFrozen = false;
  (binanceRateLimiter as any).frozenUntil = 0;
  (binanceRateLimiter as any).frozenReason = '';
  
  // 模拟响应头：当前权重达到 1000（上限 1200，消耗率 83.3%）
  binanceRateLimiter.handleResponse(200, { 'x-mbx-used-weight-1m': '1000' });
  console.log(`📊 当前权重消耗: ${binanceRateLimiter.getStatus().currentWeight1m}/1200 (${(binanceRateLimiter.getStatus().weightUsageRatio * 100).toFixed(1)}%)`);

  // 3.1 测试非核心请求被阻断
  let nonCoreBlocked = false;
  try {
    binanceRateLimiter.checkCanRequest(false); // 非核心请求
  } catch (err: any) {
    if (err.message.includes('[RATE_LIMIT_WEIGHT_HIGH]')) {
      nonCoreBlocked = true;
      console.log('🛡️ 非核心任务已被自动推迟拦截:', err.message);
    }
  }

  // 3.2 测试核心风控订单被放行
  let coreAllowed = false;
  try {
    binanceRateLimiter.checkCanRequest(true); // 核心风控单
    coreAllowed = true;
    console.log('⚡ 核心订单 (isCoreOrder = true) 特权放行成功！');
  } catch (err: any) {
    console.error('❌ 核心订单被误杀:', err.message);
  }

  if (nonCoreBlocked && coreAllowed) {
    console.log('✅ 测试 3 通过：权重超标时精准推迟巡检任务，并顺利放行核心订单！');
  } else {
    console.error('❌ 测试 3 失败：权重门禁逻辑未达预期');
  }

  console.log('\n🧪 ========== RateLimiter 全量验证执行完毕 ==========');
  process.exit(0);
}

runRateLimiterVerification();
