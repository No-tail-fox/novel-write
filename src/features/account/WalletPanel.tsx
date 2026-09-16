import { useEffect, useRef, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { formatCredits, type CommercialSnapshot, type LedgerEntry, type RechargeOrder, type RechargeProduct } from '../../shared/commercial-contract';
import { Button, Dialog, TextField } from '../../ui';
import { CommercialNotice, formatCommercialDate, formatFen, PaymentCode } from './commercial-ui';
import { notifyCommercialChanged } from './useCommercialSnapshot';
import { useCommercialAction } from './useCommercialAction';
import { getCommercialStore } from './commercial-store';

const orderLabels: Record<RechargeOrder['status'], string> = { payment_pending: '等待支付', credited: '积分已到账', expired: '订单已过期', refund_pending: '退款处理中', refunded: '已退款' };
const pendingOrder = (order: RechargeOrder | null) => order?.status === 'payment_pending' || order?.status === 'refund_pending';

export function WalletPanel({ api, snapshot }: { api: StoryDreamApi; snapshot: CommercialSnapshot }) {
  const userId = snapshot.user!.id;
  const [products, setProducts] = useState<RechargeProduct[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<RechargeProduct | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const orderId = useRef<string | null>(null);
  const mounted = useRef(true);
  const loadingRevision = useRef(0);
  const action = useCommercialAction(api);
  const createOperation = useRef('');
  const refundOperation = useRef('');
  const stillCurrent = () => mounted.current && getCommercialStore(api.commercial).getState().snapshot?.user?.id === userId;
  async function load() {
    const revision = ++loadingRevision.current;
    setLoading(true); setLoadError('');
    const results = await Promise.allSettled([api.commercial.listProducts(), api.commercial.listTransactions()]);
    if (!stillCurrent() || revision !== loadingRevision.current) return;
    if (results[0].status === 'fulfilled') setProducts(results[0].value);
    if (results[1].status === 'fulfilled') setEntries(results[1].value);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') setLoadError(failed.reason instanceof Error ? failed.reason.message : '钱包记录读取失败。');
    setLoading(false);
  }
  function acceptOrder(next: RechargeOrder) { orderId.current = next.id; setOrder(next); }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; loadingRevision.current++; }; }, [api, userId]);
  useEffect(() => {
    if (!order || !pendingOrder(order)) return;
    let disposed = false;
    const id = order.id;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.commercial.getOrder(id);
        if (disposed || !stillCurrent() || orderId.current !== id) return;
        setOrder(next);
        if (!pendingOrder(next)) { notifyCommercialChanged(api); void load(); return; }
      } catch (failure) { if (!disposed && stillCurrent()) setLoadError(failure instanceof Error ? failure.message : '订单状态更新失败，请手动刷新。'); }
      if (!disposed) timer = setTimeout(poll, 5000);
    }
    timer = setTimeout(poll, 5000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, order?.id, order?.status, userId]);
  return <>
    <div className="commercial-metrics" aria-label="积分余额"><div className="commercial-metric"><span>可用积分</span><strong>{snapshot.wallet ? formatCredits(snapshot.wallet.availableUnits) : '—'}</strong><small>可用于新的平台任务</small></div><div className="commercial-metric"><span>预留积分</span><strong>{snapshot.wallet ? formatCredits(snapshot.wallet.reservedUnits) : '—'}</strong><small>运行中的任务完成后结算</small></div><div className="commercial-metric"><span>冻结积分</span><strong>{snapshot.wallet ? formatCredits(snapshot.wallet.frozenUnits) : '—'}</strong><small>退款或核查中的额度</small></div></div>
    <section className="commercial-section"><div className="commercial-section-heading"><h3>充值积分</h3><Button density="compact" onClick={() => void load()} disabled={loading || action.busy}>刷新商品与流水</Button></div>
      {!snapshot.paymentAvailable && <CommercialNotice>当前服务尚未开放充值。支付渠道启用后才可创建订单。</CommercialNotice>}
      {loading && products.length === 0 ? <p role="status" className="commercial-muted">正在读取充值商品…</p> : products.length ? <div className="commercial-products">{products.map((product) => <div className="commercial-product" key={product.id}><h3>{product.name}</h3><strong>{formatCredits(product.creditUnits)} 积分</strong><span>¥ {formatFen(product.amountFen)}</span><Button disabled={!snapshot.paymentAvailable || action.busy || pendingOrder(order)} onClick={() => { createOperation.current = crypto.randomUUID(); setSelectedProduct(product); }}>选择充值</Button></div>)}</div> : <p className="commercial-muted">暂无可购买的充值商品。</p>}
      <p className="commercial-muted">充值成功以服务端确认支付并入账为准。充值不会自动启动或重试生成任务。</p>
      {loadError && <CommercialNotice error>{loadError}</CommercialNotice>}
    </section>
    <section className="commercial-section"><h3>订单状态</h3><div className="commercial-form"><TextField label="查询历史订单" value={lookupId} onChange={(_, data) => setLookupId(data.value)} placeholder="输入本账号的订单号" /><div><Button disabled={action.busy || !lookupId.trim()} onClick={() => void action.run(() => api.commercial.getOrder(lookupId.trim()), acceptOrder)}>查询订单</Button></div></div>
      {order ? <div className="commercial-order"><div className="commercial-section-heading"><strong>{orderLabels[order.status]}</strong><span className="commercial-muted">{formatCommercialDate(order.createdAt)}</span></div><dl className="commercial-details"><div><dt>订单号</dt><dd>{order.id}</dd></div><div><dt>支付金额 / 积分</dt><dd>¥ {formatFen(order.amountFen)} / {formatCredits(order.creditUnits)} 积分</dd></div>{order.status === 'payment_pending' && <div><dt>支付有效期</dt><dd>{formatCommercialDate(order.expiresAt)}</dd></div>}</dl><PaymentCode key={order.id} order={order} /><div className="commercial-actions"><Button density="compact" disabled={action.busy} onClick={() => void action.run(() => api.commercial.getOrder(order.id), (next) => { acceptOrder(next); notifyCommercialChanged(api); void load(); })}>刷新订单状态</Button>{order.status === 'credited' && <Button density="compact" disabled={action.busy} onClick={() => { refundOperation.current = crypto.randomUUID(); setRefundOpen(true); }}>申请退款</Button>}</div></div> : <p className="commercial-muted">创建订单后会自动查询支付结果，也可输入订单号找回历史订单。</p>}
      {action.error && <CommercialNotice error>{action.error}</CommercialNotice>}{action.message && <p role="status" className="commercial-muted">{action.message}</p>}
    </section>
    <section className="commercial-section"><h3>积分流水</h3>{entries.length ? <div className="commercial-table-wrap"><table className="commercial-table"><thead><tr><th>发生时间</th><th>说明 / 关联记录</th><th>可用变化</th><th>预留变化</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{formatCommercialDate(entry.createdAt)}</td><td className="commercial-id">{entry.description}<div className="commercial-muted">{entry.referenceId}</div></td><td className="commercial-number">{formatCredits(entry.availableDelta)}</td><td className="commercial-number">{formatCredits(entry.reservedDelta)}</td></tr>)}</tbody></table></div> : <p className="commercial-muted">{loading ? '正在读取积分流水…' : '当前账号暂无积分流水。'}</p>}</section>
    <Dialog open={Boolean(selectedProduct)} onOpenChange={(open) => { if (!action.busy && !open) setSelectedProduct(null); }} title="确认充值商品" actions={<><Button disabled={action.busy} onClick={() => setSelectedProduct(null)}>取消</Button><Button variant="primary" disabled={action.busy || !selectedProduct} onClick={() => { if (selectedProduct) void action.run(() => api.commercial.createOrder({ productId: selectedProduct.id, version: selectedProduct.version, operationId: createOperation.current }), (next) => { acceptOrder(next); setSelectedProduct(null); }); }}>创建支付订单</Button></>}>{selectedProduct && <p>购买 {selectedProduct.name}，支付 ¥ {formatFen(selectedProduct.amountFen)}，到账 {formatCredits(selectedProduct.creditUnits)} 积分。软件授权有效期不会因此延长。</p>}{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}</Dialog>
    <Dialog open={refundOpen} onOpenChange={(open) => { if (!action.busy) setRefundOpen(open); }} title="申请订单退款？" actions={<><Button disabled={action.busy} onClick={() => setRefundOpen(false)}>取消</Button><Button variant="danger" disabled={action.busy || !order} onClick={() => { if (order) void action.run(() => api.commercial.requestRefund({ orderId: order.id, operationId: refundOperation.current }), (next) => { acceptOrder(next); setRefundOpen(false); notifyCommercialChanged(api); void load(); }); }}>提交退款申请</Button></>}><p>服务端会核验该订单未使用的付费积分并冻结可退额度，已消费或用于运行中任务的额度按退款规则处理。退款状态由支付渠道确认。</p>{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}</Dialog>
  </>;
}
