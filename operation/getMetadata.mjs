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

    // ENTRY LOG — this MUST appear for every single request that reaches
    // this function. If this line is ever missing from the logs, the
    // request isn't reaching this handler at all (routing/middleware issue).
    console.log("[METADATA REQUEST]", "id:", id, "time:", time);

    const theJob = jobs.get(id);

    if (!theJob) {
        console.log("[METADATA] job not found for id:", id, "— returning 404");
        return res.status(404).json({ message: "id not found" })
    }

    const url = theJob.url
    const type = theJob.type

    console.log("[METADATA] job found — url:", url, "| type:", type, "| isYouTubeUrl:", isYouTubeUrl(url || ""));

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
                    console.log("[METADATA] routing to extractYoutube()");
                    extractYoutube(url, cookie)
                        .then(resolve)
                        .catch(err => reject(err.message));
                    return;
                } else {
                    console.log("[METADATA] routing to GENERIC (non-YouTube) extraction branch — this branch does NOT log YT STDERR/METADATA details");
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
                console.log("[METADATA] routing to playlist branch");
                proc = spawn(ytDlpPath, argument, { stdio: ["ignore", "pipe", "pipe"] })
            } else if (type === "audio") {
                console.log("[METADATA] routing to audio branch");
                proc = spawn(ytDlpPath, argument, { stdio: ["ignore", "pipe", "pipe"] })
            } else {
                console.log("[METADATA] unknown type:", type, "— rejecting");
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
                console.error('[GENERIC BRANCH STDERR]:', chunk.toString())
                error += chunk.toString()
            })

            proc.on("close", (code) => {
                if (time != null) clearTimeout(timeout)
                console.log("[GENERIC BRANCH] closed with code:", code);
                if (code === 0) {
                    try {
                        const parsed = JSON.parse(data);
                        console.log("[GENERIC BRANCH KEYS]", Object.keys(parsed).sort().join(", "));
                        console.log("[GENERIC BRANCH duration]", parsed.duration, "| thumbnails:", Array.isArray(parsed.thumbnails) ? `array(${parsed.thumbnails.length})` : typeof parsed.thumbnails);
                        resolve(parsed)
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
            console.error("[METADATA] extraction failed:", e);
            theJob.state = "failed"
            jobs.delete(id)
            res.status(400).json({ message: e })
        }

    } catch (e) {
        console.error("[METADATA] outer catch — unexpected error:", e);
        jobs.delete(id)
        res.status(500).json({ message: `${e.message}, apologies 😣 fix in progress` })
    }
}

/**
 * Extracts YouTube metadata.
 */
function extractYoutube(url, cookie) {
    url = normalizeYoutubeUrl(url);
    console.log("[extractYoutube] starting for normalized url:", url);

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
            "--cookies", cookie,
            "--ignore-no-formats-error",
            "--js-runtimes", "node",
        ];

        args.push(url);

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
            console.error("[extractYoutube] spawn error:", err.message);
            clearTimeout(timeout);
            finish(reject, err);
        });

        proc.on("close", async code => {
            console.log("[extractYoutube] process closed with code:", code);
            clearTimeout(timeout);
            if (settled) return;

            if (code !== 0) {
                if (/Too Many Requests|429/i.test(stderr)) {
                    return finish(reject, new Error("YouTube rate-limited this server — try again shortly"));
                }
                if (/Sign in to confirm you're not a bot/i.test(stderr)) {
                    return finish(reject, new Error("YouTube bot-detection triggered — cookies may be missing or expired"));
                }
                if (/n-challenge|nsig/i.test(stderr)) {
                    return finish(reject, new Error("YouTube n-challenge failed — check player_client arg"));
                }
                if (/Requested format is not available/i.test(stderr)) {
                    return finish(reject, new Error("No formats available — player client may be blocked"));
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

                const hasFormats = Array.isArray(result.formats) && result.formats.length > 0;
                const hasDirectUrl = typeof result.url === "string" && result.url.length > 0;
                const hasRequestedFormats = Array.isArray(result.requested_formats) && result.requested_formats.length > 0;
                const hasRequestedDownloads = Array.isArray(result.requested_downloads) && result.requested_downloads.length > 0;

                if (!hasFormats && !hasDirectUrl && !hasRequestedFormats && !hasRequestedDownloads) {
                    const detail = stderr.trim() ? ` | yt-dlp warnings: ${stderr.trim().slice(0, 500)}` : "";
                    return finish(reject, new Error(`YouTube returned no usable stream data${detail}`));
                }

                console.log("[METADATA KEYS]", Object.keys(result).sort().join(", "));
                console.log("[METADATA duration]", result.duration, "| duration_string:", result.duration_string);
                console.log("[METADATA thumbnails]", Array.isArray(result.thumbnails) ? `array(${result.thumbnails.length})` : typeof result.thumbnails);
                console.log("[METADATA formats count]", Array.isArray(result.formats) ? result.formats.length : typeof result.formats);

                // Check every place yt-dlp might have stashed a duration value —
                // different clients put it in different spots, or omit the
                // top-level field entirely.
                if (!result.duration) {
                    const candidates = [
                        ...(Array.isArray(result.formats) ? result.formats : []),
                        ...(Array.isArray(result.requested_formats) ? result.requested_formats : []),
                        ...(Array.isArray(result.requested_downloads) ? result.requested_downloads : []),
                    ];
                    const withDuration = candidates.find(f => f && f.duration);
                    if (withDuration) {
                        result.duration = withDuration.duration;
                        console.log("[METADATA duration recovered from format entry]", result.duration);
                    }
                }

                // Last resort: probe the actual media stream directly with
                // ffprobe. This is independent of yt-dlp's client/JSON shape —
                // if there's a playable URL OR HLS/DASH manifest URL, ffprobe
                // reads the real duration straight from it.
                if (!result.duration) {
                    const candidateObjects = [
                        result,
                        ...(Array.isArray(result.requested_downloads) ? result.requested_downloads : []),
                        ...(Array.isArray(result.requested_formats) ? result.requested_formats : []),
                        ...(Array.isArray(result.formats) ? [...result.formats].reverse() : []),
                    ];
                    let probeUrl = null;
                    for (const obj of candidateObjects) {
                        if (obj?.url) { probeUrl = obj.url; break; }
                        if (obj?.manifest_url) { probeUrl = obj.manifest_url; break; }
                    }

                    console.log("[METADATA] ffprobe candidate url:", probeUrl ? "found" : "none found");

                    if (probeUrl) {
                        try {
                            const probed = await ffprobeDuration(probeUrl);
                            if (probed) {
                                result.duration = probed;
                                console.log("[METADATA duration recovered via ffprobe]", probed);
                            }
                        } catch (probeErr) {
                            console.error("[ffprobe duration failed]", probeErr.message);
                        }
                    }
                }

                // NOTE: the network fallback below now only fires for missing
                // THUMBNAILS. A second live yt-dlp call to YouTube purely to
                // chase duration was triggering "Sign in to confirm you're
                // not a bot" on rapid repeat requests from the same cookie/IP —
                // so if duration is still unavailable after the checks above,
                // we accept that gracefully rather than risk that failure mode.
                const missingDuration = !result.duration && !result.duration_string;
                const missingThumbnails = !Array.isArray(result.thumbnails) || result.thumbnails.length === 0;

                if (missingDuration) {
                    console.log("[METADATA] duration unavailable after all recovery attempts — proceeding without it");
                }

                if (missingThumbnails) {
                    console.log("[METADATA] triggering fallback for missing thumbnails only");
                    fetchBasicMetadataFallback(url, cookie)
                        .then(fallback => {
                            console.log("[METADATA FALLBACK OK] duration:", fallback?.duration, "| thumbnails:", Array.isArray(fallback?.thumbnails) ? fallback.thumbnails.length : typeof fallback?.thumbnails);
                            if (missingDuration && fallback?.duration) {
                                result.duration = fallback.duration;
                                result.duration_string = fallback.duration_string;
                            }
                            if (Array.isArray(fallback?.thumbnails) && fallback.thumbnails.length > 0) {
                                result.thumbnails = fallback.thumbnails;
                                result.thumbnail = fallback.thumbnail || result.thumbnail;
                            }
                            finish(resolve, result);
                        })
                        .catch(err => {
                            console.error("[METADATA FALLBACK FAILED]", err?.message || err);
                            finish(resolve, result);
                        });
                    return;
                }

                finish(resolve, result);
            } catch (err) {
                finish(reject, new Error(`JSON parse failed: ${err.message}, 😣 fix in progress`));
            }
        });
    });
}

// Reads duration directly from the media stream/container using ffprobe,
// independent of whatever fields yt-dlp's chosen client did or didn't
// include in its JSON output. Requires ffmpeg/ffprobe to be installed
// (already present via apt-get in the Dockerfile).
function ffprobeDuration(mediaUrl) {
    return new Promise((resolve, reject) => {
        const ffprobePath = isWindows ? "ffprobe.exe" : "ffprobe";
        const args = [
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            mediaUrl
        ];

        const proc = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });

        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch (_) {}
            reject(new Error("ffprobe timed out"));
        }, 15000);

        proc.stdout.on("data", chunk => { stdout += chunk.toString(); });
        proc.stderr.on("data", chunk => { stderr += chunk.toString(); });

        proc.on("error", err => {
            clearTimeout(timeout);
            reject(err);
        });

        proc.on("close", code => {
            clearTimeout(timeout);
            if (code !== 0) return reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
            try {
                const parsed = JSON.parse(stdout);
                const seconds = parsed?.format?.duration ? Math.round(parseFloat(parsed.format.duration)) : null;
                resolve(seconds);
            } catch (err) {
                reject(err);
            }
        });
    });
}

function fetchBasicMetadataFallback(url, cookie) {
    console.log("[fetchBasicMetadataFallback] starting for:", url);
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
            "--socket-timeout", "15",
            "--retries", "2",
            "--cookies", cookie,
            "--js-runtimes", "node",
            url
        ];

        const proc = spawn(ytDlpPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            cwd: '/app/operation',
            env: { ...process.env, PATH: `/usr/local/bin:/usr/bin:${process.env.PATH}` }
        });

        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch (_) {}
            reject(new Error("fallback metadata call timed out"));
        }, 20000);

        proc.stdout.on("data", chunk => { stdout += chunk.toString(); });
        proc.stderr.on("data", chunk => {
            console.error("[FALLBACK STDERR]", chunk.toString().trim());
            stderr += chunk.toString();
        });

        proc.on("error", err => {
            clearTimeout(timeout);
            reject(err);
        });

        proc.on("close", code => {
            console.log("[fetchBasicMetadataFallback] closed with code:", code);
            clearTimeout(timeout);
            if (code !== 0) return reject(new Error(stderr.trim() || `fallback exited with code ${code}`));
            try {
                resolve(JSON.parse(stdout));
            } catch (err) {
                reject(err);
            }
        });
    });
}

export { metadataExtractor }
