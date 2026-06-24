import path from "path";
import { spawn } from "child_process";
import { jobs } from "../tracker/track.mjs";
import { fileURLToPath } from "url";
import { ensureCookiesFile } from "./dependencies.mjs";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

const isWindows=process.platform==="win32";

const ytDlpPath=isWindows
 ? path.join(__dirname,"bin","yt-dlp.exe")
 : "/app/operation/yt-dlp";

function isYouTubeUrl(url){
 return url.includes("youtube.com")||url.includes("youtu.be");
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

const metadataExtractor=async(req,res)=>{

 const {time=null,id,arg}=req.body;

 const theJob=jobs.get(id);

 if(!theJob){

  return res.status(404).json({
   message:"id not found"
  });
 }

 const url=theJob.url;
 const type=theJob.type;

 try{

  const cookie=ensureCookiesFile();

  const argument=[...arg];

  argument.push("--cookies");
  argument.push(cookie);
  argument.push(url);

  const outPut=new Promise((resolve,reject)=>{

   let proc;

   if(type==="video"){

    if(isYouTubeUrl(url)){

     extractYoutube(url,cookie)
      .then(resolve)
      .catch(reject);

     return;
    }

    const args=[
     "--cookies",cookie,
     "--no-warnings",
     "--skip-download",
     "--no-check-certificate",
     "--no-playlist",
     "--force-ipv4",
     "--retries","3",
     "--fragment-retries","3",
     "--ignore-errors",
     "--no-cache-dir",
     "-j",
     url
    ];

    proc=spawn(ytDlpPath,args,{
     stdio:["ignore","pipe","pipe"],
     cwd:"/app/operation",
     env:{
      ...process.env,
      PATH:`/usr/local/bin:/usr/bin:${process.env.PATH}`
     }
    });

   }else if(type==="playlist"||type==="audio"){

    proc=spawn(ytDlpPath,argument,{
     stdio:["ignore","pipe","pipe"],
     cwd:"/app/operation",
     env:{
      ...process.env,
      PATH:`/usr/local/bin:/usr/bin:${process.env.PATH}`
     }
    });

   }else{

    return reject("selected option not available");
   }

   if(!proc){

    return reject("process not started");
   }

   theJob.process=proc;
   theJob.state="started";

   let timeout;

   if(time!=null){

    timeout=setTimeout(()=>{

     if(!proc.killed){

      try{

       process.kill(-proc.pid,"SIGKILL");

       reject("took too much time");

      }catch(e){

       reject(e.message);
      }
     }

    },time);
   }

   let data="";
   let error="";

   proc.stdout.on("data",chunk=>{
    data+=chunk.toString();
   });

   proc.stderr.on("data",chunk=>{
    error+=chunk.toString();
   });

   proc.on("close",code=>{

    if(time!=null){
     clearTimeout(timeout);
    }

    if(code===0){

     try{

      resolve(JSON.parse(data));

     }catch(err){

      reject(err.message);
     }

    }else{

     reject(error||`failed with code ${code}`);
    }

   });

  });

  try{

   const out=await outPut;

   jobs.delete(id);

   return res.status(200).json({
    data:out
   });

  }catch(e){

   theJob.state="failed";

   jobs.delete(id);

   return res.status(400).json({
    message:e.message||e
   });
  }

 }catch(e){

  jobs.delete(id);

  return res.status(500).json({
   message:e.message
  });
 }

};

function extractYoutube(url,cookie){

 url=normalizeYoutubeUrl(url);

 return new Promise((resolve,reject)=>{

  const args=[
   "--ignore-config",
   "--skip-download",
   "--dump-single-json",
   "--no-playlist",
   "--force-ipv4",
   "--retries","3",
   "--no-warnings",
   "--extractor-args","youtube:player_client=android"
  ];

  if(cookie){

   args.push("--cookies");
   args.push(cookie);

  }

  args.push(url);

  const proc=spawn(ytDlpPath,args,{
   windowsHide:true,
   cwd:"/app/operation",
   env:{
    ...process.env,
    PATH:`/usr/local/bin:/usr/bin:${process.env.PATH}`
   }
  });

  let stdout="";
  let stderr="";
  let settled=false;

  const finish=(fn,data)=>{

   if(settled){
    return;
   }

   settled=true;

   fn(data);
  };

  const timeout=setTimeout(()=>{

   try{

    proc.kill("SIGKILL");

   }catch{}

   finish(
    reject,
    new Error("yt-dlp timeout after 60 seconds")
   );

  },60000);

  proc.stdout.on("data",chunk=>{
   stdout+=chunk.toString();
  });

  proc.stderr.on("data",chunk=>{
   stderr+=chunk.toString();
  });

  proc.on("error",err=>{

   clearTimeout(timeout);

   finish(reject,err);

  });

  proc.on("close",code=>{

   clearTimeout(timeout);

   if(settled){
    return;
   }

   if(code!==0){

    if(/Too Many Requests|429/i.test(stderr)){

     return finish(
      reject,
      new Error("YouTube rate limited this server")
     );
    }

    if(/Sign in to confirm you're not a bot/i.test(stderr)){

     return finish(
      reject,
      new Error(
       "YouTube blocked Railway's IP or the cookies are invalid"
      )
     );
    }

    return finish(
     reject,
     new Error(stderr||`yt-dlp exited ${code}`)
    );
   }

   try{

    const result=JSON.parse(stdout);

    if(!result?.id){

     return finish(
      reject,
      new Error("Invalid metadata")
     );
    }

    if(!Array.isArray(result.formats)){
     result.formats=[];
    }

    finish(resolve,result);

   }catch(err){

    finish(
     reject,
     new Error(`JSON parse failed: ${err.message}`)
    );
   }

  });

 });

}

export { metadataExtractor };
