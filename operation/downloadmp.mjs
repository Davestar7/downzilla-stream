import path from "path"
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs"
import {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject, chooseFormat, ensureCookiesFile} from "./dependencies.mjs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "/app/operation/yt-dlp";

const ffmpegPath = isWindows
  ? path.join(__dirname, "ffmpeg-n8.0-7-g4f8b3891ee-win64-lgpl-shared-8.0", "bin", "ffmpeg.exe")
  : "/app/operation/ffmpeg";

const tempPath = path.join(__dirname, "temp")

// FIX 1: Ensure temp directory exists — yt-dlp fails silently without it
if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true })
    console.log('Created temp directory:', tempPath)
}

// FIX 4: Audio jobs use their own isolated map (removed unused `processes as p` import
// and the misleading "use existing" comment — this was always a separate local map)
const audioProcesses = new Map();

const startAudioDownload = async (req, res) => {
    const { url, title, format_id, ext, formats, headers} = req.body

    if (!url) {
        return res.status(400).json({ success: false, message: "required data not found" })
    }

    let format = format_id
    let extformat = ext

    if (format_id == null) {
        if (formats) {
            const choosen = selectaudioformat(formats)
            format = choosen.format_id
            extformat = choosen.ext
        } 
    }

    let name = sanname(title).toString().toLowerCase().trim()
    const filename = (name || "audio") + "_downzilla.mp3"

    const id = crypto.randomBytes(6).toString('hex');
    const outputPath = path.join(tempPath, `${name.toLowerCase()}-${id}.mp3`);

    let headerArgs = []
    if (headers && typeof headers === "object") {
        for (const [key, value] of Object.entries(headers)) {
            headerArgs.push('--add-header', `${key}: ${value}`);
        }
    }

    try {
        const cookie = ensureCookiesFile()

        const args = [
            url,
            '-f', 'bestaudio[ext=m4a]/bestaudio/best',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '--postprocessor-args', 'ffmpeg:-vn',
            '--extractor-args', 'youtube:player_client=tv',
            '--js-runtimes', 'node',
            '--cookies', cookie,
            ...headerArgs,
            '-o', outputPath.replace('.mp3', '.%(ext)s')
        ];

        const yt = spawn(ytDlpPath, args, {
            stdio: "pipe",
            cwd: __dirname
        });

        audioProcesses.set(id, {
            status: "processing",
            outputPath,
            filename,
            yt,
            expiresAt: Date.now() + 30 * 60 * 1000
        });

        res.json({ success: true, jobId: id });

        // FIX 2: Consume stderr — without this the 64KB pipe buffer fills on large
        // audio files and yt-dlp blocks mid-download. close event never fires,
        // job stays "processing" forever and the client polls indefinitely.
        yt.stderr.on('data', (data) => {
            console.log('yt-dlp audio:', data.toString())
        })
        yt.stdout.on('data', () => {}) // drain stdout

        yt.on("close", (code) => {
            const job = audioProcesses.get(id);
            if (!job) return;

            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                console.log('yt-dlp audio done, file size:', fs.statSync(outputPath).size)
                job.status = "done";
                job.expiresAt = Date.now() + 30 * 60 * 1000
            } else {
                console.log('yt-dlp audio failed with code:', code)
                job.status = "failed";
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
            }
        });

        // FIX 3: Capture err argument — was silently dropped before
        yt.on("error", (err) => {
            console.log('yt-dlp audio spawn error:', err.message)
            const job = audioProcesses.get(id);
            if (job) {
                job.status = "failed";
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
            }
        });

    } catch (e) {
        console.log(e);
        if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
        res.status(500).json({ success: false, message: e.message });
    }
}

const confirmAudioDownload = async (req, res) => {
    const { jobId } = req.query;

    try {
        if (!jobId) return res.status(400).json({ success: false, message: "jobId is required" });

        const job = audioProcesses.get(jobId);
        if (!job) return res.status(404).json({ success: false, message: "job not found" });

        if (job.status === "processing") {
            return res.json({ success: true, done: false, status: "processing" });
        }

        if (job.status === "failed") {
            audioProcesses.delete(jobId);
            return res.json({ success: false, done: false, status: "failed", message: "download failed" });
        }

        if (job.status === "done") {
            job.expiresAt = Date.now() + 30 * 60 * 1000
            return res.json({ success: true, done: true, status: "done", jobId });
        }

    } catch (e) {
        console.log(e);
        res.status(500).json({ success: false, message: e.message });
    }
}

const serveAudioDownload = async (req, res) => {
    const { jobId } = req.query;

    try {
        if (!jobId) return res.status(400).json({ success: false, message: "jobId is required" });

        const job = audioProcesses.get(jobId);
        if (!job) return res.status(404).json({ success: false, message: "job not found" });

        if (job.status !== "done") {
            return res.status(400).json({ success: false, message: "download not ready yet" });
        }

        if (!fs.existsSync(job.outputPath)) {
            audioProcesses.delete(jobId);
            return res.status(404).json({ success: false, message: "file not found" });
        }

        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);

        res.download(job.outputPath, job.filename, (err) => {
            if (err) console.log('serve audio error:', err.message);
            if (fs.existsSync(job.outputPath)) fs.unlink(job.outputPath, () => {});
            audioProcesses.delete(jobId);
        });

    } catch (e) {
        console.log(e);
        res.status(500).json({ success: false, message: e.message });
    }
}

export { startAudioDownload, confirmAudioDownload, serveAudioDownload };
