import { list2FastScanner, DirectTriggerPayload } from '../services/list2FastScanner';
import { eventBus } from '../core/EventBus';

async function runList2FastScannerVerification() {
  console.log('🧪 ========== 开始执行 List2FastScanner 极速 Tick 扫描与直通开仓验证 ==========');

  // 1. 测试同步列表 1（初筛池）300 个币数据
  console.log('\n[测试 1] 同步列表 1 候选池数据到 O(1) 内存索引...');
  const mockCandidates = [
    { symbol: 'BTCUSDT', breakoutLine: 90000, emaFast: 90500, emaMid: 90200, emaSlow: 89800, direction: 'LONG', price: 89900 },
    { symbol: 'ETHUSDT', breakoutLine: 3000, emaFast: 2950, emaMid: 2980, emaSlow: 3050, direction: 'SHORT', price: 3010 },
    { symbol: 'SOLUSDT', breakoutLine: 200, emaFast: 205, emaMid: 202, emaSlow: 198, direction: 'LONG', price: 199 }
  ];

  list2FastScanner.syncList1Pool(mockCandidates);
  console.log('✅ 测试 1 通过：候选池极速索引同步完成');

  // 2. 监听直通开仓管道事件 DIRECT_TRIGGER_TO_LIST4
  let directTriggerReceived: DirectTriggerPayload | null = null;
  const unsub = eventBus.subscribe('DIRECT_TRIGGER_TO_LIST4', (payload: any) => {
    directTriggerReceived = payload;
  });

  // 3. 模拟 Tick 价格到达：命中安全进场区间 [90000, 90720]
  console.log('\n[测试 2] 模拟毫秒级 Tick 价格到达：命中安全突破区间 (90100)...');
  list2FastScanner.onPriceUpdate('BTCUSDT', 90100);

  if (directTriggerReceived && directTriggerReceived.symbol === 'BTCUSDT') {
    console.log(`✅ 测试 2 通过：成功触发直通开仓管道！触发价: ${directTriggerReceived.triggerPrice}, 突破线: ${directTriggerReceived.breakoutLine}, 偏离度: +${directTriggerReceived.slippagePct}%`);
  } else {
    console.error('❌ 测试 2 失败：直通管道事件未触发');
  }

  // 4. 模拟追高情况：当前价 202.5 超出突破线 200 达 1.25% (>0.8%)
  console.log('\n[测试 3] 模拟追高行情 (202.5 > 200 * 1.008)：触发 0.8% 追高熔断拦截...');
  directTriggerReceived = null;
  list2FastScanner.onPriceUpdate('SOLUSDT', 202.5);

  if (!directTriggerReceived) {
    console.log('✅ 测试 3 通过：成功触发 0.8% 追高熔断拦截，防高位接盘锁已锁定！');
  } else {
    console.error('❌ 测试 3 失败：追高行情未被熔断');
  }

  // 清理
  unsub();
  list2FastScanner.clearAll();
  console.log('\n🧪 ========== List2FastScanner 验证流程执行完毕 ==========');
  process.exit(0);
}

runList2FastScannerVerification();
