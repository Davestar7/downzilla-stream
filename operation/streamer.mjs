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

const knowStreamer = (req, res) => {
    const { url, title, formats, height = null, headers } = req.body
    
    if (!url || !title || !formats) {
        return res.status(400).json({
            success: false,
            message: "failed incomplete data"
        })
    }
    let header = headers
    if (!header) {
      header = formats[0].http_headers
    }
    
    if (!header) {
       return res.status(404).json({
         success: false,
         message: "header not found"
       })
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
        outputFile: null
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
           const ytdlpArg = [url, '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--extractor-args', 'youtube:player_client=web,mweb', '--cookies', cookie, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s')];

            yt = spawn(ytDlpPath, ytdlpArg, {
                stdio: "inherit",
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
            
        const interva = setInterval(() => {
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                clearInterval(interva)
                streamer(job.outputFile)
            }
        }, 300)

        async function streamer(out = null) {
            try {
                const realout = out || tk.get(sid).outputFile
                const stat = fs.statSync(realout)
                const filesize = stat.size;

                const range = req.headers.range;
                if (!range) {
                    res.writeHead(200, {
                        "Content-Length": filesize,
                        "Content-Type": "video/mp4"
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

export {stream, knowStreamer}