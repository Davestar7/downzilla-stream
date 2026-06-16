import express from "express"
import cors from 'cors'
import route from "./routes/routes.mjs"
import path from "path"
import { fileURLToPath } from "url";
import { execSync, spawn } from 'child_process';
import fs from 'fs'
import https from 'https'

let bgutilStarted = false

startBgutilServer()

const app = express()

const origin = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "https://downzilla.netlify.app",
    "https://www.downzilla.buzz",
    "https://downzilla.buzz"
    ]
app.use(cors({
    origin: origin,
    credentials: true
}))

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isWindows = process.platform === "win32";

const ytDlpPath = isWindows
  ? path.join(__dirname, "bin", "yt-dlp.exe")
  : "/app/operation/yt-dlp";

async function downloadBgutil() {
    const binaryPath = '/app/operation/bgutil-pot'
    
    if (fs.existsSync(binaryPath)) return binaryPath

    console.log('Downloading bgutil-pot binary...')
    
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(binaryPath)
        https.get('https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64', (res) => {
            // Follow redirects
            if (res.statusCode === 302 || res.statusCode === 301) {
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file)
                    file.on('finish', () => {
                        file.close()
                        execSync(`chmod +x ${binaryPath}`)
                        console.log('bgutil-pot downloaded successfully')
                        resolve(binaryPath)
                    })
                }).on('error', reject)
            } else {
                res.pipe(file)
                file.on('finish', () => {
                    file.close()
                    execSync(`chmod +x ${binaryPath}`)
                    console.log('bgutil-pot downloaded successfully')
                    resolve(binaryPath)
                })
            }
        }).on('error', (err) => {
            fs.unlink(binaryPath, () => {})
            reject(err)
        })
    })
}

async function startBgutilServer() {
    if (bgutilStarted) return
    bgutilStarted = true

    try {
        // Detect architecture and download correct binary
        const arch = execSync('uname -m').toString().trim()
        console.log('System arch:', arch)

        const binaryUrl = arch === 'aarch64' 
            ? 'https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-aarch64'
            : 'https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64'

        const binaryPath = '/app/operation/bgutil-pot'

        // Always re-download to ensure correct arch
        console.log(`Downloading bgutil-pot for ${arch}...`)
        execSync(`curl -L ${binaryUrl} -o ${binaryPath}`)
        execSync(`chmod +x ${binaryPath}`)

        // Test binary
        const test = execSync(`${binaryPath} --version 2>&1 || true`).toString().trim()
        console.log('bgutil version:', test)

        const bgutil = spawn(binaryPath, ['server', '--host', '0.0.0.0', '--port', '4416'], {
            stdio: 'pipe',
            detached: true,
            env: { ...process.env, RUST_LOG: 'info' }
        })

        bgutil.stdout.on('data', d => console.log('bgutil:', d.toString().trim()))
        bgutil.stderr.on('data', d => console.log('bgutil err:', d.toString().trim()))

        bgutil.on('close', (code) => {
            console.log('bgutil server closed with code:', code)
            bgutilStarted = false
            setTimeout(startBgutilServer, 10000)
        })

        bgutil.on('error', (err) => {
            console.log('bgutil spawn error:', err.message)
            bgutilStarted = false
        })

        bgutil.unref()
        await new Promise(resolve => setTimeout(resolve, 3000))
        console.log('bgutil POT server ready on port 4416')

        let bgutilFailCount = 0

       bgutil.on('close', (code) => {
         console.log('bgutil server closed with code:', code)
         bgutilStarted = false
         bgutilFailCount++
    
    // Stop retrying after 3 failures
        if (bgutilFailCount > 3) {
          console.log('bgutil failed too many times, giving up')
          return
        }
    
         setTimeout(startBgutilServer, 10000)
     })

    } catch (e) {
        console.log('Failed to start bgutil server:', e.message)
        bgutilStarted = false
    }
}

function ensureNodeRuntime() {
    try {
        const nodePath = process.execPath
        console.log('Current node path:', nodePath)
        
        // Symlink node to standard locations yt-dlp checks
        execSync(`ln -sf ${nodePath} /usr/local/bin/node 2>/dev/null || true`)
        execSync(`ln -sf ${nodePath} /usr/bin/node 2>/dev/null || true`)
        
        // Verify
        const check = execSync('which node').toString().trim()
        console.log('node now available at:', check)
    } catch (e) {
        console.log('symlink error:', e.message)
    }
}

ensureNodeRuntime()

try {
  console.log('Updating yt-dlp...');
  const out = execSync(`${ytDlpPath} -U`, { encoding: 'utf8' });
  console.log(out)
} catch (err) {
  console.error('yt-dlp self-update failed:', err.message);
}

app.use(express.json())

app.use("/v1/", route)
app.get("/", (req, res) => {
  res.send(`Downzilla Streaming service - <a href="https://downzilla.netlify.app">Home</a>`)
})

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

const port = 7700

app.listen(port, () => {
    console.log(`server live at http://localhost:${port}`)
})

export default app
