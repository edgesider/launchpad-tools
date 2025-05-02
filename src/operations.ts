import pinyin from 'pinyin';
import { App, Group, Item, RootGroup, walkGroup } from './db';
import { deepClone, groupBy } from './utils';

const MAX_PER_PAGE = 5 * 7;

export class Operations {
  private constructor(public root: RootGroup) {
  }

  static from(root: RootGroup, clone = true): Operations {
    return new Operations(clone ? deepClone(root) : root);
  }

  private getApps(): App[] {
    const apps: App[] = [];
    walkGroup(this.root, (item) => {
      if (item.kind === 'app') {
        apps.push(item);
      }
    });
    return apps;
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

  groupBy(grouper: (app: App) => string): Operations {
    const apps = this.getApps();
    const colorGrouped = groupBy(apps.map(app => [app, grouper(app)] as const), '1');
    const groups: Group[] = [];
    for (const [group, apps_] of Object.entries(colorGrouped)) {
      const apps = apps_.map(a => a[0]);
      groups.push({
        id: 0,
        kind: 'group',
        name: group,
        isPlaceholder: true,
        children: [{
          kind: 'group',
          id: 0,
          name: null,
          children: apps
        }]
      });
    }
    return Operations.from({
      id: 1,
      kind: 'group',
      name: null,
      children: [{
        id: 0,
        kind: 'group',
        name: null,
        children: groups
      }]
    });
  }
}