"use client";
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ArrowRight,ShieldCheck,ScanFace,Activity,Glasses,Download,Play,Pause,X,Wind,Layers,Camera} from 'lucide-react';
import VrMindfulness from './vr-mindfulness';
import {downloadText} from './research-data';

const FACE_API_URL =
  "https://face-emotion-api-1.onrender.com";

export function Intro({en,title,desc}:{en:string,title:string,desc:string}){return <div className="sub-intro"><span className="p-kicker">{en}</span><h1>{title}</h1><p>{desc}</p></div>}
function TherapyVideoFaceDetection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const isAnalyzingRef = useRef(false);
  const isEndingRef = useRef(false);

  const [consent, setConsent] = useState(false);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(
    "请先阅读说明并勾选授权。"
  );

  const [result, setResult] = useState({
    activity: 0,
    attention: 0,
    tension: 0,
    state: "等待校准"
  });

  const [downloads, setDownloads] = useState<{
    csv?: string;
    chart?: string;
    report?: string;
    excel?: string;
  }>({});

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => {
      track.stop();
    });

    streamRef.current = null;

    if (cameraRef.current) {
      cameraRef.current.srcObject = null;
    }
  }

  function drawLandmarks(points: number[][]) {
    const canvas = overlayRef.current;
    const camera = cameraRef.current;

    if (!canvas || !camera) return;

    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#00e5e5";

    points.forEach(([x, y]) => {
      context.beginPath();

      context.arc(
        x * canvas.width,
        y * canvas.height,
        1.5,
        0,
        Math.PI * 2
      );

      context.fill();
    });
  }

  async function endSession() {
    if (isEndingRef.current) return;

    isEndingRef.current = true;
    clearTimer();

    const id = sessionIdRef.current;

    if (id) {
      try {
        const response = await fetch(
          `${FACE_API_URL}/api/end-session`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              session_id: id
            })
          }
        );

        const data = await response.json();

        if (data.success && data.download_urls) {
          setDownloads(data.download_urls);
          setStatus("体验结束，报告已生成。");
        } else {
          setStatus("体验已结束，但数据不足以生成报告。");
        }
      } catch {
        setStatus("体验已结束，但报告生成失败。");
      }
    }

    sessionIdRef.current = null;
    stopCamera();

    if (overlayRef.current) {
      const context = overlayRef.current.getContext("2d");

      context?.clearRect(
        0,
        0,
        overlayRef.current.width,
        overlayRef.current.height
      );
    }
  }

  async function sendFrame(id: string) {
    const camera = cameraRef.current;

    if (
      !camera ||
      camera.readyState < 2 ||
      isAnalyzingRef.current
    ) {
      return;
    }

    isAnalyzingRef.current = true;

    try {
      const canvas = document.createElement("canvas");

      canvas.width = camera.videoWidth;
      canvas.height = camera.videoHeight;

      const context = canvas.getContext("2d");

      if (!context) return;

      context.drawImage(
        camera,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const imageBlob = await new Promise<Blob | null>(
        resolve => {
          canvas.toBlob(resolve, "image/jpeg", 0.85);
        }
      );

      if (!imageBlob) return;

      const formData = new FormData();

      formData.append("session_id", id);
      formData.append("image", imageBlob, "camera.jpg");

      const response = await fetch(
        `${FACE_API_URL}/api/analyze`,
        {
          method: "POST",
          body: formData
        }
      );

      const data = await response.json();

      if (!data.success) {
        setStatus(data.message || "分析服务暂时不可用。");
        return;
      }

      if (!data.face_detected) {
        setStatus("未检测到人脸，请正对摄像头并改善光线。");
        return;
      }

      if (data.landmarks) {
        drawLandmarks(data.landmarks);
      }

      if (data.stage === "baseline") {
        setStatus(
          `正在进行自然状态校准，剩余 ${
            data.remaining_seconds || 0
          } 秒。`
        );

        return;
      }

      if (data.baseline_completed) {
        setReady(true);

        setStatus(
          "校准完成，疗愈视频已自动开始，正在同步检测。"
        );

        await videoRef.current?.play();

        return;
      }

      if (data.stage === "measurement") {
        setResult({
          activity: data.activity || 0,
          attention: data.attention || 0,
          tension: data.tension || 0,
          state: data.state || "中性或过渡状态"
        });

        setStatus(
          `视频观看与面部检测中：${
            Math.floor((data.time_seconds || 0) / 60)
          } 分 ${
            Math.floor((data.time_seconds || 0) % 60)
          } 秒`
        );
      }
    } catch {
      setStatus(
        "无法连接面部分析服务。请确认 Flask 服务已经启动。"
      );
    } finally {
      isAnalyzingRef.current = false;
    }
  }

  async function startExperience() {
    if (!consent || started) return;

    try {
      setStatus("正在创建检测会话。");

      const sessionResponse = await fetch(
        `${FACE_API_URL}/api/start-session`,
        {
          method: "POST"
        }
      );

      const sessionData = await sessionResponse.json();

      if (!sessionData.success) {
        setStatus("无法创建检测会话。");
        return;
      }

      sessionIdRef.current = sessionData.session_id;

      const mediaStream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

      streamRef.current = mediaStream;

      if (cameraRef.current) {
        cameraRef.current.srcObject = mediaStream;
        await cameraRef.current.play();
      }

      setStarted(true);

      setStatus(
        "摄像头已开启，请保持自然状态，开始 10 秒校准。"
      );

      clearTimer();

      timerRef.current = window.setInterval(() => {
        if (sessionIdRef.current) {
          sendFrame(sessionIdRef.current);
        }
      }, 500);
    } catch {
      setStatus(
        "无法开启摄像头。请检查浏览器权限、HTTPS 和 Flask 服务。"
      );
    }
  }

  useEffect(() => {
    return () => {
      clearTimer();
      stopCamera();
    };
  }, []);

  return (
    <div className="therapy-detection">
      <div className="therapy-video-layout">
        <section>
          <p className="p-label">
            数字疗愈视频 · 观看过程同步反馈
          </p>

          <video
  ref={videoRef}
  src="/mindful-breathing.mp4"
  controls={ready}
  playsInline
  onEnded={() => {
    endSession();
  }}
/>

          {!ready && (
            <p className="modal-note">
              完成 10 秒自然状态校准后，视频会自动播放。
            </p>
          )}
        </section>

        <section className="camera-detection-panel">
          <p className="p-label">实时面部行为检测</p>

          <div
            className="camera-box"
            style={{
              position: "relative",
              overflow: "hidden",
              minHeight: "220px"
            }}
          >
            <video
              ref={cameraRef}
              muted
              playsInline
              style={{
                display: started ? "block" : "none",
                width: "100%",
                transform: "scaleX(-1)"
              }}
            />

            {started && (
              <canvas
                ref={overlayRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  transform: "scaleX(-1)",
                  pointerEvents: "none"
                }}
              />
            )}

            {!started && (
              <div>
                <ScanFace size={52} strokeWidth={1} />
                <p>开始后显示摄像头与关键点</p>
              </div>
            )}
          </div>

          <div className="simulation-result">
            <small>当前状态趋势</small>
            <strong>{result.state}</strong>

            <p>
              面部活跃度：{result.activity.toFixed(3)}
              <br />
              观看投入度：{result.attention.toFixed(3)}
              <br />
              紧张相关指数：{result.tension.toFixed(3)}
            </p>
          </div>
        </section>
      </div>

      {!started && (
        <>
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={event => {
                setConsent(event.target.checked);
              }}
            />

            我同意在本次体验中使用摄像头画面进行非诊断性面部行为趋势分析；
            系统不进行身份识别。
          </label>

          <div className="p-actions">
            <button
              className="p-primary"
              disabled={!consent}
              onClick={startExperience}
            >
              开始校准并进入体验
            </button>
          </div>
        </>
      )}

      {started && (
        <div className="p-actions">
          <button
            className="p-secondary"
            onClick={endSession}
          >
            提前结束并生成报告
          </button>
        </div>
      )}

      <p className="inline-status" role="status">
        {status}
      </p>

      {downloads.excel && (
        <div className="p-actions">
          <a
            className="p-primary"
            href={`${FACE_API_URL}${downloads.excel}`}
            target="_blank"
            rel="noreferrer"
          >
            下载 Excel 汇总
          </a>

          <a
            className="p-secondary"
            href={`${FACE_API_URL}${downloads.chart}`}
            target="_blank"
            rel="noreferrer"
          >
            查看趋势图
          </a>

          <a
            className="p-secondary"
            href={`${FACE_API_URL}${downloads.report}`}
            target="_blank"
            rel="noreferrer"
          >
            下载文字报告
          </a>
        </div>
      )}

      <p className="modal-note">
        本功能仅反映观看过程中的面部行为变化趋势，不构成心理或医学诊断。
      </p>
    </div>
  );
}
export function Resources({onStart}:{onStart:()=>void}){const [filter,setFilter]=useState('全部');const [open,setOpen]=useState<string|null>(null);const [done,setDone]=useState(false);const [playing,setPlaying]=useState(false);const [ticks,setTicks]=useState(0);useEffect(()=>{if(!playing)return;const t=setInterval(()=>setTicks(s=>s+1),1000);return()=>clearInterval(t);},[playing]);const resources=[{title:'正念呼吸暂停',type:'2D',tag:'72 秒 · 视听引导',desc:'沿用原站正念视频，在钢琴与缓慢的呼吸节奏中觉察当下。',key:'video',icon:<Play/>},{title:'光息花园',type:'3D / VR',tag:'60 秒 · 交互场景',desc:'转动视角、跟随呼吸光球，触碰光点。兼容设备支持 WebXR。',key:'vr',icon:<Glasses/>},{title:'呼吸节奏练习',type:'2D',tag:'自主时长 · 视觉引导',desc:'随圆环舒展进行呼吸。保持自然节奏，不适时可立即暂停。',key:'breath',icon:<Wind/>}];return <div className="p-container"><Intro en="EXPERIENCE LIBRARY" title="找到适合此刻的体验" desc="先自由探索，或进入完整评估流程，记录体验前后的主观感受。"/><div className="resource-banner"><ShieldCheck size={22}/><div><b>想获得个人体验报告？</b><p>请从心理评估开始，完成量表、即时前测、体验与后测。</p></div><button className="p-primary" onClick={onStart}>开始完整流程 <ArrowRight size={16}/></button></div><div className="filter-row">{['全部','2D','3D / VR'].map(f=><button className={filter===f?'selected':''} key={f} onClick={()=>setFilter(f)}>{f}</button>)}</div><div className="resources-grid">{resources.filter(r=>filter==='全部'||r.type===filter).map(r=><article key={r.key} className="resource-card"><div className={'resource-cover cover-'+r.key}><div className="resource-shape">{r.icon}</div><span>{r.type}</span></div><div className="resource-body"><span className="p-label">{r.tag}</span><h2>{r.title}</h2><p>{r.desc}</p><button className="p-link" onClick={()=>{setOpen(r.key);setDone(false);setPlaying(false);setTicks(0);}}>进入体验 <ArrowUpRight size={17}/></button></div></article>)}</div><a className="design-entry" href="/design-lab"><Layers/><div><h3>设计体验实验室</h3><p>继续探索原站的数字媒介与视觉交互作品。</p></div><ArrowUpRight/></a>{open&&<div className="modal-overlay"><section className="p-modal" role="dialog" aria-modal="true" aria-label="资源体验"><button className="modal-close" aria-label="关闭体验" autoFocus onClick={()=>{setOpen(null);setPlaying(false);window.speechSynthesis?.cancel();}}><X/></button><span className="p-kicker">自由探索 · 不记录量表分数</span><h2>{resources.find(r=>r.key===open)?.title}</h2>{(open === 'video' || open === 'vr' || open === 'breath') && <TherapyVideoFaceDetection />}{false&&<VrMindfulness onComplete={()=>setDone(true)}/>} {false&&<div className="breath-demo"><div className={'breath-ring '+(playing?'running':'')}><b>{playing?(ticks%10<4?'轻轻吸气':'缓缓呼气'):'准备好了'}<small>{ticks} 秒</small></b></div><button className="p-primary" onClick={()=>setPlaying(!playing)}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'暂停':'开始呼吸'}</button></div>}{done&&<p role="status">本次互动已完成。你可以关闭窗口，或开始完整评估流程。</p>}<p className="modal-note">如果感到不适、眩晕或疲劳，请停止体验。当前为浏览器交互原型，无法替代专业干预。</p></section></div>}</div>}
export function Emotion(){const video=useRef<HTMLVideoElement>(null);const stream=useRef<MediaStream|null>(null);const request=useRef(0);const [consent,setConsent]=useState(false);const [camera,setCamera]=useState(false);const [busy,setBusy]=useState(false);const [msg,setMsg]=useState('摄像头未开启');const [kind,setKind]=useState('平静');const [rows,setRows]=useState<{time:string,label:string,value:number}[]>([]);function stop(){request.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;setCamera(false);setBusy(false);setMsg('摄像头已关闭');}useEffect(()=>()=>{request.current++;stream.current?.getTracks().forEach(t=>t.stop());},[]);async function start(){if(!consent||busy)return;const id=++request.current;setBusy(true);try{const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});if(id!==request.current){s.getTracks().forEach(t=>t.stop());return;}stream.current=s;if(video.current){video.current.srcObject=s;await video.current.play();}setCamera(true);setMsg('本地实时预览 · 未进行人脸或情绪识别');}catch{if(id===request.current){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setMsg('无法访问摄像头：请检查浏览器权限、设备连接或 HTTPS 环境。仍可使用模拟演示。');}}finally{if(id===request.current)setBusy(false);}}const record=()=>setRows(r=>[...r,{time:new Date().toLocaleTimeString('zh-CN'),label:kind,value:kind==='平静'?80:kind==='愉悦'?90:45}]);return <div className="p-container"><Intro en="EMOTION OBSERVATION" title="观察表情，觉察当下" desc="人脸识别与情绪分析流程演示。当前未接入识别模型，摄像头只作本地预览；模拟结果不读取画面。"/><div className="emotion-layout"><section className="panel"><div className="panel-heading"><h2><Camera size={20}/> 摄像头预览</h2><span className="p-pill">{camera?'本地预览中':'默认关闭'}</span></div><div className="camera-box"><video ref={video} muted playsInline className={camera?'':'camera-hidden'}/>{!camera&&<div><ScanFace size={68} strokeWidth={1}/><h3>你的隐私，由你决定</h3><p>不开启摄像头，也可以使用全部模拟功能</p></div>}{camera&&<span>本地画面 · 不上传 · 不保存</span>}</div><label className="consent"><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);if(!e.target.checked)stop();}}/>我同意仅在当前设备预览摄像头画面（不录制、不上传、不识别身份）。</label><div className="p-actions"><button className="p-primary" disabled={!consent||busy||camera} onClick={start}>{busy?'等待设备授权…':'开启摄像头'}</button><button className="p-secondary" onClick={stop}>关闭摄像头</button></div><p className="inline-status" role="status">{msg}</p></section><section className="panel"><div className="panel-heading"><h2>表情分析面板</h2><span className="demo-badge">模拟演示</span></div><p>选择一个预设表情，演示数据记录与趋势。数值为固定示例，不是识别置信度或心理状态。</p><div className="emotion-options">{['平静','愉悦','紧张'].map(k=><button key={k} className={kind===k?'selected':''} onClick={()=>setKind(k)}>{k==='平静'?'◡':k==='愉悦'?'☀':'≈'}<b>{k}</b></button>)}</div><div className="simulation-result"><small>预设模拟标签</small><strong>{kind}</strong><p>人脸检测：未接入<br/>表情识别：未接入<br/>身份识别：不提供</p></div><button className="p-primary" onClick={record}>记录一条模拟数据 <ArrowRight size={16}/></button></section></div><section className="panel emotion-record"><div className="panel-heading"><div><h2>本次模拟记录</h2><p>{rows.length} 条 · 离开此模块即清除 · 与量表自评数据分开</p></div><div className="p-actions"><button className="p-secondary" disabled={!rows.length} onClick={()=>downloadText('模拟表情记录.csv','类型,时间,模拟标签,示例数值\n'+rows.map(r=>`模拟数据,${r.time},${r.label},${r.value}`).join('\n'))}><Download size={15}/>导出</button><button className="p-secondary" onClick={()=>setRows([])}>清空</button></div></div>{!rows.length?<div className="empty-state"><Activity/><p>还没有记录。选择上方模拟表情，添加第一条数据。</p></div>:<><div className="mini-chart" aria-label="模拟预设数值趋势">{rows.map((r,i)=><div key={i}><span style={{height:r.value+'%'}}/><small>{i+1}</small></div>)}</div><p className="chart-caption">纵向高度为固定示例值（平静 80 / 愉悦 90 / 紧张 45），无心理测量含义。</p><div className="record-list">{rows.map((r,i)=><span key={i}>{r.time} · {r.label} <i>模拟</i></span>)}</div></>}</section></div>}
