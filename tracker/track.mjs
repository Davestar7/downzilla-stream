
const jobs = new Map()

const start = (req, res) => {
    const id = crypto.randomUUID()
    const { url, type } = req.body

    jobs.set(id, {
        state: "created",
        url: url,
        type: type,
        process: null
    })

    res.status(200).json({
        success: true,
        data: id
    })
}

const cancelJob = async (req, res) => {
    const body = req.body

    const job = body.id
    console.log(`${job.state} \n ${body.id}`)
    if (!job) {
        return res.status(404).json({
            success: false,
            message: "failed to cancel couse proccess not found"
        })
    }

    if (job.process) {
        if (process.platform === "win32") {
                try {
                    await spawn("taskkill", ["/pid", job.process.pid, "/f", "/t"])
                    res.status(200).json({
                        message: "cancelled successfully"
                    })
                } catch (e) {
                    res.status(500).json({
                        message: "error trying to cancel on win32"
                    })
                }
            } else {
                try {
                    await job.process.kill("SIGKILL")
                    res.status(200).json({
                        message: "cancelled sussefully!"
                    })
                } catch (e) {
                    res.status(500).json({
                        message: "error cancelling prccess"
                    })
                }
        }

        jobs.delete(body.id)
    } else {
        res.status(404).json({
            message: "this activity was not found!"
        })
    }
}

export {start, jobs, cancelJob}