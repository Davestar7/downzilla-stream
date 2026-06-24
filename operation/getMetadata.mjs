import path from "path"
import { spawn } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";
import { ensureCookiesFile } from "./dependencies.mjs"
import fs from 'fs'
import { BG } from 'bgutils-js'
import { Innertube } from 'youtubei.js'


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "/app/operation/yt-dlp";

function isYouTubeUrl(url) {
    return url.includes('youtube.com') || url.includes('youtu.be')
}

/*
let bgutilStarted = false

async function generatePoToken(videoId) {
    try {
        const innertube = await Innertube.create({ retrieve_player: false })
        const visitorData = innertube.session.context.client.visitorData

        const bgConfig = {
            fetch: (url, options) => fetch(url, options),
            globalObj: globalThis,
            identifier: visitorData,
            requestKey: 'O43z0dpjhgX20SCx4KAo',
        }

        const bgChallenge = await BG.Challenge.create(bgConfig)
        if (!bgChallenge) throw new Error('Failed to create challenge')

        const interpreterJavascript = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
        if (interpreterJavascript) {
            new Function(interpreterJavascript)()
        }

        const poTokenResult = await BG.PoToken.generate({
            program: bgChallenge.program,
            globalName: bgChallenge.globalName,
            bgConfig,
        })

        return { poToken: poTokenResult.poToken, visitorData }
    } catch (e) {
        console.log('PO token generation failed:', e.message)
        return null
    }
}
*/

const metadataExtractor = async (req, res) => {
    const { time = null, id, arg } = req.body

    const theJob = jobs.get(id);
    
    if (!theJob) {
        return res.status(404).json({ message: "id not found" })
    }

    const url = theJob.url
    const type = theJob.type

    try {
        const cookie = ensureCookiesFile()

        let argument = [...arg]
        
        argument.push("--cookies")
        argument.push(cookie)
        argument.push(url)

        const outPut = new Promise((resolve, reject) => {
            let proc

            if (type === "video") {
                let argss

    if (isYouTubeUrl(url)) {
      try {

       const result = extractYoutube(url, cookie);
       return resolve(result);
    } catch (err) {
      return reject(err.message);
    }
      
    } else {
        argss = [
            '--cookies', cookie,
            '--no-warnings',
            '--skip-download',
            '--no-check-certificate',
            '--no-playlist',
            '--force-ipv4',
            '--retries', '3',
            '--fragment-retries', '3',
            '--ignore-errors',
            '--no-cache-dir',
            '-j',
            url
        ]
      proc = spawn(ytDlpPath, argss, { stdio: ["ignore", "pipe", "pipe"], cwd: '/app/operation', env: { ...process.env, PATH: `/usr/local/bin:/usr/bin:${process.env.PATH}` } })
            
    }

    // ✅ Only called once
              
            } else if (type === "playlist") {
                proc = spawn(ytDlpPath, argument, { stdio: ["ignore", "pipe", "pipe"] })
            } else if (type === "audio") {
                proc = spawn(ytDlpPath, argument, { stdio: ["ignore", "pipe", "pipe"] })
            } else {
                return reject("selected option not available")
            }

            if (!proc) return reject("process not started")

            theJob.process = proc
            theJob.state = "started"

            let timeout
            if (time != null) {
                timeout = setTimeout(() => {
                    if (!proc.killed) {
                        try {
                            process.kill(-proc.pid, "SIGKILL")
                            reject("took too much time")
                        } catch (e) {
                            reject(e.message)
                        }
                    }
                }, time)
            }

            let data = ""
            let error = ""

            proc.stdout.on("data", (chunk) => {
                data += chunk.toString()
            })

              proc.stderr.on("data", (chunk) => {
                console.error('YTDLP STDERR:', chunk.toString())
                error += chunk.toString()
            })

            proc.on("close", (code) => {
                if (time != null) clearTimeout(timeout)
                if (code === 0) {
                    try {
                        resolve(JSON.parse(data))
                    } catch (err) {
                        reject(err.message)
                    }
                } else {
                    reject(error || `failed with code ${code} possibly cancelled`)
                }
            })
        })

        try {
            const out = await outPut
            jobs.delete(id)
            res.status(200).json({ data: out })
        } catch (e) {
            theJob.state = "failed"
            jobs.delete(id)
            res.status(400).json({ message: e })
        }

    } catch (e) {
        jobs.delete(id)
        res.status(500).json({ message: e.message })
    }
}

async function extractYoutube(url, cookiePath = null) {
  const strategies = [
    {
      name: "android-web",
      args: ["--extractor-args", "youtube:player_client=android,web"],
      useCookie: true
    },
    {
      name: "android",
      args: ["--extractor-args", "youtube:player_client=android"],
      useCookie: true
    },
    {
      name: "tv",
      args: ["--extractor-args", "youtube:player_client=tv"],
      useCookie: true
    },
    {
      name: "no-client-force",
      args: [],
      useCookie: false
    }
  ];

  let bestResult = null;
  let bestScore = 0;
  let lastError = null;

  for (const strategy of strategies) {
    let proc = null;

    try {
      const result = await new Promise((resolve, reject) => {
        const args = [
          "--ignore-config",
          "--skip-download",
          "--no-playlist",
          "--no-warnings",
          "--force-ipv4",
          "--retries", "2",           // reduced: info extraction doesn't need 5 retries
          "--fragment-retries", "2",
          "--socket-timeout", "15",
          "--format", "bv*+ba/b",
          "-J",
          url,
          ...strategy.args
        ];

        // Push cookies to end — more predictable than unshift before all other flags
        if (strategy.useCookie && cookiePath) {
          args.push("--cookies", cookiePath);
        }

        proc = spawn(ytDlpPath, args, {
          windowsHide: true,
          stdio: "pipe",       // explicit, even though it's the default
          cwd: __dirname       // consistent with rest of codebase
        });

        let stdout = "";
        let stderr = "";
        
        let settled = false;

        const settle = (fn, val) => {
          if (settled) return;
          settled = true;
          fn(val);
        };

        const timeout = setTimeout(() => {
          console.log(`[extractYoutube] strategy "${strategy.name}" timed out`);
          if (proc && !proc.killed) proc.kill("SIGKILL");
          settle(reject, new Error(`Strategy "${strategy.name}" timed out after 30s`));
        }, 30000);

        proc.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });

        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          console.log(`[extractYoutube] strategy "${strategy.name}" spawn error:`, err.message);
          settle(reject, err);
        });

        proc.on("close", (code) => {
          clearTimeout(timeout);
          if (settled) return;

          if (code !== 0 && !stdout) {
            return settle(reject, new Error(stderr?.trim() || `yt-dlp exited with code ${code}`));
          }

          try {
            const start = stdout.indexOf("{");
            const end = stdout.lastIndexOf("}");

            if (start === -1 || end === -1) {
              return settle(reject, new Error("No JSON in yt-dlp output"));
            }

            const json = stdout.slice(start, end + 1);
            settle(resolve, JSON.parse(json));
          } catch (e) {
            settle(reject, new Error("Failed to parse yt-dlp JSON: " + e.message));
          }
        });
      });

      if (!result) continue;

      let score = 0;
      if (result.title) score += 10;
      if (result.duration) score += 10;
      if (result.uploader) score += 10;
      if (result.description) score += 5;
      if (result.thumbnails?.length) score += 10;
      if (result.formats?.length) score += result.formats.length;
      if (result.subtitles) score += 5;
      if (result.chapters) score += 5;

      const valid = result?.title && result?.id && result?.formats?.length > 0;

      if (valid) {
        console.log(`[extractYoutube] strategy "${strategy.name}" succeeded — ${result.formats.length} formats`);
        return result;
      }

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      }

    } catch (e) {
      lastError = e;
      console.log(`[extractYoutube] strategy "${strategy.name}" failed:`, e.message);
      if (proc && !proc.killed) {
        try { proc.kill("SIGKILL"); } catch (_) {}
      }
    }
  }

  if (bestResult) {
    console.log(`[extractYoutube] all strategies exhausted — returning best partial result (score: ${bestScore})`);
    return bestResult;
  }

  throw new Error(`All extraction strategies failed. Last error: ${lastError?.message ?? "unknown"}`);
}

export {metadataExtractor}
