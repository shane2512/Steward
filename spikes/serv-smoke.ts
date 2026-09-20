// V-01/V-02/V-08 spike (throwaway). Never prints secrets.
import { config } from "dotenv";
import OpenAI from "openai";
config({ path: "../.env.local" });

const baseURL = process.env.SERV_BASE_URL ?? "https://inference-api.openserv.ai/v1";
const client = new OpenAI({ apiKey: process.env.SERV_API_KEY!, baseURL });

const models = await client.models.list();
const ids = models.data.map((m) => m.id);
console.log("V-01 ok; models:", ids);

const model = process.argv[2] ?? ("gpt-5.4-mini");
console.log("using model:", model, "| V-02 gpt-5.4-mini present:", ids.includes("gpt-5.4-mini"));

try {
  const { data, response } = await client.chat.completions
    .create({
      model,
      messages: [{ role: "system", content: "You output JSON only." }, { role: "user", content: "Return kind=NOOP with reason 'smoke'." }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "proposal",
          strict: true,
          schema: {
            type: "object",
            properties: { kind: { type: "string", enum: ["NOOP"] }, reason: { type: "string" } },
            required: ["kind", "reason"],
            additionalProperties: false,
          },
        },
      },
    })
    .withResponse();
  console.log("V-08 json_schema ok:", data.choices[0]?.message.content);
  console.log("request id:", data.id, "| x-request-id:", response.headers.get("x-request-id"));
  console.log("usage:", data.usage);
} catch (e: any) {
  console.log("V-08 json_schema FAILED:", e?.status, e?.message?.slice(0, 300));
}
const raw = await fetch(baseURL + "/models", { headers: { Authorization: `Bearer ${process.env.SERV_API_KEY}` } });
console.log("raw /models:", raw.status, (await raw.text()).slice(0, 300));
