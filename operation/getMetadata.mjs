import path from "path"
import { spawn, execSync } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";
import { ensureCookiesFile } from "./dependencies.mjs"
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
    ? path.join(__dirname, "bin", "yt-dlp.exe")
    : "/app/operation/yt-dlp";

function isYouTubeUrl(url) {
    return url.includes('youtube.com') || url.includes('youtu.be');
}

const nodePath = execSync("which node").toString().trim();

function normalizeYoutubeUrl(url) {
    try {
        const u = new URL(url);
        if (u.hostname === "youtu.be") {
            return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
        }
        u.searchParams.delete("si");
        return u.toString();
    } catch {
        return url;
    }
}

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

                if (isYouTubeUrl(url)) {
                    // YouTube: android client — no cookies passed (see extractYoutube for why)
                    extractYoutube(url)
                        .then(resolve)
                        .catch(err => reject(err.message));
                    return;
                } else {
                    const argss = [
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
                    proc = spawn(ytDlpPath, argss, {
                        stdio: ["ignore", "pipe", "pipe"],
                        cwd: '/app/operation',
                        env: { ...process.env, PATH: `/usr/local/bin:/usr/bin:${process.env.PATH}` }
                    })
                }

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

/**
 * Extracts YouTube metadata using the android player client.
 *
 * Why no --cookies:
 *   yt-dlp >= 2026.06.09 hard-blocks the android client whenever --cookies is
 *   present, forcing a silent fallback to the web client. The web client then
 *   hits YouTube's n-challenge (nsig) which requires a JS runtime — unavailable
 *   on Railway — and returns zero formats. The android client works without
 *   cookies and bypasses the n-challenge entirely.
 *
 * Why no web fallback in player_client:
 *   player_client=android,web re-introduces the web path as a fallback,
 *   which fails for the same nsig reason above. android alone is sufficient.
 */
function extractYoutube(url) {
    url = normalizeYoutubeUrl(url);

    return new Promise((resolve, reject) => {
        const args = [
            "--ignore-config",
            "--skip-download",
            "--no-playlist",
            "--force-ipv4",
            "--dump-single-json",
            "--no-warnings",
            "--no-cache-dir",
            "--no-check-certificate",
            "--socket-timeout", "30",
            "--retries", "3",
            // android client: no cookies needed, no JS runtime needed
            "--extractor-args", "youtube:player_client=android",
        ];

        args.push(url);

        console.log("[YT-DLP]", ytDlpPath, args.join(" "));

        const proc = spawn(ytDlpPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            cwd: '/app/operation',
            env: {
                ...process.env,
                PATH: `/usr/local/bin:/usr/bin:${process.env.PATH}`
            }
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (fn, val) => {
            if (settled) return;
            settled = true;
            fn(val);
        };

        const timeout = setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch (_) {}
            finish(reject, new Error("yt-dlp timed out after 60 seconds"));
        }, 60000);

        proc.stdout.on("data", chunk => { stdout += chunk.toString(); });

        proc.stderr.on("data", chunk => {
            const line = chunk.toString();
            console.error("[YT STDERR]", line.trimEnd());
            stderr += line;
        });

        proc.on("error", err => {
            clearTimeout(timeout);
            finish(reject, err);
        });

        proc.on("close", code => {
            clearTimeout(timeout);
            if (settled) return;

            if (code !== 0) {
                // Specific, actionable messages for known failure modes
                if (/Too Many Requests|429/i.test(stderr)) {
                    return finish(reject, new Error("YouTube rate-limited this server — try again shortly"));
                }
                if (/Sign in to confirm you're not a bot/i.test(stderr)) {
                    return finish(reject, new Error("YouTube is blocking this server IP"));
                }
                if (/n-challenge|nsig/i.test(stderr)) {
                    return finish(reject, new Error("YouTube n-challenge failed — no JS runtime; ensure android-only client"));
                }
                if (/Requested format is not available/i.test(stderr)) {
                    return finish(reject, new Error("No formats available — player client may be blocked"));
                }
                if (/android.*blocked|blocked.*android/i.test(stderr)) {
                    return finish(reject, new Error("Android client blocked by YouTube — cookies may still be leaking in"));
                }
                if (/Video unavailable/i.test(stderr)) {
                    return finish(reject, new Error("Video unavailable (private, deleted, or geo-restricted)"));
                }
                return finish(reject, new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
            }

            try {
                const result = JSON.parse(stdout);

                if (!result?.id) {
                    return finish(reject, new Error("Metadata invalid: missing video id"));
                }
                if (!result.formats || result.formats.length === 0) {
                    return finish(reject, new Error("Metadata returned with zero formats — android client may be blocked"));
                }

                finish(resolve, result);
            } catch (err) {
                finish(reject, new Error(`JSON parse failed: ${err.message}`));
            }
        });
    });
}

export { metadataExtractor }
          
