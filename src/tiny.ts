import { App, Page, RootFolder, Folder } from './db';
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

function toTinyFolder(folder: Folder): TinyFolder {
  const name = folder.name;
  let apps: TinyApp[];
  apps = folder.children
    .map(page => (page.children as App[])
      .map(app => app.name))
    .flat();
  return [name, apps];
}

function toTinyPage(group: Page): TinyPage {
  return group.children.map((item): (TinyFolder | TinyApp) => {
    if (item.kind === 'app') {
      return item.name;
    } else {
      return toTinyFolder(item);
    }
  });
}

export function toTinyRoot(root: RootFolder): TinyRoot {
  return root.children.map(item => toTinyPage(item as Page));
}

export function tinyToRoot(apps: App[], tiny: TinyRoot): RootFolder {
  const appByName = associateWith(apps, 'name');
  return {
    id: 1,
    kind: 'folder',
    name: 'root',
    children: tiny.map((page): Page => {
      return {
        kind: 'page',
        id: 0,
        children: page.map((item): App | Folder => {
          if (isTinyFolder(item)) {
            return {
              kind: 'folder',
              id: 0,
              name: item[0],
              children: [{
                kind: 'page',
                id: 0,
                children: item[1].map(appName => {
                  const app = appByName[appName];
                  assert(Boolean(app), `app ${appName} not found`);
                  return app;
                })
              }]
            } satisfies Folder;
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