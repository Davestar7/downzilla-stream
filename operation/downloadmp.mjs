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

const downloadMPFunction = async (req, res) => {
    const { url, title, format_id, ext, formats} = req.body
    console.log(`url: ${url}`)
    if (!url) {
        return res.status(400).json({
            success: false,
            message: "required data not found"
        })
    }
    
    
    let format = format_id
    let extformat = ext
    
    if (format_id == null) {
        if (formats) {
            const choosen = selectaudioformat(formats)
            format = choosen.format_id
            extformat = choosen.ext
        } else {
            return res.status(400).json({
                success: false,
                message: "required data incomplete"
            })
        }
    }

    const name = sanname(title)
    console.log(name)

    await res.setHeader("Content-Disposition", `attachment; filename="${name}-downzilla.${extformat ||"mp3"}"`)
    await res.setHeader("Content-Type", "audio/mpeg")

    const args = [url, "-f", format, "-x", "--audio-format", "mp3", "-o", "-"]
    const yt = await spawn(ytDlpPath, args)

    yt.stdout.pipe(res)

    yt.stderr.on("data", async chunk => await chunk.toString())
    yt.on("close", code => {
        console.log(`exited with code ${code}`)
        if (code !== 0) {
            if (!res.writableEnded) {
                res.status(500).end("failed to download")
            }
        } else {
            res.end()
        }
    })

    yt.on("error", err => {
        console.log(`failed with error: ${err}`)
        if (!res.writableEnded) {
            res.status(500).end("internal error")
        }
    })
}

export default downloadMPFunction