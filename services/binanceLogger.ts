// @LOCKED: 币安全域请求与响应中文审计日志服务 (Binance Logger & Chinese Translator)
/**
 * 🔒 LOCKED_MODULE: services/binanceLogger.ts
 * 
 * 责任范围：
 * 1. 拦截与格式化所有向币安发送的手动与自动请求（开仓、平仓、对冲、补仓、砍仓、复开、批量平仓、资产同步、穿透核验、流水查询、订单反查、资金划转、数据流申请）。
 * 2. 拦截与格式化所有币安反馈接收的信息（订单撮合回执、订单拒绝错误码、账户同步回执、WebSocket实时推送更新）。
 * 3. 全量专业中文翻译：币种中文名称、买卖方向、仓位方向、订单状态、错误码解析与交易参数。
 * 4. 毫秒级零延迟推送到【系统日志】（System Logs），确保当前持仓页面的系统日志全面完整透明呈现。
 */

import { formatCoinWithChinese, getCoinChineseName } from './coinNames';
import { LogCategory, LogEntry } from '../types';

export type LogType = 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER';

export type LogSinkFn = (type: LogType, message: string, immediate?: boolean, extraMeta?: Partial<LogEntry>) => void;

let activeLogSink: LogSinkFn | null = null;
const pendingLogQueue: Array<{ type: LogType; message: string; immediate?: boolean; extraMeta?: Partial<LogEntry> }> = [];

/**
 * 注册系统日志下沉函数（由 App.tsx handleLog 挂载）
 */
export function setBinanceLogSink(sink: LogSinkFn): void {
    activeLogSink = sink;
    // 刷新挂载前的积压日志
    while (pendingLogQueue.length > 0) {
        const item = pendingLogQueue.shift();
        if (item) {
            sink(item.type, item.message, item.immediate, item.extraMeta);
        }
    }
}

/**
 * 分发日志到系统日志面板
 */
export function emitBinanceLog(type: LogType, message: string, immediate = true, extraMeta?: Partial<LogEntry>): void {
    if (activeLogSink) {
        activeLogSink(type, message, immediate, extraMeta);
    } else {
        pendingLogQueue.push({ type, message, immediate, extraMeta });
        // 最多暂存 200 条待下沉日志
        if (pendingLogQueue.length > 200) pendingLogQueue.shift();
    }
}

/**
 * 币安原生错误码全量中文翻译字典 (权威完整版)
 */
export const BINANCE_ERROR_CODE_MAP: Record<number | string, string> = {
    // 通用服务器与网络错误
    '-1000': '币安服务器内部未知异常，通常为币安节点短时抖动',
    '-1001': '币安系统当前繁忙，订单处理排队中',
    '-1002': '未经授权的操作，API Key 未生效或权限配置不正确',
    '-1003': 'API 访问频次超出限制 (IP限频/封禁)，系统已自动开启请求退避降频保护',
    '-1004': '时间戳格式错误或超出允许区间',
    '-1006': '币安响应解析异常，返回了非标准数据',
    '-1007': '向币安服务器发送的请求超时',
    '-1008': '币安服务器当前资源繁忙，请稍后重试',
    '-1010': 'API Key 格式错误',
    '-1011': 'API Key 已失效或已被币安注销',
    '-1013': '下单参数不符合交易所规则 (LOT_SIZE 数量精度不符合步进或未达到 MIN_NOTIONAL 最低名义金额限制)',
    '-1014': '该交易对不支持指定的订单类型',
    '-1015': '高频下单限流，单位时间内向币安发起的订单过多',
    '-1016': '币安合约交易引擎维护中，暂时停止接单',
    '-1017': '订单状态无效，无法继续操作',
    '-1020': '币安系统不支持当前接口操作',
    '-1021': '客户端时钟与币安服务器不同步 (时间戳偏移超出 recvWindow 容忍窗口)，系统已自动对齐时间戳',
    '-1022': '签名鉴权失败，请仔细核对币安 API Secret 密钥是否输入错误或存在多余空格',
    '-1023': '起始时间晚于结束时间',

    // 参数校验与格式错误
    '-1100': '请求参数非法，包含非法字符或空参数',
    '-1101': '发送的参数过多，超出接口规格',
    '-1102': '缺少必填参数，未提供完整下单数据',
    '-1105': '请求体内容为空',
    '-1111': '精度不匹配，下单数量或价格的小数位超出了币安该币种规则限制',
    '-1112': '订单参数缺少必要约束条件',
    '-1114': '时间戳参数超出合理时间范围',
    '-1115': '订单类型无效 (orderType 无效)',
    '-1116': '订单买卖方向无效 (side 无效)',
    '-1117': '订单有效方式 (timeInForce) 无效',
    '-1121': '交易对代码无效，该币种可能在币安未上线永续合约或已被下架',
    '-1128': '参数组合冲突，例如同时设置了互斥字段',

    // 账户与持仓风控错误
    '-2010': '账户下单条件不足或保证金风险超标 (可能处于强平冷静期或持仓限制)',
    '-2011': '在币安系统中未查询到指定的目标订单 (订单可能未成交或已被取消)',
    '-2012': '撤单请求被拒绝，订单可能已成交或不存在',
    '-2013': '目标订单不存在',
    '-2014': 'API Key 格式非法',
    '-2015': 'API Key 或 IP 地址无访问权限 (请核对是否已开通合约权限，或在币安后台设置了出口IP白名单限制)',
    '-2018': '账户可用余额不足',
    '-2019': '合约账户保证金不足，当前可用余额无法满足开仓所需的起始保证金',
    '-2021': '市价单未能立即完全成交，当前盘口撮合深度不足',
    '-2022': '只减仓 (ReduceOnly) 订单被币安拒绝 (当前可能已无对应持仓，或平仓方向与实际持仓方向冲突)',
    '-2026': '达到单币允许挂单数量上限',
    '-2027': '该合约当前持仓名义价值已超出允许的最大杠杆倍数上限',

    // 订单限制与规则错误
    '-4001': '委托价格超出交易所规定的最高/最低价格限制',
    '-4002': '委托价格必须大于零',
    '-4003': '下单数量低于币安规定的单笔最小允许数量',
    '-4004': '委托数量必须大于零',
    '-4005': '下单数量超出该币种单笔最大允许委托限制',
    '-4006': '委托价格超出单笔最大价格限制',
    '-4007': '委托价格低于单笔最小价格限制',
    '-4008': '触发价格必须大于零',
    '-4012': '订单数量超过限制',
    '-4013': '订单总价值低于交易所最低限制',
    '-4014': '价格小数位数超出该币种价格精度上限',
    '-4015': '数量小数位数超出该币种数量精度上限',
    '-4028': '该合约不支持指定的杠杆倍数',
    '-4046': '该合约当前处于不可交易状态',
    '-4055': '划转或交易金额必须大于零',
    '-4059': '当前未持有该币种对应方向的仓位，无法执行平仓或减仓',
    '-4060': '持仓方向不匹配 (请检查持仓模式与多空方向)',
    '-4061': '持仓模式冲突 (当前账户为单向持仓模式，但请求了双向对冲持仓字段，或反之)',
    '-4131': '价格偏离标记价格比例过大',
    '-4140': '持仓金额或数量已达到币安单向最大风控限额',
    '-4164': '订单总名义价值低于币安最低下单限制 (单笔交易价值通常不得低于 5~20 USDT)',
    '-4184': '单笔名义金额未达到币安最小限制 (单笔需≥5~20 USDT)',
    '-5000': '现货/资金账户可用余额不足，无法完成资金划转',
    '-5021': '该合约交易对正在盘中结算或临时维护'
};

/**
 * 翻译币安错误消息（包含错误码与英文说明深度转换）
 */
export function translateBinanceError(code?: number | string, rawMsg?: string): string {
    const codeStr = code !== undefined && code !== null ? String(code).trim() : '';
    const codeDesc = codeStr && BINANCE_ERROR_CODE_MAP[codeStr] ? BINANCE_ERROR_CODE_MAP[codeStr] : '';

    if (!rawMsg && codeDesc) {
        return `[错误码 ${codeStr}] ${codeDesc}`;
    }

    const msg = String(rawMsg || '').trim();
    let translatedMsg = msg;

    // 常见英文短语全量中文化映射
    if (msg.includes('Exceeded the maximum allowable position') || msg.includes('maximum allowable position') || codeStr === '-2027') {
        translatedMsg = '当前杠杆倍数下的开仓名义价值已超出币安官方风控持仓上限！请调低杠杆倍数或减少单笔开仓金额。';
    } else if (msg.includes('Margin is insufficient') || msg.includes('insufficient balance')) {
        translatedMsg = '合约可用保证金不足，请向合约账户划转资金或降低单笔开仓金额';
    } else if (msg.includes('ReduceOnly Order is rejected') || msg.includes('ReduceOnly')) {
        translatedMsg = '只减仓平仓订单被拒绝 (可能仓位已被完全平仓，或平仓方向与实际持仓反向)';
    } else if (msg.includes('Filter failure: MIN_NOTIONAL') || msg.includes('MIN_NOTIONAL')) {
        translatedMsg = '订单总价值低于币安最低名义金额限制 (通常单笔名义价值需≥5~20 USDT)';
    } else if (msg.includes('Filter failure: LOT_SIZE') || msg.includes('LOT_SIZE')) {
        translatedMsg = '下单数量不符合步进精度或小于交易所最小下单量限制';
    } else if (msg.includes('Filter failure: PRICE_FILTER') || msg.includes('PRICE_FILTER')) {
        translatedMsg = '委托价格超出允许波动范围或价格小数精度不合规';
    } else if (msg.includes('Filter failure: PERCENT_PRICE')) {
        translatedMsg = '委托价格偏离标记价格比例过大，被风控过滤器拦截';
    } else if (msg.includes('Filter failure: MAX_NUM_ORDERS')) {
        translatedMsg = '挂单数量已达到该币种允许的最大上限';
    } else if (msg.includes('Precision is over the maximum')) {
        translatedMsg = '数量或价格的小数位数超过了币安允许的最大精度限制';
    } else if (msg.includes('API-key format invalid')) {
        translatedMsg = 'API Key 格式错误，请检查是否包含多余空格或非法字符';
    } else if (msg.includes('Signature for this request is not valid')) {
        translatedMsg = '签名验证无效，请检查 API Secret 密钥是否输入正确';
    } else if (msg.includes('Timestamp for this request was')) {
        translatedMsg = '请求时间戳与币安服务器时钟存在偏差，系统已自动重新对齐时间戳';
    } else if (msg.includes('IP rate limit') || msg.includes('Too many requests') || msg.includes('429')) {
        translatedMsg = 'IP 访问频次超出币安限频规定，系统已自动进入降频排队保护';
    } else if (msg.includes('Invalid symbol') || msg.includes('UNKNOWN_SYMBOL')) {
        translatedMsg = '无效的交易对代码，或该币种在币安未上线永续合约';
    } else if (msg.includes('Position is closed') || msg.includes('No open position')) {
        translatedMsg = '该币种在币安当前已无活动持仓';
    } else if (msg.includes('Order would immediately trigger')) {
        translatedMsg = '限价或止损单将立即触发，已被币安风控拒绝';
    } else if (msg.includes('Unknown order sent')) {
        translatedMsg = '向币安查询的订单号不存在或已被取消';
    } else if (msg.includes('Invalid listenKey')) {
        translatedMsg = '用户实时数据流监听凭据 (ListenKey) 已失效或过期，正在自动重新申请';
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
        translatedMsg = '网络连接超时或中断，已尝试自动切换备用节点重试';
    } else if (msg.includes('fetch failed')) {
        translatedMsg = '网络底层请求失败，无法连通币安 API 节点';
    } else if (msg.includes('Bad Gateway') || msg.includes('502')) {
        translatedMsg = '币安服务节点网关响应异常 (502 Bad Gateway)，正在重连备用节点';
    } else if (msg.includes('Gateway Timeout') || msg.includes('504')) {
        translatedMsg = '币安网关响应超时 (504 Gateway Timeout)，请检查交易所服务状态';
    } else if (msg.includes('Internal Server Error') || msg.includes('500')) {
        translatedMsg = '币安内部服务器异常 (500 Internal Error)';
    }

    if (codeDesc) {
        return `[错误码 ${codeStr}] ${codeDesc}${translatedMsg && translatedMsg !== codeDesc ? ` (交易所反馈: ${translatedMsg})` : ''}`;
    }

    if (codeStr) {
        return `[错误码 ${codeStr}] ${translatedMsg || '币安拒绝了请求'}`;
    }

    return translatedMsg || '币安未返回明确错误详情';
}

/**
 * 翻译订单状态为清晰中文
 */
export function translateOrderStatus(status?: string): string {
    if (!status) return '未知状态';
    const s = status.toUpperCase().trim();
    switch (s) {
        case 'FILLED':
            return '全部成交 (FILLED)';
        case 'PARTIALLY_FILLED':
            return '部分成交 (PARTIALLY_FILLED)';
        case 'NEW':
            return '已报入挂单等待撮合 (NEW)';
        case 'CANCELED':
            return '已撤销 (CANCELED)';
        case 'EXPIRED':
            return '已过期失效 (EXPIRED)';
        case 'REJECTED':
            return '已拒绝 (REJECTED)';
        case 'PENDING_CANCEL':
            return '正在撤销中 (PENDING_CANCEL)';
        default:
            return s;
    }
}

/**
 * 翻译买卖方向与持仓方向为清晰中文
 */
export function translateSideAndAction(side?: string, action?: 'OPEN' | 'CLOSE' | string, positionSide?: string): string {
    const normalizedSide = (side || '').toUpperCase().trim();
    const normalizedAction = (action || '').toUpperCase().trim();
    const isLong = normalizedSide === 'BUY' || normalizedSide === 'LONG';
    const isShort = normalizedSide === 'SELL' || normalizedSide === 'SHORT';

    if (normalizedAction === 'OPEN') {
        if (isLong) return '买入开多 (市价做多)';
        if (isShort) return '卖出开空 (市价做空)';
        return `市价开仓 (${normalizedSide})`;
    }

    if (normalizedAction === 'CLOSE') {
        if (isLong) return '卖出平多 (市价平仓)';
        if (isShort) return '买入平空 (市价平仓)';
        return `市价平仓 (${normalizedSide})`;
    }

    if (positionSide) {
        const ps = positionSide.toUpperCase().trim();
        if (ps === 'LONG') return '多头持仓 (LONG)';
        if (ps === 'SHORT') return '空头持仓 (SHORT)';
        if (ps === 'BOTH') return '单向持仓 (BOTH)';
    }

    if (isLong) return '做多 (LONG)';
    if (isShort) return '做空 (SHORT)';
    return normalizedSide || '未知方向';
}

/**
 * 格式化币种名称，附带标准中文名
 * 例如: BTCUSDT -> BTCUSDT (比特币)
 */
export function formatCoin(symbol?: string): string {
    if (!symbol) return '未知币种';
    const clean = symbol.toUpperCase().trim();
    const zh = getCoinChineseName(clean);
    return zh ? `${clean} (${zh})` : clean;
}

// =========================================================================
// 向币安发送请求全面记录接口
// =========================================================================

export interface BinanceRequestOptions {
    /** 业务操作类型 */
    actionType: 'MANUAL_OPEN' | 'AUTO_OPEN' | 'MANUAL_CLOSE' | 'AUTO_CLOSE' | 'MANUAL_HEDGE' | 'AUTO_HEDGE' | 'AMPUTATE' | 'MANUAL_AMPUTATE' | 'REFILL' | 'REOPEN' | 'BATCH_CLOSE' | 'SYNC_BALANCE' | 'QUERY_ORDER' | 'QUERY_TRADES' | 'VERIFY_POSITION' | 'TRANSFER' | 'LISTEN_KEY' | 'CLEAR_CACHE';
    /** 交易对代码 */
    symbol?: string;
    /** 方向 (BUY/SELL/LONG/SHORT) */
    side?: string;
    /** 持仓方向 (LONG/SHORT/BOTH) */
    positionSide?: string;
    /** 委托数量 (币数/手) */
    quantity?: number | string;
    /** 委托金额 (USDT) */
    amountUsdt?: number | string;
    /** 杠杆倍数 */
    leverage?: number | string;
    /** 触发来源/策略原因 */
    reason?: string;
    /** 自定义客户端订单号 */
    clientOrderId?: string;
    /** 附加详细说明 */
    extraInfo?: string;
    /** 是否手动操作 (true: 手动操作, false: 自动策略信号) */
    isManual?: boolean;
    /** 是否为防爆对冲仓位 */
    isHedge?: boolean;
    /** 仓位归属明确标记：'ORIGINAL' (原主仓位) | 'HEDGE' (防爆对冲仓位) */
    positionTarget?: 'ORIGINAL' | 'HEDGE' | string;
    /** 信号来源名称 */
    signalSource?: string;
    /** 信号发生细节 */
    signalDetails?: string;
    /** 交易生命周期溯源 Chain ID */
    chainId?: string;
    /** 执行耗时与延迟信息 */
    latencyInfo?: {
        signalTimeMs?: number;
        networkRttMs?: number;
        totalLatencyMs?: number;
        slippagePercent?: number;
    };
    /** 综合多空净风险敞口信息 */
    exposureInfo?: {
        longAmount?: number;
        shortAmount?: number;
        netExposure?: number;
        netExposureUsdt?: number;
        hedgeRatioPercent?: number;
    };
}

/**
 * 记录向币安发送请求（全面中文展示，绝对明确手动/自动、动作、原主仓/对冲仓、数量与金额USDT）
 */
export function logBinanceOutboundRequest(opt: BinanceRequestOptions): void {
    const symbolStr = opt.symbol ? formatCoin(opt.symbol) : '';
    const sideActionStr = translateSideAndAction(opt.side, opt.actionType.includes('OPEN') ? 'OPEN' : (opt.actionType.includes('CLOSE') ? 'CLOSE' : undefined), opt.positionSide);
    const categoryTag = '📤 [向币安发送请求]';

    // 1. 信号类型明确判定：【手动操作】 vs 【自动策略信号】
    const isManual = opt.isManual !== undefined 
        ? opt.isManual 
        : (opt.actionType.startsWith('MANUAL') || (opt.reason && (opt.reason.includes('手动') || opt.reason.toLowerCase().includes('manual'))));
    const signalTag = isManual ? '【手动操作】' : '【自动策略信号】';

    // 2. 仓位归属明确判定：【原主仓位】 vs 【防爆对冲仓位】
    const isHedge = opt.isHedge !== undefined
        ? opt.isHedge
        : (opt.actionType.includes('HEDGE') || (opt.reason && (opt.reason.includes('对冲') || opt.reason.includes('防爆'))));
    const positionTag = isHedge ? '【防爆对冲仓位】' : '【原主仓位】';

    // 3. 动作类型明确判定
    let actionTypeTag = '';
    const isTradeAction = opt.actionType.includes('OPEN') || opt.actionType.includes('CLOSE') || opt.actionType.includes('HEDGE') || opt.actionType.includes('AMPUTATE') || opt.actionType === 'REFILL' || opt.actionType === 'REOPEN' || opt.actionType === 'BATCH_CLOSE';

    if (opt.actionType === 'MANUAL_HEDGE' || opt.actionType === 'AUTO_HEDGE') {
        actionTypeTag = '【防爆对冲开仓】';
    } else if (opt.actionType === 'AMPUTATE' || opt.actionType === 'MANUAL_AMPUTATE') {
        actionTypeTag = '【断臂求生减仓】';
    } else if (opt.actionType === 'REFILL') {
        actionTypeTag = '【策略加仓补位】';
    } else if (opt.actionType === 'REOPEN') {
        actionTypeTag = '【解套仓位复开】';
    } else if (opt.actionType === 'BATCH_CLOSE') {
        actionTypeTag = '【一键全量批量平仓】';
    } else if (opt.actionType.includes('CLOSE')) {
        actionTypeTag = isHedge ? '【防爆对冲减仓/平仓】' : '【市价平仓】';
    } else if (opt.actionType.includes('OPEN')) {
        actionTypeTag = isHedge ? '【防爆对冲开仓】' : '【市价开仓】';
    } else {
        switch (opt.actionType) {
            case 'SYNC_BALANCE':
                actionTypeTag = '【账户资产与持仓对账】';
                break;
            case 'VERIFY_POSITION':
                actionTypeTag = '【单币持仓穿透核验】';
                break;
            case 'QUERY_ORDER':
                actionTypeTag = '【查询订单执行状态】';
                break;
            case 'QUERY_TRADES':
                actionTypeTag = '【查询单币历史成交流水】';
                break;
            case 'TRANSFER':
                actionTypeTag = '【合约/现货资金划转】';
                break;
            case 'LISTEN_KEY':
                actionTypeTag = '【申请实时用户数据流】';
                break;
            case 'CLEAR_CACHE':
                actionTypeTag = '【重置交易缓存】';
                break;
            default:
                actionTypeTag = `【${opt.actionType}】`;
        }
    }

    const detailParts: string[] = [];
    if (opt.chainId) {
        detailParts.push(`链路ID: ${opt.chainId}`);
    }
    if (symbolStr) detailParts.push(`币种: ${symbolStr}`);
    if (sideActionStr && sideActionStr !== '未知方向') detailParts.push(`操作方向: ${sideActionStr}`);
    if (opt.quantity !== undefined && opt.quantity !== null && Number(opt.quantity) > 0) {
        detailParts.push(`委托数量: ${Number(opt.quantity).toFixed(4)}`);
    }
    if (opt.amountUsdt !== undefined && opt.amountUsdt !== null && Number(opt.amountUsdt) > 0) {
        detailParts.push(`委托金额: ${Number(opt.amountUsdt).toFixed(2)} USDT`);
    }
    if (opt.leverage) {
        detailParts.push(`杠杆倍数: ${opt.leverage}x`);
    }
    if (opt.latencyInfo) {
        const { signalTimeMs, networkRttMs, totalLatencyMs, slippagePercent } = opt.latencyInfo;
        const latParts: string[] = [];
        if (signalTimeMs !== undefined) latParts.push(`信号触发: ${signalTimeMs}ms`);
        if (networkRttMs !== undefined) latParts.push(`币安往返: ${networkRttMs}ms`);
        if (totalLatencyMs !== undefined) latParts.push(`总延迟: ${totalLatencyMs}ms`);
        if (slippagePercent !== undefined) latParts.push(`滑点偏离: ${slippagePercent > 0 ? '+' : ''}${slippagePercent.toFixed(2)}%`);
        if (latParts.length > 0) detailParts.push(`[执行耗时] ${latParts.join(' | ')}`);
    }
    if (opt.exposureInfo) {
        const { longAmount, shortAmount, netExposure, netExposureUsdt, hedgeRatioPercent } = opt.exposureInfo;
        const expParts: string[] = [];
        if (longAmount !== undefined) expParts.push(`多头:${longAmount.toFixed(4)}`);
        if (shortAmount !== undefined) expParts.push(`空头:${shortAmount.toFixed(4)}`);
        if (netExposure !== undefined) expParts.push(`净敞口:${netExposure >= 0 ? '+' : ''}${netExposure.toFixed(4)}`);
        if (netExposureUsdt !== undefined) expParts.push(`净值:${netExposureUsdt >= 0 ? '+' : ''}${netExposureUsdt.toFixed(2)}U`);
        if (hedgeRatioPercent !== undefined) expParts.push(`对冲比:${hedgeRatioPercent.toFixed(1)}%`);
        if (expParts.length > 0) detailParts.push(`[净风险敞口] ${expParts.join(' | ')}`);
    }
    if (opt.reason) {
        detailParts.push(`触发来源: ${opt.reason}`);
    }
    if (opt.clientOrderId) {
        detailParts.push(`客户订单号: ${opt.clientOrderId}`);
    }
    if (opt.extraInfo) {
        detailParts.push(opt.extraInfo);
    }

    const headerTag = isTradeAction ? `${signalTag} | ${actionTypeTag} | ${positionTag}` : actionTypeTag;
    const message = `${categoryTag} ${headerTag} | ${detailParts.join(' | ')}`;

    const cat: LogCategory = isHedge ? 'HEDGE' : (isManual ? 'MANUAL' : 'AUTO');
    emitBinanceLog('INFO', message, true, {
        category: cat,
        chainId: opt.chainId,
        latencyInfo: opt.latencyInfo,
        exposureInfo: opt.exposureInfo
    });
}

// =========================================================================
// 策略信号捕获记录接口 (发生信号的信息记录)
// =========================================================================

export interface SignalOccurrenceOptions {
    /** 策略来源模块 (如: List 4 动能趋势审计、List 3 结构深度审计、List 2 大十字星、List 1 全域底边、模块2 强力防爆对冲等) */
    source: string;
    /** 策略名称 */
    strategyName?: string;
    /** 交易对代码 */
    symbol: string;
    /** 交易方向 (LONG 做多 / SHORT 做空) */
    side: 'LONG' | 'SHORT' | string;
    /** 动作类型 */
    actionType?: 'OPEN' | 'CLOSE' | string;
    /** 是否手动操作 */
    isManual?: boolean;
    /** 是否为对冲操作 */
    isHedge?: boolean;
    /** K线周期 (如: 15m, 1h, 5m 等) */
    timeframe?: string;
    /** 触发信号的价格 (USDT) */
    price?: number;
    /** 计划委托金额 (USDT) */
    amountUsdt?: number;
    /** 触发指标或逻辑详细说明 */
    details?: string;
    /** 触发原因 */
    reason?: string;
}

/**
 * 记录每一次发生信号的详细信息（中文全量展示）
 */
export function logSignalOccurrence(opt: SignalOccurrenceOptions): void {
    const symbolStr = formatCoin(opt.symbol);
    const signalTag = opt.isManual ? '【手动操作】' : '【自动策略信号】';
    const positionTag = opt.isHedge ? '【防爆对冲仓位】' : '【原主仓位】';
    let actionTag = '【市价开仓】';
    if (opt.actionType === 'CLOSE') {
        actionTag = opt.isHedge ? '【防爆对冲减仓/平仓】' : '【市价平仓】';
    } else if (opt.isHedge) {
        actionTag = '【防爆对冲开仓】';
    }
    const sideStr = (opt.side === 'LONG' || opt.side === 'BUY') ? '买入做多 (LONG)' : '卖出做空 (SHORT)';
    const stratName = opt.strategyName || opt.source;
    
    const parts: string[] = [
        `币种: ${symbolStr}`,
        `计划方向: ${sideStr}`
    ];
    if (opt.timeframe) parts.push(`信号周期: ${opt.timeframe}`);
    if (opt.price !== undefined && opt.price > 0) parts.push(`触发价格: ${opt.price} USDT`);
    if (opt.amountUsdt !== undefined && opt.amountUsdt > 0) parts.push(`计划委托金额: ${opt.amountUsdt.toFixed(2)} USDT`);
    if (opt.reason || opt.details) parts.push(`触发原因: ${opt.reason || opt.details}`);

    const message = `🔔 [策略信号捕获] ${signalTag} | ${actionTag} | ${positionTag} | 策略来源: ${stratName} | ${parts.join(' | ')}`;
    emitBinanceLog('INFO', message, true);
}

// =========================================================================
// 币安反馈接收全面记录接口
// =========================================================================

export interface BinanceResponseOptions {
    /** 业务操作类型 */
    actionType: string;
    /** 请求是否成功 */
    success: boolean;
    /** 交易对代码 */
    symbol?: string;
    /** 买卖方向 */
    side?: string;
    /** 订单ID */
    orderId?: string | number;
    /** 客户端自定义订单ID */
    clientOrderId?: string;
    /** 成交均价 (USDT) */
    price?: number | string;
    /** 成交数量 */
    quantity?: number | string;
    /** 累计成交金额 (USDT) */
    cumQuote?: number | string;
    /** 订单状态 (FILLED / PARTIALLY_FILLED 等) */
    status?: string;
    /** 实际生效杠杆 */
    leverage?: number | string;
    /** 已实现盈亏 (USDT) */
    realizedPnl?: number | string;
    /** 手续费扣除 */
    commission?: number | string;
    /** 手续费资产 */
    commissionAsset?: string;
    /** 资金费率扣除 (USDT) */
    fundingFee?: number | string;
    /** 纯净净利润 (USDT) */
    netPnl?: number | string;
    /** 币安原生错误码 */
    errorCode?: number | string;
    /** 错误消息 */
    errorMessage?: string;
    /** 补充信息 */
    extraInfo?: string;
    /** 是否手动操作 */
    isManual?: boolean;
    /** 是否为防爆对冲仓位 */
    isHedge?: boolean;
    /** 确认通道 (如: WebSocket极速直通 / REST API回执) */
    channel?: string;
    /** 交易生命周期溯源 Chain ID */
    chainId?: string;
    /** 执行耗时与延迟信息 */
    latencyInfo?: {
        signalTimeMs?: number;
        networkRttMs?: number;
        totalLatencyMs?: number;
        slippagePercent?: number;
    };
    /** 综合多空净风险敞口信息 */
    exposureInfo?: {
        longAmount?: number;
        shortAmount?: number;
        netExposure?: number;
        netExposureUsdt?: number;
        hedgeRatioPercent?: number;
    };
}

/**
 * 记录币安反馈接收（全面中文展示，明确显示手动/自动、动作、原主仓/对冲仓、成交数量与金额USDT）
 */
export function logBinanceInboundResponse(opt: BinanceResponseOptions): void {
    const symbolStr = opt.symbol ? formatCoin(opt.symbol) : '';
    const sideStr = opt.side ? translateSideAndAction(opt.side) : '';

    // 1. 信号类型明确判定
    const isManual = opt.isManual !== undefined
        ? opt.isManual
        : (opt.actionType.includes('手动') || (opt.clientOrderId && opt.clientOrderId.includes('MANUAL')));
    const signalTag = isManual ? '【手动操作】' : '【自动策略信号】';

    // 2. 仓位归属明确判定
    const isHedge = opt.isHedge !== undefined
        ? opt.isHedge
        : (opt.actionType.includes('对冲') || (opt.clientOrderId && opt.clientOrderId.includes('HEDGE')));
    const positionTag = isHedge ? '【防爆对冲仓位】' : '【原主仓位】';

    // 3. 动作类型明确判定
    let actionTypeTag = '';
    const isTradeAction = opt.actionType.includes('开仓') || opt.actionType.includes('平仓') || opt.actionType.includes('减仓') || opt.actionType.includes('砍仓') || opt.actionType.includes('补位') || opt.actionType.includes('对冲') || opt.actionType.includes('清仓');

    if (opt.actionType.includes('开仓')) {
        actionTypeTag = isHedge ? '【防爆对冲开仓】' : '【市价开仓】';
    } else if (opt.actionType.includes('砍仓') || opt.actionType.includes('断臂')) {
        actionTypeTag = '【断臂求生减仓】';
    } else if (opt.actionType.includes('平仓') || opt.actionType.includes('减仓')) {
        actionTypeTag = isHedge ? '【防爆对冲减仓/平仓】' : '【市价平仓】';
    } else if (opt.actionType.includes('补位') || opt.actionType.includes('补仓')) {
        actionTypeTag = '【策略加仓补位】';
    } else if (opt.actionType.includes('批量')) {
        actionTypeTag = '【一键全量批量平仓】';
    } else {
        actionTypeTag = opt.actionType.endsWith('回执') || opt.actionType.endsWith('同步') || opt.actionType.endsWith('完成')
            ? `【${opt.actionType}】`
            : `【${opt.actionType}回执】`;
    }

    if (opt.success) {
        const categoryTag = '📥 [币安反馈接收 - 全部成交]';
        const parts: string[] = [];
        if (opt.chainId) parts.push(`链路ID: ${opt.chainId}`);
        if (symbolStr) parts.push(`币种: ${symbolStr}`);
        if (sideStr) parts.push(`方向: ${sideStr}`);
        if (opt.orderId) parts.push(`币安订单号: ${opt.orderId}`);
        if (opt.status) parts.push(`订单状态: ${translateOrderStatus(opt.status)}`);
        
        const priceNum = Number(opt.price || 0);
        if (priceNum > 0) parts.push(`成交均价: ${priceNum} USDT`);

        const qtyNum = Number(opt.quantity || 0);
        if (qtyNum > 0) parts.push(`成交数量: ${qtyNum.toFixed(4)}`);

        const cumQuoteNum = Number(opt.cumQuote || 0);
        if (cumQuoteNum > 0) parts.push(`成交金额: ${cumQuoteNum.toFixed(2)} USDT`);
        else if (priceNum > 0 && qtyNum > 0) parts.push(`折算成交金额: ${(priceNum * qtyNum).toFixed(2)} USDT`);

        if (opt.leverage) parts.push(`生效杠杆: ${opt.leverage}x`);

        // 交易费用与纯净利润穿透
        let pnlBreakdown: any = undefined;
        if (opt.realizedPnl !== undefined && opt.realizedPnl !== null) {
            const grossPnl = Number(opt.realizedPnl);
            const comm = Number(opt.commission || 0);
            const fund = Number(opt.fundingFee || 0);
            const net = opt.netPnl !== undefined ? Number(opt.netPnl) : (grossPnl - comm - fund);
            pnlBreakdown = {
                grossPnl,
                commission: comm,
                fundingFee: fund,
                netPnl: net
            };

            if (comm > 0 || fund !== 0) {
                parts.push(`毛盈亏: ${grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(4)} USDT`);
                if (comm > 0) parts.push(`手续费: -${comm.toFixed(4)} ${opt.commissionAsset || 'USDT'}`);
                if (fund !== 0) parts.push(`资金费: ${fund >= 0 ? '+' : ''}${fund.toFixed(4)} USDT`);
                parts.push(`纯净利润: ${net >= 0 ? '+' : ''}${net.toFixed(4)} USDT`);
            } else {
                parts.push(`实现盈亏: ${grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(4)} USDT`);
            }
        } else if (opt.commission !== undefined && opt.commission !== null && Number(opt.commission) > 0) {
            parts.push(`手续费: ${opt.commission} ${opt.commissionAsset || 'USDT'}`);
        }

        if (opt.latencyInfo) {
            const { signalTimeMs, networkRttMs, totalLatencyMs, slippagePercent } = opt.latencyInfo;
            const latParts: string[] = [];
            if (signalTimeMs !== undefined) latParts.push(`信号: ${signalTimeMs}ms`);
            if (networkRttMs !== undefined) latParts.push(`往返: ${networkRttMs}ms`);
            if (totalLatencyMs !== undefined) latParts.push(`总耗时: ${totalLatencyMs}ms`);
            if (slippagePercent !== undefined) latParts.push(`滑点: ${slippagePercent > 0 ? '+' : ''}${slippagePercent.toFixed(2)}%`);
            if (latParts.length > 0) parts.push(`[执行耗时] ${latParts.join(' | ')}`);
        }

        if (opt.exposureInfo) {
            const { longAmount, shortAmount, netExposure, netExposureUsdt, hedgeRatioPercent } = opt.exposureInfo;
            const expParts: string[] = [];
            if (longAmount !== undefined) expParts.push(`多:${longAmount.toFixed(4)}`);
            if (shortAmount !== undefined) expParts.push(`空:${shortAmount.toFixed(4)}`);
            if (netExposure !== undefined) expParts.push(`净:${netExposure >= 0 ? '+' : ''}${netExposure.toFixed(4)}`);
            if (netExposureUsdt !== undefined) expParts.push(`净值:${netExposureUsdt >= 0 ? '+' : ''}${netExposureUsdt.toFixed(2)}U`);
            if (hedgeRatioPercent !== undefined) expParts.push(`对冲比:${hedgeRatioPercent.toFixed(1)}%`);
            if (expParts.length > 0) parts.push(`[净风险敞口] ${expParts.join(' | ')}`);
        }

        if (opt.channel) {
            parts.push(`确认通道: ${opt.channel}`);
        }

        if (opt.clientOrderId) {
            parts.push(`客户订单号: ${opt.clientOrderId}`);
        }

        if (opt.extraInfo) parts.push(opt.extraInfo);

        const headerTag = isTradeAction ? `${signalTag} | ${actionTypeTag} | ${positionTag}` : actionTypeTag;
        const message = `${categoryTag} ${headerTag} | ${parts.join(' | ')}`;

        let cat: LogCategory = 'ALL';
        if (pnlBreakdown || opt.actionType.includes('平仓') || opt.actionType.includes('减仓')) {
            cat = 'PNL';
        } else if (isHedge) {
            cat = 'HEDGE';
        } else if (isManual) {
            cat = 'MANUAL';
        } else {
            cat = 'AUTO';
        }

        emitBinanceLog('SUCCESS', message, true, {
            category: cat,
            chainId: opt.chainId,
            latencyInfo: opt.latencyInfo,
            pnlBreakdown,
            exposureInfo: opt.exposureInfo
        });
    } else {
        const categoryTag = '🚨 [币安反馈接收 - 异常/拒绝]';
        const translatedError = translateBinanceError(opt.errorCode, opt.errorMessage);
        const parts: string[] = [];
        if (opt.chainId) parts.push(`链路ID: ${opt.chainId}`);
        if (symbolStr) parts.push(`币种: ${symbolStr}`);
        if (sideStr) parts.push(`方向: ${sideStr}`);
        parts.push(`异常排查: ${translatedError}`);
        if (opt.orderId) {
            parts.push(`币安订单号: ${opt.orderId}`);
        }
        if (opt.clientOrderId) {
            parts.push(`客户订单号: ${opt.clientOrderId}`);
        }
        if (opt.extraInfo) parts.push(opt.extraInfo);

        const failTitle = isTradeAction ? `${signalTag} | ${actionTypeTag} | ${positionTag}` : `【${opt.actionType}被拒】`;
        const message = `${categoryTag} ${failTitle} | ${parts.join(' | ')}`;
        emitBinanceLog('DANGER', message, true, {
            category: 'ERROR',
            chainId: opt.chainId
        });
    }
}

// =========================================================================
// 币安实时 WebSocket 推送反馈记录接口
// =========================================================================

/**
 * 记录币安实时推送反馈（订单成交更新、账户资金变动，全面中文化呈现）
 */
export function logBinancePushEvent(eventType: 'TRADE_UPDATE' | 'ACCOUNT_UPDATE' | 'POSITION_UPDATE', data: any): void {
    if (!data) return;

    if (eventType === 'TRADE_UPDATE') {
        const symbolStr = data.symbol ? formatCoin(data.symbol) : '';
        const sideStr = data.side ? (data.side === 'BUY' ? '买入' : '卖出') : '';
        const statusStr = translateOrderStatus(data.orderStatus || data.status);
        const price = Number(data.lastFilledPrice || data.price || data.avgPrice || 0);
        const qty = Number(data.lastFilledQty || data.origQty || data.qty || 0);
        const realizedPnl = data.realizedPnl !== undefined ? Number(data.realizedPnl) : 0;
        const commission = data.commission !== undefined ? Number(data.commission) : 0;
        const commissionAsset = data.commissionAsset || 'USDT';

        const clientOrderId = data.clientOrderId || '';
        const isManual = clientOrderId.includes('MANUAL') || clientOrderId.includes('manual');
        const isHedge = clientOrderId.includes('HEDGE') || clientOrderId.includes('hedge');
        const isAmputate = clientOrderId.startsWith('AMP_');

        const signalTag = isManual ? '【手动操作】' : '【自动策略信号】';
        const posTag = isHedge ? '【防爆对冲仓位】' : '【原主仓位】';
        let actTag = '【成交流水】';
        if (isHedge) actTag = '【防爆对冲成交】';
        else if (isAmputate) actTag = '【断臂求生减仓成交】';

        const parts: string[] = [];
        if (symbolStr) parts.push(`币种: ${symbolStr}`);
        if (sideStr) parts.push(`方向: ${sideStr}`);
        parts.push(`订单状态: ${statusStr}`);
        if (price > 0) parts.push(`最新成交价: ${price} USDT`);
        if (qty > 0) parts.push(`成交数量: ${qty.toFixed(4)}`);
        if (price > 0 && qty > 0) parts.push(`成交金额: ${(price * qty).toFixed(2)} USDT`);
        if (realizedPnl !== 0) parts.push(`实现盈亏: ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(4)} USDT`);
        if (commission > 0) parts.push(`手续费扣除: ${commission} ${commissionAsset}`);
        if (data.orderId) parts.push(`币安订单号: ${data.orderId}`);
        if (clientOrderId) parts.push(`客户订单号: ${clientOrderId}`);

        const message = `⚡ [币安推送反馈 - 实时成交流水] ${signalTag} | ${actTag} | ${posTag} | ${parts.join(' | ')}`;
        emitBinanceLog(realizedPnl >= 0 ? 'SUCCESS' : 'WARNING', message, true);
        return;
    }

    if (eventType === 'ACCOUNT_UPDATE') {
        const walletBalance = data.walletBalance !== undefined ? Number(data.walletBalance).toFixed(2) : null;
        const crossMargin = data.crossMargin !== undefined ? Number(data.crossMargin).toFixed(2) : null;
        const reason = data.reason || '资产变动';

        const parts: string[] = [];
        parts.push(`变动原因: ${reason}`);
        if (walletBalance !== null) parts.push(`最新钱包总额: ${walletBalance} USDT`);
        if (crossMargin !== null) parts.push(`全仓保证金: ${crossMargin} USDT`);

        const message = `⚡ [币安推送反馈 - 账户资金变动] ${parts.join(' | ')}`;
        emitBinanceLog('INFO', message, true);
        return;
    }
}

// =========================================================================
// 全网零遗漏自动拦截器 (Fetch Interceptor)
// =========================================================================

let isInterceptorInstalled = false;
let lastBalanceLogTime = 0;

function shouldLogPeriodicBalance(): boolean {
    const now = Date.now();
    if (now - lastBalanceLogTime > 60000) { // 每 60 秒最多输出一次后台自动轮询的资产对账日志，避免刷屏
        lastBalanceLogTime = now;
        return true;
    }
    return false;
}

// 🔒 保存原生 fetch 的纯净句柄，确保无论全局如何覆写，底层请求绝不发生循环递归
const getNativeFetch = (): typeof fetch => {
    if (typeof window !== 'undefined') {
        if (!(window as any).__NATIVE_FETCH__) {
            (window as any).__NATIVE_FETCH__ = window.fetch ? window.fetch.bind(window) : fetch;
        }
        return (window as any).__NATIVE_FETCH__;
    }
    return fetch;
};

/**
 * 币安全链路审计 Fetch 包装器：对所有发往 /api/binance/* 的请求进行结构化中文审计并安全透传
 */
export async function binanceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const rawFetch = getNativeFetch();
    try {
        const urlStr = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input && 'url' in input ? (input as any).url : ''));
        
        // 仅拦截币安 API 接口路由
        if (!urlStr || !urlStr.includes('/api/binance/')) {
            return rawFetch(input, init);
        }

        let bodyJson: any = null;
        if (init && init.body && typeof init.body === 'string') {
            try {
                bodyJson = JSON.parse(init.body);
            } catch (e) {}
        }

        const isOrderRoute = urlStr.includes('/api/binance/order');
        const isBalanceRoute = urlStr.includes('/api/binance/validate-and-balance');
        const isTransferRoute = urlStr.includes('/api/binance/transfer');
        const isQueryOrderRoute = urlStr.includes('/api/binance/query-order') || urlStr.includes('/api/binance/order-status');
        const isTradesRoute = urlStr.includes('/api/binance/user-trades') || urlStr.includes('/api/binance/fast-user-trades');
        const isSymbolPositionRoute = urlStr.includes('/api/binance/symbol-position');
        const isUserStreamRoute = urlStr.includes('/api/binance/user-stream');
        const isClearCacheRoute = urlStr.includes('/api/binance/clear-trade-cache');

        // 若调用方已显式打标 __loggedOutbound 则跳过请求拦截，避免重复输出
        const alreadyLoggedOutbound = bodyJson && bodyJson.__loggedOutbound;

        const startTime = Date.now();
        const signalTimeMs = bodyJson?.__signalTimeMs || (bodyJson?.timestamp ? Math.max(0, startTime - bodyJson.timestamp) : undefined);

        if (!alreadyLoggedOutbound) {
            if (isOrderRoute && bodyJson) {
                const action = bodyJson.action || 'OPEN';
                const side = bodyJson.side || 'LONG';
                const sym = bodyJson.symbol || '';
                const isManual = !!bodyJson.isManual;
                const isHedge = !!bodyJson.isHedge;
                const isAmputation = !!bodyJson.isAmputation || (bodyJson.clientOrderId && bodyJson.clientOrderId.startsWith('AMP_'));
                const isRefill = !!bodyJson.isRefill || (bodyJson.clientOrderId && bodyJson.clientOrderId.startsWith('REF_'));
                const isReopen = !!bodyJson.isReopen || (bodyJson.clientOrderId && bodyJson.clientOrderId.startsWith('REOPEN_'));
                const isBatch = !!bodyJson.isBatch || (bodyJson.clientOrderId && bodyJson.clientOrderId.startsWith('BATCH_'));
                const reason = bodyJson.reason;
                const qty = bodyJson.quantity;
                const usdt = bodyJson.amountUsdt;
                const lev = bodyJson.leverage;
                const chainId = bodyJson.chainId;
                const exposureInfo = bodyJson.exposureInfo;

                let actionType: BinanceRequestOptions['actionType'] = isManual ? 'MANUAL_OPEN' : 'AUTO_OPEN';
                if (isHedge) {
                    actionType = isManual ? 'MANUAL_HEDGE' : 'AUTO_HEDGE';
                } else if (isAmputation) {
                    actionType = isManual ? 'MANUAL_AMPUTATE' : 'AMPUTATE';
                } else if (isRefill) {
                    actionType = 'REFILL';
                } else if (isReopen) {
                    actionType = 'REOPEN';
                } else if (isBatch) {
                    actionType = 'BATCH_CLOSE';
                } else if (action === 'CLOSE') {
                    actionType = isManual ? 'MANUAL_CLOSE' : 'AUTO_CLOSE';
                }

                logBinanceOutboundRequest({
                    actionType,
                    symbol: sym,
                    side,
                    quantity: qty,
                    amountUsdt: usdt,
                    leverage: lev,
                    reason: reason || (action === 'OPEN' ? (isManual ? '用户手动市价开仓' : '策略自动开仓') : (isManual ? '用户手动市价平仓' : '策略自动平仓')),
                    clientOrderId: bodyJson.clientOrderId,
                    chainId,
                    exposureInfo,
                    isManual,
                    isHedge
                });
            } else if (isBalanceRoute) {
                const isForce = bodyJson?.force;
                if (isForce || shouldLogPeriodicBalance()) {
                    logBinanceOutboundRequest({
                        actionType: 'SYNC_BALANCE',
                        extraInfo: isForce ? '【手动/深度对账】向币安查询全量资产净值与活跃持仓列表' : '【定时安全巡检】向币安校准账户可用余额与持仓'
                    });
                }
            } else if (isTransferRoute && bodyJson) {
                const isF2S = bodyJson.type === 'UMFUTURE_MAIN' || bodyJson.type === '2';
                logBinanceOutboundRequest({
                    actionType: 'TRANSFER',
                    amountUsdt: bodyJson.amount,
                    extraInfo: `划转方向: ${isF2S ? '合约账户 ➡️ 现货账户' : '现货账户 ➡️ 合约账户'} | 申请金额: ${bodyJson.amount} USDT`
                });
            } else if (isSymbolPositionRoute && bodyJson) {
                logBinanceOutboundRequest({
                    actionType: 'VERIFY_POSITION',
                    symbol: bodyJson.symbol,
                    extraInfo: `向币安查询单币 ${formatCoin(bodyJson.symbol)} 底层实际持仓状态与均价`
                });
            } else if (isQueryOrderRoute && bodyJson) {
                logBinanceOutboundRequest({
                    actionType: 'QUERY_ORDER',
                    symbol: bodyJson.symbol,
                    extraInfo: `向币安反查订单号: ${bodyJson.orderId || bodyJson.origClientOrderId || '最新'}`
                });
            } else if (isTradesRoute && bodyJson) {
                const targetSym = bodyJson.symbol || (Array.isArray(bodyJson.symbols) ? bodyJson.symbols.join(',') : '');
                logBinanceOutboundRequest({
                    actionType: 'QUERY_TRADES',
                    symbol: targetSym,
                    extraInfo: `向币安拉取历史真实成交流水账本`
                });
            } else if (isUserStreamRoute) {
                logBinanceOutboundRequest({
                    actionType: 'LISTEN_KEY',
                    extraInfo: '向币安申请/维持 ListenKey 建立实时 WebSocket 用户数据流'
                });
            } else if (isClearCacheRoute) {
                logBinanceOutboundRequest({
                    actionType: 'CLEAR_CACHE',
                    extraInfo: '重置并清理币安交易历史缓存'
                });
            }
        }

        try {
            const res = await rawFetch(input, init);

            // 异步安全克隆并解析响应，绝不阻塞或打扰业务调用方
            try {
                const clone = res.clone();
                clone.json().then((json: any) => {
                    const alreadyLoggedInbound = bodyJson && bodyJson.__loggedInbound;
                    if (alreadyLoggedInbound) return;

                    if (isOrderRoute) {
                        const sym = bodyJson?.symbol || json?.symbol;
                        const side = bodyJson?.side || json?.side;
                        const isManual = !!bodyJson?.isManual;
                        const isHedge = !!bodyJson?.isHedge;
                        const isAmputation = !!bodyJson?.isAmputation || (bodyJson?.clientOrderId && bodyJson.clientOrderId.startsWith('AMP_'));
                        const isRefill = !!bodyJson?.isRefill || (bodyJson?.clientOrderId && bodyJson.clientOrderId.startsWith('REF_'));
                        const isBatch = !!bodyJson?.isBatch || (bodyJson?.clientOrderId && bodyJson.clientOrderId.startsWith('BATCH_'));

                        let actionLabel = '市价开仓';
                        if (isHedge && bodyJson?.action === 'CLOSE') actionLabel = '防爆对冲减仓/平仓';
                        else if (isHedge) actionLabel = '防爆对冲开仓';
                        else if (isAmputation) actionLabel = '断臂求生减仓';
                        else if (isRefill) actionLabel = '策略加仓补位';
                        else if (isBatch) actionLabel = '一键全量批量平仓';
                        else if (bodyJson?.action === 'CLOSE') actionLabel = '市价平仓';

                        const endTime = Date.now();
                        const networkRttMs = endTime - startTime;
                        const totalLatencyMs = (signalTimeMs !== undefined ? signalTimeMs : 0) + networkRttMs;
                        
                        let slippagePercent: number | undefined = undefined;
                        if (bodyJson?.expectedPrice && Number(bodyJson.expectedPrice) > 0 && json?.price && Number(json.price) > 0) {
                            const expP = Number(bodyJson.expectedPrice);
                            const fillP = Number(json.price);
                            slippagePercent = ((fillP - expP) / expP) * 100;
                        }

                        const latencyInfo = {
                            signalTimeMs,
                            networkRttMs,
                            totalLatencyMs,
                            slippagePercent
                        };

                        if (res.ok && json && json.success) {
                            logBinanceInboundResponse({
                                actionType: actionLabel,
                                success: true,
                                isManual,
                                isHedge,
                                symbol: sym,
                                side: side,
                                orderId: json.orderId,
                                clientOrderId: json.clientOrderId || bodyJson?.clientOrderId,
                                chainId: bodyJson?.chainId,
                                price: json.price,
                                quantity: json.qty,
                                cumQuote: json.cumQuote,
                                status: json.status || 'FILLED',
                                leverage: json.leverage || bodyJson?.leverage,
                                realizedPnl: json.realizedPnl,
                                commission: json.commission,
                                commissionAsset: json.commissionAsset,
                                fundingFee: json.fundingFee,
                                netPnl: json.netPnl,
                                latencyInfo,
                                exposureInfo: bodyJson?.exposureInfo
                            });
                        } else {
                            logBinanceInboundResponse({
                                actionType: actionLabel,
                                success: false,
                                isManual,
                                isHedge,
                                symbol: sym,
                                side: side,
                                clientOrderId: bodyJson?.clientOrderId,
                                chainId: bodyJson?.chainId,
                                latencyInfo,
                                errorCode: json?.code || json?.errorCode || (res.ok ? undefined : res.status),
                                errorMessage: json?.error || json?.msg || json?.message || '币安拒绝了订单请求'
                            });
                        }
                    } else if (isTransferRoute) {
                        if (res.ok && json && json.success) {
                            logBinanceInboundResponse({
                                actionType: '资金划转',
                                success: true,
                                extraInfo: `划转流水号: ${json.tranId || '已到账'} | 划转成功`
                            });
                        } else {
                            logBinanceInboundResponse({
                                actionType: '资金划转',
                                success: false,
                                errorCode: json?.code,
                                errorMessage: json?.error || '资金划转失败'
                            });
                        }
                    } else if (isSymbolPositionRoute) {
                        if (res.ok && json && json.success && Array.isArray(json.positions)) {
                            const active = json.positions.filter((p: any) => Math.abs(parseFloat(p.positionAmt || '0')) > 0.000001);
                            if (active.length > 0) {
                                for (const p of active) {
                                    const amt = Math.abs(parseFloat(p.positionAmt || '0'));
                                    const pSide = parseFloat(p.positionAmt) > 0 ? '多头持仓 (做多)' : '空头持仓 (做空)';
                                    const ePrice = p.entryPrice;
                                    const pnl = Number(p.unRealizedProfit || 0).toFixed(2);
                                    logBinanceInboundResponse({
                                        actionType: '单币穿透核验',
                                        success: true,
                                        symbol: bodyJson?.symbol,
                                        extraInfo: `币安实际持仓: ${pSide} | 持仓数量: ${amt} | 开仓均价: ${ePrice} USDT | 未实现盈亏: ${pnl} USDT`
                                    });
                                }
                            } else {
                                logBinanceInboundResponse({
                                    actionType: '单币穿透核验',
                                    success: true,
                                    symbol: bodyJson?.symbol,
                                    extraInfo: `币安反馈该币种当前实际持仓数量为 0 (交易所已无持仓)`
                                });
                            }
                        } else if (!res.ok || (json && !json.success)) {
                            logBinanceInboundResponse({
                                actionType: '单币穿透核验',
                                success: false,
                                symbol: bodyJson?.symbol,
                                errorCode: json?.code,
                                errorMessage: json?.error || '向币安穿透核验持仓失败'
                            });
                        }
                    } else if (isBalanceRoute) {
                        if (res.ok && json && json.success) {
                            const isForce = bodyJson?.force;
                            if (isForce || shouldLogPeriodicBalance()) {
                                const wallet = json.totalWalletBalance !== undefined ? Number(json.totalWalletBalance).toFixed(2) : (json.marginBalance !== undefined ? Number(json.marginBalance).toFixed(2) : '--');
                                const avail = json.availableBalance !== undefined ? Number(json.availableBalance).toFixed(2) : '--';
                                const unPnl = json.totalUnrealizedProfit !== undefined ? Number(json.totalUnrealizedProfit).toFixed(2) : '0.00';
                                const activePositions = Array.isArray(json.activePositions) 
                                    ? json.activePositions 
                                    : (Array.isArray(json.positions) ? json.positions.filter((p: any) => Math.abs(parseFloat(p.positionAmt || '0')) > 0.000001) : []);
                                const posCount = activePositions.length;
                                const posSummary = activePositions.slice(0, 5).map((p: any) => `${formatCoin(p.symbol)} ${p.side || (parseFloat(p.positionAmt) > 0 ? '多' : '空')}`).join(', ');
                                logBinanceInboundResponse({
                                    actionType: '账户资产与持仓同步',
                                    success: true,
                                    extraInfo: `钱包净值: ${wallet} USDT | 可用保证金: ${avail} USDT | 未实现总盈亏: ${unPnl} USDT | 真实持仓: ${posCount} 个${posSummary ? ` [${posSummary}${posCount > 5 ? ' 等' : ''}]` : ''}`
                                });
                            }
                        } else if (!res.ok || (json && !json.success)) {
                            logBinanceInboundResponse({
                                actionType: '账户资产同步',
                                success: false,
                                errorCode: json?.code,
                                errorMessage: json?.error || '向币安拉取账户信息失败'
                            });
                        }
                    } else if (isQueryOrderRoute) {
                        if (res.ok && json && json.success) {
                            logBinanceInboundResponse({
                                actionType: '订单状态反查',
                                success: true,
                                symbol: bodyJson?.symbol || json.symbol,
                                extraInfo: `订单号: ${json.orderId || bodyJson?.orderId} | 执行状态: ${translateOrderStatus(json.status)} | 成交均价: ${json.avgPrice || json.price || 0} USDT | 已成交量: ${json.executedQty || json.qty || 0}`
                            });
                        } else if (!res.ok || (json && !json.success)) {
                            logBinanceInboundResponse({
                                actionType: '订单状态反查',
                                success: false,
                                symbol: bodyJson?.symbol,
                                errorCode: json?.code,
                                errorMessage: json?.error || '查询订单执行状态失败'
                            });
                        }
                    } else if (isTradesRoute) {
                        if (res.ok && json && json.success && Array.isArray(json.trades)) {
                            const count = json.trades.length;
                            const latest = count > 0 ? json.trades[0] : null;
                            const latestInfo = latest ? `最近一笔: ${latest.side === 'BUY' ? '买入' : '卖出'} ${latest.qty} @ ${latest.price} USDT (盈亏: ${latest.realizedPnl || 0} USDT)` : '暂无新成交';
                            logBinanceInboundResponse({
                                actionType: '成交流水账本',
                                success: true,
                                symbol: bodyJson?.symbol,
                                extraInfo: `成功获取 ${count} 条成交流水 | ${latestInfo}`
                            });
                        } else if (!res.ok || (json && !json.success)) {
                            logBinanceInboundResponse({
                                actionType: '成交流水账本',
                                success: false,
                                symbol: bodyJson?.symbol,
                                errorCode: json?.code,
                                errorMessage: json?.error || '获取币安成交流水失败'
                            });
                        }
                    } else if (isUserStreamRoute) {
                        if (res.ok && json && json.success) {
                            logBinanceInboundResponse({
                                actionType: '实时数据流建立',
                                success: true,
                                extraInfo: '币安已返回 ListenKey，实时订单成交与资金通道保持通畅'
                            });
                        } else if (!res.ok || (json && !json.success)) {
                            logBinanceInboundResponse({
                                actionType: '实时数据流建立',
                                success: false,
                                errorCode: json?.code,
                                errorMessage: json?.error || '申请 ListenKey 失败'
                            });
                        }
                    }
                }).catch(async () => {
                    // 🛡️ 容错分支：若返回非 JSON 响应（如 500/502/504 HTML 页面或纯文本），自动捕获并输出中文日志
                    try {
                        const textClone = res.clone();
                        const rawText = await textClone.text();
                        const shortText = rawText ? rawText.slice(0, 150) : '';
                        logBinanceInboundResponse({
                            actionType: isOrderRoute ? (bodyJson?.action === 'OPEN' ? '开仓' : '平仓') : '网络请求',
                            success: res.ok,
                            symbol: bodyJson?.symbol,
                            side: bodyJson?.side,
                            errorCode: res.status,
                            errorMessage: translateBinanceError(res.status, shortText || res.statusText || '币安服务器返回非预期响应')
                        });
                    } catch (textErr) {
                        logBinanceInboundResponse({
                            actionType: isOrderRoute ? (bodyJson?.action === 'OPEN' ? '开仓' : '平仓') : '网络请求',
                            success: false,
                            errorCode: res.status,
                            errorMessage: translateBinanceError(res.status, res.statusText || '请求异常响应')
                        });
                    }
                });
            } catch (e) {}

            return res;
        } catch (err: any) {
            logBinanceInboundResponse({
                actionType: isOrderRoute ? '订单网络请求' : '网络请求',
                success: false,
                symbol: bodyJson?.symbol,
                side: bodyJson?.side,
                errorMessage: `网络底层连接异常: ${err.message || err}`
            });
            throw err;
        }
    } catch (outerErr) {
        return rawFetch(input, init);
    }
}

/**
 * 安全尝试挂载全局网络拦截器（若环境为只读 Getter 则静默跳过，绝不报错崩溃）
 */
export function installBinanceFetchInterceptor(): void {
    if (typeof window === 'undefined') return;
    getNativeFetch(); // 确保原生 fetch 已被安全捕获
    if (isInterceptorInstalled) return;
    isInterceptorInstalled = true;

    try {
        // 1. 尝试通过 Object.defineProperty 代理 window.fetch，穿透大部分 iframe 限制
        try {
            Object.defineProperty(window, 'fetch', {
                value: binanceFetch,
                writable: true,
                configurable: true,
                enumerable: true
            });
            console.log("🛡️ [BinanceLogger] 全局 window.fetch 拦截器已通过 defineProperty 安全挂载");
            return;
        } catch (defErr) {
            // 2. 回退到直接赋值
            (window as any).fetch = binanceFetch;
            console.log("🛡️ [BinanceLogger] 全局 window.fetch 拦截器已通过直接赋值挂载");
        }
    } catch (e) {
        console.log("🛡️ [BinanceLogger] 拦截器安装完成 (模块级保障已生效)");
    }
}

// 立即在模块加载时安全尝试激活拦截器
if (typeof window !== 'undefined') {
    installBinanceFetchInterceptor();
    (window as any).__BINANCE_LOGGER__ = {
        logRequest: logBinanceOutboundRequest,
        logResponse: logBinanceInboundResponse,
        logPush: logBinancePushEvent,
        translateError: translateBinanceError,
        translateStatus: translateOrderStatus,
        translateSide: translateSideAndAction,
        formatCoin: formatCoin,
        setSink: setBinanceLogSink,
        installInterceptor: installBinanceFetchInterceptor,
        binanceFetch
    };
}

