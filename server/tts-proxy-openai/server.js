import express from "express";

const app = express();
app.use(express.json({ limit: "256kb" }));

// Very permissive CORS for local/dev. Tighten for production.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || "marin";

app.get("/health", (req, res) => res.json({ ok: true }));

// Accepts: { text, voice?, instructions?, response_format? }
// Returns: audio bytes
app.post("/tts", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY env" });
    }

    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "text is required" });

    const voice = String(req.body?.voice || DEFAULT_VOICE);
    const instructions = req.body?.instructions ? String(req.body.instructions) : undefined;
    const response_format = String(req.body?.response_format || "mp3");

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: text,
        voice,
        ...(instructions ? { instructions } : {}),
        response_format,
      }),
    });

    if (!r.ok) {
      const msg = await r.text().catch(() => "");
      return res.status(502).json({ error: "Upstream TTS error", status: r.status, detail: msg.slice(0, 500) });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", response_format === "wav" ? "audio/wav" : "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: "Proxy crashed", detail: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`[tts-proxy] listening on http://localhost:${port}`);
});
