# 乡道 · 20:30

坐在四川乡间公路的小皮卡上。晚上八点半，略微破败的水泥路，路边一盏盏泛黄的路灯往后退，远处偶尔有车开着远光过来。可以下车沿着路边走一段。

整个场景是**实时程序化生成**的（three.js / WebGL），不是预渲染的视频或静态模型：路面起伏、裂缝、伸缩缝、砖房、树、竹林、路灯、会车、浮尘、星空、远处的树线剪影，全部在运行时算出来。所有纹理也是 canvas 现画的，仓库里没有一张图片资源。

## 直接打开

线上：<https://sichuan-night-road.app.workbuddy.host/?sharecode=CACYLQ23YE>

本地：

```bash
# 需要一个 http 服务，ES module 不能直接 file:// 打开
python -m http.server 8899
# 然后访问 http://127.0.0.1:8899/
```

Windows 上也可以直接双击 `start-preview.bat`。

想发到自己的 GitHub Pages：双击 `publish-to-github.bat`（推到 `absm5665.github.io/sichuan-night-road/`，首次会弹一次 GitHub 登录）。

## 操作

| 键 | 作用 |
|---|---|
| `W A S D` | 走动（下车后） |
| 鼠标 | 转头 |
| `E` | 下车 / 上车 |
| `R` | 收起 / 展开收音机 |
| `M` | 静音 |
| `H` | 隐藏界面 |

## 收音机与音乐

右下角是一台老式收音机。播放列表是：

1. Summer Vibe (Album Version) — Walk off the Earth
2. Mystery of Love — Sufjan Stevens
3. The Hell Song — Dream Tunes
4. Chemtrails Over The Country Club — Lana Del Rey
5. So Far Away (Acoustic) — Adam Christopher
6. Closure — Sarcastic Sounds / Birdy
7. Things You Said — Cody Fry / Abby Cates

**音频文件不在仓库里**（都是有版权的商用录音）。想听原曲，有两种办法：

1. **直接把文件拖进右下角的收音机**，或者点「选本地音频…」——立刻生效，不用改代码，刷新后要重选。
2. **放进 `music/` 目录**（命名见 `music/README.txt`），页面会自动扫出来。支持 `mp3 / m4a / ogg / wav / flac / opus / aac`。

没有文件也不会静音 —— 会播一段程序生成的「深夜电台」垫音（Am–F–C–G 缓慢循环的正弦垫 + 底噪），经过同一条信号链。点歌之后垫音立刻响，后台继续找文件，找到了就无缝切到原曲。

无论有没有文件，声音都会过一遍模拟老收音机的处理链：

```
音源 → 高通 178 Hz → 低通 3.48 kHz → 中频 1.38 kHz +7.5 dB 凸起
     → tanh 软削波（纸盆喇叭过载）→ 输出
     ↑ 电源 100 Hz 哼声        ↑ 带通噪声（调不准的载波）
```

另外还有：信号随时间的缓慢漂移（滤波频率游走）、偶发的瞬间跌落、切台时一段从 300 Hz 扫到 4.3 kHz 的调谐噪声。每首歌占一个电台频率，指针会滑过去。

## 调试参数

URL 上可以带一些参数，方便复现某个瞬间：

- `?auto` — 跳过开场直接进场景
- `?skip=140` — 直接把车开到 140 m 处
- `?walk` — 以漫步模式开始
- `?sim=30` — 快进 30 秒的模拟
- `?hide=props,veg,cars,road` — 隐藏某一类物体（`beam / lampglow / pool / win / cars / interior / sky / ground / road / truck / dust / insects / mist / stone / truckglow / props / veg`）
- `?probe` — 逐个隐藏场景对象并输出屏幕区域平均亮度（定位异常亮斑用）

## 结构

```
index.html            页面外壳、HUD、收音机界面
js/main.js            场景全部内容（约 2500 行）
js/radio.js           老收音机：播放列表、信号链、合成垫音
js/three.module.js    three r180（本地预览用；线上走 CDN）
js/addons/            BufferGeometryUtils
music/                放音频文件的地方（空）
```

three.js 的加载方式按环境切换：`localhost / 127.0.0.1` 用仓库里的文件（可离线），其他域名走 jsDelivr CDN —— 这样 Pages 上不用塞 2 MB 的库。

## 已知可以继续打磨的地方

- 树冠还是低模团块，近看能看出是二十面体
- 音效（风、引擎、蟋蟀、脚步）都是 WebAudio 实时合成，不是录音
- 路面没有真正的凹陷几何，坑洞是贴花
- 收音机的「信号强度」是装饰性的，没有真的做电台搜索
