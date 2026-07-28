import path from "path"
import fs from 'fs';
import dotenv from "dotenv";
dotenv.config();

function loopFormatForFormatObject(ff, id) {
    if (ff.length == 0) {
        return ""
    }

    let format = null

    ff.forEach(f => {
        if (f.format_id == id) {
            format = f
        }
    })
    return format
}

function returnCorrectForArguments(ff, id, aid) {
    const v = loopFormatForFormatObject(ff, id)
    const a = loopFormatForFormatObject(ff, aid)
    console.log(`video: ${v}\n audio: ${a}`)
    if (v == null || a == null) {
        return ""
    }
    
    if (v.ext === "mp4" && a.ext !== "mp4" && !v.vcodec?.startsWith("avc") && !["aac", "mp3", "none"].includes(a.acodec)) {
        return true
    } else {
        return false
    }
    return ""
}

function sanname(name) {
    return name.replace(/[<>:"/\\|?*." "]+/g, "-")
                .replace(/[\u007F-\uFFFF]/g, "")
                .trim()
                .replace(/\s+/g, "-")
}

function selectaudioformat(ff) {
    const audioformat = ff.filter(
        f => f.vcodec === "none" && f.acodec !== "none"
    );
    if (audioformat.length === 0) {
        return ""
    }

    audioformat.sort((a, b) => (b.abr || 0) - (a.abr || 0))

    const best = audioformat[0];

    return {
        format_id: best.format_id,
        ext: best.ext,
        abr: best.abr,
        filesize: best.filesize || best.filesize_approx || null
    }
}

function selectvideoformat(ff) {
    if (!Array.isArray(ff) || ff.length === 0) {
        return ""
    }

    const videoFormats = ff.filter(f => 
        f.vcodec && f.vcodec !== "none" && typeof f.height === "number"
        )

    if (videoFormats.length === 0) return ""

    const preferred = videoFormats.filter(f => 
        f.ext === "mp4" && typeof f.vcodec === "string" && f.vcodec.startsWith("avc") && f.height >= 144 && f.height <= 1080
        )

    const cands = preferred.length ? preferred : videoFormats

    cands.sort((a, b) => a.length - b.height);

    const medianIndex = Math.floor(cands.length / 2)
    const s = cands[medianIndex];


    return {
        format_id: s.format_id,
        ext: s.ext,
        vcodec: s.vcodec,
        acodec: s.acodec,
        height: s.height,
        filesize: s.filesize || s.filesize_approx || null
    }
}

function getHeightFromString(h) {
    if (h === null) return ""

    const m = String(h).match(/\d{3,4}/)
    return m ? Number(m[0]) : ""
}

function getMainDomain(irl) {
    const arrs = irl.split(".")
    console.log(`path: ${arrs[0]}.${arrs[1]}.${arrs[2]}`)
    const lastarr = arrs[2].split("/")
    const path = `${arrs[0]}.${arrs[1]}.${lastarr[0]}/`
    console.log(`new path: ${path}`)
    return path
}

function chooseFormat(ff = null) {
    if (!ff) return 'bestvideo+bestaudio/best'

    if (ff > 144 && ff <= 1080){
        return `bestvideo[height<=${ff}][ext=m4a]+bestaudio[ext=m4a]/best[height<=${ff}]`
    } else {
        return 'bestvideo+bestaudio/best'
    }
}

const COOKIES_PATH = path.join('/tmp', 'cookies.txt');

function ensureCookiesFile() {
  // Check if cookies.txt already exists
  if (fs.existsSync(COOKIES_PATH)) {
    return COOKIES_PATH;
  }

  // Read from environment variable
  const cookiesContent = process.env.COOKIESTXT;

  if (!cookiesContent) {
    console.error('Error: COOKIES_TXT environment variable is not set.');
    return "";
  }

  // Create the cookies.txt file
  fs.writeFileSync(COOKIES_PATH, cookiesContent, 'utf8');
  console.log('cookies.txt created successfully.');
  return COOKIES_PATH;
}

function buildYtdlpArgs(url, outputPath, cookie, quality = null, defaultHeaders = [], headerArgs = []) {

  let format;

  if (quality) {
    format =
      `bv*[height<=${quality}]+ba/` +
      `b[height<=${quality}]/` +
      `bv*+ba/b`;
  } else {
    format =
      `bv*+ba/` +
      `b`;
  }

  const args = [
    url,

    '--format', format,

    '--merge-output-format', 'mp4',

    // REMOVED: '--extractor-args', 'youtube:player_client=android,web'
    // The android client combined with --cookies triggers a known yt-dlp
    // regression: yt-dlp silently falls back to the web client, which then
    // gets bot-detected ("Sign in to confirm you're not a bot"). Letting
    // yt-dlp pick its own cookie-aware default client combo (currently
    // tv_downgraded + web_safari for authenticated requests) avoids this —
    // same fix already confirmed working in the metadata extractor.

    '--cookies',
    cookie,

    '--js-runtimes',
    'node',

    '--retries',
    '10',

    '--fragment-retries',
    '10',

    '--socket-timeout',
    '30',

    '--force-ipv4',

    '--ignore-config',

    '--no-cache-dir',

    '--no-playlist',

    // Spread out requests slightly — pure datacenter-IP flagging isn't
    // affected much by this alone, but combined with a proxy (below) it
    // reduces the odds of tripping frequency-based heuristics on top of
    // IP-reputation ones.
    '--sleep-requests', '1',
  ];

  // Optional residential/mobile proxy support. Datacenter IPs (Render,
  // Railway, AWS, etc.) are broadly flagged by YouTube's bot detection at
  // the stream-URL-resolution step, independent of valid cookies — this is
  // a widely documented 2026 pattern, not specific to this app. Set
  // YTDLP_PROXY_URL in your Render environment (e.g.
  // http://user:pass@proxy-host:port) if you have a residential/mobile
  // proxy provider, and downloads will route through it instead of
  // Render's own IP.
  if (process.env.YTDLP_PROXY_URL) {
    args.push('--proxy', process.env.YTDLP_PROXY_URL);
  }

  args.push(...defaultHeaders, ...headerArgs, '-o', outputPath);

  return args;
}

const processes = new Map()

setInterval(() => {
    const now = Date.now()
    for (const [fileId, job] of processes.entries()) {
        if (job.status === "done" && job.expiresAt && now > job.expiresAt) {
            if (fs.existsSync(job.outputPath)) fs.unlink(job.outputPath, () => {})
            processes.delete(fileId)
        }
    }
}, 5 * 60 * 1000)

export {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject, returnCorrectForArguments, chooseFormat, ensureCookiesFile, processes, buildYtdlpArgs}
