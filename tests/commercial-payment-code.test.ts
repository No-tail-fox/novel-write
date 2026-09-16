import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaymentCode, paymentTargetForOrder, safePaymentTarget, safePaymentUrl } from '../src/features/account/commercial-ui';
import type { RechargeOrder } from '../src/shared/commercial-contract';

const native = 'weixin://wxpay/bizpayurl?pr=Native_token-123';
const order = (overrides: Partial<RechargeOrder> = {}): RechargeOrder => ({ id: 'order-1', amountFen: '3000', creditUnits: '3000000', status: 'payment_pending', paymentUrl: native, expiresAt: new Date(Date.now() + 60000).toISOString(), createdAt: new Date().toISOString(), ...overrides });

describe('validated local payment QR', () => {
  it('accepts the exact WeChat Native payment shape but never makes it a browser link', () => {
    expect(safePaymentTarget(native)).toEqual({ kind: 'wechat', value: native });
    expect(safePaymentUrl(native)).toBeUndefined();
    expect(safePaymentUrl('https://pay.example.com/order/1')).toBe('https://pay.example.com/order/1');
  });
  it.each([
    'javascript:alert(1)', 'data:text/html,<script></script>', 'http://pay.example.com', 'file:///C:/secret',
    'https://user:password@pay.example.com', 'https://pay.example.com/#unsafe', ' https://pay.example.com',
    'weixin://other/bizpayurl?pr=123', 'weixin://wxpay/launch?pr=123', 'weixin://wxpay:443/bizpayurl?pr=123',
    'weixin://wxpay/bizpayurl?pr=', 'weixin://wxpay/bizpayurl?pr=one&pr=two', 'weixin://wxpay/bizpayurl?pr=one&redirect=https://other.example',
    'weixin://wxpay/bizpayurl?pr=one#fragment', 'weixin://user@wxpay/bizpayurl?pr=one', 'weixin://wxpay/bizpayurl?pr=%0Aone',
  ])('rejects unsupported or ambiguous payment targets: %s', (value) => { expect(safePaymentTarget(value)).toBeUndefined(); });
  it('returns no payment target at the exact deadline or for any completed/refunding order', () => {
    const pending = order(); const expiry = Date.parse(pending.expiresAt);
    expect(paymentTargetForOrder(pending, expiry - 1)?.kind).toBe('wechat');
    expect(paymentTargetForOrder(pending, expiry)).toBeUndefined();
    for (const status of ['credited', 'expired', 'refund_pending', 'refunded'] as const) expect(paymentTargetForOrder(order({ status }))).toBeUndefined();
    expect(paymentTargetForOrder(order({ expiresAt: 'invalid' }))).toBeUndefined();
  });
  it('renders an accessible locally encoded QR with the authoritative amount and no image/network URL', () => {
    const html = renderToStaticMarkup(createElement(PaymentCode, { order: order() }));
    expect(html).toContain('<svg'); expect(html).toContain('<path'); expect(html).toContain('微信支付二维码');
    expect(html).toContain('¥ 30.00'); expect(html).toContain('使用微信扫一扫付款');
    expect(html).not.toContain('<img'); expect(html).not.toContain('<a'); expect(html).not.toContain('src=');
  });
  it('hides QR for expired and settled orders and only links a validated HTTPS target', () => {
    const expired = renderToStaticMarkup(createElement(PaymentCode, { order: order({ expiresAt: new Date(Date.now() - 1).toISOString() }) }));
    expect(expired).toContain('已到期并隐藏'); expect(expired).not.toContain('commercial-payment-code__image');
    expect(renderToStaticMarkup(createElement(PaymentCode, { order: order({ status: 'credited' }) }))).toBe('');
    const https = renderToStaticMarkup(createElement(PaymentCode, { order: order({ paymentUrl: 'https://pay.example.com/order/1' }) }));
    expect(https).toContain('href="https://pay.example.com/order/1"'); expect(https).toContain('noreferrer noopener');
  });
});
