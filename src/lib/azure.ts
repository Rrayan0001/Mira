import { AzureOpenAI } from "openai";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

let cached: AzureOpenAI | null = null;

export function getAzure(): AzureOpenAI {
  if (cached) return cached;
  cached = new AzureOpenAI({
    endpoint: required("AZURE_OPENAI_ENDPOINT"),
    apiKey: required("AZURE_OPENAI_API_KEY"),
    apiVersion: required("AZURE_OPENAI_API_VERSION"),
    deployment: required("AZURE_OPENAI_CHAT_DEPLOYMENT"),
  });
  return cached;
}

export function getChatDeployment(): string {
  return required("AZURE_OPENAI_CHAT_DEPLOYMENT");
}

export function getEmbedDeployment(): string {
  return required("AZURE_OPENAI_EMBED_DEPLOYMENT");
}

// Lazy proxy for backwards-compat `import { azure }` — does not construct
// until first property access, so `next build` without env still succeeds.
export const azure: AzureOpenAI = new Proxy({} as AzureOpenAI, {
  get(_target, prop) {
    const real = getAzure() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

// For string deployments, export empty fallbacks at build time; request-time
// code should prefer getChatDeployment()/getEmbedDeployment().
export const CHAT_DEPLOYMENT = (() => {
  try {
    return getChatDeployment();
  } catch {
    return "";
  }
})();

export const EMBED_DEPLOYMENT = (() => {
  try {
    return getEmbedDeployment();
  } catch {
    return "";
  }
})();
