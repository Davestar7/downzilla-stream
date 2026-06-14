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

const tk = new Map()

const knowStreamer = (req, res) => {
    const { url, title, formats = null, height = null, headers = null, vid } = req.body

    if (!url || !title) {
        return res.status(400).json({
            success: false,
            message: "failed incomplete data"
        })
    }

    let header = headers
    if (!header) {
        header = formats[0]?.http_headers
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

        // Reuse existing file
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

        // Reuse in-progress job
        let entry = processes.get(fileId)
        if (entry && entry.status === "processing") {
            waitAndStream(req, res, fileId, outputPath)
            return
        }

        // Check if formats from youtubei.js have direct URLs
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')

        if (isYouTube && formats && formats.length > 0) {
            // Use direct URLs from youtubei.js metadata
            const videoFormat = formats.find(f => 
                f.vcodec !== 'none' && f.acodec === 'none' && 
                f.ext === 'mp4' && f.height && f.height <= (newHeight || 1080) && f.url
            ) || formats.find(f => f.vcodec !== 'none' && f.url)

            const audioFormat = formats.find(f => 
                f.acodec !== 'none' && f.vcodec === 'none' && f.url
            )

            if (videoFormat?.url && audioFormat?.url) {
                processes.set(fileId, {
                    status: "processing",
                    outputPath,
                    yt: null,
                    expiresAt: Date.now() + 30 * 60 * 1000
                })

                // Use ffmpeg to merge video and audio from direct URLs
                const ffmpegArgs = [
                    '-i', videoFormat.url,
                    '-i', audioFormat.url,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-movflags', '+faststart',
                    '-y',
                    outputPath
                ]

                const ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: "pipe", cwd: __dirname })

                processes.get(fileId).yt = ffmpeg

                ffmpeg.stderr.on('data', (data) => {
                    console.log('ffmpeg:', data.toString())
                })

                ffmpeg.on('close', (code) => {
                    const entry = processes.get(fileId)
                    if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                        if (entry) {
                            entry.status = "done"
                            entry.expiresAt = Date.now() + 30 * 60 * 1000
                        }
                    } else {
                        if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                        if (entry) {
                            entry.status = "failed"
                            processes.delete(fileId)
                        }
                        tk.delete(sid)
                    }
                })

                ffmpeg.on('error', () => {
                    const entry = processes.get(fileId)
                    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                    if (entry) {
                        entry.status = "failed"
                        processes.delete(fileId)
                    }
                    tk.delete(sid)
                })

                waitAndStream(req, res, fileId, outputPath)
                return
            }
        }

        // Fallback to yt-dlp for non-YouTube or if no direct URLs
        let headerArgs = []
        if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                headerArgs.push('--add-header', `${key}: ${value}`)
            }
        }

        const cookie = ensureCookiesFile()
        const ytdlpArg = [url, '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--cookies', cookie, ...headerArgs, '-o', outputPath]

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
            return res.status(501).json({ success: false, message: "error trying to download request: " + e })
        }

        yt.on('close', (code) => {
            const entry = processes.get(fileId)
            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                job.ready = true
                if (entry) {
                    entry.status = "done"
                    entry.expiresAt = Date.now() + 30 * 60 * 1000
                }
            } else {
                job.ready = false
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                if (entry) {
                    entry.status = "failed"
                    processes.delete(fileId)
                }
                tk.delete(sid)
            }
        })

        yt.on('error', () => {
            const entry = processes.get(fileId)
            job.ready = false
            if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
            if (entry) {
                entry.status = "failed"
                processes.delete(fileId)
            }
            tk.delete(sid)
        })

        waitAndStream(req, res, fileId, outputPath)

    } catch (e) {
        console.log(e.message)
        tk.delete(sid)
        if (!res.writableEnded) {
            res.status(500).json({ message: `Error streaming: ${e.message}` })
        }
    }
}

/*
const stream = async (req, res) => {
    const { sid } = req.query

    try {
        const job = tk.get(sid)
        
        let outputPath

        if (job?.yt && job?.outputFile) {
            if (fs.existsSync(job.outputFile) && fs.statSync(job.outputFile).size > 0) {
                streamer(job.outputFile)
                return
            }
        }

        const url = job.url
        const title = job.title
        const formats = job.formats
        const height = job.height
        const headers = job.headers

        let forFormat;
        let for_id
        let formatc

        const newHeight = getHeightFromString(height)
        
        if (newHeight === null || newHeight < 144 || newHeight > 1080 || typeof newHeight != "number") {    
            const selected = selectvideoformat(formats)
            if (selected === null) {
                return res.status(400).json({
                    success: false,
                    message: "streamable format not found"
                })
            }
            
            formatc = chooseFormat(Number(selected.height))
        }
        // const domain = getMainDomain(url)
        let yt
        if (!formatc) {
            formatc = chooseFormat(Number(height))
        }

        let newtitle = sanname(title).toString().toLowerCase().trim()
        // const filename = (newtitle || "video") + "_downzilla.mp4"
        
        const id = crypto.randomBytes(6).toString('hex');
        outputPath = path.join(tempPath, `${newtitle.toLowerCase()}-${id}.mp4`);


        try {   
            
            let headerArgs = []
            if (headers && typeof headers === "object") {
                for (const [key, value] of Object.entries(headers)) {
                    headerArgs.push('--add-header', `${key}: ${value}`);
                }
            }

        const cookie = ensureCookiesFile()
                
            
            // const ytdlpArg = [ url, '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', "--extractor-args", 'youtube:player_client=android', '--cookies', cookie, '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s')];
           const ytdlpArg = [url, '--js-runtimes', 'node', '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best', '--merge-output-format', 'mp4', '--extractor-args', 'youtube:player_client=web', '--cookies', cookie, ...headerArgs, '-o', '-'];

            yt = spawn(ytDlpPath, ytdlpArg, {
                stdio: "pipe",
                cwd: __dirname
            })
            job.outputFile = outputPath
            job.yt = yt
        } catch (e) {
            if (fs.existsSync(job.outputFile)) {
                fs.unlink(job.outputFile, () => {});
            }
            tk.delete(sid)
            return res.status(501).json({
                success: false,
                message: "error trying to download request: " + e
            })
        }
            
        const heartbeat = setInterval(() => {
           if (!res.writableEnded) {
              res.write(Buffer.alloc(0));
            }
         }, 3000);

        
        yt.on('close', (code) => {
               clearInterval(heartbeat);
    
             if (code !== 0) {
               if (fs.existsSync(outputPath))   fs.unlink(outputPath, () => {});
              tk.delete(sid);
              return res.status(500).json({ success: false, message: 'Download failed' });
         }
    streamer(outputPath);
});

        async function streamer(out = null) {
            try {
                const realout = out || tk.get(sid).outputFile
                const stat = fs.statSync(realout)
                const filesize = stat.size;

                const range = req.headers.range;
                if (!range) {
                    res.writeHead(200, {
                      'Content-Type': 'video/mp4',
                      'Transfer-Encoding': 'chunked',
                      'X-Accel-Buffering': 'no'
                    });
                    fs.createReadStream(realout).pipe(res)
                    return
                }

                const parts = range.replace(/bytes=/, "").split("-")
                const start = parseInt(parts[0], 10)
                const end = parts[1] ? parseInt(parts[1], 10) : filesize - 1
                const chuckSize = end - start + 1

                const streaming = fs.createReadStream(realout, { start, end })
                res.writeHead(206, {
                    "Content-Range": `bytes ${start}-${end}/${filesize}`,
                    "Accept-Range": "bytes",
                    "Content-Length": chuckSize,
                    "Content-Type": "video/mp4"
                });

                await streaming.pipe(res)
            } catch (e) {
                tk.delete(sid)
            }
        }

        try {
             await res.on("close", () => {
                setTimeout(() => {
                    if (fs.existsSync(job.outputFile)) {
                        fs.unlink(job.outputFile, () => {});
                    }
                    tk.delete(sid)            
                }, 600000);
                yt.kill("SIGKILL") 
        
            })
            
        } catch (e) {
            tk.delete(sid)
            yt.kill("SIGKILL")
            res.status(500).json({
                message: "ended with server error"
            })
        }
        try {
            await res.on("finish", () => {
                setTimeout(() => {
                    if (fs.existsSync(job.outputFile)) {
                        fs.unlink(job.outputFile, () => {});
                    }
                    tk.delete(sid)            
                }, 600000);
                yt.kill("SIGKILL")
            }) 
        } catch (e) {
            tk.delete(sid)
            yt.kill("SIGKILL")
            res.status(500).json({
                message: "seems to be some kind of error"
            })
        }
    } catch (e) {
        tk.delete(sid)
        res.status(500).json({
            message: `Error streaming: ${e.message}`
        })
    }
}
*/

export {stream, knowStreamer}
