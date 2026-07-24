import path from "path"
import fs from 'fs';
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto"
import {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject, chooseFormat, ensureCookiesFile, processes, buildYtdlpArgs} from "./dependencies.mjs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "/app/operation/yt-dlp";

const ffmpegPath = isWindows
  ? path.join(__dirname, "ffmpeg-n8.0-7-g4f8b3891ee-win64-lgpl-shared-8.0", "bin", "ffmpeg.exe")
  : '/usr/bin/ffmpeg';

const tempPath = path.join(__dirname, "temp");

// How long a download job is allowed to run before we consider it stuck
// and force-kill it. Without this, a hung yt-dlp process (e.g. stalled on
// an nsig challenge or SABR-forced manifest resolution) leaves the job
// stuck at "processing" forever, with the frontend polling indefinitely
// and no visible error.
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true })
    console.log('Created temp directory:', tempPath)
}

const startDownload = async (req, res) => {
    const {url, format_id, title, formats, height = null, headers, vid} = req.body

    try {
        let formatc
        const newHeight = getHeightFromString(height)

        if (newHeight === null || newHeight < 144 || newHeight > 1080 || typeof newHeight != "number") {    
            const selected = selectvideoformat(formats)
            formatc = chooseFormat(Number(selected?.height))
        } else {
            formatc = chooseFormat(Number(height))
        }

        const newtitle = sanname(title).toString().toLowerCase().trim()
        const filename = (newtitle || "video") + "_downzilla.mp4"

        let fileId
        if (vid) {
            fileId = crypto.createHash('md5').update(`${vid}-${formatc || 'default'}`).digest('hex')
        } else {
            fileId = crypto.createHash('md5').update(`${newtitle}-${formatc || 'default'}`).digest('hex')
        }

        const outputPath = path.join(tempPath, `${fileId}.mp4`)

        // Reuse existing completed file
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            let job = processes.get(fileId)
            if (!job) {
                job = { status: "done", outputPath, yt: null }
                processes.set(fileId, job)
            }
            job.status = "done"
            job.filename = filename
            job.expiresAt = Date.now() + 30 * 60 * 1000
            return res.json({ success: true, jobId: fileId })
        }

        // Attach to already in-progress job
        let existingJob = processes.get(fileId)
        if (existingJob && existingJob.status === "processing") {
            existingJob.filename = filename
            return res.json({ success: true, jobId: fileId })
        }

        const cookie = ensureCookiesFile()

        let headerArgs = []
        if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                headerArgs.push('--add-header', `${key}: ${value}`)
            }
        }

        const defaultHeaders = [
            '--add-header', 'Referer:https://www.google.com/',
            '--add-header', `User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
        ]

        const ytdlpArg = buildYtdlpArgs(url, outputPath, cookie, newHeight, defaultHeaders, headerArgs)
        console.log('[DOWNLOAD] args:', ytdlpArg)
        console.log('[DOWNLOAD] starting job:', fileId, '| url:', url)

        const yt = spawn(ytDlpPath, ytdlpArg, {
            stdio: "pipe",
            cwd: __dirname
        })

        const job = {
            status: "processing",
            outputPath,
            filename,
            yt,
            expiresAt: Date.now() + 30 * 60 * 1000
        }
        processes.set(fileId, job)

        // Respond immediately — client polls confirmDownload for status
        res.json({ success: true, jobId: fileId })

        // Timeout guard — if yt-dlp hasn't finished within DOWNLOAD_TIMEOUT_MS,
        // force-kill it and mark the job failed instead of leaving it stuck
        // at "processing" forever.
        const hangTimeout = setTimeout(() => {
            if (!yt.killed) {
                console.log('[DOWNLOAD] job', fileId, 'exceeded timeout — killing process')
                try { yt.kill('SIGKILL') } catch (e) {
                    console.error('[DOWNLOAD] failed to kill hung process:', e.message)
                }
                const currentJob = processes.get(fileId)
                if (currentJob && currentJob.status === "processing") {
                    currentJob.status = "failed"
                    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                }
            }
        }, DOWNLOAD_TIMEOUT_MS)

        let lastStderr = ""

        // FIX 2: Consume stderr — without this, the 64KB pipe buffer fills up on
        // large downloads and yt-dlp blocks indefinitely waiting for it to drain.
        yt.stderr.on('data', (data) => {
            const line = data.toString()
            lastStderr = line
            console.log('yt-dlp:', line)
        })
        yt.stdout.on('data', () => {}) // drain stdout

        yt.on("close", (code) => {
            clearTimeout(hangTimeout)
            const currentJob = processes.get(fileId)
            if (!currentJob) return

            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                console.log('[DOWNLOAD] job', fileId, 'done, file size:', fs.statSync(outputPath).size)
                currentJob.status = "done"
                currentJob.expiresAt = Date.now() + 30 * 60 * 1000
            } else {
                console.log('[DOWNLOAD] job', fileId, 'failed with code:', code, '| last stderr:', lastStderr.slice(0, 500))
                currentJob.status = "failed"
                currentJob.error = lastStderr.slice(0, 500)
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
            }
        })

        // FIX 3: Capture the err argument — previously swallowed silently
        yt.on("error", (err) => {
            clearTimeout(hangTimeout)
            console.error('[DOWNLOAD] spawn error for job', fileId, ':', err.message)
            const currentJob = processes.get(fileId)
            if (currentJob) {
                currentJob.status = "failed"
                currentJob.error = err.message
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
            }
        })

    } catch (e) {
        console.error('[DOWNLOAD] startDownload outer catch:', e)
        res.status(500).json({ success: false, message: `${e.message}, apologies 😣 fix in progress` })
    }
}

const confirmDownload = async (req, res) => {
    const { jobId } = req.query

    try {
        if (!jobId) {
            return res.status(400).json({ success: false, message: "jobId is required" })
        }

        const job = processes.get(jobId)

        if (!job) {
            return res.status(404).json({ success: false, message: "job not found" })
        }

        if (job.status === "processing") {
            return res.json({ success: true, done: false, status: "processing" })
        }

        if (job.status === "failed") {
            const errorMessage = job.error || "download failed"
            processes.delete(jobId)
            return res.json({ success: false, done: false, status: "failed", message: errorMessage })
        }

        if (job.status === "done") {
            job.expiresAt = Date.now() + 30 * 60 * 1000
            return res.json({ success: true, done: true, status: "done", jobId })
        }

    } catch (e) {
        console.error('[DOWNLOAD] confirmDownload error:', e)
        res.status(500).json({ success: false, message: `${e.message}, apologies 😣 fix in progress` })
    }
}


const serveDownload = async (req, res) => {
    const { jobId } = req.query

    try {
        if (!jobId) return res.status(400).json({ success: false, message: "jobId is required" })

        const job = processes.get(jobId)
        if (!job) return res.status(404).json({ success: false, message: "job not found" })

        if (job.status !== "done") return res.status(400).json({ success: false, message: "download not ready yet" })

        if (!fs.existsSync(job.outputPath)) {
            processes.delete(jobId)
            return res.status(404).json({ success: false, message: "file not found" })
        }

        job.expiresAt = Date.now() + 30 * 60 * 1000

        const stat = fs.statSync(job.outputPath)
        const fileSize = stat.size
        const range = req.headers.range

        if (!range) {
            res.setHeader("Content-Length", fileSize)
            res.setHeader("Content-Type", "video/mp4")
            res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`)
            res.setHeader("Accept-Ranges", "bytes")
            res.setHeader("Access-Control-Expose-Headers", "Content-Length")

            const fileStream = fs.createReadStream(job.outputPath)
            fileStream.on("error", (err) => {
                console.log('serveDownload stream error:', err.message)
                if (!res.writableEnded) res.end()
            })
            fileStream.pipe(res)
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
            "Content-Type": "video/mp4",
            "Content-Disposition": `attachment; filename="${job.filename}"`,
            "Access-Control-Expose-Headers": "Content-Length"
        })

        const fileStream = fs.createReadStream(job.outputPath, { start, end })
        fileStream.on("error", (err) => {
            console.log('serveDownload range stream error:', err.message)
            if (!res.writableEnded) res.end()
        })
        fileStream.pipe(res)

    } catch (e) {
        console.error('[DOWNLOAD] serveDownload error:', e)
        res.status(500).json({ success: false, message: `${e.message}, apologies 😣 fix in progress` })
    }
}

export { startDownload, confirmDownload, serveDownload };
                             
