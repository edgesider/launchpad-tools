import { App, Group, Item, RootGroup, walkGroup } from './db';
import { assert, associateWith } from './utils';

// 表示单个App，值为App名称
export type TinyApp = string;
// 表示一个文件夹，第一项为文件夹名，第二个参数是App列表
export type TinyFolder = [string, TinyApp[]];
export type TinyItem = TinyFolder | TinyApp;
// 表示一页，一页中的元素可能为App，也可能为文件夹
export type TinyPage = TinyItem[];
// 表示根节点，由多页构成
export type TinyRoot = TinyPage[];

function isTinyFolder(item: TinyItem): item is TinyFolder {
  return Array.isArray(item);
}

function toTinyFolder(group: Group): TinyFolder {
  assert(Boolean(group.name));
  const name = group.name!;
  let apps: TinyApp[];
  if (group.children.length === 0) {
    apps = [];
  } else if (group.children[0].kind === 'group') {
    apps = group.children[0].children.map(item => item.name!);
  } else {
    apps = group.children.map(item => item.name!);
  }
  return [name, apps];
}

function toTinyPage(group: Group): TinyPage {
  assert(!group.isFolder);
  return group.children.map((item): (TinyFolder | TinyApp) => {
    if (item.kind === 'app') {
      return item.name;
    } else if (item.kind === 'group') {
      return toTinyFolder(item);
    }
    throw Error('unknown kind');
  });
}

export function toTinyRoot(root: RootGroup): TinyRoot {
  return root.children.map(item => toTinyPage(item as Group));
}

export function tinyToRoot(apps: App[], tiny: TinyRoot): RootGroup {
  const appByName = associateWith(apps, 'name');
  return {
    id: 1,
    kind: 'group',
    name: null,
    children: tiny.map((page): Group => {
      return {
        kind: 'group',
        id: 0,
        name: null,
        children: page.map((item): Item => {
          if (isTinyFolder(item)) {
            return {
              kind: 'group',
              id: 0,
              name: item[0],
              children: item[1].map(appName => {
                const app = appByName[appName];
                assert(Boolean(app), `app ${appName} not found`);
                return app;
              })
            } satisfies Group;
          } else {
            const app = appByName[item];
            assert(Boolean(app), `app ${item} not found`);
            return app;
          }
        })
      };
    })
  };
}