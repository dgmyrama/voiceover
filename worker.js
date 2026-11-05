const CARTESIA_VERSION = "2026-08-14";
const GEMINI_MODELS = new Set([
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-flash-preview-05-20"
]);
const CARTESIA_MODELS = new Set(["sonic-3.6", "sonic-3.5", "sonic-3", "sonic-latest"]);

function corsHeaders(origin, env) {
  const configured = (env.ALLOWED_ORIGIN || "*").split(",").map(v => v.trim()).filter(Boolean);
  const allowedOrigin = configured.includes("*") ? "*" : (configured.includes(origin) ? origin : "null");
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
  });
}

function errorMessage(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error || parsed.title || fallback;
  } catch {
    return text || fallback;
  }
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function cartesiaFetch(path, init, env) {
  if (!env.CARTESIA_API_KEY) throw new Error("Secret CARTESIA_API_KEY belum diatur di Cloudflare.");
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.CARTESIA_API_KEY}`);
  headers.set("Cartesia-Version", CARTESIA_VERSION);
  return fetch(`https://api.cartesia.ai${path}`, { ...init, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    const allowed = cors["Access-Control-Allow-Origin"] !== "null";

    if (request.method === "OPTIONS") {
      if (!allowed) return new Response("Origin tidak diizinkan.", { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }
    if (!allowed) return json({ error: "Origin tidak diizinkan. Atur ALLOWED_ORIGIN di Worker." }, 403, cors);

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "voice-over-ai-proxy" }, 200, cors);
      }

      // Gemini tetap tersedia sebagai pilihan provider dan untuk fitur Refine Text.
      if (url.pathname === "/api/gemini" && request.method === "POST") {
        if (!env.GEMINI_API_KEY) return json({ error: "Secret GEMINI_API_KEY belum diatur di Cloudflare." }, 500, cors);
        const model = url.searchParams.get("model") || "";
        if (!GEMINI_MODELS.has(model)) return json({ error: "Model Gemini tidak diizinkan." }, 400, cors);
        const payload = await request.json();
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }
        );
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", ...cors }
        });
      }

      if (url.pathname === "/api/cartesia/voices" && request.method === "GET") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 100)));
        const language = url.searchParams.get("language");
        const query = new URLSearchParams({ limit: String(limit) });
        if (language) query.set("language", language);
        const upstream = await cartesiaFetch(`/voices?${query.toString()}`, { method: "GET" }, env);
        if (!upstream.ok) {
          const detail = await upstream.text();
          return json({ error: errorMessage(detail, "Gagal mengambil daftar suara Cartesia.") }, upstream.status, cors);
        }
        const data = await upstream.json();
        return json(data, 200, cors);
      }

      if (url.pathname === "/api/cartesia/tts" && request.method === "POST") {
        const input = await request.json();
        const transcript = String(input.transcript || "").trim();
        const voiceId = String(input.voiceId || "").trim();
        if (!transcript) return json({ error: "Naskah kosong." }, 400, cors);
        if (!voiceId) return json({ error: "Voice ID Cartesia belum dipilih." }, 400, cors);
        const modelId = CARTESIA_MODELS.has(input.modelId) ? input.modelId : "sonic-3.6";
        const language = String(input.language || "id").slice(0, 10);
        const speed = Math.max(0.6, Math.min(1.5, Number(input.speed) || 1));
        const generationConfig = { speed, volume: 1 };
        // Sonic memakai emotion sebagai arahan prosodi. Efeknya dapat bervariasi
        // menurut bahasa, model, voice, dan naskah; jangan mengklaim hasil yang pasti.
        if (typeof input.emotion === "string") {
          const allowedEmotions = new Set([
            "happy","excited","enthusiastic","content","calm","grateful","affectionate",
            "trust","sympathetic","anticipation","mysterious","angry","mad","frustrated","disgusted",
            "contempt","sad","dejected","melancholic","disappointed","hurt","guilty","bored","tired",
            "nostalgic","wistful","apologetic","hesitant","insecure","confused","resigned","anxious",
            "panicked","alarmed","scared","proud","confident","distant","skeptical","contemplative",
            "determined","peaceful","serene","threatened","envious","ironic","sarcastic","surprised",
            "amazed","flirtatious","euphoric","triumphant","elated","outraged","agitated"
          ]);
          if (allowedEmotions.has(input.emotion)) generationConfig.emotion = input.emotion;
        }
        const upstream = await cartesiaFetch("/tts/bytes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model_id: modelId,
            transcript,
            voice: voiceId,
            output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
            language,
            normalization: "auto",
            generation_config: generationConfig
          })
        }, env);
        if (!upstream.ok) {
          const detail = await upstream.text();
          return json({ error: errorMessage(detail, "Cartesia TTS gagal.") }, upstream.status, cors);
        }
        return new Response(upstream.body, {
          status: 200,
          headers: { "Content-Type": upstream.headers.get("Content-Type") || "audio/wav", "Cache-Control": "no-store", ...cors }
        });
      }

      if (url.pathname === "/api/cartesia/stt" && request.method === "POST") {
        const input = await request.json();
        if (!input.audioBase64) return json({ error: "Audio tidak ditemukan." }, 400, cors);
        const bytes = decodeBase64(input.audioBase64);
        const mimeType = String(input.mimeType || "audio/webm").split(";")[0];
        const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
        const form = new FormData();
        form.append("file", new Blob([bytes], { type: mimeType }), `recording.${extension}`);
        form.append("model", "ink-whisper");
        form.append("language", String(input.language || "id"));
        const upstream = await cartesiaFetch("/stt", { method: "POST", body: form }, env);
        const body = await upstream.text();
        if (!upstream.ok) return json({ error: errorMessage(body, "Cartesia STT gagal.") }, upstream.status, cors);
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
        });
      }

      if (url.pathname === "/api/cartesia/voice-changer" && request.method === "POST") {
        const input = await request.json();
        if (!input.audioBase64) return json({ error: "Audio tidak ditemukan." }, 400, cors);
        if (!input.voiceId) return json({ error: "Voice ID Cartesia belum dipilih." }, 400, cors);
        const bytes = decodeBase64(input.audioBase64);
        const mimeType = String(input.mimeType || "audio/webm").split(";")[0];
        const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
        const form = new FormData();
        form.append("clip", new Blob([bytes], { type: mimeType }), `voice-input.${extension}`);
        form.append("voice_id", String(input.voiceId));
        form.append("output_format[container]", "wav");
        form.append("output_format[sample_rate]", "44100");
        form.append("output_format[encoding]", "pcm_s16le");
        const upstream = await cartesiaFetch("/voice-changer/bytes", { method: "POST", body: form }, env);
        if (!upstream.ok) {
          const detail = await upstream.text();
          return json({ error: errorMessage(detail, "Cartesia Voice Changer gagal.") }, upstream.status, cors);
        }
        return new Response(upstream.body, {
          status: 200,
          headers: { "Content-Type": upstream.headers.get("Content-Type") || "audio/wav", "Cache-Control": "no-store", ...cors }
        });
      }

      return json({ error: "Endpoint tidak ditemukan." }, 404, cors);
    } catch (error) {
      return json({ error: error.message || "Terjadi kesalahan pada Worker." }, 500, cors);
    }
  }
};
