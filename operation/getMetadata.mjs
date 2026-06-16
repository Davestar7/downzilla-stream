import path from "path"
import { spawn } from "child_process";
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
    return url.includes('youtube.com') || url.includes('youtu.be')
}

// Start bgutil POT server once at startup
let bgutilStarted = false

function startBgutilServer() {
    if (bgutilStarted) return
    bgutilStarted = true

    try {
        const bgutil = spawn('node', ['/app/bgutil/server/build/main.js'], {
            stdio: 'pipe',
            detached: true
        })

        bgutil.stdout.on('data', d => console.log('bgutil:', d.toString().trim()))
        bgutil.stderr.on('data', d => console.log('bgutil err:', d.toString().trim()))

        bgutil.on('close', (code) => {
            console.log('bgutil server closed with code:', code)
            bgutilStarted = false
        })

        bgutil.unref()
        console.log('bgutil POT server started on port 4416')
    } catch (e) {
        console.log('Failed to start bgutil server:', e.message)
    }
}

// Start server at module load
startBgutilServer()

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
                    // Use bgutil POT provider for YouTube
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
                }

                proc = spawn(ytDlpPath, argss, { stdio: ["ignore", "pipe", "pipe"] })

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

export {metadataExtractor}
