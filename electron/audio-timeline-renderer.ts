/**
 * AudioTimeline 渲染器（backlog E-3，底座 §8.2）：VideoSpec 的整条音频时间线 → 一个音频文件，只编码一次。
 *
 * 流程：
 *   1. `buildAudioTimelineGraph` 校验 spec、生成同一张 filter graph；
 *   2. 第一遍：graph 末尾接 loudnorm 测量（print_format=json）输出到 null；
 *   3. 第二遍：同一张 graph 末尾接 loudnorm 线性应用（静音/不可测时跳过），**一次**编码为 PCM WAV 或 AAC(MP4)；
 *   4. 复检：从容器头读出精确采样数（WAV data 块 / MP4 mdhd − elst 预滚），与 spec 总采样数比对（容差 1 个采样），
 *      再解码一遍测输出响度；全部通过后原子改名为目标文件。
 *
 * ffmpeg 与其他主进程模块一致：显式传入的 `ffmpegPath`，否则随应用打包的 imageio ffmpeg（resolveFinalFilmFfmpeg）。
 * 只用于新项目（ADR-03，见 `audioTimelineStrategy`），尚未接入任何现有路线。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  AudioTimelineError, buildAudioTimelineGraph, type AudioTimelineErrorCode, type AudioTimelineGraph, type AudioTimelineLoudnormMode,
} from '../src/shared/audio-timeline-graph';
import { loudnormMeasureFilter, parseLoudnormJson, type LoudnessTarget, type LoudnormMeasurement } from '../src/shared/loudness';
import { BoundedProcessError, runBoundedProcess } from '../src/shared/process-runner';
import { VIDEO_SPEC_SAMPLE_RATE } from '../src/shared/video-spec';
import { resolveFinalFilmFfmpeg } from './final-film-gate-runner';

export type AudioTimelineCodec = 'pcm_s16le' | 'aac';

export interface AudioTimelineRenderOptions {
  spec: unknown;
  /** 片段 id（或片段 ref）→ 本地文件路径。 */
  inputs: ReadonlyMap<string, string>;
  outputPath: string;
  /** 默认 `pcm_s16le`（WAV）；`aac` 输出 MP4 容器（.m4a），256 kb/s。 */
  codec?: AudioTimelineCodec;
  aacBitrate?: string;
  /** 可注入（测试）；缺省用随应用打包的 imageio ffmpeg。 */
  ffmpegPath?: string;
  pythonRoot?: string;
  signal?: AbortSignal;
  /** 单遍 ffmpeg 的超时。默认 60 s + 片长 × 3，上限 30 min。 */
  timeoutMs?: number;
  /** 输出采样数与 spec 的允许偏差（采样）。默认 1。 */
  toleranceSamples?: number;
  log?: (line: string) => void;
}

export interface AudioTimelineLoudness { integratedLufs: number; truePeakDb: number; lra: number; thresholdLufs: number }

export interface AudioTimelineRenderResult {
  outputPath: string;
  codec: AudioTimelineCodec;
  sampleRate: typeof VIDEO_SPEC_SAMPLE_RATE;
  channels: number;
  /** spec 的总采样数（= sampleAt(durationFrames)）。 */
  durationSamples: number;
  /** 输出文件容器记录的精确采样数。 */
  outputSamples: number;
  /** 解码得到的采样数（AAC 会多出不足一帧 1024 的尾部补齐）。 */
  decodedSamples: number | null;
  loudnorm: AudioTimelineLoudnormMode;
  target: LoudnessTarget;
  /** 第一遍测得的混音响度（标准化之前）；关闭标准化或静音时为 null。 */
  measured: AudioTimelineLoudness | null;
  /** 成片音频复测的响度；静音时为 null。 */
  output: AudioTimelineLoudness | null;
  elapsedMs: number;
}

const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_STDERR_BYTES = 8 * 1024 * 1024;
const INLINE_GRAPH_LIMIT = 6_000;

const fail = (code: AudioTimelineErrorCode, message: string, retryable = false) => new AudioTimelineError(code, message, [], retryable);
const tail = (text: string, lines = 4) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-lines).join(' | ').slice(0, 800);

async function isFile(path: string) { try { return (await stat(path)).isFile(); } catch { return false; } }

function toLoudness(measurement: LoudnormMeasurement | null): AudioTimelineLoudness | null {
  if (!measurement) return null;
  return { integratedLufs: Number(measurement.input_i), truePeakDb: Number(measurement.input_tp), lra: Number(measurement.input_lra), thresholdLufs: Number(measurement.input_thresh) };
}

// ───────────────────────────── 容器采样数 ─────────────────────────────

/** WAV（RIFF/RF64 之外的普通 RIFF）：data 块字节数 ÷ 块对齐。 */
export function readWavSampleCount(buffer: Buffer): { samples: number; sampleRate: number; channels: number; bitsPerSample: number } | null {
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; blockAlign: number; bitsPerSample: number } | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('latin1', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      fmt = { channels: buffer.readUInt16LE(body + 2), sampleRate: buffer.readUInt32LE(body + 4), blockAlign: buffer.readUInt16LE(body + 12), bitsPerSample: buffer.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt && fmt.blockAlign > 0) {
      const bytes = Math.min(size, buffer.length - body);
      return { samples: Math.floor(bytes / fmt.blockAlign), sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** MP4 第一条音轨：mdhd 时长（媒体时基）减去 elst 的 media_time（AAC 预滚 1024），即实际呈现的采样数。 */
export function readMp4AudioSampleCount(buffer: Buffer): { samples: number; timescale: number; primingSamples: number } | null {
  const box = (offset: number, end: number) => {
    if (offset + 8 > end) return null;
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) { if (offset + 16 > end) return null; size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16; }
    else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) return null;
    return { type, body: offset + header, end: offset + size };
  };
  const children = (start: number, end: number) => {
    const list: Array<{ type: string; body: number; end: number }> = [];
    for (let offset = start; offset < end;) { const item = box(offset, end); if (!item) break; list.push(item); offset = item.end; }
    return list;
  };
  const moov = children(0, buffer.length).find(item => item.type === 'moov');
  if (!moov) return null;
  for (const trak of children(moov.body, moov.end).filter(item => item.type === 'trak')) {
    const parts = children(trak.body, trak.end);
    const mdia = parts.find(item => item.type === 'mdia');
    if (!mdia) continue;
    const mdiaParts = children(mdia.body, mdia.end);
    const hdlr = mdiaParts.find(item => item.type === 'hdlr');
    if (!hdlr || buffer.toString('latin1', hdlr.body + 8, hdlr.body + 12) !== 'soun') continue;
    const mdhd = mdiaParts.find(item => item.type === 'mdhd');
    if (!mdhd) return null;
    const version = buffer[mdhd.body];
    const timescale = version === 1 ? buffer.readUInt32BE(mdhd.body + 20) : buffer.readUInt32BE(mdhd.body + 12);
    const duration = version === 1 ? Number(buffer.readBigUInt64BE(mdhd.body + 24)) : buffer.readUInt32BE(mdhd.body + 16);
    let priming = 0;
    const edts = parts.find(item => item.type === 'edts');
    const elst = edts ? children(edts.body, edts.end).find(item => item.type === 'elst') : undefined;
    if (elst && buffer.readUInt32BE(elst.body + 4) > 0) {
      const elstVersion = buffer[elst.body];
      const mediaTime = elstVersion === 1 ? Number(buffer.readBigInt64BE(elst.body + 16)) : buffer.readInt32BE(elst.body + 12);
      if (mediaTime > 0) priming = mediaTime;
    }
    return { samples: duration - priming, timescale, primingSamples: priming };
  }
  return null;
}

/** astats 的整体采样数（每声道）。 */
export function parseAstatsSampleCount(stderr: string): number | null {
  const values = [...stderr.matchAll(/Number of samples:\s*(\d+)/g)].map(match => Number(match[1]));
  return values.length ? values[values.length - 1] : null;
}

// ───────────────────────────── 渲染 ─────────────────────────────

function defaultTimeoutMs(durationSamples: number) {
  const seconds = durationSamples / VIDEO_SPEC_SAMPLE_RATE;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(MIN_TIMEOUT_MS + seconds * 3000)));
}

export async function renderAudioTimeline(options: AudioTimelineRenderOptions): Promise<AudioTimelineRenderResult> {
  const started = Date.now();
  const signal = options.signal;
  const cancelled = () => fail('AUDIO_TIMELINE_CANCELLED', '音频时间线渲染已取消。');
  if (signal?.aborted) throw cancelled();
  const codec: AudioTimelineCodec = options.codec ?? 'pcm_s16le';
  if (codec !== 'pcm_s16le' && codec !== 'aac') throw fail('AUDIO_TIMELINE_RENDER_FAILED', `不支持的音频编码：${String(codec)}（只支持 pcm_s16le / aac）。`);
  const tolerance = options.toleranceSamples ?? 1;
  const log = options.log ?? (() => {});

  const measureGraph = buildAudioTimelineGraph(options.spec, options.inputs);
  for (const path of new Set(measureGraph.inputPaths)) {
    if (!await isFile(path)) throw fail('AUDIO_TIMELINE_INPUT_MISSING', `找不到音频文件：${path}`);
  }
  const binaries = await resolveFinalFilmFfmpeg({ ffmpegPath: options.ffmpegPath, pythonRoot: options.pythonRoot, ffprobePath: null });
  if (!binaries) throw fail('AUDIO_TIMELINE_FFMPEG_MISSING', options.ffmpegPath ? `找不到 ffmpeg：${options.ffmpegPath}` : '找不到随应用打包的 ffmpeg，无法渲染音频时间线。');
  const ffmpeg = binaries.ffmpegPath;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs(measureGraph.durationSamples);
  const outputPath = resolve(options.outputPath);
  const outDir = dirname(outputPath);
  await mkdir(outDir, { recursive: true });
  const id = randomUUID().slice(0, 8);
  const tempOutput = join(outDir, `.${basename(outputPath)}.${id}.tmp`);
  const scriptPaths: string[] = [];

  const run = async (args: string[], step: string, maxStdoutBytes = 64 * 1024) => {
    if (signal?.aborted) throw cancelled();
    try {
      return await runBoundedProcess(ffmpeg, args, { cwd: outDir, timeoutMs, maxStdoutBytes, maxStderrBytes: MAX_STDERR_BYTES, signal });
    } catch (error) {
      if (error instanceof BoundedProcessError) {
        if (error.code === 'PROCESS_ABORTED') throw cancelled();
        if (error.code === 'PROCESS_TIMEOUT') throw fail('AUDIO_TIMELINE_TIMEOUT', `${step}超过 ${Math.round(timeoutMs / 1000)} 秒，已停止。`, true);
        if (error.code === 'PROCESS_START_FAILED') throw fail('AUDIO_TIMELINE_FFMPEG_MISSING', `无法启动 ffmpeg（${ffmpeg}）：${error.message}`);
      }
      throw fail(step === '响度测量' ? 'AUDIO_TIMELINE_MEASURE_FAILED' : 'AUDIO_TIMELINE_RENDER_FAILED', `${step}失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  let fileGraphOption: string | undefined;
  const resolveFileGraphOption = async () => {
    if (fileGraphOption) return fileGraphOption;
    const version = await run(['-version'], '滤镜参数检测');
    const major = /ffmpeg version\s+(\d+)\./u.exec(version.stdout)?.[1];
    if (major) fileGraphOption = Number(major) >= 7 ? '-/filter_complex' : '-filter_complex_script';
    else {
      const help = await run(['-hide_banner', '-h', 'full'], '滤镜参数检测', MAX_STDERR_BYTES);
      if (help.code !== 0) throw fail('AUDIO_TIMELINE_RENDER_FAILED', `无法检测 ffmpeg 滤镜文件参数：${tail(help.stderr)}`);
      fileGraphOption = `${help.stdout}\n${help.stderr}`.includes('-filter_complex_script') ? '-filter_complex_script' : '-/filter_complex';
    }
    return fileGraphOption;
  };
  /** 过长的 graph 走脚本文件，避开 Windows 32K 命令行上限。 */
  const graphArgs = async (graph: AudioTimelineGraph) => {
    if (graph.filterComplex.length <= INLINE_GRAPH_LIMIT) return ['-filter_complex', graph.filterComplex];
    const script = join(outDir, `.${basename(outputPath)}.${id}.${scriptPaths.length}.graph.txt`);
    await writeFile(script, graph.filterComplex, 'utf8');
    scriptPaths.push(script);
    return [await resolveFileGraphOption(), script];
  };

  try {
    // 第一遍：测量。
    let measurement: LoudnormMeasurement | null = null;
    let renderGraph = measureGraph;
    if (measureGraph.loudnorm === 'measure') {
      const result = await run(['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', ...measureGraph.inputs, ...await graphArgs(measureGraph),
        '-map', `[${measureGraph.outputLabel}]`, '-f', 'null', '-'], '响度测量');
      if (result.code !== 0) throw fail('AUDIO_TIMELINE_MEASURE_FAILED', `响度测量失败（ffmpeg 退出码 ${String(result.code)}）：${tail(result.stderr)}`);
      const parsed = parseLoudnormJson(result.stderr);
      if (!parsed) throw fail('AUDIO_TIMELINE_MEASURE_FAILED', `ffmpeg 没有输出 loudnorm 测量结果：${tail(result.stderr)}`);
      measurement = parsed.measurement;
      if (!measurement) log('[audio-timeline] 混音静音或低于测量门限，跳过响度标准化。');
      renderGraph = buildAudioTimelineGraph(measureGraph.spec, options.inputs, { loudnorm: measurement });
    }

    // 第二遍：渲染并只编码一次。
    const total = renderGraph.durationSamples;
    const codecArgs = codec === 'aac'
      ? ['-c:a', 'aac', '-b:a', options.aacBitrate ?? '256k', '-f', 'mp4', '-movflags', '+faststart']
      : ['-c:a', 'pcm_s16le', '-f', 'wav'];
    const render = await run(['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'error', '-y', ...renderGraph.inputs, ...await graphArgs(renderGraph),
      '-map', `[${renderGraph.outputLabel}]`, '-ar', String(VIDEO_SPEC_SAMPLE_RATE), '-ac', String(renderGraph.channels),
      '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', ...codecArgs, tempOutput], '音频渲染');
    if (render.code !== 0 || !await isFile(tempOutput)) throw fail('AUDIO_TIMELINE_RENDER_FAILED', `音频渲染失败（ffmpeg 退出码 ${String(render.code)}）：${tail(render.stderr)}`);

    // 复检：容器采样数 + 解码采样数 + 输出响度。
    const bytes = await readFile(tempOutput);
    let outputSamples: number;
    if (codec === 'pcm_s16le') {
      const wav = readWavSampleCount(bytes);
      if (!wav || wav.sampleRate !== VIDEO_SPEC_SAMPLE_RATE || wav.channels !== renderGraph.channels || wav.bitsPerSample !== 16) {
        throw fail('AUDIO_TIMELINE_OUTPUT_INVALID', `输出的 WAV 头不符合 48 kHz / ${renderGraph.channels} 声道 / 16 bit：${JSON.stringify(wav)}`);
      }
      outputSamples = wav.samples;
    } else {
      const mp4 = readMp4AudioSampleCount(bytes);
      if (!mp4 || mp4.timescale !== VIDEO_SPEC_SAMPLE_RATE) throw fail('AUDIO_TIMELINE_OUTPUT_INVALID', `无法从输出的 MP4 读出 48 kHz 音轨时长：${JSON.stringify(mp4)}`);
      outputSamples = mp4.samples;
    }
    const probe = await run(['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-i', tempOutput, '-map', '0:a:0',
      '-af', `astats=measure_perchannel=none:measure_overall=Number_of_samples,${loudnormMeasureFilter(renderGraph.loudnessTarget)}`, '-f', 'null', '-'], '输出复检');
    if (probe.code !== 0) throw fail('AUDIO_TIMELINE_OUTPUT_INVALID', `无法解码输出音频（ffmpeg 退出码 ${String(probe.code)}）：${tail(probe.stderr)}`);
    const decodedSamples = parseAstatsSampleCount(probe.stderr);
    const output = toLoudness(parseLoudnormJson(probe.stderr)?.measurement ?? null);
    const decodedOk = decodedSamples === null || (codec === 'aac' ? decodedSamples >= total - tolerance && decodedSamples < total + 1024 + tolerance : Math.abs(decodedSamples - total) <= tolerance);
    if (Math.abs(outputSamples - total) > tolerance || !decodedOk) {
      throw fail('AUDIO_TIMELINE_DURATION_MISMATCH', `输出音频长度与时间线不一致：应为 ${total} 个采样（${(total / VIDEO_SPEC_SAMPLE_RATE).toFixed(6)} 秒），容器记录 ${outputSamples}，解码 ${String(decodedSamples)}。`);
    }
    if (signal?.aborted) throw cancelled();
    await rename(tempOutput, outputPath);
    return {
      outputPath,
      codec,
      sampleRate: VIDEO_SPEC_SAMPLE_RATE,
      channels: renderGraph.channels,
      durationSamples: total,
      outputSamples,
      decodedSamples,
      loudnorm: renderGraph.loudnorm,
      target: renderGraph.loudnessTarget,
      measured: toLoudness(measurement),
      output,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    if (signal?.aborted && !(error instanceof AudioTimelineError && error.code === 'AUDIO_TIMELINE_CANCELLED')) throw cancelled();
    throw error;
  } finally {
    await rm(tempOutput, { force: true }).catch(() => {});
    for (const script of scriptPaths) await rm(script, { force: true }).catch(() => {});
  }
}
