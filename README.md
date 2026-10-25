# dsh-ios-connect

让你的 iPhone 出现在 DeepSeek Harness 的右侧栏里 —— 实时画面，用 USB 线连着的真机。

同时给 agent 一组工具：截图、点、滑、打字、读当前界面的控件树。它能看到你手机上的东西，也能动手。

> 只在 Windows + USB 下验证过。macOS 理论上也能跑（go-ios 有 darwin 版），但没测。

---

## 它解决什么

在 Windows 上用 AI 操作 iPhone，麻烦的地方从来不是「怎么点一下」，是前面那一长串：找 go-ios、挂开发者镜像、起隧道、查 WebDriverAgent 的包名（每次重签都会变）、端口转发、断线重连。任何一环断了，表现都是「没反应」，你还得自己猜断在哪一环。

这个插件把这些全接过来，只留三件必须你自己做的事：插线、点信任、用你的 Apple ID 给 WebDriverAgent 签一次名。

---

## 1. 装插件

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add dsh-ios-connect
```

然后编辑同目录下的 `package.json`，把 `dsh-ios-connect` 加进 `dsh.profile.bundles` 数组里。

重启 DSH。

包里有 `bin/ios.exe`（go-ios）和 `wda/WebDriverAgent.ipa` —— 后面几步要用的两样东西，装完插件就有了，不用另外下。

---

## 2. 准备 iPhone

### 让 Windows 能认出 iPhone

装 **Apple Devices**（微软商店里免费的那个）。

装完插线，手机弹「要信任此电脑吗」→ 点信任 → 输密码。

> **别装 iTunes。** 2026-10 那版 `iTunes64Setup.exe` 实测装完启动即崩（`KERNELBASE.dll`、异常码 `0xe06d7363`），`Apple Application Support` 一整套组件根本没落地，`Apple Mobile Device Service` 一直停在 Stopped。商店那个 Apple Devices 就够。

> 检查是否认出来了：设备管理器里应该出现 `Apple iPhone`。没有的话插件也没辙 —— 这是驱动层的事，插件没有权限替你装。

### 开开发者模式

iPhone 上：设置 → 隐私与安全性 → 开发者模式。

如果**根本看不到这一项**（正常，默认是隐藏的），插上线后跑一次（用插件包里那个 exe，`ios` 不在 PATH 里）：

```powershell
& "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ios-connect\bin\ios.exe" devmode reveal
```

然后回去就能看到了。打开，手机会重启，重启后确认一次。

### 装 WebDriverAgent

这是「手」。没有它，插件只能看不能动。

**ipa 随插件一起来了**，不用单独下 —— 装好插件后它在：

```
%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-ios-connect\wda\WebDriverAgent.ipa
```

插件面板上会直接把这个路径显示出来，签名工具里选它就行。

签名工具二选一：

- [iloader](https://github.com/nab138/iloader) — 现在能用，免费账号 7 天
- [Sideloadly](https://sideloadly.io/) — 备选

两个插件都不替你装（装它们要 UAC 提权，也涉及第三方软件的再分发）。但 iloader 不在的话，面板上有一个**「下载 iloader 安装包」**按钮：点它，安装包下到你的「下载」文件夹，双击装，装完回来点连接。

签名要你的 Apple ID 和一个验证码 —— 这一步只能你自己来。装完去 设置 → 通用 → VPN 与设备管理 → 点你的 Apple ID → 信任。

> **7 天到期**。到期后 App 打不开、插件报「没找到 WebDriverAgent」，重签一遍就好，不用重装插件。

---

## 3. 用

右侧栏会多一个 **iPhone** 标签。点「连接」，等十几秒，手机画面就上来了。
面板上只有一个按钮和一个状态灯，**画面是只读的** —— 点它不会碰到手机。这是故意的，侧栏太窄，误触代价太大。要操作手机，让 agent 去点。

连不上先别急着翻这篇文档 —— 去 DSH 的插件设置页，点进 `dsh-ios-connect`，最上面那张**「环境检查」**卡片会把还缺什么一条条列出来，缺的那条底下写着现在该干什么。这张卡片就是这篇 README 的浓缩版，随时能点「重查」。

### 给 agent 的工具

| 工具 | 干什么 |
|---|---|
| `phone_status` | 链路通不通、UDID、WDA 包名、卡在哪一步 |
| `phone_start` | 拉起整条链路（隧道 + WDA + 端口转发） |
| `phone_screenshot` | 截图落盘，返回路径和屏幕尺寸 |
| `phone_tap` | 点一点 |
| `phone_swipe` | 滑一段 |
| `phone_type` | 打字 |
| `phone_ui` | 读控件树（XML），每个控件带名字和坐标 |
| `phone_find` | 按文字找控件，直接给能点的坐标 |
| `phone_wait` | 等某段文字出现，或等画面稳定 |
| `phone_launch` | 按包名直接开 App（比在桌面找图标稳） |
| `phone_home` | 回桌面 |
| `phone_unlock` | 点亮 + 上滑 + 输密码（密码用 `DSH_IOS_PASSCODE` 给，见下） |

后面五个是为了少走弯路：`phone_find` 和 `phone_wait` 能省掉一大堆「操作完再截一张图看看」。不装它们也能用，只是慢。

### 一个必须知道的坑：坐标是 point，不是像素

截图是 828×1792，但 WDA 要的坐标是 414×896。**差 2 倍。** 插件的 `phone_screenshot` 会把 point 尺寸一起返回，照着那个算。

直接拿截图像素去点，会点偏一倍，而且偏得很稳定 —— 这种错误第一眼很像「点错了」，其实是单位。

---

## 配置

配置不在插件目录里，在用户目录：

```
~/.dsh-ios-connect/config.json    普通配置
~/.dsh-ios-connect/.env           锁屏密码（只有这一项）
```

放用户目录是因为插件装在 `node_modules` 下，升级时整包重建，写在里面会跟着丢掉。

`config.json` 一般不用动：

```json
{
  "iosPath": "",
  "udid": "",
  "bundleId": "",
  "wdaPort": 8100,
  "mjpegPort": 9100,
  "dataDir": "",
  "autoDownload": true,
  "streamScale": 50,
  "streamQuality": 65,
  "streamFps": 20
}
```

`iosPath` 留空就自己找（插件下 `bin/` → `.runtime/bin/` → PATH → SideTap 装的位置）；包里那份在就永远用不到下载（`autoDownload: false` 可关）。`bundleId` 留空就在启动时现查 —— **建议留空**，重签之后包名会变，写死了下次就报错。

后三个是画面的清晰度和流畅度，启动链路时自动设给手机：

- `streamScale`：出多大。100 是手机原尺寸（828 宽），50 是一半（414 宽）。侧栏就那么宽，让手机直接按 414 出图比出 828 再让浏览器缩小清楚得多 —— **那一缩就是画面发糊的原因**。
- `streamQuality`：单帧压多狠，1-100。
- `streamFps`：帧率上限。默认 20，实测能跑到 18.9。

调到 50/65/20 时带宽和默认的 828 宽基本一样，帧率从 9.6 涨到 18.9。侧栏拉宽了可以试试 `streamScale: 75`。

### 锁屏密码

在**插件设置页**的「锁屏密码」卡片里填一次就行，不用碰文件。填了之后智能体能替你解锁、点开 App；没填就只点亮屏幕上滑。

密码落在 `~/.dsh-ios-connect/.env` 的 `DSH_IOS_PASSCODE` 一行：

- 不在插件目录里，npm 升级不会带走；
- 不进 git，也不进 npm 包；
- 接口永远不回传密码，只回 `hasPasscode` 是 true 还是 false —— 所以卡片上只可能显示「已设置」；
- 以前写在 `config.json` 里的密码，保存时会被挪进 `.env` 并从 `config.json` 删掉。

### 环境变量（优先级高于两个文件）

| 变量 | 顶掉的字段 |
|---|---|
| `DSH_IOS_PATH` | `iosPath` |
| `DSH_IOS_UDID` | `udid` |
| `DSH_IOS_BUNDLE_ID` | `bundleId` |
| `DSH_IOS_PASSCODE` | `passcode` |
| `DSH_IOS_DATA_DIR` | `dataDir` |

读配置的顺序是 `config.json` → `.env` → 进程环境变量，后面的盖前面的。想完全不落盘，就用环境变量给密码。

---

## 卡住了看这里

| 现象 | 大概是 |
|---|---|
| 面板一直「正在找手机」 | 线没插好，或者手机上没点信任 |
| 「正在下载 go-ios 40%」卡住 | 三个源都慢。等下，或者手动把 `ios.exe` 丢进 `.runtime/bin/` |
| 「没找到 go-ios」 | 包里的 `bin/ios.exe` 被裁掉了、自动下载也关了：手动放一份到 `.runtime/bin/`，或在 `config.json` 里写 `iosPath` |
| 「没找到 WebDriverAgent」 | ipa 没装、装了没信任证书、或者 7 天签名到期了。面板上会显示 ipa 的完整路径 |
| 「挂开发者镜像失败」 | 报错原文会贴在面板上。说 x509 的，是这台机器缺 Apple 根证书 —— 装个 Python 3 插件会自己换条路 |
| 画面黑着不出来 | 端口 9100 被占了，改 `mjpegPort` |
| WDA 起来了但连不上 | 手机上锁着屏，或者证书没信任 |

想关掉自动下载，`config.json` 里 `"autoDownload": false`。包里的 `bin/ios.exe` 在就不需要它。

日志在 DSH 的终端里，搜 `dsh-ios-connect`。

---

## 关于三个二进制

**go-ios**（`bin/ios.exe`，23 MB）来自 [danielpaulus/go-ios](https://github.com/danielpaulus/go-ios)（MIT），**随包分发**，版本钉死在 v1.3.2。装插件时就下好了，不占用额外下载步骤。

它有个保底：插件每次启动会跑一次 `ios version` 验活；`.runtime/bin/` 里那份跑不起来会删掉重下。包里的那份缺失时（比如用了私有源裁掉了二进制），会按顺序试直连 GitHub、`ghfast.top`、`gh-proxy.com` 三个源自动补。想自己指定，设 `DSH_IOS_PATH` 或在 `config.json` 写 `iosPath`。

**WebDriverAgent**（`wda/WebDriverAgent.ipa`，700 KB）来自 [appium/WebDriverAgent](https://github.com/appium/WebDriverAgent)，许可 **BSD 3-Clause**（不是 Apache）。插件对它的改动只有一处：官方 release 给的 zip 里少一层 `Payload/`，不是合法的 ipa，重新打了一次包，二进制一点没动。

**开发者镜像（DDI）**不能预先打包 —— 它跟机型 iOS 版本绑定，运行时从苹果服务器下。先 `ios image auto`，撞上 `x509: certificate signed by unknown authority` 就改用 `pymobiledevice3`（那时才按需建 venv 装它，正常机器一辈子用不上）。

三个的完整许可见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。

签名工具不在这个插件里，也不打算做进来。苹果封 anisette 服务封了好几轮了（2026-10 那轮直接把 Sideloadly 和 AltStore 一起打下线过），谁把签名做进插件，谁就得跟着一起坏。分开反而稳：签名工具换三代，插件不用动。

---

## 许可

Apache-2.0