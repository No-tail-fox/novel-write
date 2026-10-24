import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { voxProductionSettings } from '../src/shared/vox-production';
const profile = resolve(process.argv[2]);
const live = join(process.env.APPDATA!, 'storydream', 'storydream');
await mkdir(join(profile, 'storydream'), { recursive: true });
// Electron's Windows vault also depends on the OS-encrypted profile key.
await copyFile(join(live, '..', 'Local State'), join(profile, 'Local State'));
// Copy only public settings and the OS-encrypted vault; never export runtime secrets.
for (const file of ['config.json', 'secrets.v1.json']) await copyFile(join(live, file), join(profile, 'storydream', file));
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
try {
  const dataPreset = process.env.VOX_QA_PRESET === 'data-map';
  const settings = voxProductionSettings(dataPreset ? 'data-map' : 'paper-explainer');
  const sourceText = dataPreset
    ? '这四根柱子，记录了四个年份的全球温度异常。数据来自美国宇航局的全球地表温度分析。二零零零年是零点三九摄氏度，二零一零年是零点七二摄氏度。二零二零年是一点零一摄氏度，二零二四年是一点二八摄氏度。请注意，这里展示的是四个年份的记录，并不是未来预测。'
    : '夏天走在城市里，你有没有发现，离开树荫，脚下的路面很快就变得烫脚？城市热岛，描述的就是城区比周围地区更热的现象。白天，深色道路和建筑吸收阳光，把能量储存在材料里。到了晚上，这些热量缓慢释放，街道就不容易凉下来。密集的建筑还会影响空气流动，空调和交通也会向周围排热。树木能提供遮阴，植物蒸腾时还能带走一部分热量。所以，给街道增加树荫，保护绿地，改善通风，并减少多余的排热，都是缓解热岛的办法。城市降温，需要把这些措施一起考虑。';
  if (dataPreset) {
    const csv = (await readFile(resolve('.artifacts/vox-production-paper/gistemp-source.csv'), 'utf8')).trim().split(/\r?\n/u).slice(1).map(line => line.split(','));
    const column = csv[0].indexOf('J-D');
    if (column < 0) throw new Error('Missing NASA annual column');
    settings.dataUnit = '℃';
    settings.data = [2000, 2010, 2020, 2024].map(year => {
      const value = Number(csv.find(row => row[0] === String(year))?.[column]);
      if (!Number.isFinite(value)) throw new Error(`Missing NASA annual value: ${year}`);
      return { label: `${year} 年`, value, source: 'NASA GISTEMP v4 · 年平均温度异常 · data.giss.nasa.gov/gistemp/' };
    });
    if (JSON.stringify(settings.data.map(row => row.value)) !== JSON.stringify([.39, .72, 1.01, 1.28])) throw new Error('Narration must be reviewed against changed source data');
  }
  const task = await db.createEditorialCollageTask({ title: dataPreset ? '四个年份的温度记录 · 数据预设自动样片' : '城市为什么更热 · 预设自动样片', sourceText, durationMs: dataPreset ? 'auto' : 60000, ratio: '16:9' });
  const other = await db.createEditorialCollageTask({ title: '切换项目隔离验收', sourceText: '保留这个项目的原始内容。', durationMs: 15000 });
  await db.upsertUiPreferences({ activeView: 'projects' });
  await db.upsertUiPreferences({ theme: 'dark' });
  const doc = parseEditorialCollagePipelineData(task.pipelineData);
  await writeFile(join(profile, 'seed.json'), JSON.stringify({ id: task.id, other: other.id, sourceText, settings, shotCount: doc.beats.flatMap(b => b.shots).length }), 'utf8');
} finally { await db.close(); }
