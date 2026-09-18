/**
 * Minimal Lovable AI Gateway client (Responses API, streaming).
 * Server-only: never import from browser code.
 */

type JsonSchema = Record<string, unknown>;

export async function aiJson<T>(opts: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: JsonSchema;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions: opts.instructions,
      input: opts.input,
      stream: true,
      reasoning: { effort: opts.effort ?? "low", summary: "auto" },
      text: {
        format: {
          type: "json_schema",
          name: opts.schemaName,
          strict: true,
          schema: opts.schema,
        },
      },
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: { output_text?: string };
        };
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          text += evt.delta;
        } else if (evt.type === "response.completed" && evt.response?.output_text) {
          if (!text) text = evt.response.output_text;
        }
      } catch {
        // ignore malformed keepalive chunks
      }
    }
  }

  if (!text.trim()) throw new Error("AI returned an empty response");
  return JSON.parse(text) as T;
}
