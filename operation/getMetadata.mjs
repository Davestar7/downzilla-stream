import path from "path"
import { spawn } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";
import { ensureCookiesFile } from "./dependencies.mjs"
import fs from 'fs'
import { BG } from 'bgutils-js'
import { Innertube } from 'youtubei.js'


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "/app/operation/yt-dlp";

function isYouTubeUrl(url) {
    return url.includes('youtube.com') || url.includes('youtu.be')
}

function normalizeYoutubeUrl(url){
 try{
  const u=new URL(url);
  if(u.hostname==="youtu.be"){
   return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
  }
  u.searchParams.delete("si");
  return u.toString();
 }catch{
  return url;
 }
}

/*
let bgutilStarted = false

async function generatePoToken(videoId) {
    try {
        const innertube = await Innertube.create({ retrieve_player: false })
        const visitorData = innertube.session.context.client.visitorData

        const bgConfig = {
            fetch: (url, options) => fetch(url, options),
            globalObj: globalThis,
            identifier: visitorData,
            requestKey: 'O43z0dpjhgX20SCx4KAo',
        }

        const bgChallenge = await BG.Challenge.create(bgConfig)
        if (!bgChallenge) throw new Error('Failed to create challenge')

        const interpreterJavascript = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
        if (interpreterJavascript) {
            new Function(interpreterJavascript)()
        }

        const poTokenResult = await BG.PoToken.generate({
            program: bgChallenge.program,
            globalName: bgChallenge.globalName,
            bgConfig,
        })

        return { poToken: poTokenResult.poToken, visitorData }
    } catch (e) {
        console.log('PO token generation failed:', e.message)
        return null
    }
}
*/

const metadataExtractor = async (req, res) => {
    const { time = null, id, arg } = req.body

    const theJob = jobs.get(id);
    
    if (!theJob) {
        return res.status(404).json({ message: "id not found" })
    }

    const url = theJob.url
    const type = theJob.type

    try {
        const cookie = ensureCookiesFile()

        let argument = [...arg]
        
        argument.push("--cookies")
        argument.push(cookie)
        argument.push(url)

        const outPut = new Promise((resolve, reject) => {
            let proc

            if (type === "video") {
                let argss

    if (isYouTubeUrl(url)) {
      try {

       const result = extractYoutube(url, cookie);
       return resolve(result);
    } catch (err) {
      return reject(err.message);
    }
      
    } else {
        argss = [
            '--cookies', cookie,
            '--no-warnings',
            '--skip-download',
            '--no-check-certificate',
            '--no-playlist',
            '--force-ipv4',
            '--retries', '3',
            '--fragment-retries', '3',
            '--ignore-errors',
            '--no-cache-dir',
            '-j',
            url
        ]
      proc = spawn(ytDlpPath, argss, { stdio: ["ignore", "pipe", "pipe"], cwd: '/app/operation', env: { ...process.env, PATH: `/usr/local/bin:/usr/bin:${process.env.PATH}` } })
            
    }

    // ✅ Only called once
              
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

async function extractYoutube(url,cookiePath=null){
 url=normalizeYoutubeUrl(url);

 const nodePath=process.execPath;

 const strategies=[
  {name:"cookie",useCookie:true},
  {name:"fallback",useCookie:false}
 ];

 let lastError;

 for(const strategy of strategies){
  try{
   const result=await new Promise((resolve,reject)=>{
    const args=[
     "--ignore-config",
     "--skip-download",
     "--no-playlist",
     "--force-ipv4",
     "--socket-timeout","20",
     "--retries","1",
     "--js-runtimes",`node:${nodePath}`,
     "-J"
    ];

    if(strategy.useCookie&&cookiePath){
     args.push("--cookies",cookiePath);
    }

    args.push(url);

    const proc=spawn(ytDlpPath,args,{windowsHide:true});

    let stdout="";
    let stderr="";

    proc.stdout.on("data",c=>stdout+=c.toString());

    proc.stderr.on("data",c=>stderr+=c.toString());

    proc.on("close",code=>{
     if(code!==0){
      return reject(new Error(stderr||`yt-dlp exited ${code}`));
     }

      
     try{
      resolve(JSON.parse(stdout));
     }catch(e){
      reject(new Error(`JSON parse failed: ${e.message}`));
     }
    });

    proc.on("error",reject);
   });

   if(result?.title&&result?.id){
    return result;
   }

  }catch(e){
   lastError=e;
   console.log(`[extractYoutube] ${strategy.name}:`,e.message);

   if(/429|Too Many Requests/i.test(e.message)){
    throw new Error("YouTube temporarily rate-limited this server.");
   }
  }
 }

 throw new Error(lastError?.message||"Extraction failed");
}

export {metadataExtractor}
