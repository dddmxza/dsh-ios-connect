# 第三方组件声明

本插件（dsh-ios-connect）自己写的代码是 Apache-2.0。包里另外带了两个**别人的**二进制，各自的许可如下。

---

## 1. go-ios —— `bin/ios.exe`

- 项目：https://github.com/danielpaulus/go-ios
- 版本：v1.3.2（Windows x64，23691264 字节）
- 许可：MIT

MIT License

Copyright (c) 2019 danielpaulus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 2. WebDriverAgent —— `wda/WebDriverAgent.ipa`

- 上游：https://github.com/appium/WebDriverAgent（来自 Facebook 的 WebDriverAgent）
- 版本：v16.15.3
- 许可：BSD 3-Clause
- 改动说明：官方 release 提供的是 `WebDriverAgentRunner-Runner.zip`，里面缺一层 `Payload/` 目录，不是合法 ipa。本插件只做了一件事 —— 把内容加 `Payload/` 前缀重新打成一个 ipa，**没有改动任何二进制内容**，也没改 Info.plist。

BSD License

For WebDriverAgent software

Copyright (c) 2015-present, Facebook, Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

 * Neither the name Facebook nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

## 3. 不随包分发的东西

- **iloader**（签名工具，nabdev）—— 没有可查的再分发许可，插件只检测它在不在，不在就给官方下载链接，由用户自己下、自己装。
- **Apple 驱动 / Apple Devices** —— 苹果的，只能从微软应用商店装。
- **开发者镜像（DDI）** —— 运行时从苹果服务器下，跟机型 iOS 版本绑定，不能预先打包。
