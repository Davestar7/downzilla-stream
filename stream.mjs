import express from "express"
import cors from 'cors'
import route from "./routes/routes.mjs"

const app = express()
app.use(cors({
    origin: "",
    credentials: true
}))

app.use(express.json())

app.use("/v1/", route)

const port = 7700

app.listen(port, () => {
    console.log(`server live at http://localhost:${port}`)
})

export default app