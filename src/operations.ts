import pinyin from 'pinyin';
import { getLayoutResult } from './ai';
import { App, getRoot, Page, Item, LaunchpadDB, RootFolder, walkGroup, Group, itemGetName, itemIsGroup } from './db';
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
  private constructor(public root: RootFolder) {
  }

  static from(root: RootFolder, clone = true): Operations {
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
      kind: 'folder',
      name: 'root',
      children: [{
        kind: 'page',
        id: 0,
        children: this.getApps()
      }]
    });
  }

  /**
   * 排序每个Group
   * @param key 排序规则，默认为字典顺序（中文为拼音）
   */
  sorted(key?: (a: Item, b: Item) => number): Operations {
    key ??= (a, b) => {
      const [nameA, nameB] = [a, b]
        .map(item => itemGetName(item) ?? '')
        .map(name => pinyin(name).map(p => p[0]).join(''));
      return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
    };
    const root = deepClone(this.root);
    root.children.sort(key);
    walkGroup(root, item => {
      if (itemIsGroup(item)) {
        item.children.sort(key);
      }
    });
    return Operations.from(root, false);
  }

  groupedBy(grouper: (app: App) => string, groupType: 'page' | 'folder' = 'folder'): Operations {
    const apps = this.getApps();
    const grouped = groupBy(apps.map(app => [app, grouper(app)] as const), '1');
    const pages: [string, Page][] = [];
    for (const [group, apps_] of Object.entries(grouped)) {
      const apps = apps_.map(a => a[0]);
      pages.push([
        group,
        {
          id: 0,
          kind: 'page',
          children: apps,
        }
      ]);
    }
    return Operations.from({
      id: 1,
      kind: 'folder',
      name: 'root',
      children: groupType === 'folder'
        ? [{
          id: 0,
          kind: 'page',
          children: pages.map(([name, page]) => ({
            kind: 'folder',
            id: 0,
            name,
            children: [page]
          }))
        }]
        : pages.map(([, page]) => page)
    });
  }
}