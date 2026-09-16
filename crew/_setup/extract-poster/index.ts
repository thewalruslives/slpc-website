// Supabase Edge Function: read an event poster and return the details.
// Deploy:  supabase functions deploy extract-poster
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Optional. Without it the dashboard still works — you just type the details in.

import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";
import { createClient } from "npm:@supabase/supabase-js@2";

// Swap this for "claude-sonnet-5" or "claude-haiku-4-5" if you'd rather trade
// a little accuracy for a lower bill. A poster is one small image either way.
const MODEL = "claude-opus-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const Poster = z.object({
  place: z.string(),
  city: z.string(),
  date: z.string(),
  eventStart: z.string(),
  eventEnd: z.string(),
  band: z.string(),
  notes: z.string(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // This call spends real API credits, so only a signed-in admin may make it.
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: admin } = await sb.from("admins")
      .select("user_id").eq("user_id", user.id).maybeSingle();
    if (!admin) return json({ error: "Not an admin" }, 403);

    const { image, mediaType, today } = await req.json();
    if (!image) return json({ error: "No image" }, 400);
    const media = ["image/jpeg", "image/png", "image/gif", "image/webp"]
      .includes(mediaType) ? mediaType : "image/jpeg";

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const prompt =
      "This image is a flyer, poster or screenshot for a crawfish boil pop-up run by " +
      "Second Line Pleasure Club at breweries, bars and wineries around the San Francisco " +
      "Bay Area.\n" +
      `Today is ${today || new Date().toISOString().slice(0, 10)}.\n\n` +
      "Read the image and report the event.\n\n" +
      "Rules:\n" +
      "- place: the venue name. Drop any leading @.\n" +
      "- city: the city or neighborhood, if shown.\n" +
      "- date: ISO YYYY-MM-DD. If the year is missing, pick the next occurrence on or " +
      "after today.\n" +
      "- eventStart / eventEnd: 24-hour HH:MM. These events run midday into the evening, " +
      'so a bare "5-8" means 17:00 to 20:00 and "12-3" means 12:00 to 15:00.\n' +
      "- band: the musical act, if one is named.\n" +
      "- notes: anything else useful, in one short phrase (ticketed, festival, private).\n" +
      '- Use an empty string for anything the image does not show. Never invent a date ' +
      "or a time.";

    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: image } },
          { type: "text", text: prompt },
        ],
      }],
      output_config: { effort: "low", format: zodOutputFormat(Poster) },
    });

    if (res.stop_reason === "refusal") return json({ error: "Could not read that image" }, 422);
    if (!res.parsed_output) return json({ error: "Nothing readable on the poster" }, 422);

    return json(res.parsed_output);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message || "Failed" }, 500);
  }
});
