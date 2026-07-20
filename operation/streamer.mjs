import path from "path"
import fs from 'fs';
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto"
import {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject, chooseFormat, ensureCookiesFile, processes} from "./dependencies.mjs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "/app/operation/yt-dlp";

const ffmpegPath = isWindows
  ? path.join(__dirname, "ffmpeg-n8.0-7-g4f8b3891ee-win64-lgpl-shared-8.0", "bin", "ffmpeg.exe")
  : '/usr/bin/ffmpeg';

const tempPath = path.join(__dirname, "temp")

// FIX 1: Ensure temp directory exists at startup — ffmpeg/yt-dlp fail silently if missing
if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true })
    console.log('Created temp directory:', tempPath)
}

const tk = new Map()

const knowStreamer = (req, res) => {
    try {
        const { url, title, formats = null, height = null, headers = null, vid } = req.body

        if (!url || !title) {
            return res.status(400).json({
                success: false,
                message: "failed incomplete data"
            })
        }

        let header = headers
        if (!header) {
            // FIX: formats can be null/undefined — indexing it directly throws
            header = formats?.[0]?.http_headers
        }

        const id = crypto.randomUUID()

        tk.set(id, {
            state: "Active",
            url: url,
            title: title,
            formats: formats,
            height: height,
            headers: header,
            yt: null,
            outputFile: null,
            vid: vid
        })

        res.status(201).json({
            success: true,
            data: id
        })
    } catch (e) {
        console.log('knowStreamer error:', e.message)
        res.status(500).json({
            success: false,
            message: "failed to start streaming session: " + e.message
        })
    }
}

const stream = async (req, res) => {
    const { sid } = req.query

    try {
        const job = tk.get(sid)
        if (!job) return res.status(404).json({ success: false, message: "session not found" })

        const url = job.url
        const title = job.title
        const formats = job.formats
        const height = job.height
        const headers = job.headers
        const vid = job.vid

        let formatc
        const newHeight = getHeightFromString(height)

        if (newHeight === null || newHeight < 144 || newHeight > 1080 || typeof newHeight != "number") {    
            const selected = selectvideoformat(formats)
            formatc = chooseFormat(Number(selected?.height))
        }

        if (!formatc) {
            formatc = chooseFormat(Number(height))
        }

        const newtitle = sanname(title).toString().toLowerCase().trim()

        let fileId
        if (vid) {
            fileId = crypto.createHash('md5').update(`${vid}-${formatc || 'default'}`).digest('hex')
        } else {
            fileId = crypto.createHash('md5').update(`${newtitle}-${formatc || 'default'}`).digest('hex')
        }

        const outputPath = path.join(tempPath, `${fileId}.mp4`)

        req.socket.setTimeout(0)
        req.socket.setKeepAlive(true, 3000)
        res.setTimeout(0)

        // Reuse existing completed file
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            let entry = processes.get(fileId)
            if (!entry) {
                entry = { status: "done", outputPath, yt: null }
                processes.set(fileId, entry)
            }
            entry.expiresAt = Date.now() + 30 * 60 * 1000
            streamFile(req, res, outputPath)
            return
        }

        // Attach to already in-progress job
        let entry = processes.get(fileId)
        if (entry && entry.status === "processing") {
            waitAndStream(req, res, fileId, outputPath)
            return
        }

        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')

        if (isYouTube && formats && formats.length > 0) {
            const videoFormat = formats.find(f =>
                f.vcodec !== 'none' &&
                f.acodec === 'none' &&
                f.ext === 'mp4' &&
                f.height && f.height <= (newHeight || 1080) &&
                f.url && typeof f.url === 'string' && f.url.startsWith('http')
            ) || formats.find(f =>
                f.vcodec !== 'none' &&
                f.url && typeof f.url === 'string' && f.url.startsWith('http')
            )

            const audioFormat = formats.find(f =>
                f.acodec !== 'none' &&
                f.vcodec === 'none' &&
                f.url && typeof f.url === 'string' && f.url.startsWith('http')
            )

            console.log('YouTube stream - videoFormat height:', videoFormat?.height, 'hasUrl:', !!videoFormat?.url)
            console.log('YouTube stream - audioFormat acodec:', audioFormat?.acodec, 'hasUrl:', !!audioFormat?.url)

            if (videoFormat?.url && audioFormat?.url) {
                const videoUrl = String(videoFormat.url)
                const audioUrl = String(audioFormat.url)

                processes.set(fileId, {
                    status: "processing",
                    outputPath,
                    yt: null,
                    expiresAt: Date.now() + 30 * 60 * 1000
                })

                const ffmpegArgs = [
                    '-i', videoUrl,
                    '-i', audioUrl,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-movflags', '+faststart',
                    '-y',
                    outputPath
                ]

                console.log('Spawning ffmpeg for YouTube stream, outputPath:', outputPath)

                let ffmpeg
                try {
                    ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: "pipe", cwd: __dirname })
                    processes.get(fileId).yt = ffmpeg
                } catch (e) {
                    // FIX: spawn can throw synchronously (e.g. bad binary path) — without
                    // this the request would hang since waitAndStream would poll forever
                    console.log('ffmpeg spawn threw synchronously:', e.message)
                    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                    processes.delete(fileId)
                    tk.delete(sid)
                    if (!res.writableEnded) {
                        res.status(500).json({ success: false, message: "error spawning ffmpeg: " + e.message })
                    }
                    return
                }

                // Both streams must be consumed — unread pipes block the child process
                ffmpeg.stderr.on('data', (data) => {
                    console.log('ffmpeg:', data.toString())
                })
                ffmpeg.stdout.on('data', () => {})

                ffmpeg.on('close', (code) => {
                    const entry = processes.get(fileId)
                    if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                        console.log('ffmpeg done, file size:', fs.statSync(outputPath).size)
                        if (entry) {
                            entry.status = "done"
                            entry.expiresAt = Date.now() + 30 * 60 * 1000
                        }
                    } else {
                        console.log('ffmpeg failed with code:', code)
                        if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                        // FIX 3: Mark failed BEFORE scheduling delete so waitAndStream
                        // can read the "failed" status. Delete after a short delay.
                        if (entry) {
                            entry.status = "failed"
                            setTimeout(() => processes.delete(fileId), 10000)
                        }
                        tk.delete(sid)
                    }
                })

                ffmpeg.on('error', (err) => {
                    console.log('ffmpeg spawn error:', err.message)
                    const entry = processes.get(fileId)
                    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                    if (entry) {
                        entry.status = "failed"
                        setTimeout(() => processes.delete(fileId), 10000)
                    }
                    tk.delete(sid)
                })

                waitAndStream(req, res, fileId, outputPath)
                return
            }

            console.log('No valid YouTube format URLs found, falling back to yt-dlp')
        }

        // Fallback: yt-dlp for non-YouTube or when no direct CDN URLs are present
        let headerArgs = []
        if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                headerArgs.push('--add-header', `${key}: ${value}`)
            }
        }

        const cookie = ensureCookiesFile()
        const ytdlpArg = [
            url,
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
            '--merge-output-format', 'mp4',
            '--cookies', cookie,
            ...headerArgs,
            '-o', outputPath
        ]

        let yt

        try {
            yt = spawn(ytDlpPath, ytdlpArg, { stdio: "pipe", cwd: __dirname })

            job.yt = yt
            job.outputFile = outputPath
            job.ready = false

            processes.set(fileId, {
                status: "processing",
                outputPath,
                yt,
                expiresAt: Date.now() + 30 * 60 * 1000
            })

        } catch (e) {
            tk.delete(sid)
            return res.status(501).json({ success: false, message: "error spawning yt-dlp: " + e })
        }

        // FIX 2: Consume yt-dlp stderr — on large files the 64KB pipe buffer fills up,
        // blocking the child process entirely until the pipe is drained.
        yt.stderr.on('data', (data) => {
            console.log('yt-dlp:', data.toString())
        })
        yt.stdout.on('data', () => {}) // drain stdout to be safe

        yt.on('close', (code) => {
            const entry = processes.get(fileId)
            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                console.log('yt-dlp done, file size:', fs.statSync(outputPath).size)
                job.ready = true
                if (entry) {
                    entry.status = "done"
                    entry.expiresAt = Date.now() + 30 * 60 * 1000
                }
            } else {
                console.log('yt-dlp failed with code:', code)
                job.ready = false
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                // FIX 3: Same as ffmpeg — mark failed first, delete after delay
                if (entry) {
                    entry.status = "failed"
                    setTimeout(() => processes.delete(fileId), 10000)
                }
                tk.delete(sid)
            }
        })

        yt.on('error', (err) => {
            console.log('yt-dlp spawn error:', err.message)
            const entry = processes.get(fileId)
            job.ready = false
            if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
            if (entry) {
                entry.status = "failed"
                setTimeout(() => processes.delete(fileId), 10000)
            }
            tk.delete(sid)
        })

        waitAndStream(req, res, fileId, outputPath)

    } catch (e) {
        console.log('stream error:', e.message)
        tk.delete(sid)
        if (!res.writableEnded) {
            res.status(500).json({ success: false, message: `Error streaming: ${e.message}` })
        }
    }
}
        
function streamFile(req, res, filePath) {
    try {
        const stat = fs.statSync(filePath)
        const fileSize = stat.size
        const range = req.headers.range

        if (!range) {
            res.writeHead(200, {
                "Content-Length": fileSize,
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes"
            })
            fs.createReadStream(filePath).pipe(res)
            return
        }

        const parts = range.replace(/bytes=/, "").split("-")
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunkSize = end - start + 1

        res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Type": "video/mp4"
        })

        fs.createReadStream(filePath, { start, end }).pipe(res)
    } catch (e) {
        console.log('streamFile error:', e.message)
        if (!res.writableEnded) res.status(500).end()
    }
}

function waitAndStream(req, res, fileId, outputPath) {
    const startTime = Date.now()
    const MAX_WAIT_MS = 15 * 60 * 1000 // 15-minute hard cap

    const wait = setInterval(() => {
        try {
            // FIX 4: Hard timeout — prevents infinite loop if something goes wrong silently
            if (Date.now() - startTime > MAX_WAIT_MS) {
                clearInterval(wait)
                console.log(`waitAndStream timeout for ${fileId}`)
                if (!res.writableEnded) res.status(504).json({ success: false, message: "streaming timed out" })
                return
            }

            const entry = processes.get(fileId)

            // FIX 3b: Handle the case where the entry was deleted before this tick runs
            // (race between failure handler calling delete and interval firing)
            if (!entry) {
                clearInterval(wait)
                if (!res.writableEnded) res.status(500).json({ success: false, message: "streaming failed" })
                return
            }

            if (entry.status === "failed") {
                clearInterval(wait)
                if (!res.writableEnded) res.status(500).json({ success: false, message: "streaming failed" })
                return
            }

            if (entry.status === "done" && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                clearInterval(wait)
                entry.expiresAt = Date.now() + 30 * 60 * 1000
                streamFile(req, res, outputPath)
            }
        } catch (e) {
            // FIX 5: fs.statSync can throw on a race (file deleted between existsSync and
            // statSync). Without this try/catch, an exception here happens inside a
            // setInterval callback — Express can't catch it, so it would crash the
            // process instead of giving the frontend a usable error response.
            clearInterval(wait)
            console.log('waitAndStream poll error:', e.message)
            if (!res.writableEnded) res.status(500).json({ success: false, message: "streaming failed: " + e.message })
        }
    }, 1000)

    res.on('close', () => {
        clearInterval(wait)
    })
}

export {stream, knowStreamer}
              
