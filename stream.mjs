import express from "express"
import cors from 'cors'
import route from "./routes/routes.mjs"
import path from "path"
import { fileURLToPath } from "url";
import { execSync, spawn } from 'child_process';
import fs from 'fs'
import https from 'https'

let bgutilStarted = false
let bgutilFailCount = 0

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
/*
async function startBgutilServer() {
    if (bgutilStarted) return
    bgutilStarted = true

    try {
        // Install libssl3 FIRST
        try {
            execSync('apt-get install -y libssl3 2>/dev/null || true')
            execSync('ldconfig 2>/dev/null || true') // update linker cache
            console.log('libssl3 installed and ldconfig updated')
        } catch(e) {
            console.log('libssl install error:', e.message)
        }

        // Download binary AFTER libssl installed
        const arch = execSync('uname -m').toString().trim()
        const binaryUrl = arch === 'aarch64'
    ? 'https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-aarch64-musl'
    : 'https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64-musl'       
       
        const binaryPath = '/app/operation/bgutil-pot'

        // Always re-download fresh
        execSync(`curl -L ${binaryUrl} -o ${binaryPath}`)
        execSync(`chmod +x ${binaryPath}`)

        const version = execSync(`${binaryPath} --version 2>&1 || true`).toString().trim()
        console.log('bgutil version:', version)

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
            bgutilFailCount++
            if (bgutilFailCount > 3) {
                console.log('bgutil failed too many times, giving up')
                return
            }
            setTimeout(startBgutilServer, 10000)
        })

        bgutil.on('error', (err) => {
            console.log('bgutil spawn error:', err.message)
            bgutilStarted = false
        })

        bgutil.unref()
        await new Promise(resolve => setTimeout(resolve, 3000))
        console.log('bgutil POT server ready on port 4416')

    } catch (e) {
        console.log('Failed to start bgutil server:', e.message)
        bgutilStarted = false
    }

    try {
       execSync('apt-get install -y libssl3 2>/dev/null || true')
       console.log('libssl3 installed')
   } catch(e) {}

    try {
    execSync('apt-get update -qq && apt-get install -y libssl3 openssl 2>/dev/null || true')
    // Find whatever libssl is available and symlink it
    const libs = execSync('find / -name "libssl.so*" 2>/dev/null || true').toString().trim()
    console.log('All libssl files:', libs)
    
    // Create symlink if libssl.so.1 or libssl.so.1.1 exists but not libssl.so.3
    if (!libs.includes('libssl.so.3') && libs.includes('libssl.so')) {
        const existingLib = libs.split('\n')[0]
        execSync(`ln -sf ${existingLib} /usr/lib/x86_64-linux-gnu/libssl.so.3 2>/dev/null || true`)
        execSync(`ldconfig 2>/dev/null || true`)
        console.log('Created libssl.so.3 symlink from:', existingLib)
    }
} catch(e) {
    console.log('libssl setup error:', e.message)
    }

    try {
    execSync('apt-get update -qq && apt-get install -y libssl3 openssl 2>/dev/null || true')
    
    const libs = execSync('find /usr/lib -name "libssl.so*" -o -name "libcrypto.so*" 2>/dev/null || true').toString().trim()
    console.log('All libs:', libs)
    
    // Symlink libssl.so.3
    if (!libs.includes('libssl.so.3')) {
        const sslLib = execSync('find /usr/lib -name "libssl.so*" 2>/dev/null | head -1 || true').toString().trim()
        if (sslLib) {
            execSync(`ln -sf ${sslLib} /usr/lib/x86_64-linux-gnu/libssl.so.3 2>/dev/null || true`)
            console.log('libssl.so.3 symlinked from:', sslLib)
        }
    }

    // Symlink libcrypto.so.3
    if (!libs.includes('libcrypto.so.3')) {
        const cryptoLib = execSync('find /usr/lib -name "libcrypto.so*" 2>/dev/null | head -1 || true').toString().trim()
        if (cryptoLib) {
            execSync(`ln -sf ${cryptoLib} /usr/lib/x86_64-linux-gnu/libcrypto.so.3 2>/dev/null || true`)
            console.log('libcrypto.so.3 symlinked from:', cryptoLib)
        }
    }

      execSync('ldconfig 2>/dev/null || true')
    } catch(e) {
       console.log('libs setup error:', e.message)
    }
}
*/

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
