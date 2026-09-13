"""Inspect intermediate video duration for concat timestamp drift."""
import json
import runpy
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
artifacts = root / '.artifacts/compose-capacity-qa'
namespace = runpy.run_path(str(artifacts/'storybound-media-sidecar/sidecar.py'))
context = namespace['_compose_with_hard_cuts'].__globals__
original_run, original_compose = context['run_bounded_subprocess'], context['run_composition_ffmpeg']
results = []
for variant in ['default', 'cfr', 'rate']:
    copied = []
    def execute(command, **kwargs):
        result = original_run(command, **kwargs)
        if 'pcm_f32le' in command and result.returncode == 0:
            audio = Path(command[-1])
            video = audio.with_name(audio.name.replace('audio-', 'video-')).with_suffix('.mp4')
            target = artifacts/f'clock-{variant}-{len(copied)}.mp4'
            shutil.copy2(video, target)
            copied.append(str(target))
        return result
    def compose(args):
        args = args[:]
        if variant != 'default':
            at = args.index('libx264')+1
            args[at:at] = ['-fps_mode','cfr'] if variant == 'cfr' else ['-r','24']
        original_compose(args)
    context['run_composition_ffmpeg'] = compose
    context['run_bounded_subprocess'] = execute
    namespace['_compose_with_hard_cuts']([str(artifacts/'segment.mp4')]*17,str(artifacts/f'clock-{variant}.mp4'),[.25]*17)
    context['run_bounded_subprocess'] = original_run
    results.append({'variant':variant,'durations':[namespace['media_duration_s'](path) for path in copied]})
print(json.dumps(results,indent=2))
(artifacts/'group-clock-report.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
