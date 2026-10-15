#!/usr/bin/env node
// =============================================================================
// OCR MCP Tool — Mission Barisal v3
// Zero dependency (uses system tesseract + ffmpeg)
//
// Tools:
//   ocr_image    — Extract text from image file (any format)
//   ocr_screenshot — Take screenshot + extract text
//   ocr_crop     — Crop region from image + extract text
//
// Usage: node "external mcp/ocr-mcp.js"
// =============================================================================

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = parseInt(process.env.OCR_MCP_PORT || "3100", 10);
const TMP_DIR = process.env.OCR_TMP_DIR || path.join(require("os").tmpdir(), "ocr-mcp");
const IMAGE_TOOL = process.platform === "win32" ? "magick" : "convert";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────
// ASYNC on purpose: the previous execSync version froze the WHOLE process for
// up to `timeoutMs` (30s) per OCR call — no other MCP request could be served
// while tesseract ran. Same timeout + stderr semantics, but the event loop
// stays free. ALL call sites must `await run(...)`.
function run(command, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Command failed: ${command}\n${stderr || err.message}`));
      resolve(String(stdout).trim());
    });
  });
}

function safeImagePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("image_path_required");
  const candidate = path.resolve(value);
  const roots = [process.cwd(), ...(process.env.PROJECT_ROOTS || "").split(path.delimiter).filter(Boolean)].map(root => path.resolve(root));
  if (!roots.some(root => candidate === root || candidate.startsWith(root + path.sep))) throw new Error("image_path_outside_project_roots");
  if (!fileExists(candidate)) throw new Error("image_file_not_found");
  return candidate;
}

function safeLangs(value) {
  const langs = String(value || process.env.OCR_LANGS || "eng");
  if (!/^[A-Za-z0-9_+.-]{1,64}$/.test(langs)) throw new Error("ocr_language_code_invalid");
  return langs;
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function detectLangs(imgPath) {
  // Default: English only for speed. Add 'ben' manually if needed.
  return process.env.OCR_LANGS || "eng";
}

// ─── Tool Definitions ─────────────────────────────────────
const TOOLS = [
  {
    name: "ocr_image",
    description: "Extract text from an image file (PNG, JPG, BMP, TIFF, PDF). Uses Tesseract OCR. Supports Bengali + English.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the image file"
        },
        langs: {
          type: "string",
          description: "Tesseract language codes (default: eng). E.g. 'eng', 'ben', 'eng+ben+ara'"
        },
        preprocess: {
          type: "string",
          enum: ["none", "threshold", "sharpen", "denoise"],
          description: "Image preprocessing mode (default: none)"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "ocr_screenshot",
    description: "Take a screenshot of the screen and extract text via OCR. Uses ffmpeg x11grab + Tesseract.",
    inputSchema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          description: "Capture region: 'full' (default), or 'WxH+X+Y' (e.g. '1920x1080+0+0')"
        },
        langs: {
          type: "string",
          description: "Tesseract language codes (default: eng)"
        }
      },
      required: []
    }
  },
  {
    name: "ocr_crop",
    description: "Crop a region from an image and extract text. Useful for reading specific parts of screenshots.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to source image" },
        x: { type: "number", description: "X offset (pixels)" },
        y: { type: "number", description: "Y offset (pixels)" },
        width: { type: "number", description: "Crop width (pixels)" },
        height: { type: "number", description: "Crop height (pixels)" },
        langs: { type: "string", description: "Tesseract language codes" }
      },
      required: ["path", "x", "y", "width", "height"]
    }
  }
];

// ─── Tool Execution ───────────────────────────────────────
async function executeTool(name, args) {
  const startTime = Date.now();

  switch (name) {
    case "ocr_image": {
      const imgPath = safeImagePath(args.path);
      if (!fileExists(imgPath)) {
        return { content: [{ type: "text", text: `Error: File not found: ${imgPath}` }] };
      }
      const langs = safeLangs(args.langs || detectLangs(imgPath));
      const preprocess = args.preprocess || "none";

      // Preprocessing
      let processedPath = imgPath;
      if (preprocess !== "none") {
        const tmpProcessed = path.join(TMP_DIR, `preprocessed-${randomUUID()}.png`);
        switch (preprocess) {
          case "threshold":
            await run(IMAGE_TOOL, [imgPath, "-threshold", "50%", tmpProcessed]);
            break;
          case "sharpen":
            await run(IMAGE_TOOL, [imgPath, "-sharpen", "0x3", tmpProcessed]);
            break;
          case "denoise":
            await run(IMAGE_TOOL, [imgPath, "-despeckle", "-deskew", tmpProcessed]);
            break;
          default:
            throw new Error("ocr_preprocess_mode_invalid");
        }
        processedPath = tmpProcessed;
      }

      // OCR
      const txtPath = path.join(TMP_DIR, `ocr-${randomUUID()}.txt`);
      await run("tesseract", [processedPath, txtPath.replace(/\.txt$/, ""), "-l", langs]);

      let text = "";
      try { text = fs.readFileSync(txtPath, "utf8").trim(); } catch {}

      // Cleanup
      if (processedPath !== imgPath) { try { fs.unlinkSync(processedPath); } catch {} }
      try { fs.unlinkSync(txtPath); } catch {}

      const elapsed = Date.now() - startTime;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            text,
            chars: text.length,
            lines: text.split("\n").length,
            langs,
            preprocess,
            elapsed_ms: elapsed,
            source: imgPath
          }, null, 2)
        }]
      };
    }

    case "ocr_screenshot": {
      if (process.platform === "win32" || !process.env.DISPLAY) return { content: [{ type: "text", text: "Error: ocr_screenshot requires an X11 display." }] };
      const langs = safeLangs(args.langs);
      const region = args.region || "full";
      const screenshotPath = path.join(TMP_DIR, `screenshot-${randomUUID()}.png`);

      try {
        if (region === "full") {
          // Full screen via ffmpeg x11grab
          const display = await run("xdpyinfo", []);
          const dimensions = display.match(/dimensions:\s+(\d+x\d+)/)?.[1];
          if (!dimensions) throw new Error("display_dimensions_unavailable");
          await run("ffmpeg", ["-f", "x11grab", "-video_size", dimensions, "-i", ":0.0", "-frames:v", "1", screenshotPath, "-y"], 15000);
        } else {
          // Specific region
          if (!/^\d{1,5}x\d{1,5}\+\d{1,5}\+\d{1,5}$/.test(region)) throw new Error("screenshot_region_invalid");
          await run("ffmpeg", ["-f", "x11grab", "-video_size", region, "-i", ":0.0", "-frames:v", "1", screenshotPath, "-y"], 15000);
        }

        if (!fileExists(screenshotPath)) {
          return { content: [{ type: "text", text: "Error: Failed to capture screenshot. Check DISPLAY." }] };
        }

        // OCR the screenshot
        const txtPath = path.join(TMP_DIR, `ocr-ss-${randomUUID()}.txt`);
        await run("tesseract", [screenshotPath, txtPath.replace(/\.txt$/, ""), "-l", langs]);
        let text = "";
        try { text = fs.readFileSync(txtPath, "utf8").trim(); } catch {}

        // Cleanup
        try { fs.unlinkSync(screenshotPath); } catch {}
        try { fs.unlinkSync(txtPath); } catch {}

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              text,
              chars: text.length,
              lines: text.split("\n").length,
              langs,
              region,
              elapsed_ms: Date.now() - startTime,
              source: "screenshot"
            }, null, 2)
          }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Screenshot error: ${e.message}. Make sure X11/DISPLAY is available.` }] };
      }
    }

    case "ocr_crop": {
      const imgPath = safeImagePath(args.path);
      if (!fileExists(imgPath)) {
        return { content: [{ type: "text", text: `Error: File not found: ${imgPath}` }] };
      }
      const langs = safeLangs(args.langs);
      const crop = [args.x,args.y,args.width,args.height].map(Number);
      if (crop.some(value => !Number.isInteger(value) || value < 0 || value > 10000) || crop[2] < 1 || crop[3] < 1) throw new Error("ocr_crop_dimensions_invalid");
      const croppedPath = path.join(TMP_DIR, `cropped-${randomUUID()}.png`);

      try {
        await run(IMAGE_TOOL, [imgPath, "-crop", `${crop[2]}x${crop[3]}+${crop[0]}+${crop[1]}`, "+repage", croppedPath]);

        const txtPath = path.join(TMP_DIR, `ocr-crop-${randomUUID()}.txt`);
        await run("tesseract", [croppedPath, txtPath.replace(/\.txt$/, ""), "-l", langs]);
        let text = "";
        try { text = fs.readFileSync(txtPath, "utf8").trim(); } catch {}

        try { fs.unlinkSync(croppedPath); } catch {}
        try { fs.unlinkSync(txtPath); } catch {}

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              text,
              chars: text.length,
              crop: { x: args.x, y: args.y, width: args.width, height: args.height },
              elapsed_ms: Date.now() - startTime
            }, null, 2)
          }]
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Crop/OCR error: ${e.message}` }] };
      }
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ─── MCP JSON-RPC Server (HTTP) ──────────────────────────
const http = require("http");

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method !== "POST") {
    res.writeHead(405); res.end("Only POST"); return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let request;
  try { request = JSON.parse(body); } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return;
  }

  const { id, method, params } = request;

  // MCP Protocol methods
  if (method === "initialize") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "ocr-mcp", version: "1.0.0" }
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
  console.log(`[OCR-MCP] Running on http://127.0.0.1:${PORT}`);
  console.log(`[OCR-MCP] Tools: ${TOOLS.map(t => t.name).join(", ")}`);
});
