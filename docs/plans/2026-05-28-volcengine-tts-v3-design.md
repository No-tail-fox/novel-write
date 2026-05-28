# Volcengine TTS V3 API Key Design

## Goal

Upgrade the Volcengine TTS provider to the current V3 HTTP Chunked API using the new console API Key flow, while keeping existing TTS profiles usable.

## Context

The current provider uses the legacy `https://openspeech.bytedance.com/api/v1/tts` endpoint with `App ID`, `Access Token`, `cluster`, `voice_type`, and a synchronous JSON response where `code = 3000` contains the final base64 audio. The current Volcengine documentation for HTTP Chunked unidirectional synthesis uses `https://openspeech.bytedance.com/api/v3/tts/unidirectional`, `X-Api-Key`, `X-Api-Resource-Id`, and a streamed sequence of JSON chunks. Audio chunks arrive as base64 in `data`; the terminal success response uses `code = 20000000`.

## Selected Approach

Use the new API Key mode as the default and primary Volcengine configuration path:

- Store `apiKey`, `resourceId`, `endpoint`, and `speaker` on the Volcengine TTS config.
- Default `resourceId` to `seed-tts-2.0`.
- Default endpoint to `https://openspeech.bytedance.com/api/v3/tts/unidirectional`.
- Keep `appId`, `accessKey`, and `cluster` fields as legacy compatibility data, but prefer `apiKey` when present.
- Provide built-in speaker presets and keep a free-form `voice_type` input for custom voices.

## Data Flow

1. Settings normalize active TTS profile into `config.tts`.
2. The narration synthesizer reads the active Volcengine config.
3. If `apiKey` is present, it sends a V3 request with:
   - `X-Api-Key`
   - `X-Api-Resource-Id`
   - `X-Api-Request-Id`
   - body containing `user.uid`, `namespace`, and `req_params`.
4. The response stream is decoded line by line.
5. Each JSON object with `data` contributes one base64 audio chunk.
6. The output file is written as one mp3 after all chunks are received.

## UI

For Volcengine TTS profiles, show:

- API Key
- Resource ID
- Endpoint
- Voice preset selector
- Default voice type input

The preset selector writes the matching `voice_type` into the speaker field. Users can still paste any custom voice type.

## Compatibility

Existing legacy fields remain in the type and normalization layer. If a profile has no `apiKey` but has old `appId/accessKey`, the provider can continue using the legacy v1 request path.

## Testing

- Config normalization preserves and mirrors `apiKey`, `resourceId`, endpoint, and speaker from the active TTS profile.
- Volcengine V3 synthesis sends the documented headers and body.
- Chunked JSON base64 audio is concatenated and written to disk.
- UI source includes the new API Key fields and voice preset controls.
