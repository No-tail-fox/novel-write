import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AppConfig } from '../../shared/types';
import { COST_KIND_LABELS, COST_KINDS, DEFAULT_COST_CURRENCY, MAX_COST_PRICE_ROWS, type CostKind, type CostPriceRow, type CostPriceTable } from '../../shared/project-cost';
import { projectCostModelHints } from '../../shared/project-cost-sources';
import { Button, IconButton, SelectField, TextField } from '../../ui';
import '../../styles/features/project-cost.css';

type PriceField = 'inputPer1M' | 'outputPer1M' | 'cachedPer1M' | 'perImage' | 'per1kChars' | 'perCall';
const PRICE_FIELDS: Array<[PriceField, string]> = [
  ['inputPer1M', '输入/百万 tokens'], ['outputPer1M', '输出/百万 tokens'], ['cachedPer1M', '缓存/百万 tokens'],
  ['perImage', '每张图'], ['per1kChars', '每千字配音'], ['perCall', '每次调用'],
];

/** U-5: simple per-model price rows for the project cost panel. Saved with the normal settings save. */
export function CostPriceTableFields({ config, onChange }: { config: AppConfig; onChange: (table: CostPriceTable) => void }) {
  const table: CostPriceTable = config.costPriceTable ?? { currency: DEFAULT_COST_CURRENCY, rows: [] };
  // Raw text while typing ("0." must stay editable); the parsed number goes to the draft config.
  const [text, setText] = useState<Record<string, string>>({});
  const update = (rows: CostPriceRow[], resetText = false) => { if (resetText) setText({}); onChange({ ...table, rows }); };
  const setRow = (index: number, patch: Partial<CostPriceRow>) => update(table.rows.map((row, current) => current === index ? { ...row, ...patch } : row));
  function setPrice(index: number, field: PriceField, value: string) {
    setText(current => ({ ...current, [`${index}:${field}`]: value }));
    const number = Number(value);
    const row = { ...table.rows[index] };
    if (!value.trim()) delete row[field];
    else if (Number.isFinite(number) && number >= 0) row[field] = number;
    else return;
    update(table.rows.map((item, current) => current === index ? row : item));
  }
  function addCurrentModels() {
    const hints = projectCostModelHints(config);
    const known = new Set(table.rows.map(row => `${row.kind ?? ''}:${row.model.toLowerCase()}`));
    const additions = (['llm', 'image', 'tts'] as const).map(kind => ({ kind, model: hints[kind].model || hints[kind].provider }))
      .filter(row => row.model && !known.has(`${row.kind}:${row.model.toLowerCase()}`));
    update([...table.rows, ...additions].slice(0, MAX_COST_PRICE_ROWS), true);
  }
  return <div className="cost-price-table">
    <p className="cost-price-help">按模型填写单价，项目“成本”面板据此估算费用；没有单价的调用只显示次数（未定价）。只对已收到结果的调用计费，结果未知的单独提示“可能已计费”。</p>
    <TextField label="币种" value={table.currency} maxLength={3} onChange={(_, data) => onChange({ ...table, currency: data.value.toUpperCase() })} />
    {table.rows.map((row, index) => <div className="cost-price-row" key={index}>
      <TextField label="模型" value={row.model} onChange={(_, data) => setRow(index, { model: data.value })} />
      <SelectField label="类型" value={row.kind ?? ''} options={[{ value: '', label: '任意' }, ...COST_KINDS.map(kind => ({ value: kind, label: COST_KIND_LABELS[kind] }))]}
        onChange={(_, data) => setRow(index, { kind: (data.value || undefined) as CostKind | undefined })} />
      {PRICE_FIELDS.map(([field, label]) => <TextField key={field} label={label} inputMode="decimal"
        value={text[`${index}:${field}`] ?? (row[field] === undefined ? '' : String(row[field]))}
        onChange={(_, data) => setPrice(index, field, data.value)} />)}
      <IconButton label="删除单价" variant="subtle" icon={<Trash2 size={15} />} onClick={() => update(table.rows.filter((_, current) => current !== index), true)} />
    </div>)}
    <div className="button-row">
      <Button icon={<Plus size={15} />} disabled={table.rows.length >= MAX_COST_PRICE_ROWS} onClick={() => update([...table.rows, { model: '' }], true)}>添加单价</Button>
      <Button variant="subtle" disabled={table.rows.length >= MAX_COST_PRICE_ROWS} onClick={addCurrentModels}>添加当前模型</Button>
    </div>
  </div>;
}
