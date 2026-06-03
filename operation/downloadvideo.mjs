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

const tempPath = path.join(__dirname, "temp");

const processes = new Map();

const startDownload = async (req, res) => {
    const {url, format_id, title, start, end, formats, height = null, headers} = req.body
    
    try {
        let for_id = format_id
        const newHeight = getHeightFromString(height)

        if (newHeight === null || newHeight < 144 || newHeight > 1080 || typeof newHeight != "number") {    
            const selected = selectvideoformat(formats)
            
            for_id = selected?.format_id

            const forFormat = selectaudioformat(formats)
            
        } 

        let newtitle = sanname(title).toString().toLowerCase().trim()
        const filename = (newtitle || "video") + "_downzilla.mp4"
        const id = crypto.randomBytes(6).toString('hex');
        const outputPath = path.join(tempPath, `${newtitle}-${id}.mp4`);

        const cookie = ensureCookiesFile()

        let headerArgs = []
        if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                headerArgs.push('--add-header', `${key}: ${value}`);
            }
        }

        const defaultHeaders = [
    '--add-header', 'Referer:https://www.google.com/',
    '--add-header', `User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`,
];

        const ytdlpArg = [url, '-f', 'bestvideo[ext=mp4][filesize<200M]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[filesize<200M]/best', '--merge-output-format', 'mp4', '--extractor-args', 'youtube:player_client=tv', '--js-runtimes', 'node', '--cookies', cookie, ...defaultHeaders, ...headerArgs, '-o', outputPath];

        const yt = spawn(ytDlpPath, ytdlpArg, {
            stdio: "pipe",
            cwd: __dirname
        });

        // Store in processes map
        processes.set(id, {
            status: "processing", // processing | done | failed
            outputPath,
            filename,
            yt
        });

        // Return job ID immediately
        res.json({ success: true, jobId: id });

        yt.on("close", (code) => {
            
            const process = processes.get(id);
            if (!process) return;

            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                console.log("done processing")
                process.status = "done";
            } else {
                process.status = "failed";
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
            }
        });

        yt.on("error", () => {
            const process = processes.get(id);
            if (process) {
                process.status = "failed";
                if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
            }
        });

    } catch (e) {
        
        res.status(500).json({ success: false, message: e.message });
    }
}


const confirmDownload = async (req, res) => {
    const { jobId } = req.query;
   

    try {
        if (!jobId) {
            return res.status(400).json({ success: false, message: "jobId is required" });
        }

        const process = processes.get(jobId);

        if (!process) {
            return res.status(404).json({ success: false, message: "job not found" });
        }

        // Return current status - frontend keeps polling if still processing
        if (process.status === "processing") {
            
            return res.json({ success: true, done: false, status: "processing" });
        }

        if (process.status === "failed") {
            processes.delete(jobId);
            return res.json({ success: false, done: false, status: "failed", message: "download failed" });
        }

        if (process.status === "done") {
            return res.json({ success: true, done: true, status: "done", jobId });
        }

    } catch (e) {
        console.log(e);
        res.status(500).json({ success: false, message: e.message });
    }
}


const serveDownload = async (req, res) => {
    const { jobId } = req.query;
    
    try {
        if (!jobId) {
            return res.status(400).json({ success: false, message: "jobId is required" });
        }

        const process = processes.get(jobId);

        if (!process) {
            return res.status(404).json({ success: false, message: "job not found" });
        }

        if (process.status !== "done") {
            return res.status(400).json({ success: false, message: "download not ready yet" });
        }

        if (!fs.existsSync(process.outputPath)) {
            processes.delete(jobId);
            return res.status(404).json({ success: false, message: "file not found" });
        }

        res.download(process.outputPath, process.filename, (err) => {
            if (err) console.log('serve error:', err);
            if (fs.existsSync(process.outputPath)) fs.unlink(process.outputPath, () => {});
            processes.delete(jobId);
        });

    } catch (e) {
        console.log(e);
        res.status(500).json({ success: false, message: e.message });
    }
}

export { startDownload, confirmDownload, serveDownload };







/*
const downloadVideoFunction = async (req, res) => {
    const {url, format_id, title, start, end, formats, height = null, headers} = req.body
    
    let forFormat;
    let for_id = format_id

    const newHeight = getHeightFromString(height)
    
    if (newHeight === null || newHeight < 144 || newHeight > 1080 || typeof newHeight != "number") {    
        const selected = selectvideoformat(formats)
        if (selected === null) {
            return res.status(400).json({
                success: false,
                message: "downloadable format not found"
            })
        }
        for_id = selected.format_id

        forFormat = selectaudioformat(formats)
        if (forFormat === null) {
            return res.status(400).json({
                success: false,
                message: "no audio format found"
            })
        }
    } 
    // const audio_id = forFormat.format_id

    // const domain = getMainDomain(url)
    let yt

    let newtitle = sanname(title).toString().toLowerCase().trim()
    const filename = (newtitle || "video") + "_downzilla.mp4"
    
    const id = crypto.randomBytes(6).toString('hex');
    const outputPath = path.join(tempPath, `${newtitle.toLowerCase()}-${id}.mp4`);


    try {   
        const formatc = chooseFormat(Number(height))
        // console.log("audioId: ", audio_id, "formatId: ", format_id, "timer: ", start, "-to-", end)
        // let format = audio_id ? `${for_id}+${audio_id}` : `${format_id}+bestaudio`
        // format = `bv*[height<=1080][ext=mp4]+ba[ext=m4a]`

        const cookie = ensureCookiesFile()

        await res.setHeader("Content-Type", "video/mp4");
        await res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        // const trimArg = `ffmpeg:-ss ${start} -to ${end} -map 0:v -map 0:a`
        
        let headerArgs = []
        
        if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                headerArgs.push('--add-header', `${key}: ${value}`);
               }
             }
             
        
        // const nodePath = process.platform === 'win32' ? process.execPath : '/usr/user/bin'
        // console.log(`node path: ${nodePath}`)

        // const ytdlpArg = [ '-f', format || 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', 'youtube:player_client=android', '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s'), url];
        // const ytdlpArg = [ url, '-f', format || 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', "--extractor-args", 'youtube:player_client=android', '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s')];
        // const ytdlpArg = [ url, '-f', formatc, '--merge-output-format', 'mp4', "--extractor-args", 'youtube:player_client=android', 'cookies', cookies, '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s')];
        const ytdlpArg = [url, '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--extractor-args', 'youtube:player_client=tv', '--js-runtimes', 'node', '--cookies', cookie, ...headerArgs, '-o', '-'];

        yt = spawn(ytDlpPath, ytdlpArg, {
            stdio: "inherit",
            cwd: __dirname
        })
    } catch (e) {
        if (fs.existsSync(outputPath)) {
            fs.unlink(outputPath, () => {});
        }
        return res.status(501).json({
            success: false,
            message: "error trying to download request: " + e
        })
    }
        
    // await yt.stdout.pipe(res)

    // yt.stderr.on("data", async data =>  console.log("data: " + await data.toString()))

    await req.on("close", () => {
        yt.kill("SIGKILL")
    })
    yt.on("close", async (code) => {
        if (code !== 0) {
            if (fs.existsSync(outputPath)) {
                fs.unlink(outputPath, () => {});
            }
            
            if (!res.writableEnded) {
                return res.status(500).json({
                    success: false,
                    message: "download failed"
                })
            }
        }
        
        res.download(outputPath, () => {
                fs.unlink(outputPath, () => {});
            });
    })   
}
*/

// export default downloadVideoFunction