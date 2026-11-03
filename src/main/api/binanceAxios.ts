import axios, { AxiosInstance } from 'axios';
import { systemHealthGuard } from '../guards/SystemHealthGuard';

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

  // 核心修正：锁定期间仅放行用于恢复探针的 POST 请求，严格阻断定时的 PUT 续期请求防 429
  if (systemHealthGuard.isSystemLocked()) {
    const isListenKeyProbe = config.url?.includes('/fapi/v1/listenKey') && config.method?.toUpperCase() === 'POST';
    if (!isListenKeyProbe) {
      return Promise.reject({
        isHandledIpError: true,
        message: '【受控挂起】系统处于锁定保护中，阻断交易指令与无效续期，防 429 封禁'
      });
    }
  }
  return config;
});

binanceAxios.interceptors.response.use(
  (response) => response,
  async (error) => {
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
