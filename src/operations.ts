import pinyin from 'pinyin';
import { getLayoutResult } from './ai';
import { App, getRoot, Group, Item, LaunchpadDB, RootGroup, walkGroup } from './db';
import { tinyToRoot, toTinyRoot } from './tiny';
import { assert, deepClone, groupBy } from './utils';

export function collectApps(group: Group) {
  const apps: App[] = [];
  walkGroup(group, item => {
    if (item.kind === 'app') {
      apps.push(item);
    }
  });
  return apps;
}

export class Operations {
  private constructor(public root: RootGroup) {
  }

  static from(root: RootGroup, clone = true): Operations {
    return new Operations(clone ? deepClone(root) : root);
  }

  private getApps(): App[] {
    return collectApps(this.root);
  }

  /**
   * 将所有的图标平铺
   *
   * Note. 所有的Page也会被合并
   */
  flatted(): Operations {
    return Operations.from({
      id: 1,
      kind: 'group',
      name: null,
      children: [{
        kind: 'group',
        id: 0,
        name: null,
        children: this.getApps()
      }]
    });
  }

  /**
   * 排序每个Group
   * @param key 排序规则，默认为字典顺序（中文为拼音）
   */
  sorted(key?: (a: Item, b: Item) => number): Operations {
    key = (a, b) => {
      const [nameA, nameB] = [a, b]
        .map(item => item.name ?? '')
        .map(name => pinyin(name).map(p => p[0]).join(''));
      return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
    };
    const root = deepClone(this.root);
    root.children.sort(key);
    walkGroup(root, item => {
      if (item.kind === 'group') {
        item.children.sort(key);
      }
    });
    return Operations.from(root, false);
  }

  groupedBy(grouper: (app: App) => string, groupType: 'page' | 'folder' = 'folder'): Operations {
    const apps = this.getApps();
    const grouped = groupBy(apps.map(app => [app, grouper(app)] as const), '1');
    const groups: Group[] = [];
    for (const [group, apps_] of Object.entries(grouped)) {
      const apps = apps_.map(a => a[0]);
      groups.push({
        id: 0,
        kind: 'group',
        name: group,
        children: apps,
      });
    }
    return Operations.from({
      id: 1,
      kind: 'group',
      name: null,
      children: groupType === 'folder'
        ? [{
          id: 0,
          kind: 'group',
          name: null,
          children: groups
        }]
        : groups
    });
  }

  // TODO 循环检测输出，不断矫正问题，例如App变多或变少
  async layoutWithAI(db: LaunchpadDB, prompt: string): Promise<Operations> {
    const root = getRoot(db);
    const newRoot = await getLayoutResult(
      toTinyRoot(root),
      prompt
      // '按照应用类别，将应用分为开发者工具、系统工具、社交、网络、影音、游戏、其他几个类别，并将每个类别放到第一页的各自的文件夹里面',
      // '按照应用类别，将应用分为开发者工具、系统工具、社交、网络、影音、游戏、其他几个类别，并将每个类别平铺并放到单独的Page中，不要建立文件夹',
      // '按照应用类别，将应用分为开发者工具、系统工具等类别，并将每个类别放到第一页的各自的文件夹里面',
      // '按照应用类别将每个类别平铺并放到单独的Page中，不要建立文件夹',
      // '将应用按照图标主题色分类'
      // '将Mac自带的应用放到单独一个useless的文件夹中，其他的平铺到第一页'
      // '平铺所有应用，别漏掉任何应用'
      // '所有应用放到一个文件夹中'
    );
    assert(Boolean(newRoot));
    return Operations.from(tinyToRoot(collectApps(root), newRoot!));
  }
}