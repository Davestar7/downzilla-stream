import express from "express"
import cors from 'cors'
import route from "./routes/routes.mjs"

const app = express()

const origin = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
     ""
    ]
app.use(cors({
    origin: origin,
    credentials: true
}))

app.use(express.json())

app.use("/v1/", route)

const port = 7700

app.listen(port, (req, res) => {
    console.log(`server live at http://localhost:${port}`)

    res.send(`Downzilla Streaming service - <a href="https://downzilla.netlify.app">Home</a>`)
})

export default app