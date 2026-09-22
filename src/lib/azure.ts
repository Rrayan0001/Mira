import { AzureOpenAI, OpenAI } from "openai";

/**
 * LLM provider resolution (first configured wins):
 *   1. Groq  (GROQ_API_KEY) — OpenAI-compatible, hosts open-source models
 *      like openai/gpt-oss-120b on ultra-fast LPUs. Streaming + JSON work
 *      the same as OpenAI. NOTE: Groq has no embedding models, so retrieve()
 *      relies on the local TF-IDF index (already the default).
 *   2. Azure (AZURE_OPENAI_ENDPOINT + KEY)
 *   3. OpenAI (OPENAI_API_KEY [+ OPENAI_BASE_URL])
 */

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export function isGroqActive(): boolean {
  // Active = would actually be selected by getAzure().
  return isGroqConfigured();
}

export function isAzureConfigured(): boolean {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

let cached: OpenAI | AzureOpenAI | null = null;

export function getAzure(): OpenAI | AzureOpenAI {
  if (cached) return cached;

  if (isGroqConfigured()) {
    cached = new OpenAI({
      apiKey: process.env.GROQ_API_KEY!,
      baseURL: process.env.GROQ_BASE_URL || GROQ_BASE_URL,
    });
    return cached;
  }

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

  throw new Error(
    "Missing LLM credentials: set GROQ_API_KEY, or AZURE_OPENAI_API_KEY (+ AZURE_OPENAI_ENDPOINT), or OPENAI_API_KEY in environment variables.",
  );
}

export function getChatDeployment(): string {
  if (isGroqConfigured()) {
    return process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL;
  }
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
