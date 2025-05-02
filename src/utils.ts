import sharp from 'sharp';

export function assert(cond: Boolean, log: string) {
  if (!cond) {
    throw Error(log);
  }
}

export function deepClone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

export function associateWith<T extends Record<string, any>, K extends keyof T>(arr: T[], key: K): Record<string, T> {
  return Object.fromEntries(arr.map(item => [item[key], item]));
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取图片的主色调
 */
export async function getDominantColor(imageData: ArrayBuffer) {
  // 将图片缩小到1x1像素来获取主色调
  const data = await sharp(imageData)
    .resize(1, 1)
    .raw()
    .toBuffer();
  return [data[0], data[1], data[2]] as [number, number, number]; // 返回RGB值
}

/**
 * 将RGB颜色值转换为HSL颜色空间
 * @param rgb RGB颜色值，数组形式 [r, g, b]，范围 0-255
 * @returns HSL颜色值，数组形式 [h, s, l]，h范围 0-360，s和l范围 0-100
 */
export function rgbToHSL(rgb: [number, number, number]): [number, number, number] {
  // 将RGB值归一化到0-1范围
  let [r, g, b] = rgb.map(v => v / 255);

  // 计算最大值和最小值
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  // 计算亮度 (Lightness)
  let h = 0, s = 0, l = (max + min) / 2;

  // 如果颜色不是灰度色（max !== min）
  if (max !== min) {
    const delta = max - min;

    // 计算饱和度 (Saturation)
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    // 计算色相 (Hue)
    switch (max) {
      case r:
        h = (g - b) / delta + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      case b:
        h = (r - g) / delta + 4;
        break;
    }
    h *= 60;
  }

  // 将饱和度和亮度转换为百分比（0-100）
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  // 确保色相在0-360度范围内
  h = Math.round(h % 360);

  return [h, s, l];
}

/**
 * 基于 HSL 对颜色进行分类
 * @param hsl HSL颜色值，数组形式 [h, s, l]，h范围 0-360，s和l范围 0-100
 */
export function classifyHSL(hsl: [number, number, number])
  : 'gray' | 'white' | 'orange-red' | 'blue' | 'yellow-green' {
  const [h, s, l] = hsl;

  // 1. 先判断无彩色（灰色/白色）
  if (s < 15) {
    return l > 85 ? 'white' : 'gray';
  }

  // 2. 判断有彩色
  if (h >= 0 && h < 40) return 'orange-red';    // 红-橙黄
  if (h >= 40 && h < 180) return 'yellow-green';  // 黄-绿-青
  if (h >= 180 && h < 300) return 'blue';   // 青-蓝-紫
  return 'orange-red';                          // 紫红-红
}