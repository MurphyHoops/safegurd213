import { binanceAxios } from '../src/main/api/binanceAxios';

/**
 * 核心交易执行层：按业务优先级注入 isCoreOrder 标记
 */
export class OrderExecutionService {
  /**
   * 🚨 1. 紧急平仓 / 止损 / 救世平仓指令（最高优先级风控）
   * 必须附带 isCoreOrder: true
   */
  public static async closePositionEmergency(symbol: string, quantity: number, side: 'BUY' | 'SELL') {
    console.log(`⚡ [风控通道] 发起紧急平仓指令: ${symbol} ${side} ${quantity}`);
    return await binanceAxios.post(
      '/fapi/v1/order',
      null,
      {
        params: {
          symbol,
          side,
          type: 'MARKET',
          quantity,
          reduceOnly: 'true',
          timestamp: Date.now()
        },
        isCoreOrder: true // ⭐️ 核心特权标记：权重 ≥80% 时强制放行，优先保障账户安全
      }
    );
  }

  /**
   * 🛡️ 2. 防爆仓对冲加仓 / 动态对冲锁仓（救世策略 Strategy 2/4）
   * 必须附带 isCoreOrder: true
   */
  public static async placeHedgeOrder(symbol: string, quantity: number, side: 'BUY' | 'SELL') {
    console.log(`🛡️ [对冲通道] 发起救世防爆仓锁仓指令: ${symbol} ${side} ${quantity}`);
    return await binanceAxios.post(
      '/fapi/v1/order',
      null,
      {
        params: {
          symbol,
          side,
          type: 'MARKET',
          quantity,
          timestamp: Date.now()
        },
        isCoreOrder: true // ⭐️ 核心特权标记
      }
    );
  }

  /**
   * 📈 3. 阶梯止盈挂单 / 条件平仓单
   * 必须附带 isCoreOrder: true
   */
  public static async placeTakeProfitOrder(symbol: string, quantity: number, price: number, side: 'BUY' | 'SELL') {
    return await binanceAxios.post(
      '/fapi/v1/order',
      null,
      {
        params: {
          symbol,
          side,
          type: 'LIMIT',
          timeInForce: 'GTC',
          price,
          quantity,
          reduceOnly: 'true',
          timestamp: Date.now()
        },
        isCoreOrder: true // ⭐️ 核心特权标记
      }
    );
  }

  /**
   * 🔍 4. 常规行情查询或定时轮询（非核心任务）
   * 默认不传或设为 false，权重超标时自动推迟
   */
  public static async fetchNonCoreMarketData(symbol: string) {
    return await binanceAxios.get('/fapi/v1/klines', {
      params: { symbol, interval: '1m', limit: 10 },
      isCoreOrder: false // 普通请求，权重超 80% 时自动被拦截排队
    });
  }
}
