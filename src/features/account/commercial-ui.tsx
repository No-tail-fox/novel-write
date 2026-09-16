import { useEffect, useState, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertCircle, RefreshCw, ServerOff } from 'lucide-react';
import { Button } from '../../ui';
import type { CommercialSnapshot, RechargeOrder } from '../../shared/commercial-contract';
import './commercial.css';

export const capabilityLabels = { text: '文本', image: '绘图', video: '视频', music: '音乐', tts: '语音合成', speechToText: '语音识别', vision: '视觉分析' } as const;
export function CommercialNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`commercial-notice${error ? ' commercial-notice--error' : ''}`} role={error ? 'alert' : 'status'}><AlertCircle size={16} /><div>{children}</div></div>;
}
export function CommercialBoundary({ snapshot, loading, error, onRetry, children, requireLogin = true }: { snapshot: CommercialSnapshot | null; loading: boolean; error: string; onRetry: () => void; children: ReactNode; requireLogin?: boolean }) {
  if (!snapshot && loading) return <div className="commercial-empty" role="status"><RefreshCw size={22} /><strong>正在同步账号服务…</strong></div>;
  if (error) return <div className="commercial-empty"><AlertCircle size={24} /><strong>暂时无法读取服务状态</strong><p role="alert">{error}</p><Button onClick={onRetry}>重新连接</Button></div>;
  if (!snapshot?.configured) return <div className="commercial-empty"><ServerOff size={28} /><strong>账号服务尚未配置</strong><p>{snapshot?.message || '请联系运营方提供账号服务。配置完成后可登录、激活和使用平台积分。'}</p><p>已有作品和本机自有 API 配置可继续保留。</p><Button onClick={onRetry} icon={<RefreshCw size={15} />}>重新检查</Button></div>;
  if (requireLogin && !snapshot.authenticated) return <div className="commercial-empty"><strong>请先登录账号</strong><p>在账号中心使用手机验证码登录后，即可同步授权、设备和积分钱包。</p></div>;
  return <>{snapshot.environment === 'development' && <CommercialNotice>开发服务 · 使用测试身份与测试交易，不代表生产授权或真实充值。</CommercialNotice>}{snapshot.message && <CommercialNotice>{snapshot.message}</CommercialNotice>}{children}</>;
}
export function formatCommercialDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function formatFen(value: string): string {
  const n = BigInt(value); return `${(n / 100n).toLocaleString('zh-CN')}.${(n % 100n).toString().padStart(2, '0')}`;
}
export function safePaymentUrl(value?: string): string | undefined {
  const target = safePaymentTarget(value);
  return target?.kind === 'https' ? target.value : undefined;
}
export interface SafePaymentTarget { kind: 'wechat' | 'https'; value: string }
export function safePaymentTarget(value?: string): SafePaymentTarget | undefined {
  if (!value || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return;
    if (url.protocol === 'https:' && url.hostname) return { kind: 'https', value: url.href };
    if (url.protocol !== 'weixin:' || url.hostname !== 'wxpay' || url.port || url.pathname !== '/bizpayurl') return;
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0][0] !== 'pr' || !/^[A-Za-z0-9_-]{1,256}$/.test(entries[0][1])) return;
    return { kind: 'wechat', value };
  } catch { return; }
}
export function paymentTargetForOrder(order: RechargeOrder, now = Date.now()): SafePaymentTarget | undefined {
  if (order.status !== 'payment_pending' || !Number.isFinite(Date.parse(order.expiresAt)) || Date.parse(order.expiresAt) <= now) return;
  return safePaymentTarget(order.paymentUrl);
}
/** Local SVG encoding: no payment URL is sent to an external QR service. */
export function PaymentCode({ order }: { order: RechargeOrder }) {
  const [observedNow, setObservedNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setObservedNow(Date.now());
    const deadline = Date.parse(order.expiresAt);
    const timer = order.status === 'payment_pending' && Number.isFinite(deadline) && deadline > Date.now() ? window.setTimeout(refresh, Math.min(60000, deadline - Date.now() + 1)) : undefined;
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [order.id, order.expiresAt, order.status, observedNow]);
  if (order.status !== 'payment_pending') return null;
  const now = Math.max(observedNow, Date.now());
  const target = paymentTargetForOrder(order, now);
  if (!Number.isFinite(Date.parse(order.expiresAt)) || Date.parse(order.expiresAt) <= now) return <CommercialNotice>支付二维码已到期并隐藏。请刷新订单状态，确认结果后再创建新订单；已支付的订单请勿重复付款。</CommercialNotice>;
  if (!target) return <CommercialNotice>服务端尚未提供可用的安全支付地址，请稍后刷新订单。</CommercialNotice>;
  return <div className="commercial-payment-code"><QRCodeSVG value={target.value} size={208} level="M" marginSize={4} title={target.kind === 'wechat' ? '微信支付二维码' : '订单支付二维码'} className="commercial-payment-code__image" /><div className="commercial-payment-code__instructions"><strong>{target.kind === 'wechat' ? '使用微信扫一扫付款' : '扫码打开安全支付页面'}</strong><p className="commercial-muted">请在手机上核对商户名称和应付金额 ¥ {formatFen(order.amountFen)} 后确认支付。</p><p className="commercial-muted">有效期至 {formatCommercialDate(order.expiresAt)}。付款后会自动查询到账结果，无需重复创建订单。</p>{target.kind === 'https' && <a href={target.value} target="_blank" rel="noreferrer noopener">前往安全支付页面</a>}</div></div>;
}
