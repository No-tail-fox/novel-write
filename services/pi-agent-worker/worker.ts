import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { mkdir } from "node:fs/promises";
import path from "node:path";

type WorkerConfig = {
  cwd: string;
  sessionDir: string;
  sessionFile?: string;
  gatewayBaseUrl: string;
  gatewayToken: string;
  api?: "anthropic-messages" | "openai-completions" | "openai-responses";
  systemPrompt?: string;
  images?: boolean;
  reasoning?: boolean;
  tools?: Array<{ name: string; description: string; parameters: any; executionMode?: "parallel" | "sequential" }>;
  modelId?: string;
  modelName?: string;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
};

type WorkerRequest =
  | { id: string; type: "start"; config: WorkerConfig; restore?: boolean }
  | { id: string; type: "prompt"; text: string }
  | { id: string; type: "abort" }
  | { id: string; type: "compact"; instructions?: string }
  | { id: string; type: "shutdown" };

type ToolRequest = { type: "tool"; toolCallId: string; name: string; params: unknown };
type Outgoing = { id?: string; type: string; [key: string]: unknown };

const send = (message: Outgoing) => {
  if ((process as any).parentPort) (process as any).parentPort.postMessage(message);
  else if (typeof process.send === "function") process.send(message);
  else process.stdout.write(`${JSON.stringify(message)}\n`);
};

const pendingTools = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();

function makeForwardedTool(definition?: NonNullable<WorkerConfig["tools"]>[number]): ToolDefinition<any> {
  return {
    name: definition?.name ?? "storydream_host",
    label: "StoryDream host tool",
    description: definition?.description ?? "Call a host-owned StoryDream operation. The host enforces the operation allowlist and path policy.",
    parameters: definition?.parameters ?? Type.Object({
      operation: Type.String({ description: "Host operation name" }),
      input: Type.Optional(Type.Unknown({ description: "Operation-specific JSON input" })),
    }),
    executionMode: definition?.executionMode ?? "sequential",
    async execute(toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("tool call aborted");
      return await new Promise((resolve, reject) => {
        pendingTools.set(toolCallId, { resolve, reject });
        send({ type: "tool", toolCallId, name: definition?.name ?? (params as { operation: string }).operation, params: definition ? params : (params as { input?: unknown }).input ?? null });
        signal?.addEventListener("abort", () => {
          pendingTools.delete(toolCallId);
          reject(new Error("tool call aborted"));
        }, { once: true });
      });
    },
  };
}

async function create(config: WorkerConfig, restore: boolean) {
  const gateway = new URL(config.gatewayBaseUrl);
  if (gateway.protocol !== "http:" || gateway.hostname !== "127.0.0.1" || gateway.username || gateway.password) throw new Error("gateway must use http://127.0.0.1");
  if (restore && !config.sessionFile) throw new Error("restore requires sessionFile");
  if (!path.isAbsolute(config.cwd) || !path.isAbsolute(config.sessionDir)) throw new Error("cwd and sessionDir must be absolute");
  await mkdir(config.sessionDir, { recursive: true });
  const settings = SettingsManager.inMemory({
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
    compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 12_000 },
    cacheWarming: "off",
    defaultProjectTrust: "never",
    enableInstallTelemetry: false,
    enableAnalytics: false,
    defaultTools: [],
  });
  const runtime = await ModelRuntime.create({
    authPath: path.join(config.sessionDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const modelId = config.modelId ?? "storydream-model";
  runtime.registerProvider("storydream", {
    name: "StoryDream ledger gateway",
    baseUrl: config.gatewayBaseUrl,
    api: config.api ?? "anthropic-messages",
    apiKey: config.gatewayToken,
    authHeader: true,
    models: [{
      id: modelId,
      name: config.modelName ?? modelId,
      api: config.api ?? "anthropic-messages",
      baseUrl: config.gatewayBaseUrl,
      input: config.images ? ["text", "image"] : ["text"],
      reasoning: config.reasoning ?? false,
      contextWindow: config.contextWindow ?? 128_000,
      maxTokens: config.maxTokens ?? 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  });
  const model = runtime.getModel("storydream", modelId) as Model<any> | undefined;
  if (!model) throw new Error(`registered model unavailable: ${modelId}`);
  const resourceLoader = new DefaultResourceLoader({
    cwd: config.cwd,
    agentDir: config.sessionDir,
    settingsManager: settings,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: config.systemPrompt ?? "You are the StoryDream T3 worker. Use only the supplied host tools; never assume shell access.",
  });
  await resourceLoader.reload();
  const sessionManager = restore && config.sessionFile
    ? SessionManager.open(config.sessionFile, config.sessionDir, config.cwd)
    : SessionManager.create(config.cwd, config.sessionDir);
  const result = await createAgentSession({
    cwd: config.cwd,
    agentDir: config.sessionDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: config.thinkingLevel ?? "low",
    settingsManager: settings,
    resourceLoader,
    sessionManager,
    noTools: "builtin",
    tools: (config.tools ?? [{ name: "storydream_host" }]).map((tool) => tool.name),
    customTools: config.tools?.map(makeForwardedTool) ?? [makeForwardedTool()],
  });
  return result.session;
}

let session: Awaited<ReturnType<typeof create>> | undefined;
let sessionFile: string | undefined;

let busy = false;
let starting = false;

async function handle(request: WorkerRequest) {
  if (request.type === "start") {
    if (session || starting) throw new Error("worker already started");
    starting = true;
    try { session = await create(request.config, request.restore === true); }
    finally { starting = false; }
    sessionFile = session.sessionManager.getSessionFile();
    session.subscribe((event: any) => send({ type: "event", event }));
    send({ id: request.id, type: "started", sessionFile });
    return;
  }
  if (!session) throw new Error("worker session has not started");
  if (request.type === "prompt") {
    if (busy) throw new Error("worker is busy");
    busy = true;
    try { await session.prompt(request.text); }
    finally { busy = false; }
    send({ id: request.id, type: "settled", sessionFile });
  } else if (request.type === "abort") {
    await session.abort();
    send({ id: request.id, type: "aborted" });
  } else if (request.type === "compact") {
    if (busy) throw new Error("worker is busy");
    busy = true;
    try {
      const result = await session.compact(request.instructions);
      send({ id: request.id, type: "compacted", result, sessionFile });
    } finally { busy = false; }
  } else if (request.type === "shutdown") {
    await session.abort();
    send({ id: request.id, type: "shutdown" });
    process.exit(0);
  }
}

function receive(message: any) {
  if (message?.type === "tool_result") {
    const pending = pendingTools.get(message.toolCallId);
    if (!pending) return;
    pendingTools.delete(message.toolCallId);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result?.content ? message.result : { content: [{ type: "text", text: JSON.stringify(message.result ?? null) }] });
    return;
  }
  void handle(message as WorkerRequest).catch((error: unknown) => send({ id: message?.id, type: "error", error: String(error) }));
}

if ((process as any).parentPort) (process as any).parentPort.on("message", ({ data }: any) => receive(data));
else if (typeof process.send === "function") process.on("message", receive);
else {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) { try { receive(JSON.parse(line)); } catch (error) { send({ type: "error", error: String(error) }); } }
    }
  });
}
