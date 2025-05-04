import { applyRoot, buildDominantColorClassMap, getDB, getRoot } from './db';
import { Operations } from './operations';
import { restartLaunchpad } from './utils';

async function main() {
  const db = getDB();
  const root = getRoot(db);
  const colorClassMap = await buildDominantColorClassMap(db);

  // console.log(JSON.stringify(toTinyRoot(root)));
  // tinyToRoot(collectApps(root), JSON.parse(fs.readFileSync('./llm.json').toString()));

  applyRoot((await Operations.from(root).layoutWithAI(db)).root);

  restartLaunchpad();
}

if (require.main === module) {
  main().catch(console.error);
  // TODO
  // 检查是否有downloading
  // 检查是否有未识别的字段
}