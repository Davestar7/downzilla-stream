

function loopFormatForFormatObject(ff, id) {
    if (ff.length == 0) {
        return null
    }

    let format = null

    ff.forEach(f => {
        if (f.format_id == id) {
            format = f
        }
    })
    return format
}

function returnCorrectForArguments(ff, id, aid) {
    const v = loopFormatForFormatObject(ff, id)
    const a = loopFormatForFormatObject(ff, aid)
    console.log(`video: ${v}\n audio: ${a}`)
    if (v == null || a == null) {
        return null
    }
    
    if (v.ext === "mp4" && a.ext !== "mp4" && !v.vcodec?.startsWith("avc") && !["aac", "mp3", "none"].includes(a.acodec)) {
        return true
    } else {
        return false
    }
    return null
}

function sanname(name) {
    return name.replace(/[<>:"/\\|?*." "]+/g, "-")
                .replace(/[\u007F-\uFFFF]/g, "")
                .trim()
                .replace(/\s+/g, "-")
}

function selectaudioformat(ff) {
    const audioformat = ff.filter(
        f => f.vcodec === "none" && f.acodec !== "none"
    );
    if (audioformat.length === 0) {
        return null
    }

    audioformat.sort((a, b) => (b.abr || 0) - (a.abr || 0))

    const best = audioformat[0];

    return {
        format_id: best.format_id,
        ext: best.ext,
        abr: best.abr,
        filesize: best.filesize || best.filesize_approx || null
    }
}

function selectvideoformat(ff) {
    if (!Array.isArray(ff) || ff.length === 0) {
        return null
    }

    const videoFormats = ff.filter(f => 
        f.vcodec && f.vcodec !== "none" && typeof f.height === "number"
        )

    if (videoFormats.length === 0) return null

    const preferred = videoFormats.filter(f => 
        f.ext === "mp4" && typeof f.vcodec === "string" && f.vcodec.startsWith("avc") && f.height >= 144 && f.height <= 1080
        )

    const cands = preferred.length ? preferred : videoFormats

    cands.sort((a, b) => a.length - b.height);

    const medianIndex = Math.floor(cands.length / 2)
    const s = cands[medianIndex];

    console.log(`chosen: ${s}`)
    return {
        format_id: s.format_id,
        ext: s.ext,
        vcodec: s.vcodec,
        acodec: s.acodec,
        height: s.height,
        filesize: s.filesize || s.filesize_approx || null
    }
}

function getHeightFromString(h) {
    if (h === null) return null

    const m = String(h).match(/\d{3,4}/)
    return m ? Number(m[0]) : null
}

function getMainDomain(irl) {
    const arrs = irl.split(".")
    console.log(`path: ${arrs[0]}.${arrs[1]}.${arrs[2]}`)
    const lastarr = arrs[2].split("/")
    const path = `${arrs[0]}.${arrs[1]}.${lastarr[0]}/`
    console.log(`new path: ${path}`)
    return path
}

function chooseFormat(ff = null) {
    if (!ff) return 'bestvideo+bestaudio/best'

    if (ff > 144 && ff <= 1080){
        return `bestvideo[height<=${ff}][ext=m4a]+bestaudio[ext=m4a]/best[height<=${ff}]`
    } else {
        return 'bestvideo+bestaudio/best'
    }
}

export {getMainDomain, getHeightFromString, selectvideoformat, selectaudioformat, sanname, loopFormatForFormatObject, returnCorrectForArguments, chooseFormat}