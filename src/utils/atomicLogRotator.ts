/**
 * 🛡️ [HIGH-AVAILABILITY ATOMIC PERSISTENCE & LOG ROTATOR]
 * 金融级无阻塞原子落盘与非阻塞日志轮转器
 */

import fs from 'fs';
import path from 'path';

/**
 * 原子 JSON 文件写入 (写入 .tmp -> fsyncSync 物理刷盘 -> renameSync 替换)
 * 具有磁盘崩溃/断电防护与临时文件自动清理
 */
export function atomicWriteJsonSync<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
  let fd: number | null = null;

  try {
    const content = JSON.stringify(data, null, 2);
    fd = fs.openSync(tmpPath, 'w');
    fs.writeFileSync(fd, content, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
    console.error(`❌ [Atomic Write Failure] Failed to write ${filePath}:`, err);
  }
}

/**
 * 安全读取 JSON 文件，若文件损坏自动回滚至 fallback 并备份坏文件
 */
export function safeReadJsonSync<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      if (!raw || raw.trim() === '') return fallback;
      return JSON.parse(raw) as T;
    }
  } catch (err) {
    console.warn(`⚠️ [Json Corrupted] File ${filePath} is corrupted, rolling back to fallback state:`, err);
    try {
      const bakPath = `${filePath}.corrupted.${Date.now()}`;
      fs.renameSync(filePath, bakPath);
    } catch (_) {}
  }
  return fallback;
}

/**
 * 无阻塞金融级日志轮转器 (StreamLogRotator)
 * 单文件上限 5MB，保留最多 5 个历史归档卷 (.log, .log.1, .log.2 ... .log.5)
 */
export class StreamLogRotator {
  private logPath: string;
  private maxSizeBytes: number;
  private maxFiles: number;
  private writeStream: fs.WriteStream | null = null;
  private currentSize: number = 0;

  constructor(logPath: string, maxSizeBytes = 5 * 1024 * 1024, maxFiles = 5) {
    this.logPath = logPath;
    this.maxSizeBytes = maxSizeBytes;
    this.maxFiles = maxFiles;
    this.initStream();
  }

  private initStream(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.logPath)) {
      try {
        const stat = fs.statSync(this.logPath);
        this.currentSize = stat.size;
      } catch (_) {
        this.currentSize = 0;
      }
    } else {
      this.currentSize = 0;
    }

    this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a', encoding: 'utf-8' });
  }

  public write(message: string): void {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const formattedLine = `[${timestamp}] ${message}\n`;
    const byteLength = Buffer.byteLength(formattedLine, 'utf-8');

    if (this.currentSize + byteLength >= this.maxSizeBytes) {
      this.rotate();
    }

    if (this.writeStream) {
      this.writeStream.write(formattedLine);
      this.currentSize += byteLength;
    }
  }

  private rotate(): void {
    try {
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }

      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const src = `${this.logPath}.${i}`;
        const dest = `${this.logPath}.${i + 1}`;
        if (fs.existsSync(src)) {
          if (i + 1 > this.maxFiles) {
            fs.unlinkSync(src);
          } else {
            fs.renameSync(src, dest);
          }
        }
      }

      if (fs.existsSync(this.logPath)) {
        fs.renameSync(this.logPath, `${this.logPath}.1`);
      }

      this.currentSize = 0;
      this.initStream();
    } catch (err) {
      console.error('❌ Log Rotation Error:', err);
      this.initStream();
    }
  }

  public close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}
