import path from "path"
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs"
import {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject} from "./dependencies.mjs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "yt-dlp";

const ffmpegPath = isWindows
  ? path.join(__dirname, "ffmpeg-n8.0-7-g4f8b3891ee-win64-lgpl-shared-8.0", "bin", "ffmpeg.exe")
  : "ffmpeg";

const tempPath = path.join(__dirname, "temp")

const downloadMPFunction = async (req, res) => {
    const { url, title, format_id, ext, formats, headers} = req.body
    
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

    let name = sanname(title).toString().toLowerCase().trim()
    const filename = (name || "video") + "_downzilla.mp3"
    
    const id = crypto.randomBytes(6).toString('hex');
    const outputPath = path.join(tempPath, `${name.toLowerCase()}-${id}.mp3`);

    let headerArgs = []
    
    if (headers && typeof headers === "object") {
        for (const [key, value] of Object.entries(headers)) {
            headerArgs.push('--add-header', `${key}: ${value}`);
        }
    }
    
    let yt

    try {
        await res.setHeader("Content-Disposition", `attachment; filename="${filename}-downzilla.${extformat ||"mp3"}"`)
        await res.setHeader("Content-Type", "audio/mpeg")

        // const args = [url, "-f", format, "-x", "--audio-format", "mp3", "-o", "-"]
        const args = [ url, '-f', 'bestaudio[ext=m4a]/bestaudio/best', "-x", "--audio-format", 'mp3', "--audio-quality", "0", "--postprocessor-args", "ffmpeg:-vn", "--extractor-args", 'youtube:player_client=android', '--ffmpeg-location', ffmpegPath, ...headerArgs, '-o', outputPath.replace('.mp3', '.%(ext)s')];
        yt = spawn(ytDlpPath, args)
    } catch (e) {
        if (fs.existsSync(outputPath)) {
            fs.unlink(outputPath, () => {});
        }
        return res.status(501).json({
            success: false,
            message: "error trying to download audio request: " + e
        })
    }

    // await yt.stdout.pipe(res)

    // yt.stderr.on("data", async chunk => await chunk.toString())
    await req.on("close", () => {
        yt.kill("SIGKILL")
    })

    yt.on("close", code => {
        if (code !== 0) {
            if (fs.existsSync(outputPath)) {
                fs.unlink(outputPath, () => {});
            }
            if (!res.writableEnded) {
                res.status(500).end("failed to download")
            }
        } else {
            // res.end()
            res.download(outputPath, () => {
                fs.unlink(outputPath, () => {});
            });
        }
    })

    yt.on("error", err => {
        if (!res.writableEnded) {
            res.status(500).end(`internal error: ${err.message}`)
        }
    })
}

export default downloadMPFunction