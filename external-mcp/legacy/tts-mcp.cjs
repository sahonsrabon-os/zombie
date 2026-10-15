#!/usr/bin/env node
// =============================================================================
// TTS MCP Tool — Mission Barisal v3
// Uses Microsoft Edge TTS (free, zero API key needed)
// Voice: bn-BD-NabanitaNeural (Bengali female, natural)
//
// Tools:
//   tts_speak     — Convert text to speech audio file
//   tts_voices    — List available voices
//   tts_play      — Convert text to speech AND play it
//
// Usage: node "external mcp/tts-mcp.js"
// =============================================================================

const { spawn } = require("child_process"); // NOTE: no execSync — all child procs are async (spawnAsync)
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const PORT = parseInt(process.env.TTS_MCP_PORT || "3102", 10);
const OUTPUT_DIR = process.env.TTS_OUTPUT_DIR || path.join(os.homedir(), "zombie-tts");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const DEFAULT_VOICE = process.env.TTS_VOICE || "bn-BD-NabanitaNeural";
const DEFAULT_RATE = process.env.TTS_RATE || "+0%";

const EDGE_TTS = process.env.EDGE_TTS_PATH || "edge-tts";

function safeOutputPath(value, fallbackName) {
  const name=String(value || fallbackName);
  if(path.basename(name)!==name || !/^[A-Za-z0-9._-]{1,100}\.mp3$/i.test(name)) throw new Error("tts_output_name_invalid");
  return path.join(OUTPUT_DIR,name);
}

function validateTtsOptions(text,voice,rate) {
  if(!text.trim() || text.length>20000) throw new Error("tts_text_invalid_or_too_long");
  if(!/^[A-Za-z0-9-]{1,80}$/.test(voice)) throw new Error("tts_voice_invalid");
  if(!/^[+-]\d{1,3}%$/.test(rate)) throw new Error("tts_rate_invalid");
}

// ─── Helpers ──────────────────────────────────────────────
function spawnAsync(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let killed = false;
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    proc.stdout?.on("data", d => stdout += d);
    proc.stderr?.on("data", d => stderr += d);

    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill("SIGTERM"); } catch {}
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", code => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Exit ${code}: ${stderr.trim()}`));
    });
    proc.on("error", e => { clearTimeout(timer); reject(e); });
  });
}

function makeArgs(args) {
  // Build edge-tts args safely — no shell interpretation
  const result = [];
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null && v !== "") {
      result.push(`--${k}`, String(v));
    }
  }
  return result;
}

// ─── Tool Definitions ─────────────────────────────────────
const TOOLS = [
  {
    name: "tts_speak",
    description: "Convert text to speech audio file. Uses Microsoft Edge TTS (free, no API key). Default voice: Bengali female (bn-BD-NabanitaNeural).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to convert to speech" },
        voice: { type: "string", description: "Voice name (default: bn-BD-NabanitaNeural)" },
        rate: { type: "string", description: "Speech rate (default: '+0%')" },
        output: { type: "string", description: "Custom output path (optional)" }
      },
      required: ["text"]
    }
  },
  {
    name: "tts_voices",
    description: "List available TTS voices. Filter by language.",
    inputSchema: {
      type: "object",
      properties: {
        lang: { type: "string", description: "Filter by language code (e.g. 'bn', 'en')" }
      },
      required: []
    }
  },
  {
    name: "tts_play",
    description: "Convert text to speech AND play it immediately.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to speak" },
        voice: { type: "string", description: "Voice name" },
        rate: { type: "string", description: "Speech rate" }
      },
      required: ["text"]
    }
  }
];

// ─── Tool Execution ───────────────────────────────────────
async function executeTool(name, args) {
  const startTime = Date.now();

  switch (name) {
    case "tts_speak": {
      const text = args.text || "";
      const voice = args.voice || DEFAULT_VOICE;
      const rate = args.rate || DEFAULT_RATE;
      const outputPath = safeOutputPath(args.output, `tts-${Date.now()}.mp3`);

      validateTtsOptions(text,voice,rate);

      try {
        // Use spawn — no shell interpretation, safe with any text content
        const cliArgs = makeArgs({ voice, rate, text, "write-media": outputPath });
        await spawnAsync(EDGE_TTS, cliArgs, 60000);

        const stat = fs.statSync(outputPath);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              path: outputPath,
              voice,
              rate,
              text_length: text.length,
              size_kb: Math.round(stat.size / 1024),
              elapsed_ms: Date.now() - startTime,
              message: `Audio saved. Play with: mpv "${outputPath}" or aplay "${outputPath}"`
            }, null, 2)
          }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `TTS error: ${e.message}` }] };
      }
    }

    case "tts_voices": {
      const lang = args.lang || "";
      try {
        const raw = await spawnAsync(EDGE_TTS, ["--list-voices"], 15000);
        const voices = [];
        // edge-tts outputs blocks like:
        //   Name: xxx
        //   ShortName: xxx
        //   Gender: xxx
        //   Locale: xx-XX
        // separated by blank lines
        let current = {};
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) {
            if (current.short_name) {
              if (!lang || current.locale.startsWith(lang)) {
                voices.push(current);
              }
              current = {};
            }
            continue;
          }
          if (trimmed.startsWith("Name: ")) current.name = trimmed.slice(6);
          else if (trimmed.startsWith("ShortName: ")) current.short_name = trimmed.slice(11);
          else if (trimmed.startsWith("Gender: ")) current.gender = trimmed.slice(8);
          else if (trimmed.startsWith("Locale: ")) current.locale = trimmed.slice(8);
        }
        // Push last entry
        if (current.short_name && (!lang || current.locale.startsWith(lang))) {
          voices.push(current);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              count: voices.length,
              default_voice: DEFAULT_VOICE,
              voices: voices.slice(0, 50)
            }, null, 2)
          }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Voice list error: ${e.message}` }] };
      }
    }

    case "tts_play": {
      const text = args.text || "";
      const voice = args.voice || DEFAULT_VOICE;
      const rate = args.rate || DEFAULT_RATE;

      validateTtsOptions(text,voice,rate);

      const tmpFile = safeOutputPath(null, `tts-play-${Date.now()}.mp3`);

      try {
        // Generate audio
        const cliArgs = makeArgs({ voice, rate, text, "write-media": tmpFile });
        await spawnAsync(EDGE_TTS, cliArgs, 60000);

        // Try to play: paplay > aplay > mpv > mplayer
        let played = false;
        const players = [
          ["paplay", [tmpFile]],
          ["aplay", [tmpFile]],
          ["mpv", ["--no-video", tmpFile]],
          ["mplayer", [tmpFile]],
        ];
        for (const [cmd, cmdArgs] of players) {
          try {
            await spawnAsync(cmd, cmdArgs, 30000);
            played = true;
            break;
          } catch {}
        }

        // Cleanup
        try { fs.unlinkSync(tmpFile); } catch {}

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              played,
              voice,
              rate,
              text_length: text.length,
              elapsed_ms: Date.now() - startTime,
              message: played ? "Audio played successfully" : "Audio generated but no player found (install mpv or paplay)"
            }, null, 2)
          }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `TTS play error: ${e.message}` }] };
      }
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ─── Process Error Handlers (prevent crashes) ─────────────
process.on("uncaughtException", (e) => {
  console.error(`[TTS-MCP] Uncaught exception: ${e.message}`);
});
process.on("unhandledRejection", (e) => {
  console.error(`[TTS-MCP] Unhandled rejection: ${e}`);
});

// ─── MCP JSON-RPC Server (HTTP) ──────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { res.writeHead(405); res.end("Only POST"); return; }

  let body = "";
  for await (const chunk of req) body += chunk;

  let request;
  try { request = JSON.parse(body); } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return;
  }

  const { id, method, params } = request;

  if (method === "initialize") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "tts-mcp", version: "1.1.0" }
      }
    }));
    return;
  }

  if (method === "tools/list") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }));
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};
    try {
      const result = await executeTool(toolName, args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }
      }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Method not found: " + method }));
});

// Loopback-only bind: unauthenticated local tool backend — never on LAN.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[TTS-MCP] Running on http://127.0.0.1:${PORT}`);
  console.log(`[TTS-MCP] Tools: ${TOOLS.map(t => t.name).join(", ")}`);
  console.log(`[TTS-MCP] Default voice: ${DEFAULT_VOICE}`);
  console.log(`[TTS-MCP] Output dir: ${OUTPUT_DIR}`);
});
