import { applyRoot, buildDominantColorClassMap, getDB, getRoot } from './db';
import { Operations } from './operations';
import { getInput, restartLaunchpad } from './utils';

async function main() {
  const db = getDB();
  const root = getRoot(db);
  const colorClassMap = await buildDominantColorClassMap(db);

  // console.log(JSON.stringify(toTinyRoot(root)));
  // tinyToRoot(collectApps(root), JSON.parse(fs.readFileSync('./llm.json').toString()));

  const input = await getInput('>> ');
  applyRoot((await Operations.from(root).layoutWithAI(db, input)).root);

  restartLaunchpad();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(-1);
    });
  // TODO
  // 检查是否有downloading
  // 检查是否有未识别的字段
}