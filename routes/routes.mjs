import express from "express"
import {start, cancelJob} from "../tracker/track.mjs"
import { metadataExtractor } from "../operation/getMetadata.mjs"
import downloadMPFunction from "../operation/downloadmp.mjs"
import downloadVideoFunction from "../operation/downloadvideo.mjs"

const route = express.Router()

route.post("/start", start)

route.post("/cancel", cancelJob)

route.post("/getMetadata", metadataExtractor)

route.post("/downloadVideo", downloadVideoFunction)

route.post("/downloadMp", downloadMPFunction)

export default route