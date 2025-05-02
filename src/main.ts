import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import { applyRoot, getDB, getDBPath, getRoot } from './db';
import { Operations } from './operations';
import {
  classifyHSL,
  ColorClass,
  getColorClassName,
  getDominantColor,
  rgbToHSL,
  sleep
} from './utils';

function restartLaunchpad() {
  child_process.spawnSync('killall', ['Dock']);
}

async function resetLaunchpad() {
  fs.unlinkSync(getDBPath());
  restartLaunchpad();
  await sleep(500);
  restartLaunchpad();
}

async function main() {
  const db = getDB();
  const root = getRoot(db);

  const colorClassMap: Record<number, ColorClass> = {};
  for (const image of db.imageCaches) {
    const miniImage = db.imageCacheMap[image.item_id].image_data_mini.buffer;
    const rgb = await getDominantColor(miniImage as ArrayBuffer);
    const hsl = rgbToHSL(rgb);
    colorClassMap[image.item_id] = classifyHSL(hsl);
  }

  const newRoot = Operations.from(root)
    .groupBy(app => getColorClassName(colorClassMap[app.id]))
    .sorted()
    // .flatted()
    .root;
  applyRoot(newRoot);
  restartLaunchpad();
}

if (require.main === module) {
  main().catch(console.error);
  // TODO
  // 检查是否有downloading
  // 检查是否有未识别的字段
}