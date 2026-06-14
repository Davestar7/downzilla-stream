import path from "path"
import { spawn } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";
import { ensureCookiesFile } from "./dependencies.mjs"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "/app/operation/yt-dlp";

const metadataExtractor = async (req, res) => {
    const { time = null, id, arg } = req.body

    const theJob = jobs.get(id)
    
    if (!theJob) {
        return res.status(404).json({message:"id not found"})
    }
    const url = theJob.url
    const type = theJob.type

    const options = {
        timeout: 350000,
        maxBuffer: 10 * 1024 * 1024 // 10mb
    }

    try {

        let argument = arg

        const cookie = ensureCookiesFile()

        const outPut = new Promise(async (resolve, reject) => {
            let proc
            
            argument.push("--cookies")
            argument.push(cookie)
            argument.push(url)
            
            if (type === "video") {
              //const argss = ['--cookies', cookie, '--js-runtimes', 'node','-j','--no-warnings', '--skip-download', '--no-check-certificate', '--no-playlist','--force-ipv4',  '--retries', 'infinite','--fragment-retries', 'infinite','--ignore-errors','--no-cache-dir', url];
              const argss = ['--verbose', '--cookies', cookie, '--js-runtimes', 'node', '--no-warnings', '--skip-download', '--no-check-certificate', '--no-playlist', '--force-ipv4', '--retries', 'infinite', '--fragment-retries', 'infinite', '--no-cache-dir', '--extractor-args', 'youtube:player_client=web', '-J', url];
              proc = spawn(ytDlpPath, argss, { stdio: ["ignore", "pipe", "pipe"] })
            
             // proc = spawn(ytDlpPath, ['--cookies', cookie, '-j', '-S', '+size,+br', '--no-warnings', '--skip-download', '--no-check-certificate', '--no-playlist', '--force-ipv4', '--retries', 'infinite', '--fragment-retries', 'infinite', '--ignore-errors', '--no-cache-dir', url], { stdio: ["ignore", "pipe", "pipe"] })
              //proc = spawn(ytDlpPath, ['--cookies', cookie, '-j', '--skip-download', '--no-check-certificate', '--no-playlist', '--retries', 'infinite', '--fragment-retries', 'infinite', '--ignore-errors', '--no-cache-dir', '--extractor-args', 'youtube:player_client=android_vr,tv', url], { stdio: ["ignore", "pipe", "pipe"] })
                //proc = spawn(ytDlpPath, ['--cookies', cookie, '-j', '--skip-download', '--no-check-certificate', '--no-playlist', '--retries', 'infinite', '--fragment-retries', 'infinite', '--ignore-errors', '--no-cache-dir', '--js-runtimes', 'node', '--remote-components', 'ejs:github', '--extractor-args', 'youtube:player_client=tv,web', url], { stdio: ["ignore", "pipe", "pipe"] })
            } else if (type === "playlist") {
                proc = spawn(ytDlpPath, argument, {
                    stdio: ["ignore", "pipe", "pipe"]
                })
            } else if  (type === "audio") {
                proc = spawn(ytDlpPath, argument, {
                    stdio: ["ignore", "pipe", "pipe"]
                })
            } else {
                return reject("selected option not available")
            }

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
                }, time);
            }

            let data = "";
            let error = "";

            await proc.stdout.on("data", async (chunk) => {
                const chuck = await chunk.toString()
                data += chuck
            });
          
            await proc.stderr.on("data", async (chunk) => {
                console.error('YTDLP STDERR:', chunk.toString())
                const chuck = await chunk.toString()
                error += chuck
            });
            
            proc.on("close", (code) => {
                
                if (time != null) {
                    timeout.close()
                }
                if (code === 0) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(err.message);
                    }   
                } else {
                    reject(error || `failed with code ${code} possibly cancelled`);
                }
            });
        });

        try {
            const out = await outPut
            jobs.delete(id)
            res.status(200).json({data: out})
        } catch (e) {
            theJob.state = "failed"
            jobs.delete(id)
            res.status(400).json({message: e})
        }
    } catch (e) {
        jobs.delete(id)
        res.status(500).json({
            message: e.message
        })
    }
}

export {metadataExtractor}
