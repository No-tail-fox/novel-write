import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adapterRun,
  type WorkJob,
  SubmissionError,
} from "../../platform-worker/src/adapters.js";
import type { PlatformConfig } from "../src/config.js";
const config = { fixtureMode: false } as PlatformConfig;
const keyName = "PLATFORM_PROVIDER_ADAPTER_TEST_KEY";
process.env[keyName] = "test-only-secret";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD2sAAAAASUVORK5CYII=",
  "base64",
);
function job(
  adapter: string,
  capability: string,
  params: Record<string, unknown>,
): WorkJob {
  return {
    id: "job-test",
    user_id: "user-test",
    submission_key: "stable-operation-id",
    capability,
    operation: capability + ".generate",
    params,
    route_snapshot: {
      adapter,
      origin: "https://provider.example",
      credentialRef: keyName,
      upstreamModel: "model-test",
      options: {},
      unit: "request",
      unitsPerQuantity: "1000",
      minimumSuccess: 1,
    },
  };
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const assetLoader = async () => ({ bytes: png, mime: "image/png" });

test("Suno advanced generation fields remain frozen; query uses original song ids", async () => {
  const work = job("suno", "music", {
    mode: "custom",
    lyrics: "歌词",
    title: "标题",
    style: "风格",
    negativeStyle: "噪声",
    maxMode: true,
    styleWeight: 0.8,
    weirdness: 0.2,
    vocalGender: "f",
    variety: 2,
  });
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    paths.push(String(input));
    const body = JSON.parse(String(init?.body));
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-only-secret",
    );
    if (paths.length === 1) {
      assert.equal(body.max_mode, true);
      assert.equal(body.style_weight, 0.8);
      assert.equal(body.weirdness_constraint, 0.2);
      assert.equal(body.vocal_gender, "f");
      return json({
        data: [
          { id: "song-1", status: "pending" },
          { id: "song-2", status: "pending" },
        ],
      });
    }
    assert.equal(body.song_ids, "song-1,song-2");
    return json({
      data: [
        {
          id: "song-1",
          status: "complete",
          audio_url: "https://cdn.example/song.mp3",
        },
        { id: "song-2", status: "failed" },
      ],
    });
  };
  const submitted = await adapterRun(config, work, assetLoader, fetcher);
  assert.equal(submitted.state, "running");
  const queried = await adapterRun(
    config,
    { ...work, upstream_id: submitted.upstreamId },
    assetLoader,
    fetcher,
  );
  assert.equal(queried.state, "completed");
  assert.equal(queried.quantity, "1");
  assert.equal(queried.outputs?.length, 1);
  assert.deepEqual(paths, [
    "https://provider.example/api/music/create/custom",
    "https://provider.example/api/music/query",
  ]);
});
test("uncertain upstream transport does not become a definitive rejection", async () => {
  await assert.rejects(
    adapterRun(
      config,
      job("suno", "music", { description: "song" }),
      assetLoader,
      async () => {
        throw new Error("HTTP timeout with secret");
      },
    ),
    (error) =>
      error instanceof SubmissionError &&
      !error.definitive &&
      !error.message.includes("secret"),
  );
  await assert.rejects(
    adapterRun(
      config,
      job("suno", "music", { description: "song" }),
      assetLoader,
      async () => new Response("{}", { status: 400 }),
    ),
    (error) => error instanceof SubmissionError && error.definitive,
  );
});
test("text and vision use bounded token output and owned asset data", async () => {
  for (const capability of ["text", "vision"]) {
    const work = job(
      capability === "text" ? "openai-text" : "openai-vision",
      capability,
      { prompt: "test", assetId: "owned-asset", maxTokens: 123 },
    );
    work.route_snapshot.unit = "token";
    const result = await adapterRun(
      config,
      work,
      assetLoader,
      async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.max_tokens, 123);
        assert.equal(body.stream, false);
        if (capability === "vision")
          assert.match(
            body.messages[0].content[1].image_url.url,
            /^data:image\/png;base64,/,
          );
        return json({
          choices: [{ message: { content: "answer" } }],
          usage: { total_tokens: 42 },
        });
      },
    );
    assert.equal(result.quantity, "42");
    assert.equal(result.outputs?.[0].bytes?.toString(), "answer");
  }
});
test("image adapter preserves per-image delivery count", async () => {
  const work = job("openai-image", "image", {
    prompt: "test",
    n: 2,
    size: "1024x1024",
  });
  work.route_snapshot.unit = "image";
  const result = await adapterRun(
    config,
    work,
    assetLoader,
    async (_input, init) => {
      assert.equal(JSON.parse(String(init?.body)).n, 2);
      return json({
        data: [
          { b64_json: png.toString("base64") },
          { b64_json: png.toString("base64") },
        ],
      });
    },
  );
  assert.equal(result.quantity, "2");
  assert.equal(result.outputs?.length, 2);
  assert.ok(result.outputs?.[0].bytes?.equals(png));
});
test("speech returns binary audio and transcription uploads an owned file", async () => {
  const speech = job("openai-speech", "tts", {
    input: "你好🌏",
    voice: "alloy",
  });
  speech.route_snapshot.unit = "character";
  const audio = Buffer.from("ID3-test-audio");
  const result = await adapterRun(
    config,
    speech,
    assetLoader,
    async (input, init) => {
      assert.match(String(input), /\/v1\/audio\/speech$/);
      assert.equal(JSON.parse(String(init?.body)).response_format, "mp3");
      return new Response(audio);
    },
  );
  assert.equal(result.quantity, "3");
  assert.ok(result.outputs?.[0].bytes?.equals(audio));
  const transcribed = await adapterRun(
    config,
    job("openai-transcription", "speechToText", { assetId: "owned-audio" }),
    async () => ({ bytes: audio, mime: "audio/mpeg" }),
    async (input, init) => {
      assert.match(String(input), /\/v1\/audio\/transcriptions$/);
      assert.ok(init?.body instanceof FormData);
      assert.ok(init.body.get("file") instanceof Blob);
      return json({ text: "转写结果" });
    },
  );
  assert.equal(transcribed.outputs?.[0].bytes?.toString(), "转写结果");
});
test("video submission and polling download the same upstream job without another POST", async () => {
  const work = job("async-video", "video", { prompt: "test", duration: 4 }),
    calls: { path: string; method: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ path: String(input), method: String(init?.method) });
    if (calls.length === 1) return json({ id: "video-1", status: "queued" });
    if (calls.length === 2)
      return json({ id: "video-1", status: "completed", seconds: 4 });
    return new Response(Buffer.from("0000ftypmock-video"));
  };
  const first = await adapterRun(config, work, assetLoader, fetcher);
  assert.equal(first.state, "running");
  const done = await adapterRun(
    config,
    { ...work, upstream_id: first.upstreamId },
    assetLoader,
    fetcher,
  );
  assert.equal(done.state, "completed");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(
    calls[2].path,
    "https://provider.example/v1/videos/video-1/content",
  );
});
