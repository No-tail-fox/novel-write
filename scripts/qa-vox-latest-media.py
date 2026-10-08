from pathlib import Path
import json
import re
import sqlite3
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts' / 'vox-latest-media-20260916'
OUT.mkdir(parents=True, exist_ok=True)
DB = sqlite3.connect('file:C:/Users/foxnotail/AppData/Roaming/storydream/storydream/data.db?mode=ro', uri=True)
DB.row_factory = sqlite3.Row

def sanitized(value):
    if isinstance(value, dict):
        return {k: sanitized(v) for k, v in value.items() if not re.search(r'api.?key|authorization|credentials|access.?token|secret|password|providerConfig', k, re.I)}
    if isinstance(value, list):
        return [sanitized(v) for v in value]
    if isinstance(value, str):
        value = re.sub(r'Bearer\s+\S+', 'Bearer [REDACTED]', value, flags=re.I)
        value = re.sub(r'\bsk-[A-Za-z0-9_-]+', '[REDACTED]', value)
        value = re.sub(r'https?://[^\s"<>]+', '[REMOTE_URL]', value)
    return value

def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

rows = []
for row in DB.execute("SELECT id,title,created_at,pipeline_data FROM tasks WHERE task_type='editorial-collage'"):
    item = dict(row)
    project = json.loads(item.pop('pipeline_data'))
    item.update(updatedAt=project.get('updatedAt'), stage=project.get('stage'), beatCount=len(project.get('beats', [])), assetCount=len(project.get('assets', [])), jobCount=len(project.get('providerJobs', [])))
    rows.append((item, project))
rows.sort(key=lambda pair: pair[0]['updatedAt'] or pair[0]['created_at'], reverse=True)
save('inventory.json', [item for item, _ in rows])

reports = []
for item, project in rows[:2]:
    save(f"project-{item['id']}.json", sanitized(project))
    assets = {}
    for asset in project.get('assets', []):
        info = {key: asset.get(key) for key in ('id', 'assetId', 'kind', 'role', 'nodeId', 'shotId', 'localPath', 'durationMs', 'createdAt') if asset.get(key) is not None}
        path = Path(asset.get('localPath', ''))
        info['fileExists'] = path.is_file()
        if path.is_file() and asset.get('kind') == 'image':
            try:
                with Image.open(path) as image:
                    info.update(size=list(image.size), mode=image.mode)
                    if 'A' in image.getbands():
                        alpha = image.getchannel('A')
                        histogram = alpha.histogram()
                        count = image.width * image.height
                        info.update(transparentPixelRatio=sum(histogram[:16]) / count, partiallyTransparentPixelRatio=sum(histogram[16:240]) / count, opaquePixelRatio=sum(histogram[240:]) / count)
                    else:
                        info.update(transparentPixelRatio=0, partiallyTransparentPixelRatio=0, opaquePixelRatio=1)
            except Exception as error:
                info['inspectionError'] = str(error)
        assets[asset['id']] = info
    shots = []
    for beat in project.get('beats', []):
        for shot in beat.get('shots', []):
            current = {key: shot.get(key) for key in ('id', 'title', 'description', 'mode', 'renderMode', 'renderStrategy', 'renderer', 'motionStyle', 'animation', 'durationMs') if shot.get(key) is not None}
            current['allKeys'] = list(shot.keys())
            current['layers'] = []
            for layer in shot.get('layers', []):
                data = {key: layer.get(key) for key in ('id', 'kind', 'role', 'label', 'assetId', 'assetVersionId', 'zIndex', 'depth', 'transform', 'keyframes', 'motion', 'enabled') if layer.get(key) is not None}
                data['boundAsset'] = assets.get(layer.get('assetVersionId'))
                current['layers'].append(data)
            shots.append(current)
    report = dict(item, shots=shots, assets=list(assets.values()), providerJobs=sanitized(project.get('providerJobs', [])), qualityReports=sanitized(project.get('qualityReports', [])), timeline=sanitized(project.get('timeline', {})))
    save(f"report-{item['id']}.json", report)
    reports.append(report)
save('report.json', reports)
print(json.dumps([dict(item, shots=len(report['shots'])) for (item, _), report in zip(rows, reports)], ensure_ascii=False, indent=2))
