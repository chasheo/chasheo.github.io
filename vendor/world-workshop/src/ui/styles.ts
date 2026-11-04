/** Scoped stylesheet: every rule is prefixed with .ww-root so nothing leaks into the host page. */
export const CSS = `
.ww-root{position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;color:#1b1a21;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;--paper:#efe4cc;--ink:#1b1a21;--warm:#b7412e;--cool:#2e6b66;--jade:#7fd6a4;contain:layout style}
.ww-root *{box-sizing:border-box}
.ww-root canvas.ww-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:auto;touch-action:none;outline:none}
.ww-root .ww-layer{position:absolute;inset:0;pointer-events:none}
.ww-root .ww-hide{display:none!important}
.ww-root .ww-btn{pointer-events:auto;cursor:pointer;border:2.5px solid var(--ink);background:var(--paper);color:var(--ink);font:600 15px/1 inherit;padding:10px 16px;box-shadow:4px 4px 0 var(--ink);transform:translate(0,0);transition:transform .09s,box-shadow .09s;border-radius:2px 5px 3px 4px;letter-spacing:.06em}
.ww-root .ww-btn:hover{transform:translate(-1px,-1px);box-shadow:5px 5px 0 var(--ink)}
.ww-root .ww-btn:active{transform:translate(3px,3px);box-shadow:1px 1px 0 var(--ink)}
.ww-root .ww-btn:focus-visible{outline:3px solid var(--cool);outline-offset:3px}
.ww-root .ww-btn.primary{background:var(--warm);color:var(--paper);font-size:19px;padding:13px 22px}
.ww-root .ww-btn.cool{background:var(--cool);color:var(--paper)}
.ww-root .ww-btn[disabled]{cursor:default;box-shadow:none;opacity:.72;background:#d8ccb0;color:#57525a;transform:none}
.ww-root .ww-btn.small{font-size:13px;padding:7px 10px;box-shadow:3px 3px 0 var(--ink)}
.ww-root kbd{display:inline-block;font:700 11px/1 "Segoe UI",sans-serif;border:1.5px solid currentColor;padding:2px 5px;margin:0 3px;border-radius:3px;opacity:.9}
/* browse panel (right) */
.ww-root .ww-browse{position:absolute;right:3.5%;bottom:6%;display:flex;flex-direction:column;align-items:flex-end;gap:12px;pointer-events:none}
.ww-root .ww-title{font-family:"STKaiti","KaiTi","Kaiti SC","Songti SC",serif;font-size:44px;font-weight:700;color:var(--paper);text-shadow:3px 3px 0 var(--ink),-1px 1px 0 var(--warm);letter-spacing:.12em;line-height:1}
.ww-root .ww-sub{font-size:13px;color:var(--paper);text-shadow:1px 1px 0 var(--ink);max-width:300px;text-align:right;opacity:.92}
.ww-root .ww-chips{display:flex;gap:8px;pointer-events:auto}
.ww-root .ww-chip{font-size:12px;padding:6px 9px;border:2px solid var(--ink);background:rgba(239,228,204,.86);cursor:pointer;box-shadow:2px 2px 0 var(--ink)}
.ww-root .ww-chip.on{background:var(--cool);color:var(--paper)}
.ww-root .ww-progress{width:260px;display:flex;gap:3px;align-items:center}
.ww-root .ww-progress i{flex:1;height:12px;border:2px solid var(--ink);background:rgba(239,228,204,.4)}
.ww-root .ww-progress i.on{background:var(--warm)}
.ww-root .ww-progress b{font:700 12px/1 "Segoe UI";color:var(--paper);text-shadow:1px 1px 0 var(--ink);margin-left:6px;width:38px}
.ww-root .ww-hint{position:absolute;left:3.5%;bottom:6%;font-size:13px;color:var(--paper);text-shadow:1px 1px 0 var(--ink);background:rgba(27,26,33,.42);padding:6px 10px;border-left:4px solid var(--jade)}
/* loading cover: text-free key-art poster, fades into the live 3D scene */
.ww-root .ww-intro{position:absolute;inset:0;z-index:5;background:#0d1117;overflow:hidden;pointer-events:none;opacity:1;transition:opacity .8s ease}
.ww-root .ww-intro.out{opacity:0}
.ww-root .ww-intro-art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:52% 38%;display:block}
.ww-root .ww-intro-video{opacity:0;transition:opacity .6s ease}
.ww-root .ww-intro-video.on{opacity:1}
.ww-root .ww-intro-shade{position:absolute;left:0;right:0;bottom:0;height:22%;background:linear-gradient(to top,rgba(13,17,23,.55),rgba(13,17,23,0))}
.ww-root .ww-intro-bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(27,26,33,.55)}
.ww-root .ww-intro-bar i{display:block;height:100%;background:var(--paper);box-shadow:0 -1px 0 var(--ink);transform:scaleX(0);transform-origin:0 50%;transition:transform .25s linear}
.ww-root .ww-intro.out .ww-intro-bar{opacity:0;transition:opacity .2s}
/* play hud */
.ww-root .ww-hud{position:absolute;inset:0}
.ww-root .ww-plate{position:absolute;left:3%;top:4%;width:min(320px,44vw)}
.ww-root .ww-name{font:700 15px/1 "STKaiti","KaiTi",serif;color:var(--paper);text-shadow:2px 2px 0 var(--ink);margin-bottom:6px;letter-spacing:.1em}
.ww-root .ww-bar{position:relative;height:14px;border:2.5px solid var(--ink);background:rgba(27,26,33,.55);box-shadow:3px 3px 0 var(--ink)}
.ww-root .ww-bar>i{position:absolute;left:0;top:0;bottom:0;background:var(--warm);transition:width .12s}
.ww-root .ww-bar>u{position:absolute;left:0;top:0;bottom:0;background:#f0d9b0;transition:width .7s .25s}
.ww-root .ww-bar.posture{height:8px;margin-top:6px;background:rgba(27,26,33,.4)}
.ww-root .ww-bar.posture>i{background:linear-gradient(90deg,#e9b44c,#f6e3a6);left:50%;transform:translateX(-50%)}
.ww-root .ww-boss{position:absolute;left:50%;top:4%;transform:translateX(-50%);width:min(560px,70vw);text-align:center}
.ww-root .ww-boss .ww-name{font-size:18px}
.ww-root .ww-boss .ww-bar>i{background:#9d2f22}
.ww-root .ww-top-right{position:absolute;right:2.5%;top:3.5%;display:flex;gap:10px;pointer-events:auto}
.ww-root .ww-word{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%) rotate(-4deg);font:900 64px/1 "STKaiti","KaiTi","Kaiti SC",serif;letter-spacing:.08em;pointer-events:none;opacity:0}
.ww-root .ww-word.show{animation:ww-stamp .85s ease-out forwards}
.ww-root .ww-word.parry{color:#e8fbff;text-shadow:4px 4px 0 var(--cool),-2px -1px 0 #0d2b33}
.ww-root .ww-word.counter{color:var(--paper);text-shadow:4px 4px 0 var(--warm)}
.ww-root .ww-word.broken{color:#ffd56a;text-shadow:5px 5px 0 #6b1a10}
.ww-root .ww-word.stagger{color:var(--paper);text-shadow:4px 4px 0 #6b1a10;font-size:48px}
.ww-root .ww-word.fail{color:#cfc7b4;text-shadow:3px 3px 0 var(--ink);font-size:34px;top:58%}
@keyframes ww-stamp{0%{opacity:0;transform:translate(-50%,-50%) rotate(-4deg) scale(1.6)}12%{opacity:1;transform:translate(-50%,-50%) rotate(-4deg) scale(.96)}20%{transform:translate(-50%,-50%) rotate(-4deg) scale(1)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-56%) rotate(-4deg) scale(1)}}
.ww-root .ww-counter{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);font:900 30px/1 "STKaiti","KaiTi",serif;color:var(--paper);background:var(--cool);border:2.5px solid var(--ink);box-shadow:4px 4px 0 var(--ink);padding:6px 12px;opacity:0;transition:opacity .12s}
.ww-root .ww-counter.on{opacity:1;animation:ww-pulse .4s infinite alternate}
@keyframes ww-pulse{to{transform:translateX(-50%) scale(1.07)}}
.ww-root .ww-charge{position:absolute;left:50%;bottom:17%;transform:translateX(-50%);width:180px;height:10px;border:2.5px solid var(--ink);background:rgba(27,26,33,.5);opacity:0;transition:opacity .1s}
.ww-root .ww-charge.on{opacity:1}
.ww-root .ww-charge i{position:absolute;left:0;top:0;bottom:0;background:#f2b45a}
.ww-root .ww-prompt{position:absolute;left:50%;bottom:28%;transform:translateX(-50%);background:var(--paper);border:2.5px solid var(--ink);box-shadow:4px 4px 0 var(--ink);padding:8px 14px;font-size:14px;font-weight:600;white-space:nowrap}
.ww-root .ww-strip{position:absolute;left:0;right:0;bottom:0;padding:9px 3%;background:rgba(27,26,33,.62);border-top:3px solid var(--ink);color:var(--paper);font-size:13px;text-align:center}
.ww-root .ww-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.ww-root .ww-card{pointer-events:auto;background:var(--paper);border:3px solid var(--ink);box-shadow:8px 8px 0 var(--ink);padding:26px 30px;text-align:center;max-width:min(460px,86vw)}
.ww-root .ww-card .big{font:900 72px/1 "STKaiti","KaiTi",serif;color:var(--warm);text-shadow:3px 3px 0 var(--ink);margin-bottom:10px}
.ww-root .ww-card p{margin:0 0 18px;font-size:15px;line-height:1.6}
.ww-root .ww-card .row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.ww-root .ww-bosscard{position:absolute;left:50%;top:26%;transform:translateX(-50%);text-align:center;color:var(--paper);opacity:0;pointer-events:none}
.ww-root .ww-bosscard.show{animation:ww-card 3.2s ease forwards}
.ww-root .ww-bosscard b{display:block;font:900 52px/1.1 "STKaiti","KaiTi",serif;text-shadow:4px 4px 0 #6b1a10;letter-spacing:.1em}
.ww-root .ww-bosscard span{font-size:15px;text-shadow:1px 1px 0 var(--ink)}
@keyframes ww-card{0%{opacity:0;letter-spacing:.4em}15%{opacity:1;letter-spacing:.1em}80%{opacity:1}100%{opacity:0}}
/* gate panel */
.ww-root .ww-gate{position:absolute;right:3%;top:50%;transform:translateY(-50%);width:min(380px,90vw);pointer-events:auto;background:var(--paper);border:3px solid var(--ink);box-shadow:8px 8px 0 var(--ink)}
.ww-root .ww-gate .cover{position:relative;aspect-ratio:16/9;background:#222 center/cover;border-bottom:3px solid var(--ink);overflow:hidden}
.ww-root .ww-gate .cover video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ww-root .ww-gate .badge{position:absolute;left:10px;top:10px;font-size:12px;font-weight:700;padding:4px 8px;border:2px solid var(--ink);background:var(--jade);color:var(--ink)}
.ww-root .ww-gate .badge.showcase{background:#e7d6a9}
.ww-root .ww-gate .badge.offline{background:#bbb}
.ww-root .ww-gate .body{padding:14px 16px 16px}
.ww-root .ww-gate h3{margin:0 0 4px;font:800 21px/1.2 inherit}
.ww-root .ww-gate .tags{font-size:12px;color:#5d5866;margin-bottom:8px}
.ww-root .ww-gate p{margin:0 0 14px;font-size:13.5px;line-height:1.55;color:#33303a}
.ww-root .ww-gate .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.ww-root .ww-gate .nav{display:flex;justify-content:space-between;align-items:center;padding:0 16px 12px;font-size:12px;color:#5d5866}
.ww-root .ww-gate .x{position:absolute;right:8px;top:8px;z-index:2}
/* touch */
.ww-root .ww-touch{position:absolute;inset:0;pointer-events:none}
.ww-root .ww-stick{position:absolute;left:5%;bottom:9%;width:130px;height:130px;border-radius:50%;border:3px solid rgba(239,228,204,.8);background:rgba(27,26,33,.25);pointer-events:auto;touch-action:none}
.ww-root .ww-stick i{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px;border-radius:50%;background:var(--paper);border:3px solid var(--ink)}
.ww-root .ww-tbtns{position:absolute;right:4%;bottom:8%;display:grid;grid-template-columns:repeat(2,68px);gap:12px;pointer-events:auto}
.ww-root .ww-tbtns .ww-btn{width:68px;height:68px;border-radius:50%;font:900 24px/1 "STKaiti","KaiTi",serif;padding:0;touch-action:none}
.ww-root .ww-paused{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-3deg);font:900 40px/1 "STKaiti","KaiTi",serif;color:var(--paper);text-shadow:3px 3px 0 var(--ink)}
@media (max-width:720px){.ww-root .ww-plate{left:3%;top:2%;width:44vw}.ww-root .ww-name{font-size:12px}.ww-root .ww-boss{top:9.5%;width:92vw}.ww-root .ww-boss .ww-name{font-size:13px}.ww-root .ww-top-right{top:2%;right:2%;gap:6px}.ww-root .ww-top-right .ww-btn{font-size:11px;padding:6px 7px}.ww-root .ww-top-right .ww-btn kbd{display:none}.ww-root .ww-bosscard b{font-size:30px}.ww-root .ww-bosscard{top:22%;width:90vw}.ww-root .ww-prompt{font-size:12px;bottom:34%;white-space:normal;max-width:86vw;text-align:center}.ww-root .ww-counter{bottom:30%}.ww-root .ww-charge{bottom:27%}.ww-root .ww-title{font-size:32px}.ww-root .ww-sub{display:none}.ww-root .ww-word{font-size:46px}.ww-root .ww-strip{display:none}.ww-root .ww-gate{top:auto;bottom:2%;transform:none;right:2%;left:2%;width:auto;max-height:70%;overflow:auto}.ww-root .ww-browse{right:4%;bottom:4%}}
@media (prefers-reduced-motion:reduce){.ww-root .ww-word.show{animation:none;opacity:1}.ww-root .ww-counter.on{animation:none}.ww-root .ww-bosscard.show{animation:none;opacity:1}}
.ww-root.ww-reduced .ww-word.show{animation:none;opacity:1}.ww-root.ww-reduced .ww-counter.on{animation:none}.ww-root.ww-reduced .ww-bosscard.show{animation:none;opacity:1}
/* ---- material skin (round 10): same layout and interaction, surfaces from real materials ----
   xuan paper, cinnabar & jade lacquer, aged bronze, old timber, sumi ink and a cinnabar seal (assets/ui/*.png, set as
   CSS variables by the HUD). Text stays live text; hard offset shadows become drop-shadows of the material shape. */
.ww-root .ww-btn{background:transparent;border-style:solid;border-width:10px 12px;border-image:var(--ui-btn-paper) 34 36 fill / 10px 12px stretch;box-shadow:none;border-radius:0;padding:3px 8px;filter:drop-shadow(2px 3px 0 rgba(20,16,12,.55));transition:transform .09s,filter .09s}
.ww-root .ww-btn:hover{transform:translate(-1px,-1px);box-shadow:none;filter:drop-shadow(3px 4px 0 rgba(20,16,12,.55)) brightness(1.06)}
.ww-root .ww-btn:active{transform:translate(2px,2px);box-shadow:none;filter:drop-shadow(0 1px 0 rgba(20,16,12,.5)) brightness(.95)}
.ww-root .ww-btn.primary{background:transparent;border-width:13px 17px;border-image:var(--ui-btn-cinnabar) 48 54 fill / 13px 17px stretch;color:#f6e7c8;text-shadow:0 1px 0 #4a120b,0 0 6px rgba(60,10,5,.6);padding:4px 10px;font-size:19px}
.ww-root .ww-btn.cool{background:transparent;border-width:10px 14px;border-image:var(--ui-btn-jade) 48 54 fill / 10px 14px stretch;color:#eef3ea;text-shadow:0 1px 0 #0c2420}
.ww-root .ww-btn.small{border-width:8px 10px;border-image-width:8px 10px;padding:2px 5px;filter:drop-shadow(1px 2px 0 rgba(20,16,12,.55))}
.ww-root .ww-btn[disabled]{background:transparent;filter:grayscale(.85) brightness(.9);opacity:.75;box-shadow:none}
.ww-root .ww-chip{background:transparent;border-style:solid;border-width:7px 9px;border-image:var(--ui-btn-paper) 34 36 fill / 7px 9px stretch;box-shadow:none;padding:2px 3px;filter:drop-shadow(1px 2px 0 rgba(20,16,12,.5))}
.ww-root .ww-chip.on{background:transparent;border-image:var(--ui-btn-jade) 48 54 fill / 7px 9px stretch;color:#eef3ea}
.ww-root .ww-progress i{border:0;height:13px;background:var(--ui-cell-empty) center/100% 100% no-repeat}
.ww-root .ww-progress i.on{background:var(--ui-cell-filled) center/100% 100% no-repeat}
.ww-root .ww-title{position:relative;padding:14px 70px 18px 30px;margin-right:-14px;background:var(--ui-brush-wide) center/100% 100% no-repeat;text-shadow:0 2px 0 #0d0c10,0 0 10px rgba(0,0,0,.6)}
.ww-root .ww-title::after{content:'';position:absolute;right:8px;top:50%;width:46px;height:46px;transform:translateY(-50%) rotate(4deg);background:var(--ui-seal) center/contain no-repeat;opacity:.92}
.ww-root .ww-hint{background:var(--ui-brush-wide) center/100% 100% no-repeat;border-left:0;padding:10px 26px 12px 18px}
.ww-root .ww-name{text-shadow:0 2px 0 #0d0c10,0 0 6px rgba(0,0,0,.7)}
.ww-root .ww-bar{background:rgba(18,12,10,.78);background-clip:padding-box;border:0;border-style:solid;border-width:5px 14px;border-image:var(--ui-bar-frame) 28 70 / 5px 14px stretch;box-shadow:none;filter:drop-shadow(1px 2px 0 rgba(0,0,0,.5));height:20px}
.ww-root .ww-bar>i{background:linear-gradient(#cf4a33,#8e2316 60%,#6d1a10)}
.ww-root .ww-boss .ww-bar>i{background:linear-gradient(#b23a26,#701b10 60%,#4f120a)}
.ww-root .ww-bar.posture{height:14px;border-width:4px 12px;border-image-width:4px 12px;background:rgba(18,12,10,.6)}
.ww-root .ww-bar.posture>i{background:linear-gradient(90deg,#c9932f,#f1d48a,#c9932f)}
.ww-root .ww-word{padding:.42em .55em;background:var(--ui-ink-splat) 50% 55%/112% auto no-repeat}
.ww-root .ww-word.fail{background-size:90% auto}
.ww-root .ww-counter{background:transparent;border-style:solid;border-width:12px 16px;border-image:var(--ui-btn-jade) 48 54 fill / 12px 16px stretch;box-shadow:none;padding:2px 8px;filter:drop-shadow(2px 3px 0 rgba(0,0,0,.5))}
.ww-root .ww-charge{border-width:4px 12px;border-style:solid;border-image:var(--ui-bar-frame) 28 70 / 4px 12px stretch;height:14px;background:rgba(18,12,10,.6);background-clip:padding-box}
.ww-root .ww-prompt{background:transparent;border-style:solid;border-width:10px 14px;border-image:var(--ui-btn-paper) 34 36 fill / 10px 14px stretch;box-shadow:none;padding:2px 8px;filter:drop-shadow(2px 3px 0 rgba(20,16,12,.5))}
.ww-root .ww-strip{background:transparent;border-top:0;border-style:solid;border-width:8px 40px;border-image:var(--ui-wood-band) 40 130 fill / 8px 40px stretch;padding:2px 2%;text-shadow:0 1px 0 #120d09,0 0 6px rgba(0,0,0,.8)}
.ww-root .ww-card,.ww-root .ww-gate{background:transparent;border-style:solid;border-width:22px;border-image:var(--ui-paper) 44 fill / 22px stretch;box-shadow:none;filter:drop-shadow(5px 7px 0 rgba(15,12,10,.45))}
.ww-root .ww-card{position:relative;padding:12px 18px}
.ww-root .ww-card::after{content:'';position:absolute;left:-14px;top:-14px;width:48px;height:48px;background:var(--ui-seal) center/contain no-repeat;transform:rotate(-8deg);opacity:.9;pointer-events:none}
.ww-root .ww-card .big{text-shadow:0 2px 0 rgba(27,26,33,.35)}
.ww-root .ww-gate .cover{border-bottom:2px solid rgba(27,26,33,.7)}
.ww-root .ww-gate .badge{border-width:1.5px}
.ww-root .ww-paused{padding:18px 60px;background:var(--ui-brush-wide) center/100% 100% no-repeat}
.ww-root .ww-stick{border:0;background:var(--ui-bronze) center/100% 100% no-repeat;opacity:.85}
.ww-root .ww-stick i{border:0;background:var(--ui-bronze) center/100% 100% no-repeat;filter:brightness(1.25) drop-shadow(0 3px 2px rgba(0,0,0,.6))}
.ww-root .ww-tbtns .ww-btn{border:0;border-image:none;background:var(--ui-bronze) center/100% 100% no-repeat;color:#f3e6c6;text-shadow:0 2px 0 #1a120b,0 0 6px rgba(0,0,0,.7);filter:drop-shadow(1px 3px 0 rgba(0,0,0,.5))}
.ww-root .ww-tbtns .ww-btn.primary{background:var(--ui-btn-cinnabar) center/100% 100% no-repeat;border-radius:50%;grid-column:span 2;justify-self:center;width:78px;height:78px}
@media (max-width:720px){.ww-root .ww-title{padding:10px 52px 14px 22px}.ww-root .ww-title::after{width:34px;height:34px}}
`;
