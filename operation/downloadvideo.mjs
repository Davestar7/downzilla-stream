import path from "path"
import fs from 'fs';
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto"
import {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject} from "./dependencies.mjs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytDlpPath = (process.platform === 'win32' ? path.join(__dirname, "../bin", "yt-dlp.exe") : path.join(__dirname, '../bin', 'yt-dlp'))

const ffmpegPath = process.env.FFMPEG_PATH || (process.platform === 'win32' ? path.join(__dirname, "../ffmpeg-n8.0-7-g4f8b3891ee-win64-lgpl-shared-8.0/bin", "ffmpeg.exe") : '/usr/bin/ffmpeg');
const tempPath = path.join(__dirname, "temp")

const downloadVideoFunction = async (req, res) => {
    const {url, format_id, title, start, end, formats, height = null, headers} = req.body
    
    let forFormat;
    let for_id = format_id

    console.log(`type of format ${typeof height} - ${height}`)
    const newHeight = getHeightFromString(height)
    console.log(`new height type ${typeof newHeight} - ${newHeight}`)

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
    } else {
        if (!url || !format_id) {
            console.log("failed first condition")
            return res.status(400).json({
                success: false,
                message: "missing parameters"
            })
        }
        console.log("format proceed")

        forFormat = selectaudioformat(formats)
        if (forFormat === null) {
            console.log("failed second condition: ", forFormat)
            return res.status(400).json({
                success: false,
                message: "no audio format found"
            })
        }
    }
    const audio_id = forFormat.format_id

    const domain = getMainDomain(url)
    let yt

    let newtitle = sanname(title).toString().toLowerCase().trim()
    const filename = (newtitle || "video") + "_downzilla.mp4"
    
    const id = crypto.randomBytes(6).toString('hex');
    const outputPath = path.join(tempPath, `${newtitle.toLowerCase()}-${id}.mp4`);


    try {   
        console.log("audioId: ", audio_id, "formatId: ", format_id, "timer: ", start, "-to-", end)
        let format = audio_id ? `${for_id}+${audio_id}` : `${format_id}+bestaudio`
        console.log(`format: ${format}`)
        // format = `bv*[height<=1080][ext=mp4]+ba[ext=m4a]`

        await res.setHeader("Content-Type", "video/mp4");
        await res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        // const trimArg = `ffmpeg:-ss ${start} -to ${end} -map 0:v -map 0:a`
        
        let headerArgs = []
        console.log(typeof headers)
        console.log(headers)
        if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
                console.log(`headers: key ${key}, value ${value} `)
                headerArgs.push('--add-header', `${key}: ${value}`);
               }
             }
             
        console.log(headerArgs)

        // const ytdlpArg = [url, "-f", format, "--merge-output-format", "mkv", "--no-playlist", "--ffmpeg-location", ffmpegPath, "--add-header", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "--add-header", "Accept-Language:en-US,en;q=0.9", "--add-header", `Referer: ${domain}`, "-o", "-", "--no-progress"]
        
        // const nodePath = process.platform === 'win32' ? process.execPath : '/usr/user/bin'
        // console.log(`node path: ${nodePath}`)

        // const ytdlpArg = [ '-f', format || 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', 'youtube:player_client=android', '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s'), url];
        // const ytdlpArg = [ url, '-f', format || 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', "--extractor-args", 'youtube:player_client=android', '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s')];
        const ytdlpArg = [ url, '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', "--extractor-args", 'youtube:player_client=android', '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp4', '.%(ext)s')];

        yt = spawn(ytDlpPath, ytdlpArg, {
            stdio: "inherit",
            cwd: __dirname
        })
    } catch (e) {
        console.log(`error runing download ${e}`)
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
        console.log(`code: ${code}`)
        if (code !== 0) {
            if (fs.existsSync(outputPath)) {
                fs.unlink(outputPath, () => {});
            }
            console.log("yt-dlp exited with code: ", code)
            if (!res.writableEnded) {
                console.log("failed alert sent")
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

export default downloadVideoFunction