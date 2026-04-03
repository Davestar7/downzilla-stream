import path from "path"
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject} from "./dependencies.mjs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytDlpPath = path.join(__dirname, "../bin", "yt-dlp.exe");
const ytDlpPathOld = path.join(__dirname, "../bin", "yt-dlp-old.exe");
const ffmpegPath = path.join(__dirname, "../ffmpeg-n8.0-7-g4f8b3891ee-win64-lgpl-shared-8.0/bin", "ffmpeg.exe");
const tempPath = path.join(__dirname, "/operation/temp/")

const downloadVideoFunction = async (req, res) => {
    const {url, format_id, title, start, end, formats, height = null} = req.body
    
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

    try {   
        console.log("audioId: ", audio_id, "formatId: ", format_id, "timer: ", start, "-to-", end)
        let format = audio_id ? `${for_id}+${audio_id}` : `${format_id}+bestaudio`
        console.log(`format: ${format}`)
        // format = `bv*[height<=1080][ext=mp4]+ba[ext=m4a]`

        let newtitle = sanname(title)
        newtitle = newtitle.toString().toLowerCase().trim()

        const filename = (newtitle || "video") + "_downzilla.mp4"
        
        await res.setHeader("Content-Type", "video/mp4");
        await res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        // const trimArg = `ffmpeg:-ss ${start} -to ${end} -map 0:v -map 0:a`

        const ytdlpArg = [url, "-f", format, "--merge-output-format", "mkv", "--no-playlist", "--ffmpeg-location", ffmpegPath, "--add-header", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "--add-header", "Accept-Language:en-US,en;q=0.9", "--add-header", `Referer: ${domain}`, "-o", "-", "--no-progress"]

        const yt = spawn(ytDlpPath, ytdlpArg)
        
        await yt.stdout.pipe(res)

        yt.stderr.on("data", async data =>  console.log("data: " + await data.toString()))

        req.on("close", () => {
            yt.kill("SIGKILL")
        })
        yt.on("close", async (code) => {
            if (code !== 0) {
                console.log("yt-dlp exited with code: ", code)
                if (!res.writableEnded) {
                    console.log("failed alert sent")
                    res.status(500).json({
                        success: false,
                        message: "download failed"
                    })
                }
            }
            console.log(`code: ${code}`)
        })   
        
    } catch (e) {
        console.log(`error runing download ${e}`)
        res.status(501).json({
            success: false,
            message: "error trying to download request: " + e
        })
    }
}

export default downloadVideoFunction