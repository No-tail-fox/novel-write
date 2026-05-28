import { createHash, createHmac } from 'node:crypto';
import type { VolcengineSpeaker, VolcengineSpeakerListRequest, VolcengineSpeakerListResult } from './types';

type SpeakerListOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
};

const endpoint = 'https://open.volcengineapi.com/?Action=ListSpeakers&Version=2025-05-20';
const host = 'open.volcengineapi.com';
const region = 'cn-beijing';
const service = 'speech_saas_prod';

export async function listVolcengineSpeakers(
  request: VolcengineSpeakerListRequest,
  options: SpeakerListOptions = {},
): Promise<VolcengineSpeakerListResult> {
  const startedAt = Date.now();
  const accessKeyId = request.accessKeyId.trim();
  const secretAccessKey = request.secretAccessKey.trim();
  if (!accessKeyId || !secretAccessKey) {
    return buildResult({
      startedAt,
      status: 'fail',
      detail: 'AccessKey ID 和 SecretAccessKey 不能为空，火山音色列表接口使用开放平台 AK/SK 签名。',
      speakers: [],
      total: 0,
      requestId: null,
    });
  }

  const body = JSON.stringify({
    ResourceIDs: [request.resourceId?.trim() || 'seed-tts-2.0'],
    ...(request.voiceTypes?.length ? { VoiceTypes: request.voiceTypes } : {}),
    Page: request.page ?? 1,
    Limit: String(request.limit ?? 100),
  });
  const now = options.now ?? new Date();
  const xDate = formatAmzDate(now);
  const xContentSha256 = sha256Hex(body);
  const authorization = signVolcengineOpenApi({
    accessKeyId,
    secretAccessKey,
    xDate,
    xContentSha256,
    body,
  });

  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Host: host,
        'X-Date': xDate,
        'X-Content-Sha256': xContentSha256,
        Authorization: authorization,
      },
      body,
    });
    if (!response.ok) {
      return buildResult({
        startedAt,
        status: 'fail',
        detail: `火山音色列表接口错误 (${response.status}): ${await response.text()}`,
        speakers: [],
        total: 0,
        requestId: null,
      });
    }
    const data = await response.json();
    const result = parseListSpeakersResponse(data);
    return buildResult({
      startedAt,
      status: result.speakers.length ? 'pass' : 'warn',
      detail: result.speakers.length ? `已加载 ${result.speakers.length}/${result.total || result.speakers.length} 个火山音色。` : '火山音色列表为空。',
      speakers: result.speakers,
      total: result.total,
      requestId: result.requestId,
    });
  } catch (error) {
    return buildResult({
      startedAt,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      speakers: [],
      total: 0,
      requestId: null,
    });
  }
}

function parseListSpeakersResponse(data: unknown): { speakers: VolcengineSpeaker[]; total: number; requestId: string | null } {
  const root = isRecord(data) ? data : {};
  const result = isRecord(root.Result) ? root.Result : isRecord(root.result) ? root.result : {};
  const responseMetadata = isRecord(root.ResponseMetadata) ? root.ResponseMetadata : {};
  const rawSpeakers = Array.isArray(result.Speakers) ? result.Speakers : Array.isArray(result.speakers) ? result.speakers : [];
  const speakers = rawSpeakers.map(parseSpeaker).filter((speaker): speaker is VolcengineSpeaker => Boolean(speaker));
  return {
    speakers,
    total: Number(result.Total ?? result.total ?? speakers.length),
    requestId: typeof responseMetadata.RequestId === 'string' ? responseMetadata.RequestId : null,
  };
}

function parseSpeaker(value: unknown): VolcengineSpeaker | null {
  if (!isRecord(value)) return null;
  const voiceType = String(value.VoiceType ?? value.voiceType ?? value.voice_type ?? '').trim();
  if (!voiceType) return null;
  return {
    voiceType,
    name: String(value.Name ?? value.name ?? voiceType).trim() || voiceType,
    gender: optionalString(value.Gender ?? value.gender),
    age: optionalString(value.Age ?? value.age),
    labels: parseLabels(value),
    avatar: optionalString(value.Avatar ?? value.avatar) ?? '',
  };
}

function parseLabels(value: Record<string, unknown>): string[] {
  const normalLabels = Array.isArray(value.NormalLabels) ? value.NormalLabels : Array.isArray(value.normalLabels) ? value.normalLabels : [];
  const categories = Array.isArray(value.Categories) ? value.Categories : [];
  return [...normalLabels, ...categories.flatMap((category) => (isRecord(category) && Array.isArray(category.Categories) ? category.Categories : []))]
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function signVolcengineOpenApi(input: { accessKeyId: string; secretAccessKey: string; xDate: string; xContentSha256: string; body: string }): string {
  const shortDate = input.xDate.slice(0, 8);
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const canonicalRequest = [
    'POST',
    '/',
    'Action=ListSpeakers&Version=2025-05-20',
    `host:${host}\n` + `x-content-sha256:${input.xContentSha256}\n` + `x-date:${input.xDate}\n`,
    'host;x-content-sha256;x-date',
    input.xContentSha256,
  ].join('\n');
  const stringToSign = ['HMAC-SHA256', input.xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(Buffer.from(input.secretAccessKey, 'utf8'), shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=host;x-content-sha256;x-date, Signature=${signature}`;
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function buildResult(input: Omit<VolcengineSpeakerListResult, 'latencyMs' | 'endpoint'> & { startedAt: number }): VolcengineSpeakerListResult {
  return {
    status: input.status,
    detail: input.detail,
    latencyMs: Date.now() - input.startedAt,
    endpoint,
    speakers: input.speakers,
    total: input.total,
    requestId: input.requestId,
  };
}

function optionalString(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
