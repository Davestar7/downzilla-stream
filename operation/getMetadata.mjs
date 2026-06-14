import path from "path"
import { spawn, execSync } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";
import { ensureCookiesFile } from "./dependencies.mjs"
import { Innertube, UniversalCache } from 'youtubei.js'
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
    const videoId = getVideoId(url)
    if (!videoId) throw new Error('Invalid YouTube URL')

    // Define httpHeaders first before anything else
    const httpHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
    }

    let cookieHeader = ''
    try {
        const cookieFile = fs.readFileSync(cookiePath, 'utf8')
        cookieHeader = cookieFile.split('\n')
            .filter(line => line.trim() && !line.startsWith('#'))
            .map(line => {
                const parts = line.split('\t')
                if (parts.length >= 7) return `${parts[5]}=${parts[6].trim()}`
                return null
            })
            .filter(Boolean)
            .join('; ')
    } catch (e) {
        console.log('Cookie parse error:', e.message)
    }

    const youtube = await Innertube.create({
        cookie: cookieHeader,
        generate_session_locally: true,
        retrieve_player: true,
        enable_session_cache: false,
        // Provide JS evaluator using Node.js Function constructor
        js_evaluator: (js) => new Function(js)(),
    })

    const info = await youtube.getInfo(videoId)

    if (!info.streaming_data) {
        throw new Error('No streaming data - cookies may be expired')
    }

    const primary = info.primary_info
    const secondary = info.secondary_info
    const basic = info.basic_info

    const allFormats = [
        ...(info.streaming_data?.formats || []),
        ...(info.streaming_data?.adaptive_formats || [])
    ]

    const formats = allFormats.map(f => {
        const isVideo = f.has_video
        const isAudio = f.has_audio
        const mimeType = f.mime_type || ''
        const ext = mimeType.split('/')[1]?.split(';')[0] || 'mp4'
        const codec = mimeType.match(/codecs="([^"]+)"/)?.[1] || ''

        let formatUrl = null
        try {
            formatUrl = f.decipher(youtube.session.player)
        } catch (e) {
            formatUrl = f.url || null
        }

        return {
            format_id: String(f.itag),
            url: formatUrl,
            ext,
            width: f.width || null,
            height: f.height || null,
            fps: f.fps || null,
            filesize: f.content_length ? Number(f.content_length) : null,
            tbr: f.bitrate ? f.bitrate / 1000 : null,
            abr: isAudio ? f.bitrate / 1000 : null,
            vbr: isVideo && !isAudio ? f.bitrate / 1000 : null,
            asr: f.audio_sample_rate ? Number(f.audio_sample_rate) : null,
            audio_channels: f.audio_channels || null,
            vcodec: isVideo ? codec.split(',')[0]?.trim() : 'none',
            acodec: isAudio ? codec.split(',').pop()?.trim() : 'none',
            resolution: f.height ? `${f.width}x${f.height}` : 'audio only',
            quality_label: f.quality_label || null,
            format_note: f.quality_label || (isAudio && !isVideo ? 'audio only' : null),
            http_headers: httpHeaders,
            protocol: 'https',
            language: f.audio_track?.id?.split('.')[0] || null,
        }
    })

    const thumbnails = basic.thumbnail || []

    return {
        id: videoId,
        title: primary?.title?.text || basic.title || '',
        description: secondary?.description?.text || '',
        duration: basic.duration || null,
        view_count: primary?.view_count?.original_view_count || basic.view_count || null,
        like_count: basic.like_count || null,
        channel: secondary?.owner?.author?.name || basic.author || null,
        channel_id: secondary?.subscribe_button?.channel_id || basic.channel_id || null,
        uploader: secondary?.owner?.author?.name || basic.author || null,
        uploader_id: secondary?.subscribe_button?.channel_id || null,
        upload_date: primary?.published?.text || null,
        webpage_url: url,
        original_url: url,
        webpage_url_basename: 'watch',
        webpage_url_domain: 'youtube.com',
        extractor: 'youtube',
        extractor_key: 'Youtube',
        thumbnail: thumbnails[thumbnails.length - 1]?.url || null,
        thumbnails: thumbnails.map(t => ({ url: t.url, width: t.width, height: t.height })),
        formats,
        http_headers: httpHeaders,
        requested_formats: formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none'),
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
