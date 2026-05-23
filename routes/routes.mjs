import express from "express"
import {start, cancelJob} from "../tracker/track.mjs"
import { metadataExtractor } from "../operation/getMetadata.mjs"
import downloadMPFunction from "../operation/downloadmp.mjs"
import { startDownload, confirmDownload, serveDownload } from "../operation/downloadvideo.mjs"
import {stream, knowStreamer} from "../operation/streamer.mjs"

const route = express.Router()

route.post("/start", start)

route.get("/cancel", cancelJob)

route.post("/getMetadata", metadataExtractor)

route.post("/downloadVideo", startDownload)

route.get("/checkDownload", confirmDownload)

route.get("/download", serveDownload)

route.post("/downloadMp", downloadMPFunction)

route.post("/startstream", knowStreamer)

route.get("/stream", stream)

export default route