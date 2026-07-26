import { useEffect, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { countVisibleCharacters } from '../../shared/content-metrics';
import { useAsyncAction } from '../../ui/async-action';
import { parseBookProductInfo, productInfoSummary, taskFromMutation } from '../tasks/task-formatters';
import '../../styles/features/local-labs.css';

export function BenchmarkImportPage({
  api,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [sourceLink, setSourceLink] = useState('');
  const [benchmarkTitle, setBenchmarkTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [script, setScript] = useState('');
  const [productInfo, setProductInfo] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const benchmarkAction = useAsyncAction();
  const product = parseBookProductInfo(productInfo);
  const productName = product?.name ?? '';

  useEffect(() => {
    const incomingProductInfo = sessionStorage.getItem('book_product_info');
    const incomingSearch = sessionStorage.getItem('benchmark_search');
    if (incomingProductInfo) setProductInfo(incomingProductInfo);
    if (incomingSearch) setKeyword(incomingSearch);
    sessionStorage.removeItem('book_product_info');
    sessionStorage.removeItem('benchmark_search');
  }, []);

  async function createBenchmarkTask() {
    if (!script.trim()) {
      setMessage('请先粘贴对标文案。');
      return;
    }
    if (isBrowserPreview) {
      setMessage('浏览器预览不能执行真实流水线，请在 Electron 应用中创建任务。');
      return;
    }
    await benchmarkAction.run(async () => {
      setRunning(true);
      setMessage('');
      try {
        const next = await api.createAndRunTask({
          title: benchmarkTitle.trim() || keyword.trim() || productName || '',
          inputText: script,
          mode: 'paste',
          track: productInfo ? 'ecommerce' : 'character-story',
          keepPromotion: Boolean(productInfo),
          productInfo,
          pausePoints: [],
        });
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) openTaskDetail(createdTask.id);
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <div className="local-lab-workbench benchmark-import-layout" data-local-lab-workbench="benchmark">
      <section className="local-lab-rail benchmark-source-panel">
        <div className="panel-title-row">
          <div>
            <h2>对标导入</h2>
            <span>把同类文案贴进来，按当前选品创建二改任务。</span>
          </div>
        </div>
        <Field label="来源链接">
          <input value={sourceLink} onChange={(event) => setSourceLink(event.target.value)} placeholder="抖音 / 小红书 / 视频号链接" />
        </Field>
        <Field label="账号 / 标题">
          <input value={benchmarkTitle} onChange={(event) => setBenchmarkTitle(event.target.value)} />
        </Field>
        <Field label="关键词">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={productName || '例如：民族史诗 / 睡前故事'} />
        </Field>
        <div className="benchmark-product-box">
          <span className="field-title">素材来源</span>
          <strong>{productName || '未带入选品'}</strong>
          <small>{productInfo ? productInfoSummary(productInfo) : '可从选品助手点击“去对标导入”带入商品信息'}</small>
        </div>
      </section>

      <section className="local-lab-main benchmark-script-panel">
        <div className="panel-title-row">
          <div>
            <h3>对标文案</h3>
            <span>保留原始结构，任务内再执行改写与带货控制。</span>
          </div>
          <button className="primary-action slim" type="button" disabled={running || !script.trim()} onClick={createBenchmarkTask}>
            {running ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
            用此文案创建任务
          </button>
        </div>
        <textarea className="source-textarea benchmark-script-textarea" value={script} onChange={(event) => setScript(event.target.value)} placeholder="粘贴转写稿、对标文案或人工整理后的口播稿" />
        <div className="benchmark-meta-row">
          <span>字数：{countVisibleCharacters(script)}</span>
          <span>{sourceLink ? '已记录来源链接' : '未填来源链接'}</span>
          <span>{productInfo ? '带货任务' : '常规故事任务'}</span>
        </div>
        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={benchmarkAction.feedback} />
      </section>
    </div>
  );
}
