export const OPENROUTER = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "google/gemini-3.8-flash";

const SYSTEM = "You read comic images and answer with exactly one JSON object, no prose, no code fences.";

export type CallStat = { stage: string; model: string; ms: number; costUsd: number; tokensIn: number; tokensOut: number; error?: string };

export type CallOptions = { key: string; model: string; effort?: "low" | "medium" | "high"; stage: string; signal?: AbortSignal; onStat?: (s: CallStat) => void };

export class LLMError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

type ORResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
};

async function complete(prompt: string, images: string[], o: CallOptions): Promise<string> {
  const content = [...images.map((url) => ({ type: "image_url", image_url: { url } })), { type: "text", text: prompt }];
  const body: Record<string, unknown> = {
    model: o.model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content },
    ],
    usage: { include: true },
  };
  if (o.effort) body.reasoning = { effort: o.effort };
  const t0 = performance.now();
  const stat: CallStat = { stage: o.stage, model: o.model, ms: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
  try {
    const res = await fetch(`${OPENROUTER}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${o.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "comic-translator",
      },
      body: JSON.stringify(body),
      signal: o.signal,
    });
    const text = await res.text();
    let out: ORResponse;
    try {
      out = JSON.parse(text);
    } catch {
      throw new LLMError(`OpenRouter ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    if (!res.ok || out.error) throw new LLMError(out.error?.message ?? `OpenRouter ${res.status}`, out.error?.code ?? res.status);
    stat.costUsd = out.usage?.cost ?? 0;
    stat.tokensIn = out.usage?.prompt_tokens ?? 0;
    stat.tokensOut = out.usage?.completion_tokens ?? 0;
    const choice = out.choices?.[0];
    if (choice?.finish_reason === "length") throw new LLMError("the model hit its output limit");
    const reply = choice?.message?.content ?? "";
    if (!reply.trim()) throw new LLMError(`empty reply (finish_reason ${choice?.finish_reason ?? "?"})`);
    return reply;
  } catch (e) {
    stat.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    stat.ms = Math.round(performance.now() - t0);
    o.onStat?.(stat);
  }
}

// call sends one prompt, extracts the JSON object and retries once on bad JSON.
export async function call<T>(prompt: string, images: string[], schema: string, o: CallOptions): Promise<T> {
  const full = `${prompt}\n\nReturn ONLY one JSON object matching this shape, no prose and no code fences:\n${schema}`;
  const want = /^\s*\{\s*"([^"]+)"/.exec(schema)?.[1];
  const parse = (text: string) => {
    const obj = extractJSON(text) as Record<string, unknown> | null;
    if (!obj || typeof obj !== "object") return null;
    if (want && !(want in obj)) return null;
    return obj as T;
  };
  const first = parse(await complete(full, images, o));
  if (first) return first;
  const second = parse(await complete(`${full}\n\nYour previous reply was not valid JSON. Return ONLY valid JSON, no prose, no code fences.`, images, o));
  if (second) return second;
  throw new LLMError("the model did not return valid JSON");
}

// extractJSON returns the first balanced {...} block that parses, forgiving trailing commas.
export function extractJSON(s: string): unknown {
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (esc) esc = false;
      else if (inStr && c === "\\") esc = true;
      else if (c === '"') inStr = !inStr;
      else if (inStr) continue;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        const raw = s.slice(start, i + 1);
        for (const candidate of [raw, stripTrailingCommas(raw)]) {
          try {
            return JSON.parse(candidate);
          } catch {}
        }
        break;
      }
    }
  }
  return null;
}

function stripTrailingCommas(raw: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (esc) esc = false;
    else if (inStr && c === "\\") esc = true;
    else if (c === '"') inStr = !inStr;
    else if (!inStr && c === ",") {
      let j = i + 1;
      while (j < raw.length && " \t\r\n".includes(raw[j])) j++;
      if (raw[j] === "}" || raw[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

export type KeyInfo = { label: string; limitRemaining: number | null; usage: number };

export async function keyInfo(key: string): Promise<KeyInfo> {
  const res = await fetch(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new LLMError(res.status === 401 ? "OpenRouter does not know this key" : `OpenRouter ${res.status}`, res.status);
  const { data } = await res.json();
  return { label: data.label, limitRemaining: data.limit_remaining ?? null, usage: data.usage ?? 0 };
}

export async function credits(key: string): Promise<number | null> {
  const res = await fetch(`${OPENROUTER}/credits`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const { data } = await res.json();
  return data.total_credits - data.total_usage;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const PKCE_KEY = "ct.pkce";

// startOAuth sends the user to OpenRouter to create a key for this site (PKCE).
export async function startOAuth(returnTo: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, returnTo }));
  const cb = `${location.origin}/oauth`;
  location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}&code_challenge=${challenge}&code_challenge_method=S256`;
}

export async function finishOAuth(code: string): Promise<{ key: string; returnTo: string }> {
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? "null") as { verifier: string; returnTo: string } | null;
  if (!saved) throw new Error("OpenRouter login was not started from this tab");
  sessionStorage.removeItem(PKCE_KEY);
  const res = await fetch(`${OPENROUTER}/auth/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: saved.verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { key } = await res.json();
  return { key, returnTo: saved.returnTo };
}
