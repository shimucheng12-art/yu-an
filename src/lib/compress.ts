'use client'

/**
 * 上传前客户端图片压缩（云端版专用）：
 * - 目标：绕开 serverless 平台 4MB 请求体限制，同时节省数据库空间
 * - 策略：最长边缩到 1600px、JPEG 质量 0.85；越压越小直到低于上限
 * - 非图片或压缩失败时原样返回
 */
import type { ChangeEvent } from 'react'

const MAX_EDGE = 1600
const MIN_QUALITY = 0.5
const TARGET_BYTES = 1.2 * 1024 * 1024 // 目标 1.2MB，给表单编码留余量

export async function compressImageIfNeeded(
  event: ChangeEvent<HTMLInputElement>
): Promise<File | null> {
  const file = event.target.files?.[0]
  event.target.value = '' // 允许重复选择同一文件
  if (!file) return null
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file // 非图片 / 动图不压缩
  }
  if (file.size <= TARGET_BYTES) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    let quality = 0.85
    let blob = await canvasToJpeg(canvas, quality)
    // 仍超目标大小时继续降质量（下限 0.5），一般两轮内可收敛
    while (blob && blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
      quality -= 0.15
      blob = await canvasToJpeg(canvas, quality)
    }
    if (!blob || blob.size >= file.size) return file // 压不出更小就传原图

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${baseName.slice(0, 100)}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch {
    return file
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality))
}
