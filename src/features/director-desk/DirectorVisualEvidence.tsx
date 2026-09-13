import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { Button, SelectField } from '../../ui';
import { visualCutIssues, type ProductionVisualContinuityEvidence } from '../../shared/production-visual-continuity';
import type { ProductionQualityRecheckScope } from '../../shared/production-workflow';

export function DirectorVisualEvidence({ evidence, onLocate }: {
  evidence: ProductionVisualContinuityEvidence;
  onLocate: (scope: ProductionQualityRecheckScope) => void;
}) {
  const [selectedTime, setSelectedTime] = useState('');
  const cut = evidence.cuts.find(item => String(item.atMs) === selectedTime)
    ?? evidence.cuts.find(item => visualCutIssues(item).length) ?? evidence.cuts[0];
  if (evidence.status !== 'ok' || !cut) return null;
  const issues = visualCutIssues(cut);
  return <section className="director-visual-evidence" aria-label="切点帧证据">
    <SelectField label="切点" value={String(cut.atMs)} options={evidence.cuts.map(item => ({
      value: String(item.atMs), label: `${(item.atMs / 1000).toFixed(3)} 秒${visualCutIssues(item).length ? ' · 需复核' : ''}`,
    }))} onChange={event => setSelectedTime(event.target.value)} />
    <table><thead><tr><th scope="col">采样帧</th><th scope="col">秒</th><th scope="col">亮度 Y</th><th scope="col">帧差 Y</th><th scope="col">近黑占比</th></tr></thead>
      <tbody>{cut.frames.map((frame, index) => <tr key={frame.index}>
        <th scope="row">{['切前 2', '切前 1', '切后 1', '切后 2'][index]}</th>
        <td>{(frame.timeMs / 1000).toFixed(3)}</td><td>{frame.lumaMean.toFixed(1)}</td><td>{frame.lumaMeanAbsoluteDelta === undefined ? '未取得' : frame.lumaMeanAbsoluteDelta.toFixed(1)}</td><td>{frame.blackPercent.toFixed(0)}%</td>
      </tr>)}</tbody></table>
    {issues.length ? <p className="director-quality-context">{issues.join('、')}</p> : null}
    <Button density="compact" variant="subtle" onClick={() => onLocate({
      kind: 'media', startMs: cut.frames[0].timeMs, endMs: cut.frames[3].timeMs + 1000 / evidence.fps,
    })}><LocateFixed size={13} />定位此切点</Button>
  </section>;
}
