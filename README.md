# dsh-ios-connect

将 USB 连接的 iPhone 接入 DeepSeek Harness。右侧栏显示设备实时画面，agent 可在该画面上执行点击、滑动与文本输入。

适用范围为 Windows + USB。macOS 未验证；go-ios 提供 darwin 构建，理论上可用。

---

## 能力

设备端可完成的操作，插件均提供对应工具：

- **启动应用** —— 按 bundle id 直接启动，无需在桌面翻页查找图标
- **读取屏幕** —— 截图落盘，或读取控件树（含每个控件的名称与坐标）
- **手势** —— 点击、长按、滑动、滚动、左边缘返回
- **输入** —— 向当前聚焦的输入框写入文本，中英文均可
- **等待** —— 等待指定文本出现或画面稳定后再执行下一步，避免额外的截图确认
- **解锁** —— 配置锁屏密码后自动点亮屏幕、上滑、逐位输入密码

典型用法：

> 打开小红书，进入第一条笔记，点赞。

agent 自行完成启动应用、截图、定位坐标、点击、复核计数由 562 变为 563 的全过程。

## 不支持的能力

以下操作受 iOS 系统限制，插件未提供：

- 面容 ID 与触控 ID 确认（支付、iCloud 授权等）
- 锁屏状态下的应用操作
- 需要用户手动确认的系统授权弹窗

上述限制来自操作系统，插件无法绕过。

---

## 背景

在 Windows 上通过 AI 控制实体 iPhone，点击本身不是难点，耗时的是点击之前的链路准备：

| 环节 | 无插件时的工作 |
|---|---|
| 获取 go-ios | 从 GitHub releases 下载 zip，网络受限时另需代理 |
| 挂载开发者镜像 | iOS 17 起必须挂载 DDI。go-ios 会停在 `x509: certificate signed by unknown authority`，其证书校验不读取 Windows 证书库，需改用 pymobiledevice3 |
| 建立隧道 | 端口冲突、后台运行、断线重连均需自行处理 |
| 查询 WebDriverAgent 包名 | 每次重签后包名变化，写死在配置里会导致下次连接失败 |
| 端口转发 | 8100 与 9100 两个端口 |
| 断线恢复 | 设备休眠、拔线、WDA 崩溃均需自行检测 |

任一环节中断，表现为同一个现象：无响应。故障点需自行排查。

插件接管上述全部环节。以下三项必须由使用者本人完成，均要求人与 Apple ID 到场：

1. USB 连接，并在设备上确认「信任」
2. 开启开发者模式（一次性操作，设备会重启）
3. 使用个人 Apple ID 为 WebDriverAgent 签名（免费证书 7 天有效，到期后重新签名）

其余环节由插件处理。包内已包含 go-ios 与 WebDriverAgent，无需额外下载。

---

## 1. 安装

```powershell
dsh plugin --profile desktop add dsh-ios-connect
```

该命令转发至 pnpm，将包安装进 desktop profile。

安装后需在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 数组中追加 `"dsh-ios-connect"`；否则包已存在，但 DSH 不会加载它。随后重启 DSH。

`dsh` 不在 PATH 时，等价写法为进入 profile 目录执行 pnpm：

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add dsh-ios-connect
```

包内包含 `bin/ios.exe`（go-ios）与 `wda/WebDriverAgent.ipa`，后续步骤所需的两个二进制随包分发。

---

## 2. 准备 iPhone

### 驱动

安装 **Apple Devices**（Microsoft Store，免费）。

安装后连接 USB，设备弹出「要信任此电脑吗」，确认并输入密码。

iTunes 不作推荐：2026-10 版 `iTunes64Setup.exe` 实测安装后启动即崩溃（`KERNELBASE.dll`，异常码 `0xe06d7363`），`Apple Application Support` 组件未落地，`Apple Mobile Device Service` 停留在 Stopped 状态。Microsoft Store 版 Apple Devices 可满足需求。

识别结果可在设备管理器中确认，正常应出现 `Apple iPhone`。该条目缺失属于驱动层问题，插件无权代为安装。

### 开发者模式

路径：设置 → 隐私与安全性 → 开发者模式。

该项默认为隐藏状态，连接 USB 后执行一次以下命令使其显示（`ios` 不在 PATH，使用包内可执行文件）：

```powershell
& "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ios-connect\bin\ios.exe" devmode reveal
```

返回设置后该项可见。开启后设备重启，重启完成后再确认一次。

### 安装 WebDriverAgent

WebDriverAgent 承担全部输入操作。未安装时插件只能读取屏幕。

ipa 随插件分发，安装后的位置：

```
%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-ios-connect\wda\WebDriverAgent.ipa
```

插件面板会直接显示该路径，签名工具中选择它即可。

签名工具：

- [iloader](https://github.com/nab138/iloader) —— 当前可用，免费账号 7 天
- [Sideloadly](https://sideloadly.io/) —— 备选

插件不代为安装签名工具：安装过程需要 UAC 提权，且涉及第三方软件再分发。iloader 不存在时，面板提供「下载 iloader 安装包」按钮，安装包下载至「下载」文件夹，手动安装后返回面板点击连接。

签名需要 Apple ID 与验证码，只能由使用者本人完成。安装完成后前往 设置 → 通用 → VPN 与设备管理 → Apple ID → 信任。

签名有效期为 7 天。到期后 App 无法启动，插件报「没找到 WebDriverAgent」，重新签名即可，无需重装插件。

---

## 3. 使用

右侧栏出现 **iPhone** 标签。点击「连接」，等待十余秒后设备画面显示。

面板只包含一个按钮与一个状态灯，**画面为只读**，点击不会作用于设备。侧栏宽度有限，误触代价较高，因此做此限制；操作设备应通过 agent 完成。

连接失败时，优先查看 DSH 插件设置页中 `dsh-ios-connect` 顶部的**「环境检查」**卡片。该卡片逐条列出缺失项及当前应执行的动作，并支持「重查」。其内容为本 README 的浓缩版本。

### 提供给 agent 的工具

| 工具 | 功能 |
|---|---|
| `phone_status` | 链路状态、UDID、WDA 包名、当前阻塞点 |
| `phone_start` | 启动整条链路（隧道 + WDA + 端口转发） |
| `phone_screenshot` | 截图落盘，返回路径与屏幕尺寸 |
| `phone_tap` | 点击 |
| `phone_swipe` | 滑动一段距离 |
| `phone_back` | 从左边缘右滑返回，纵向位置可调 |
| `phone_type` | 文本输入 |
| `phone_ui` | 读取控件树（XML），每个控件带名称与坐标 |
| `phone_find` | 按文本查找控件，直接返回可点击坐标 |
| `phone_wait` | 等待指定文本出现，或等待画面稳定 |
| `phone_launch` | 按 bundle id 启动应用，比在桌面查找图标稳定 |
| `phone_home` | 返回桌面 |
| `phone_unlock` | 点亮、上滑、输入密码（密码通过 `DSH_IOS_PASSCODE` 提供，见下） |
| `phone_batch` | 一次执行已知步骤序列（点击、滑动、输入、启动、等待），失败即停并报告执行到第几步 |

`phone_find`、`phone_back`、`phone_wait`、`phone_launch`、`phone_home` 用于减少往返：前两者省去坐标计算与截图确认，`phone_wait` 省去操作后的截图复核，后两者等待前台应用就绪后才返回。

### phone_batch

单步调用的开销主要来自每次「agent → 宿主 → 插件 → WDA → 返回」的往返，而非设备端动作本身。设备端点击约 680ms、控件树读取约 970ms，步骤增多后往返耗时会超过动作耗时。

`phone_batch` 将多次往返压缩为一次：提交步骤清单，按顺序执行完毕后返回。

```json
{"steps": [
  {"op": "home"},
  {"op": "launch", "bundleId": "com.tencent.xin"},
  {"op": "wait"},
  {"op": "tapText", "text": "某个会话"},
  {"op": "tap", "x": 187, "y": 829},
  {"op": "type", "text": "在忙，晚点回"},
  {"op": "tapText", "text": "发送"}
]}
```

支持八种动作：`tap`、`tapText`、`swipe`、`type`、`launch`、`home`、`wait`、`sleep`。可选参数两项：`settleMs`（每步之后的间隔，默认 250）与 `stopOnError`（默认 true）。

三条设计取舍：

- **执行前校验全部 `op` 名称。** 任一项拼写错误则整张清单不执行，避免执行至中途才失败、已发出的点击无法撤回。
- **单步失败即停。** 返回包含 `failedAt` 与 `log`，可定位失败步骤与原因。
- **不中途改写计划。** 清单提交后不再调整；执行中出现弹窗、插屏广告、加载未完成均按原步骤继续。因此只将确定不会出现分支的步骤串联，需要判断的位置应断开，由 agent 读取页面后再决定。

实测：同一任务（回桌面 → 启动微信 → 进入会话 → 输入一行文本 → 发送）分步调用 8 次耗时 97.7 秒，`phone_batch` 一次耗时 15.3 秒。

### 坐标单位

截图为 828×1792，WDA 接受的坐标为 414×896，相差 2 倍。`phone_screenshot` 会同时返回 point 尺寸，坐标按该尺寸计算。

以截图像素坐标执行点击，偏移比例约为 2 倍，且偏移稳定，容易被误判为元素定位错误。

---

## 配置

配置位于用户目录，不在插件目录内：

```
~/.dsh-ios-connect/config.json    普通配置
~/.dsh-ios-connect/.env           锁屏密码（仅此项）
```

插件安装在 `node_modules` 下，升级时整包重建，配置写入包内会随之丢失。

`config.json` 通常无需修改：

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

`iosPath` 留空时按以下顺序查找：插件下 `bin/` → `.runtime/bin/` → PATH → SideTap 安装位置。包内文件存在时不会触发下载（`autoDownload: false` 可关闭）。

`bundleId` 建议留空，启动时现查：重新签名后包名会变化，写死将导致下次连接报错。

后三项为画面参数，启动链路时自动下发至设备：

- `streamScale` —— 输出尺寸。100 为设备原尺寸（828 宽），50 为一半（414 宽）。侧栏宽度固定，由设备直接输出 414 宽比输出 828 宽再经浏览器缩放更清晰，后者是画面发糊的原因。
- `streamQuality` —— 单帧压缩质量，1-100。
- `streamFps` —— 帧率上限，默认 20。

50/65/20 下带宽与默认 828 宽基本持平，帧率由 9.6 提升至 18.9。侧栏拉宽后可尝试 `streamScale: 75`。

### 锁屏密码

在**插件设置页**的「锁屏密码」卡片中填写一次，无需直接编辑文件。设置后 agent 可执行解锁与启动应用；未设置时仅点亮屏幕并上滑。

密码存放于 `~/.dsh-ios-connect/.env` 的 `DSH_IOS_PASSCODE` 一行：

- 位于用户目录，npm 升级不会清除；
- 不进入 git，不进入 npm 包；
- 接口不返回密码内容，仅返回 `hasPasscode` 真假值，因此卡片只显示「已设置」；
- 此前写入 `config.json` 的密码在保存时迁入 `.env`，并从 `config.json` 移除。

### 环境变量

环境变量优先级高于两个配置文件：

| 变量 | 覆盖字段 |
|---|---|
| `DSH_IOS_PATH` | `iosPath` |
| `DSH_IOS_UDID` | `udid` |
| `DSH_IOS_BUNDLE_ID` | `bundleId` |
| `DSH_IOS_PASSCODE` | `passcode` |
| `DSH_IOS_DATA_DIR` | `dataDir` |

读取顺序为 `config.json` → `.env` → 进程环境变量，后者覆盖前者。密码不落盘时，全部通过环境变量提供。

---

## 故障排查

| 现象 | 可能原因 |
|---|---|
| 面板持续显示「正在找手机」 | USB 未连接，或设备未确认信任 |
| 显示「正在下载 go-ios 40%」后停滞 | 三个源均较慢。等待，或将 `ios.exe` 手动放入 `.runtime/bin/` |
| 报「没找到 go-ios」 | 包内 `bin/ios.exe` 被裁剪且自动下载已关闭。手动放置一份至 `.runtime/bin/`，或在 `config.json` 设置 `iosPath` |
| 报「没找到 WebDriverAgent」 | ipa 未安装、证书未信任，或 7 天签名到期。面板会显示 ipa 完整路径 |
| 报「挂开发者镜像失败」 | 报错原文显示在面板。出现 x509 相关错误时为缺少 Apple 根证书，安装 Python 3 后插件会切换处理路径 |
| 画面黑屏 | 端口 9100 被占用，修改 `mjpegPort` |
| WDA 已启动但无法连接 | 设备处于锁屏状态，或证书未信任 |

关闭自动下载：在 `config.json` 中设置 `"autoDownload": false`。包内 `bin/ios.exe` 存在时无需该功能。

日志输出在 DSH 终端，按 `dsh-ios-connect` 搜索。

---

## 第三方组件

**go-ios**（`bin/ios.exe`，23 MB）来自 [danielpaulus/go-ios](https://github.com/danielpaulus/go-ios)（MIT），随包分发，版本固定为 v1.3.2。

每次启动执行一次 `ios version` 校验可用性；`.runtime/bin/` 中的副本无法运行时会被删除并重新下载。包内文件缺失（例如使用裁剪过的私有源）时，依次尝试 GitHub 直连、`ghfast.top`、`gh-proxy.com` 三个源。可通过 `DSH_IOS_PATH` 或 `config.json` 的 `iosPath` 指定。

**WebDriverAgent**（`wda/WebDriverAgent.ipa`，700 KB）来自 [appium/WebDriverAgent](https://github.com/appium/WebDriverAgent)，许可为 **BSD 3-Clause**（非 Apache）。插件对其唯一改动为重新打包：官方 release 提供的 zip 缺少 `Payload/` 层级，不构成合法 ipa，重打包过程未修改二进制。

**开发者镜像（DDI）** 无法预先打包，与机型及 iOS 版本绑定，运行时从 Apple 服务器下载。执行 `ios image auto`；出现 `x509: certificate signed by unknown authority` 时改用 `pymobiledevice3`，按需创建 venv 安装，常规环境不会用到。

完整许可见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。

签名工具不包含在本插件内。Apple 已多轮封禁 anisette 服务（2026-10 一轮导致 Sideloadly 与 AltStore 同时不可用）。将签名功能内置意味着随其一同失效；分离后签名工具可独立替换，插件不受影响。

---

## 许可

Apache-2.0
