import { AzureOpenAI, OpenAI } from "openai";

export function isAzureConfigured(): boolean {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

let cached: OpenAI | AzureOpenAI | null = null;

export function getAzure(): OpenAI | AzureOpenAI {
  if (cached) return cached;

  if (isAzureConfigured()) {
    cached = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview",
      deployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || "gpt-4o-mini",
    });
    return cached;
  }

  if (isOpenAIConfigured()) {
    cached = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    return cached;
  }

  throw new Error("Missing LLM credentials: Set AZURE_OPENAI_API_KEY (and AZURE_OPENAI_ENDPOINT) or OPENAI_API_KEY in environment variables.");
}

export function getChatDeployment(): string {
  if (isAzureConfigured()) {
    return process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || "gpt-4o-mini";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export function getEmbedDeployment(): string {
  if (isAzureConfigured()) {
    return process.env.AZURE_OPENAI_EMBED_DEPLOYMENT || "text-embedding-3-small";
  }
  return process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
}

// Lazy proxy for backwards-compat `import { azure }`
export const azure: OpenAI | AzureOpenAI = new Proxy({} as OpenAI | AzureOpenAI, {
  get(_target, prop) {
    const real = getAzure() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export const CHAT_DEPLOYMENT = (() => {
  try {
    return getChatDeployment();
  } catch {
    return "gpt-4o-mini";
  }
})();

export const EMBED_DEPLOYMENT = (() => {
  try {
    return getEmbedDeployment();
  } catch {
    return "text-embedding-3-small";
  }
})();

