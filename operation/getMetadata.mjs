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

// Start bgutil POT server once at startup
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

    const theJob = jobs.get(id)
    
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
      return reject(err);
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

function extractYoutube(url, cookie = null) {
  return new Promise(async (resolve, reject) => {
    const strategies = [
      {
        name: "default",
        args: [
          "--extractor-args",
          "youtube:player_skip=webpage"
        ],
        useCookie: true
      },
      {
        name: "default,mweb",
        args: [
          "--extractor-args",
          "youtube:player_client=default,mweb"
        ],
        useCookie: true
      },
      {
        name: "mweb",
        args: [
          "--extractor-args",
          "youtube:player_client=mweb"
        ],
        useCookie: true
      },
      {
        name: "default-no-cookie",
        args: [
          "--extractor-args",
          "youtube:player_skip=webpage"
        ],
        useCookie: false
      }
    ];

    let bestResult = null;
    let bestScore = 0;

    try {
      for (const strategy of strategies) {
        try {
          const result = await new Promise((resolveRun, rejectRun) => {
            const args = [
              "--ignore-config",
              "--skip-download",
              "--no-playlist",
              "--no-warnings",
              "--no-call-home",
              "--force-ipv4",
              "--retries",
              "10",
              "--fragment-retries",
              "10",
              "--socket-timeout",
              "20",
              "--js-runtimes",
              "node",
              ...strategy.args,
              "-J",
              url
            ];

            if (strategy.useCookie && cookie) {
              args.unshift(cookie);
              args.unshift("--cookies");
            }

            const proc = spawn(ytDlpPath, args, {
              windowsHide: true
            });

            let stdout = "";
            let stderr = "";

            const timeout = setTimeout(() => {
              proc.kill("SIGKILL");
              rejectRun(new Error("Timeout"));
            }, 45000);

            proc.stdout.on("data", chunk => {
              stdout += chunk.toString();
            });

            proc.stderr.on("data", chunk => {
              stderr += chunk.toString();
            });

            proc.on("error", err => {
              clearTimeout(timeout);
              rejectRun(err);
            });

            proc.on("close", code => {
              clearTimeout(timeout);

              console.log("EXIT:", code);

               console.log("STDOUT:", stdout);
               console.log("STDERR:", stderr);

              if (code !== 0 && !stdout) {
                return rejectRun(
                  new Error(
                    stderr || `yt-dlp exited ${code}`
                  )
                );
              }

              try {
                resolveRun(JSON.parse(stdout));
              } catch {
                rejectRun(
                  new Error("Invalid JSON")
                );
              }
            });
          });

          let score = 0;

          if (result?.title) score += 10;
          if (result?.duration) score += 10;
          if (result?.uploader) score += 10;
          if (result?.description) score += 5;
          if (result?.thumbnails?.length) score += 10;
          if (result?.formats?.length) score += result?.formats?.length;
          if (result?.subtitles) score += 5;
          if (result?.chapters) score += 5;

          const valid =
            result.title &&
            result.duration &&
            result.uploader &&
            result.id &&
            result.formats &&
            result.formats.length >= 3;

          if (valid) {
            return resolve({
              success: true,
              strategy: strategy.name,
              data: result
            });
          }

          if (score > bestScore) {
            bestScore = score;
            bestResult = result;
          }
        } catch (e) {
          console.log(
            "Strategy failed:",
            strategy.name,
            e.message
          );
        }
      }

      if (bestResult) {
        return resolve({
          success: true,
          strategy: "partial",
          warning: "Metadata incomplete",
          data: bestResult
        });
      }

      reject(
        new Error(
          "All extraction strategies failed"
        )
      );
    } catch (err) {
      reject(err);
    }
  });
}

export {metadataExtractor}
