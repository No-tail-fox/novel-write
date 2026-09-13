"""Diagnose actual short-scene acrossfade audio without network calls."""
import json
import re
import runpy
from pathlib import Path

root = Path(__file__).resolve().parents[1]
artifacts = root / '.artifacts/compose-capacity-qa'
namespace = runpy.run_path(str(artifacts / 'storybound-media-sidecar/sidecar.py'))
compose = namespace['_compose_with_xfade']
context = compose.__globals__
original = context['run_composition_ffmpeg']
results = []
for count, variant in [(2, 'original'), (5, 'original'), (10, 'original'), (10, 'reblock'), (10, 'input-reblock')]:
    def execute(args):
        args = args[:]
        index = args.index('-filter_complex') + 1
        args[index] = re.sub(r',atrim=duration=[0-9.eE+-]+,asetpts=PTS-STARTPTS,asetnsamples=n=1024:p=0', '', args[index])
        if variant == 'reblock':
            args[index] = args[index].replace(':c2=tri', ':c2=tri,asetnsamples=n=1024:p=0')
        if variant == 'input-reblock':
            args[index] = args[index].replace('channel_layouts=stereo', 'channel_layouts=stereo,asetnsamples=n=1024:p=0')
        original(args)
    context['run_composition_ffmpeg'] = execute
    output = artifacts / f'audio-chain-{count}-{variant}.mp4'
    try:
        compose([str(artifacts / 'segment.mp4')]*count, str(output), 'fade', .0625)
        results.append({'count': count, 'variant': variant, 'status': 'passed', 'duration': namespace['media_duration_s'](str(output))})
    except Exception as error:
        results.append({'count': count, 'variant': variant, 'status': 'failed', 'error': str(error)[-300:]})
(artifacts / 'audio-chain-report.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
