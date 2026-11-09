"""Media dependency adapter for the unchanged Pixelle VideoService.

Use the host's bundled FFmpeg and PyAV (already required by faster-whisper), not
system PATH or a separately installed ffprobe. This provides the probe fields
consumed by the pinned VideoService from actual libav metadata, never estimates.
"""
from pathlib import Path
from fractions import Fraction


def _rate_string(rate):
    fraction = Fraction(rate)
    return f"{fraction.numerator}/{fraction.denominator}"


def probe_media(path):
    import av
    from PIL import Image
    file = Path(path).resolve()
    if not file.is_file():
        raise ValueError("Local media file does not exist")
    if file.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
        with Image.open(file) as image:
            image.load()
            return {"format": {"duration": "0"}, "streams": [{"codec_type": "video", "width": image.width, "height": image.height, "r_frame_rate": "1/1"}]}
    with av.open(str(file)) as container:
        streams = []
        durations = []
        for stream in container.streams:
            row = {"codec_type": stream.type}
            if stream.duration is not None and stream.time_base is not None:
                duration = float(stream.duration * stream.time_base)
                row["duration"] = str(duration)
                durations.append(duration)
            if stream.type == "video":
                row.update(width=stream.width, height=stream.height, r_frame_rate=_rate_string(stream.average_rate or stream.base_rate or 30))
            if stream.type == "audio":
                row.update(sample_rate=stream.codec_context.sample_rate, channels=stream.codec_context.channels)
            streams.append(row)
        duration = float(container.duration / av.time_base) if container.duration is not None else max(durations, default=0)
        return {"format": {"duration": str(duration)}, "streams": streams}


def original_video_service():
    import ffmpeg
    import ffmpeg._run
    import imageio_ffmpeg
    from pixelle_video.services.video import VideoService
    binary = Path(imageio_ffmpeg.get_ffmpeg_exe()).resolve()
    if not binary.is_file():
        raise ValueError("Bundled FFmpeg is missing")
    # Graph construction/filters remain upstream. Only process and metadata
    # dependencies are adapted inside this single-use, credential-free worker.
    original_run_async = ffmpeg._run.run_async
    def run_async(stream_spec, cmd="ffmpeg", **kwargs):
        return original_run_async(stream_spec, cmd=str(binary), **kwargs)
    ffmpeg._run.run_async = run_async
    ffmpeg.probe = probe_media
    class BundledVideoService(VideoService):
        def _ensure_ffmpeg(self):
            self._ffmpeg_checked = True
    return BundledVideoService()

def prepare_narration(paths, output, target_ms=None):
    """Reuse actual speech; concatenate turns and pad silence to the shared clock."""
    import math
    import ffmpeg
    if not isinstance(paths, list) or not 1 <= len(paths) <= 500:
        raise ValueError("A bounded list of local narration files is required")
    duration = 0
    for path in paths:
        info = probe_media(path)
        if not any(stream["codec_type"] == "audio" for stream in info["streams"]):
            raise ValueError("A reusable narration audio stream is required")
        duration += float(info["format"]["duration"])
    target = target_ms / 1000 if target_ms is not None and not isinstance(target_ms, bool) and isinstance(target_ms, (int, float)) else duration
    if not math.isfinite(target) or not 0 < target <= 600 or duration > target + 0.15:
        raise ValueError("Invalid narration clock; speech must fit the scene (maximum 600 seconds per scene)")
    if len(paths) == 1 and abs(target - duration) < 0.001:
        return Path(paths[0]).resolve(), duration
    # ffmpeg-python merges identical graph nodes. Cached/reused voice files
    # need explicit branches, not repeated consumers of the same filter output.
    from collections import Counter
    resolved = [str(Path(path).resolve()) for path in paths]
    counts, used = Counter(resolved), Counter()
    sources = {path: ffmpeg.input(path).audio for path in counts}
    branches = {path: source.filter_multi_output("asplit", counts[path]) if counts[path] > 1 else source for path, source in sources.items()}
    streams = []
    for path in resolved:
        source = branches[path][used[path]] if counts[path] > 1 else branches[path]
        used[path] += 1
        streams.append(source.filter("aformat", sample_fmts="s16", sample_rates=48000, channel_layouts="stereo").filter("asetpts", "PTS-STARTPTS"))
    audio = streams[0] if len(streams) == 1 else ffmpeg.concat(*streams, v=0, a=1)
    audio = audio.filter("apad").filter("atrim", duration=target)
    ffmpeg.output(audio, str(output), acodec="pcm_s16le", ar=48000).run(overwrite_output=True, capture_stdout=True, capture_stderr=True)
    return Path(output), target
