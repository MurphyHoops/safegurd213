import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { systemHealthGuard } from '../guards/SystemHealthGuard';
import { binanceRateLimiter } from '../../../services/binanceRateLimiter';

// 扩展 Axios 配置接口，支持 isCoreOrder 字段
declare module 'axios' {
  export interface AxiosRequestConfig {
    isCoreOrder?: boolean;
  }
}

const baseURL = process.env.BINANCE_BASE_URL || 'https://fapi.binance.com';

export const binanceAxios: AxiosInstance = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

binanceAxios.interceptors.request.use((config) => {
  if (process.env.BINANCE_API_KEY) {
    config.headers['X-MBX-APIKEY'] = process.env.BINANCE_API_KEY;
  }

  // 🛡️ [第一防护：出站门禁拦截] 
  // 核心订单 (isCoreOrder = true 及下单/杠杆/保证金模式调整) 允许在权重高时放行，但熔断期一律物理阻断
  const url = config.url || '';
  const isCoreOrder = Boolean(config.isCoreOrder) ||
    url.includes('/order') ||
    url.includes('/batchOrders') ||
    url.includes('/leverage') ||
    url.includes('/marginType') ||
    url.includes('/positionSide');

  try {
    binanceRateLimiter.checkCanRequest(isCoreOrder);
  } catch (err: any) {
    return Promise.reject({
      isHandledIpError: true,
      isCircuitBreakerFrozen: true,
      message: err.message || '【全局熔断拦截】处于 429/418 熔断静默期，已直接本地拦截发包！'
    });
  }

  if (systemHealthGuard.isSystemLocked()) {
    const isListenKeyProbe = config.url?.includes('/fapi/v1/listenKey') && config.method?.toUpperCase() === 'POST';
    const isTimeProbe = config.url?.includes('/fapi/v1/time');
    if (!isListenKeyProbe && !isTimeProbe) {
      return Promise.reject({
        isHandledIpError: true,
        message: '【受控挂起】系统处于锁定保护中，阻断交易指令与无效续期，防 429 封禁'
      });
    }
  }
  return config;
});

binanceAxios.interceptors.response.use(
  (response) => {
    binanceRateLimiter.handleResponse(response.status, response.headers);
    return response;
  },
  async (error) => {
    if (error.response) {
      binanceRateLimiter.handleResponse(
        error.response.status,
        error.response.headers,
        typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data || {})
      );
    }

    const resData = error.response?.data;
    const is2015 = resData?.code === -2015 || (typeof resData?.msg === 'string' && resData.msg.includes('Invalid API-key'));

    if (is2015) {
      const publicIp = await systemHealthGuard.detectPublicIpWithProxy();
      systemHealthGuard.triggerIpDrift(
        publicIp || '未知',
        `币安 API 拒接 (-2015): ${resData?.msg || 'IP未在白名单中'}`
      );

      const customError: any = new Error(`[IP_DRIFT_LOCK] ${resData?.msg || '币安拒绝访问：IP未加白名单'}`);
      customError.isHandledIpError = true;
      customError.code = -2015;
      return Promise.reject(customError);
    }

    if (error.code === 'ECONNABORTED' || (error.response && error.response.status >= 500)) {
      systemHealthGuard.triggerExchangeOutage(`币安通信异常 (${error.code || error.response?.status})`);
      const outageError: any = new Error('[EXCHANGE_OUTAGE] 交易所连接超时/服务器崩溃');
      outageError.isHandledIpError = true;
      return Promise.reject(outageError);
    }

    return Promise.reject(error);
  }
);

