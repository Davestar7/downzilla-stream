import path from "path"
import { spawn } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytDlpPath = path.join(__dirname, "../bin", "yt-dlp.exe");
const ytDlpPathOld = path.join(__dirname, "../bin", "yt-dlp-old.exe");

const metadataExtractor = async (req, res) => {
    const { time = null, id, arg } = req.body

    const theJob = jobs.get(id)
    console.log(theJob)

    if (!theJob) {
        return res.status(404).json({message:"id not found"})
    }
    const url = theJob.url
    const type = theJob.type

    console.log(`debug metadata url: ${url} id: ${id}`)

    const options = {
        timeout: 350000,
        maxBuffer: 10 * 1024 * 1024 // 10mb
    }

    let argument = arg

    const outPut = new Promise(async (resolve, reject) => {
        let proc
        console.log(type)
        if (type === "video") {
            argument = argument.push(url)
            proc = spawn(ytDlpPath, argument, {
                stdio: ["ignore", "pipe", "pipe"]
            })
        } else if (type === "playlist") {
            proc = spawn(ytDlpPathOld, url, {
                stdio: ["ignore", "pipe", "pipe"]
            })
        } else if  (type === "audio") {
            proc = spawn(ytDlpPath, url, {
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
                    console.log("should have cancelled request")
                    try {
                        process.kill(-proc.pid, "SIGKILL")
                        reject("took too much time")
                    } catch (e) {
                        console.log(`failed to cancel spawn ${e}`)
                    }
                }
            }, time);
        }

        let data = "";
        let error = "";
        console.log("proccedding fetch")

        await proc.stdout.on("data", async (chunk) => {
            const chuck = await chunk.toString()
            data += chuck
            console.log(chuck)
        });
        await proc.stderr.on("data", async (chunk) => {
            const chuck = await chunk.toString()
            error += chuck
            console.log(chuck)
        });
        console.log("error: ", error)
        console.log("data: ", data)
        proc.on("close", (code) => {
            console.log("code: ",code)
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
            console.log(error.message)
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
}

export {metadataExtractor}