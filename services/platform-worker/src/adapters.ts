import type { PlatformConfig } from "../../platform-api/src/config.js";
import { validMedia, getObject } from "../../platform-api/src/artifacts.js";
import type { Tx } from "../../platform-api/src/db.js";

export interface Output {
  name: string;
  mime: string;
  bytes?: Buffer;
  url?: string;
  objectKey?: string;
  sha256?: string;
  size?: number;
}
export interface AdapterResult {
  state: "running" | "completed" | "failed";
  upstreamId?: string;
  outputs?: Output[];
  quantity?: string;
  message?: string;
}
export interface WorkJob {
  id: string;
  user_id: string;
  upstream_id?: string;
  submission_key: string;
  capability: string;
  operation: string;
  params: Record<string, any>;
  route_snapshot: {
    adapter: string;
    origin: string;
    credentialRef: string;
    upstreamModel: string;
    options: Record<string, any>;
    unit: string;
    unitsPerQuantity: string;
    minimumSuccess: number;
  };
}
export class SubmissionError extends Error {
  constructor(
    public definitive: boolean,
    message: string,
  ) {
    super(message);
  }
}
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
function tracks(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.map(object);
  const row = object(value);
  for (const key of ["clips", "songs", "results", "items", "list", "data"]) {
    if (row[key]) {
      const result = tracks(row[key]);
      if (result.length) return result;
    }
  }
  return row.id || row.song_id || row.clip_id ? [row] : [];
}
function sunoResult(value: unknown): AdapterResult {
  const songs = tracks(value),
    ids = songs.map((s) => s.song_id || s.id || s.clip_id).filter(Boolean);
  if (!ids.length) throw new SubmissionError(false, "SUBMISSION_UNKNOWN");
  const terminal = (s: Record<string, any>) =>
    [
      "complete",
      "completed",
      "success",
      "succeeded",
      "failed",
      "error",
      "failure",
    ].includes(String(s.status || s.state).toLowerCase());
  const successful = songs.filter(
    (s) =>
      ["complete", "completed", "success", "succeeded"].includes(
        String(s.status || s.state).toLowerCase(),
      ) &&
      (s.audio_url || s.audioUrl),
  );
  if (!songs.every(terminal))
    return { state: "running", upstreamId: JSON.stringify(ids) };
  if (!successful.length)
    return {
      state: "failed",
      upstreamId: JSON.stringify(ids),
      message: "PROVIDER_FAILED",
    };
  return {
    state: "completed",
    upstreamId: JSON.stringify(ids),
    quantity: "1",
    outputs: successful.map((s, i) => ({
      name: String(s.title || s.song_title || `音乐候选 ${i + 1}`) + ".mp3",
      mime: "audio/mpeg",
      url: s.audio_url || s.audioUrl,
    })),
  };
}
export async function adapterRun(
  config: PlatformConfig,
  job: WorkJob,
  assetLoader: (id: string) => Promise<{ bytes: Buffer; mime: string }>,
  fetcher: typeof fetch = fetch,
): Promise<AdapterResult> {
  const route = job.route_snapshot,
    params = job.params;
  if (route.adapter === "fixture") {
    if (!config.fixtureMode)
      throw new SubmissionError(true, "FIXTURE_DISABLED");
    const prompt = String(
      params.prompt || params.description || params.input || "",
    );
    if (prompt.includes("[fixture:unknown]"))
      throw new SubmissionError(false, "SUBMISSION_UNKNOWN");
    if (prompt.includes("[fixture:fail]"))
      return { state: "failed", message: "DEVELOPMENT_FAILURE" };
    // A short real PCM WAV makes the complete private download path testable without an upstream request.
    if (job.capability === "music" || job.capability === "tts") {
      const wav = Buffer.alloc(44 + 16000);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVE", 8);
      wav.write("fmt ", 12);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(16000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(16000, 40);
      return {
        state: "completed",
        quantity: "1",
        outputs: Array.from(
          { length: job.capability === "music" ? 2 : 1 },
          (_, i) => ({
            name: `开发测试音频 ${i + 1}.wav`,
            mime: "audio/wav",
            bytes: wav,
          }),
        ),
      };
    }
    return {
      state: "completed",
      quantity: route.unit === "image" ? String(params.n || 1) : "1",
      outputs: [
        {
          name: "开发测试结果.txt",
          mime: "text/plain",
          bytes: Buffer.from("StoryDream 本地开发测试产物\n" + prompt),
        },
      ],
    };
  }
  const apiKey = process.env[route.credentialRef];
  if (!apiKey) throw new SubmissionError(true, "PROVIDER_UNCONFIGURED");
  const origin = new URL(route.origin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/"
  )
    throw new SubmissionError(true, "PROVIDER_ROUTE_INVALID");
  async function request(
    path: string,
    body?: unknown,
    binary = false,
    method?: string,
  ) {
    const multipart = body instanceof FormData;
    let response: Response;
    try {
      response = await fetcher(origin.origin + path, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          Authorization: "Bearer " + apiKey,
          ...(!multipart && body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body:
          body === undefined
            ? undefined
            : multipart
              ? body
              : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      throw new SubmissionError(false, "PROVIDER_RESPONSE_UNKNOWN");
    }
    if (!response.ok)
      throw new SubmissionError(
        response.status >= 400 &&
          response.status < 500 &&
          ![408, 409, 429].includes(response.status),
        "PROVIDER_HTTP_" + response.status,
      );
    const maxBytes = binary ? 256 * 1024 * 1024 : 32 * 1024 * 1024;
    if (Number(response.headers.get("content-length") || 0) > maxBytes)
      throw new SubmissionError(false, "PROVIDER_RESPONSE_TOO_LARGE");
    if (!response.body)
      throw new SubmissionError(false, "PROVIDER_EMPTY_RESPONSE");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new SubmissionError(false, "PROVIDER_RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (binary) return bytes;
    let result: any;
    try {
      result = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new SubmissionError(false, "PROVIDER_RESPONSE_INVALID");
    }
    if (
      result.success === false ||
      result.error ||
      (result.code !== undefined &&
        ![0, 200, "0", "200", "success"].includes(result.code))
    )
      throw new SubmissionError(true, "PROVIDER_REJECTED");
    return result;
  }
  if (route.adapter === "suno") {
    if (job.upstream_id)
      return sunoResult(
        await request("/api/music/query", {
          model: route.upstreamModel,
          song_ids: JSON.parse(job.upstream_id).join(","),
        }),
      );
    const body: Record<string, unknown> = {
      model: route.upstreamModel,
      instrumental: !!params.instrumental,
      wait_completion: false,
      max_mode: !!params.maxMode,
      variety: params.variety || 0,
    };
    let path = "/api/music/create";
    if (params.mode === "custom") {
      path = "/api/music/create/custom";
      Object.assign(body, {
        lyrics: params.instrumental ? "" : params.lyrics || "",
        song_title: params.title || "",
        style_tags: params.style || "",
        negative_tags: params.negativeStyle || "",
        style_weight: params.styleWeight ?? 0.5,
        weirdness_constraint: params.weirdness ?? 0.5,
        ...(params.vocalGender ? { vocal_gender: params.vocalGender } : {}),
      });
    } else if (params.mode === "sounds") {
      path = "/api/music/sounds";
      Object.assign(body, {
        description: params.description || params.prompt,
        title: params.title || "",
        type: "one_shot",
        loop: !!params.loop,
        bpm: params.bpm,
        key: params.key,
      });
    } else body.description = params.description || params.prompt;
    return sunoResult(await request(path, body));
  }
  if (route.adapter === "openai-text" || route.adapter === "openai-vision") {
    const content: any[] = [{ type: "text", text: params.prompt }];
    if (route.adapter === "openai-vision") {
      const asset = await assetLoader(params.assetId);
      if (!asset.mime.startsWith("image/"))
        throw new SubmissionError(true, "ASSET_TYPE_INVALID");
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${asset.mime};base64,${asset.bytes.toString("base64")}`,
        },
      });
    }
    const result = await request("/v1/chat/completions", {
      model: route.upstreamModel,
      messages: [
        ...(params.system ? [{ role: "system", content: params.system }] : []),
        {
          role: "user",
          content: route.adapter === "openai-vision" ? content : params.prompt,
        },
      ],
      max_tokens: params.maxTokens || 4096,
      ...(params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
      stream: false,
    });
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      throw new SubmissionError(false, "PROVIDER_RESULT_EMPTY");
    const quantity =
      route.unit === "token" ? String(result.usage?.total_tokens || 0) : "1";
    if (quantity === "0")
      throw new SubmissionError(false, "PROVIDER_USAGE_MISSING");
    return {
      state: "completed",
      quantity,
      outputs: [
        { name: "生成文本.txt", mime: "text/plain", bytes: Buffer.from(text) },
      ],
    };
  }
  if (route.adapter === "openai-image") {
    const result = await request("/v1/images/generations", {
      model: route.upstreamModel,
      prompt: params.prompt,
      n: params.n || 1,
      size: params.size || "1024x1024",
      ...(params.quality ? { quality: params.quality } : {}),
    });
    const outputs: Output[] = (result.data || [])
      .map((image: Record<string, any>, i: number) => ({
        name: `图片 ${i + 1}.png`,
        mime: "image/png",
        ...(image.b64_json
          ? { bytes: Buffer.from(image.b64_json, "base64") }
          : { url: image.url }),
      }))
      .filter((o: Output) => o.bytes || o.url);
    if (!outputs.length)
      throw new SubmissionError(false, "PROVIDER_RESULT_EMPTY");
    return { state: "completed", quantity: String(outputs.length), outputs };
  }
  if (route.adapter === "openai-speech") {
    const bytes = await request(
      "/v1/audio/speech",
      {
        model: route.upstreamModel,
        input: params.input,
        voice: params.voice || "alloy",
        speed: params.speed || 1,
        response_format: "mp3",
      },
      true,
    );
    return {
      state: "completed",
      quantity:
        route.unit === "character"
          ? String(Array.from(params.input).length)
          : "1",
      outputs: [{ name: "配音.mp3", mime: "audio/mpeg", bytes }],
    };
  }
  if (route.adapter === "openai-transcription") {
    const asset = await assetLoader(params.assetId),
      form = new FormData();
    form.set("model", route.upstreamModel);
    form.set(
      "file",
      new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }),
      asset.mime === "audio/wav" ? "source.wav" : "source.mp3",
    );
    if (params.language) form.set("language", params.language);
    const result = await request("/v1/audio/transcriptions", form);
    if (typeof result.text !== "string")
      throw new SubmissionError(false, "PROVIDER_RESULT_EMPTY");
    return {
      state: "completed",
      quantity: "1",
      outputs: [
        {
          name: "转写文本.txt",
          mime: "text/plain",
          bytes: Buffer.from(result.text),
        },
      ],
    };
  }
  if (route.adapter === "async-video") {
    if (!job.upstream_id) {
      const form = new FormData();
      form.set("model", route.upstreamModel);
      form.set("prompt", params.prompt);
      form.set("seconds", String(params.duration || 4));
      if (params.size) form.set("size", params.size);
      const result = await request("/v1/videos", form);
      if (!result.id) throw new SubmissionError(false, "SUBMISSION_UNKNOWN");
      return { state: "running", upstreamId: String(result.id) };
    }
    const result = await request(
      "/v1/videos/" + encodeURIComponent(job.upstream_id),
    );
    if (result.status === "failed")
      return { state: "failed", message: "PROVIDER_FAILED" };
    if (result.status !== "completed")
      return { state: "running", upstreamId: job.upstream_id };
    const bytes = await request(
      "/v1/videos/" + encodeURIComponent(job.upstream_id) + "/content",
      undefined,
      true,
    );
    return {
      state: "completed",
      quantity:
        route.unit === "second"
          ? String(Math.ceil(Number(result.seconds || params.duration || 4)))
          : "1",
      outputs: [{ name: "生成视频.mp4", mime: "video/mp4", bytes }],
    };
  }
  throw new SubmissionError(true, "ADAPTER_UNSUPPORTED");
}
