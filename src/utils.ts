import sharp from 'sharp';
import { LaunchpadDB } from './main';

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

export function groupBy<T extends Record<string, any>, K extends keyof T>(arr: T[], key: K): Record<T[K], T[]> {
  const groups = {} as Record<T[K], T[]>;
  for (const item of arr) {
    const k = item[key];
    if (groups[k]) {
      groups[k].push(item);
    } else {
      groups[k] = [item];
    }
  }
  return groups;
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

export type ColorClass = 'gray' | 'white' | 'orange-red' | 'blue' | 'yellow-green';

export function getColorClassName(klass: ColorClass): string {
  return ({
    'gray': '灰色系',
    'white': '白色系',
    'orange-red': '橙红色系',
    'blue': '蓝色系',
    'yellow-green': '黄绿色系'
  })[klass];
}

/**
 * 基于 HSL 对颜色进行分类
 * @param hsl HSL颜色值，数组形式 [h, s, l]，h范围 0-360，s和l范围 0-100
 */
export function classifyHSL(hsl: [number, number, number]): ColorClass {
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

export async function writeIconsHtml(db: LaunchpadDB) {
  let s = '';
  const groups: Record<
    string,
    {
      name: string;
      hsl: [number, number, number];
      image: ArrayBuffer
    }[]
  > = {};
  for (const app of db.apps) {
    const miniImage = db.imageCacheMap[app.item_id].image_data_mini.buffer;
    const image = db.imageCacheMap[app.item_id].image_data_mini.buffer as ArrayBuffer;
    const rgb = await getDominantColor(miniImage as ArrayBuffer);
    const hsl = rgbToHSL(rgb);
    const class_ = classifyHSL(hsl);
    const result = {
      name: app.title,
      hsl,
      image
    };
    if (groups[class_]) {
      groups[class_].push(result);
    } else {
      groups[class_] = [result];
    }
  }
  for (const [class_, group] of Object.entries(groups)) {
    // language=html
    s += `
        <div class="list"><p>${class_}</p>`;
    for (const { image, name, hsl } of group) {
      // language=html
      s += `
          <div class="item">
              <img class="image" src="data:image/png;base64,${Buffer.from(image).toString('base64')}"
                   alt="${name}"/>
              <div class="block" style="background: hsl(${hsl[0]} ${hsl[1]} ${hsl[2]})"></div>
          </div>
      `;
    }
    s += '</div>';
  }
  // language=html
  return `
      <meta charset="utf-8">
      <html lang="zh">
      <head>
          <style>
              .list {
                  display: flex;
                  flex-direction: row;
                  flex-wrap: wrap;
                  justify-content: flex-start;
                  align-items: flex-start;
                  gap: 16px;
                  margin-top: 30px;
              }

              .item {
                  display: flex;
                  flex-direction: row;
                  justify-content: flex-start;
                  align-items: center;
                  gap: 8px;
              }

              .image {
                  width: 50px;
                  height: 50px;
              }

              .block {
                  width: 50px;
                  height: 50px;
              }
          </style>
      </head>
      <body>
      ${s}
      </body>
      </html>
  `;
}