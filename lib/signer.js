/**
 * dsh-ios-connect — 签名工具探测。
 *
 * 签名工具（iloader / Sideloadly）是这个插件唯一「不替你装」的东西，理由：
 *   1. iloader 是 MSI，装它要 UAC 提权、往 Program Files 写文件，npm install 没这个权限；
 *   2. 它的版本变得快，钉在包里几个月就废了；
 *   3. 用别人的 Apple ID 签名这件事本身只能人来点。
 *
 * 所以这里只做两件事：查它在不在；不在就替用户把安装包下到「下载」文件夹，
 * 下完让他自己双击。不静默安装，不代替他授权。
 *
 * 注：iloader 的仓库是 nab138/iloader（MIT），不是 nabdev —— MSI 的
 * Manufacturer 字段写的是 nabdev，别被它带偏。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { httpGet } from './deps.js'

/** 用 latest：签名工具的版本不能钉死，旧版会在苹果改协议时直接失效。 */
export const ILOADER_MSI = 'https://github.com/nab138/iloader/releases/latest/download/iloader-windows-x64.msi'
export const ILOADER_PAGE = 'https://github.com/nab138/iloader/releases/latest'

function exists(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 找已经装好的签名工具。找到哪个报哪个，顺序 iloader → Sideloadly。 */
export function findSigner() {
  const cands = [
    { name: 'iloader', paths: [
      'C:\\Program Files\\iloader\\iloader.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'iloader', 'iloader.exe') : '',
    ] },
    { name: 'Sideloadly', paths: [
      'C:\\Program Files\\Sideloadly\\sideloadly.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Sideloadly', 'sideloadly.exe') : '',
    ] },
  ]
  for (const c of cands) {
    for (const p of c.paths) {
      if (p && exists(p)) return { name: c.name, path: p, installed: true }
    }
  }
  return { name: '', path: '', installed: false }
}

/** 随包带的 WDA 安装包。 */
export function ipaPath(pluginRoot) {
  return path.join(pluginRoot, 'wda', 'WebDriverAgent.ipa')
}

/** 下载目录。中文系统上名字可能是「下载」，两个都试。 */
function downloadDir() {
  const home = os.homedir()
  const cands = [path.join(home, 'Downloads'), path.join(home, '下载'), home]
  for (const c of cands) {
    try {
      if (fs.statSync(c).isDirectory()) return c
    } catch {}
  }
  return home
}

/**
 * 把 iloader 安装包下到下载目录。不执行、不提权。
 * @returns {Promise<{ok:boolean, file?:string, bytes?:number, message?:string}>}
 */
export async function downloadIloader({ onProgress } = {}) {
  const dir = downloadDir()
  const file = path.join(dir, 'iloader-windows-x64.msi')
  let buf
  try {
    buf = await httpGet(ILOADER_MSI, { onProgress, timeoutMs: 300000 })
  } catch (e) {
    return {
      ok: false,
      message: `下载 iloader 失败：${e.message}。可以自己去 ${ILOADER_PAGE} 下。`,
    }
  }
  // MSI 是 OLE 复合文档，头 8 字节固定。对不上就别往用户磁盘上放垃圾。
  const magic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  if (buf.length < 8 || !buf.subarray(0, 8).equals(magic)) {
    return { ok: false, message: `下回来的不是 MSI（${buf.length} 字节）。去 ${ILOADER_PAGE} 手动下。` }
  }
  try {
    fs.writeFileSync(file, buf)
  } catch (e) {
    return { ok: false, message: `写不进下载目录：${e.message}` }
  }
  return {
    ok: true,
    file,
    bytes: buf.length,
    message: `已经下到 ${file}。双击它装，装完回来点连接。`,
  }
}
