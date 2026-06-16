import path from "path"
import { spawn } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";
import { ensureCookiesFile } from "./dependencies.mjs"
import ytdl from '@distube/ytdl-core'
//import { Innertube } from 'youtubei.js'
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

function getVideoId(url) {
    return url.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1]
}

async function getYouTubeMetadata(url, cookiePath) {
    // Parse Netscape cookies to JSON array format ytdl-core accepts
    let cookies = []
    try {
        const cookieFile = fs.readFileSync(cookiePath, 'utf8')
        cookies = cookieFile
            .split(/\r?\n/)
            .filter(line => line.trim() && !line.startsWith('#'))
            .map(line => {
                const parts = line.split('\t')
                if (parts.length >= 7) {
                    return {
                        name: parts[5]?.trim(),
                        value: parts[6]?.trim(),
                        domain: parts[0]?.trim(),
                        path: parts[2]?.trim(),
                        secure: parts[3]?.trim() === 'TRUE',
                    }
                }
                return null
            })
            .filter(Boolean)
    } catch (e) {
        console.log('Cookie parse error:', e.message)
    }

    const agent = ytdl.createAgent(cookies)
    const info = await ytdl.getInfo(url, { agent })
    const details = info.videoDetails
    const formats = info.formats

    const httpHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
    }

    const mappedFormats = formats.map(f => ({
        format_id: String(f.itag),
        url: f.url,
        ext: f.container || 'mp4',
        width: f.width || null,
        height: f.height || null,
        fps: f.fps || null,
        filesize: f.contentLength ? Number(f.contentLength) : null,
        tbr: f.bitrate ? f.bitrate / 1000 : null,
        abr: f.audioBitrate || null,
        vbr: f.bitrate && f.hasVideo ? f.bitrate / 1000 : null,
        asr: f.audioSampleRate ? Number(f.audioSampleRate) : null,
        audio_channels: f.audioChannels || null,
        vcodec: f.hasVideo ? (f.videoCodec || 'none') : 'none',
        acodec: f.hasAudio ? (f.audioCodec || 'none') : 'none',
        resolution: f.height ? `${f.width}x${f.height}` : 'audio only',
        quality_label: f.qualityLabel || null,
        format_note: f.qualityLabel || (f.hasAudio && !f.hasVideo ? 'audio only' : null),
        http_headers: httpHeaders,
        protocol: 'https',
        language: null,
    }))

    return {
        id: details.videoId,
        title: details.title,
        description: details.description || '',
        duration: Number(details.lengthSeconds) || null,
        view_count: Number(details.viewCount) || null,
        like_count: null,
        channel: details.author?.name || null,
        channel_id: details.channelId || null,
        uploader: details.author?.name || null,
        uploader_id: details.channelId || null,
        upload_date: details.publishDate || null,
        webpage_url: url,
        original_url: url,
        webpage_url_basename: 'watch',
        webpage_url_domain: 'youtube.com',
        extractor: 'youtube',
        extractor_key: 'Youtube',
        thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url || null,
        thumbnails: details.thumbnails || [],
        formats: mappedFormats,
        http_headers: httpHeaders,
        requested_formats: mappedFormats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none'),
    }
}

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

        let argument = arg

        const outPut = new Promise(async (resolve, reject) => {
            let proc

            argument.push("--cookies")
            argument.push(cookie)
            argument.push(url)

            if (type === "video") {

                // Use youtubei.js for YouTube URLs to bypass SABR/n-challenge
                if (isYouTubeUrl(url)) {
                    try {
                        const metadata = await getYouTubeMetadata(url, cookie)
                        return resolve(metadata)
                    } catch (e) {
                        console.log('youtubei.js failed, falling back to yt-dlp:', e.message)
                        // Fall through to yt-dlp if youtubei.js fails
                    }
                }

                const argss = ['--cookies', cookie, '--no-warnings', '--skip-download', '--no-check-certificate', '--no-playlist', '--force-ipv4', '--retries', '3', '--fragment-retries', '3', '--ignore-errors', '--no-cache-dir', '-j', url]
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
