import { getLayoutResult } from './ai';
import { applyRoot, getRoot } from './db';
import { getInput, restartLaunchpad } from './utils';

async function main() {
  // '按照应用类别，将应用分为开发者工具、系统工具、社交、网络、影音、游戏、其他几个类别，并将每个类别放到第一页的各自的文件夹里面',
  // '按照应用类别，将应用分为开发者工具、系统工具、社交、网络、影音、游戏、其他几个类别，并将每个类别平铺并放到单独的Page中，不要建立文件夹',
  // '按照应用类别，将应用分为开发者工具、系统工具等类别，并将每个类别放到第一页的各自的文件夹里面',
  // '按照应用类别将每个类别平铺并放到单独的Page中，不要建立文件夹',
  // '将应用按照图标主题色分类'
  // '将Mac自带的应用放到单独一个useless的文件夹中，其他的平铺到第一页'
  // '平铺所有应用，别漏掉任何应用'
  // '所有应用放到一个文件夹中'
  while (true) {
    let prompt = await getInput('>> ');
    if (prompt === null) {
      break;
    }
    prompt = prompt.trim();
    if (!prompt) {
      continue;
    }
    const root = getRoot();
    const newRoot = await getLayoutResult(root, prompt);
    if (!newRoot) {
      console.error('AI布局失败，请检查日志');
      break;
    }
    applyRoot(newRoot!);
    restartLaunchpad();
  }
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