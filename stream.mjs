import express from "express"
import cors from 'cors'
import route from "./routes/routes.mjs"
import path from "path"
import { fileURLToPath } from "url";
import { execSync, spawn } from 'child_process';
import fs from "fs"

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

function startBgutilServer() {
    if (bgutilStarted) return
    bgutilStarted = true

    const binaryPath = '/app/operation/bgutil-pot'

    if (!fs.existsSync(binaryPath)) {
        console.log('bgutil-pot binary not found, skipping POT server')
        bgutilStarted = false
        return
    }

    try {
        const bgutil = spawn(binaryPath, ['server', '--port', '4416'], {
            stdio: 'pipe',
            detached: true
        })

        bgutil.stdout.on('data', d => console.log('bgutil:', d.toString().trim()))
        bgutil.stderr.on('data', d => console.log('bgutil err:', d.toString().trim()))

        bgutil.on('close', (code) => {
            console.log('bgutil server closed with code:', code)
            bgutilStarted = false
            setTimeout(startBgutilServer, 5000)
        })

        bgutil.unref()
        console.log('bgutil POT server started on port 4416')
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
