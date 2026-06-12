import path from "path"
import fs from 'fs';
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto"
import {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject, chooseFormat, ensureCookiesFile} from "./dependencies.mjs"

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

import crypto from 'crypto'

// Shared map to track files by content identifier (separate from session map `tk`)
const streamFiles = new Map()

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
            formatc = chooseFormat(Number(selected.height))
        }

        if (!formatc) {
            formatc = chooseFormat(Number(height))
        }

        let newtitle = sanname(title).toString().toLowerCase().trim()

        // Use vid if available, otherwise fall back to title, combined with format for uniqueness
        const baseIdentifier = vid || newtitle
        const fileId = crypto.createHash('md5').update(`${baseIdentifier}-${formatc || 'default'}`).digest('hex')
        const outputPath = path.join(tempPath, `${fileId}.mp4`)

        // Check if file already exists and is valid - stream it directly
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            let entry = streamFiles.get(fileId)
            if (!entry) {
                entry = { status: "done", outputFile: outputPath, yt: null }
                streamFiles.set(fileId, entry)
            }
            entry.expiresAt = Date.now() + 30 * 60 * 1000 // extend expiry
            job.outputFile = outputPath
            job.ready = true
            streamFile(req, res, outputPath)
            return
        }

        // If another session already started this exact file, wait on that one
        let entry = streamFiles.get(fileId)

        if (entry && entry.status === "processing") {
            job.outputFile = entry.outputFile
            job.yt = entry.yt
            job.ready = false
            waitAndStream(req, res, job, sid, fileId)
            return
        }

        let headerArgs = []
        if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                headerArgs.push('--add-header', `${key}: ${value}`);
            }
        }

        const cookie = ensureCookiesFile()

        // Save to file instead of piping to stdout for range support
        const ytdlpArg = [url, '--js-runtimes', 'node', '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--extractor-args', 'youtube:player_client=web', '--cookies', cookie, ...headerArgs, '-o', outputPath];

        let yt

        try {
            yt = spawn(ytDlpPath, ytdlpArg, {
                stdio: "pipe",
                cwd: __dirname
            })

            job.yt = yt
            job.outputFile = outputPath
            job.ready = false

            entry = {
                status: "processing",
                outputFile: outputPath,
                yt: yt,
                expiresAt: Date.now() + 30 * 60 * 1000
            }
            streamFiles.set(fileId, entry)

        } catch (e) {
            tk.delete(sid)
            return res.status(501).json({
                success: false,
                message: "error trying to download request: " + e
            })
        }

        yt.on('close', (code) => {
            const entry = streamFiles.get(fileId)

            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                job.ready = true
                if (entry) {
                    entry.status = "done"
                    entry.expiresAt = Date.now() + 30 * 60 * 1000
                }
            } else {
                job.ready = false
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {})
                if (entry) streamFiles.delete(fileId)
                tk.delete(sid)
            }
        });

        // Wait for download to complete then stream
        waitAndStream(req, res, job, sid, fileId)

    } catch (e) {
        console.log(e.message)
        tk.delete(sid)
        if (!res.writableEnded) {
            res.status(500).json({ message: `Error streaming: ${e.message}` })
        }
    }
}

function waitAndStream(req, res, job, sid, fileId) {
    req.socket.setTimeout(0)
    req.socket.setKeepAlive(true, 3000)
    res.setTimeout(0)

    const wait = setInterval(() => {
        const entry = streamFiles.get(fileId)

        if (entry && entry.status === "failed") {
            clearInterval(wait)
            if (!res.writableEnded) res.status(500).json({ success: false, message: "streaming failed" })
            return
        }

        if (job.ready && fs.existsSync(job.outputFile) && fs.statSync(job.outputFile).size > 0) {
            clearInterval(wait)
            if (entry) entry.expiresAt = Date.now() + 30 * 60 * 1000
            streamFile(req, res, job.outputFile)
        }
    }, 1000)

    // If client disconnects while waiting
    res.on('close', () => {
        clearInterval(wait)
        // Don't kill yt if other sessions are waiting on the same fileId
        // Only kill if this was the only consumer - skipped for simplicity
    })
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

// Cleanup job - run periodically to remove expired stream files
setInterval(() => {
    const now = Date.now()

    for (const [fileId, entry] of streamFiles.entries()) {
        if (entry.status === "done" && entry.expiresAt && now > entry.expiresAt) {
            if (fs.existsSync(entry.outputFile)) fs.unlink(entry.outputFile, () => {})
            streamFiles.delete(fileId)
        }
    }
}, 5 * 60 * 1000) // check every 5 minutes

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
