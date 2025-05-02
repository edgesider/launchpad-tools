import { applyRoot, buildDominantColorClassMap, getDB, getRoot } from './db';
import { Operations } from './operations';
import { getColorClassName, restartLaunchpad, sleep } from './utils';

async function main() {
  const db = getDB();
  const root = getRoot(db);
  const colorClassMap = await buildDominantColorClassMap(db);

  const newRoot = Operations.from(root)
    .groupedBy(app => getColorClassName(colorClassMap[app.id]))
    .sorted()
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