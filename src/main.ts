import * as child_process from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { Operations } from './operations';
import { associateWith, classifyHSL, getDominantColor, rgbToHSL, sleep } from './utils';

export enum ItemType {
  Group = 2,
  Page = 3,
  App = 4,
}

export interface RawItem {
  rowid: number;
  uuid: string;
  flags: number | null;
  type: number;
  parent_id: number;
  ordering: number;
}

export interface RawApp {
  item_id: number;
  title: string;
  bundleid: string;
  storeid: string | null;
  category_id: number | null;
  moddate: number | null;
  bookmark: NodeJS.ArrayBufferView | null;
}

export interface RawGroup {
  item_id: number;
  category_id: number | null;
  title: string | null;
}

export interface RawImageCache {
  item_id: number;
  size_big: number;
  size_mini: number;
  image_data: NodeJS.ArrayBufferView;
  image_data_mini: NodeJS.ArrayBufferView;
}

export interface App {
  kind: 'app';
  id: number;
  bundle_id: string;
  name: string;
}

export interface Group {
  kind: 'group';
  id: number;
  name: string | null;
  children: Item[];
}

export interface RootGroup extends Group {
  id: 1;
}

export type Item = App | Group;

export interface LaunchpadDB {
  apps: RawApp[];
  items: RawItem[];
  groups: RawGroup[];
  imageCache: RawImageCache[];
  appMap: Record<string, RawApp>;
  itemMap: Record<string, RawItem>;
  groupMap: Record<string, RawGroup>;
  imageCacheMap: Record<string, RawImageCache>;
  lastSystemItemId: number;
}

function getDBPath(): string {
  return path.join(
    spawnSync('getconf', ['DARWIN_USER_DIR']).stdout.toString().trim(),
    'com.apple.dock.launchpad/db/db'
  );
}

function getDB(): LaunchpadDB {
  const db = new DatabaseSync(getDBPath());
  const [apps, items, groups, imageCache] = [
    db.prepare('select * from apps').all() as unknown as RawApp[],
    db.prepare('select * from items').all() as unknown as RawItem[],
    db.prepare('select * from groups').all() as unknown as RawGroup[],
    db.prepare('select * from image_cache').all() as unknown as RawImageCache[],
  ];
  // 系统保留的最后一个id
  const lastSystemItemId =
    Math.max(...items.filter(i => typeof i.flags !== 'number')
      .map(i => i.rowid));
  const appMap = associateWith(apps, 'item_id');
  const groupMap = associateWith(groups, 'item_id');
  const itemMap = associateWith(items, 'rowid');
  const imageCacheMap = associateWith(imageCache, 'item_id');
  return {
    lastSystemItemId,
    apps, items, groups,
    appMap, itemMap, groupMap,
    imageCache, imageCacheMap
  };
}

export function getRoot(db?: LaunchpadDB): RootGroup {
  const { appMap, groupMap, items, itemMap, lastSystemItemId } = db ?? getDB();

  const itemToGroup = (item: RawItem): Group => {
    const g = groupMap[item.rowid];
    if (!g) {
      throw Error(`no such group ${item.rowid}`);
    }
    const children: Item[] = items
      .filter(item => item.parent_id === g.item_id)
      .sort((i1, i2) => i1.ordering - i2.ordering)
      .map((item): Item | null => {
        if (item.rowid <= lastSystemItemId) {
          return null;
        }
        if (item.type === ItemType.Group || item.type === ItemType.Page) {
          // group
          return itemToGroup(item);
        } else if (item.type === ItemType.App) {
          const app = appMap[item.rowid];
          return {
            kind: 'app',
            id: item.rowid,
            bundle_id: app.bundleid,
            name: app.title,
          } satisfies App;
        }
        return null;
      })
      .filter((r): r is (App | Group) => Boolean(r));
    return {
      kind: 'group',
      id: item.rowid,
      name: g.title,
      children,
    };
  };

  return itemToGroup(itemMap[1]) as RootGroup;
}

/**
 * 使用{@link walker}遍历{@link group}
 */
export function walkGroup(group: Group, walker: (item: Item, parent: Group, index: number) => Item | void) {
  for (let i = 0; i < group.children.length; i++) {
    const item = group.children[i];
    const newItem = walker(item, group, i);
    if (newItem) {
      group.children[i] = newItem;
    }
    if (item.kind === 'group') {
      walkGroup(item, walker);
    }
  }
}

export function applyRoot(root: RootGroup) {
  const { groupMap, itemMap, items: oldItems, apps, lastSystemItemId } = getDB();

  // 创建新项目时的下一个id
  let nextId = Math.max(...oldItems.map(item => item.rowid)) + 1;

  const updateGroups: RawGroup[] = [];
  const updateItems: RawItem[] = [];

  walkGroup(root, (item, parent, index) => {
    if (item.id >= 1 && item.id <= lastSystemItemId) {
      return;
    }
    const dbItem = itemMap[item.id];
    // parent.id=1时序号需要从1开始，因为有个系统内置的HOLDINGPAGE
    const ordering = parent.id === 1 ? index + 1 : index;
    if (dbItem) {
      // 已存在的item，更新
      dbItem.parent_id = parent.id;
      dbItem.ordering = ordering;
      updateItems.push(dbItem);

      if (item.kind === 'group') {
        // 同时更新group
        const dbGroup = groupMap[item.id];
        dbGroup.title = item.name;
        updateGroups.push(dbGroup);
      }
    } else {
      // 不存在的item，创建
      item.id = item.id === 0 ? nextId++ : item.id;
      updateItems.push({
        rowid: item.id,
        uuid: randomUUID(),
        flags: 0,
        type: parent.id === 1 ? ItemType.Page : ItemType.Group,
        parent_id: parent.id,
        ordering
      });
      if (item.kind === 'group') {
        // 同时创建group
        updateGroups.push({
          item_id: item.id,
          title: item.name,
          category_id: null,
        });
      }
    }
  });

  /// 删掉所有数据重建数据库
  let sql: StatementSync;
  const db = new DatabaseSync(getDBPath());
  db.prepare(`delete
              from items
              where rowid > ${lastSystemItemId}`).run();
  // 禁用更新触发器
  db.exec('UPDATE dbinfo SET value=1 WHERE key=\'ignore_items_update_triggers\'');
  sql = db.prepare(`insert into items (rowid, uuid, flags, type, parent_id, ordering)
                    values (?, ?, ?, ?, ?, ?)`);
  for (const item of updateItems) {
    if (item.rowid <= lastSystemItemId) {
      continue;
    }
    sql.run(item.rowid, item.uuid, item.flags, item.type, item.parent_id, item.ordering);
  }
  // 启用更新触发器
  db.exec('UPDATE dbinfo SET value = 0 WHERE key=\'ignore_items_update_triggers\'');

  db.prepare(`delete
              from groups
              where item_id > ${lastSystemItemId}`).run();
  sql = db.prepare(`insert into groups (item_id, category_id, title)
                    values (?, ?, ?)`);
  for (const group of updateGroups) {
    if (group.item_id <= lastSystemItemId) {
      continue;
    }
    sql.run(group.item_id, group.category_id, group.title);
  }

  db.prepare('delete from apps').run();
  sql = db.prepare(`insert into apps (item_id, title, bundleid, storeid, category_id, moddate, bookmark)
                    values (?, ?, ?, ?, ?, ?, ?)`);
  for (const app of apps) {
    sql.run(app.item_id, app.title, app.bundleid, app.storeid, app.category_id, app.moddate, app.bookmark);
  }
}

function restartLaunchpad() {
  child_process.spawnSync('killall', ['Dock']);
}

async function resetLaunchpad() {
  fs.unlinkSync(getDBPath());
  restartLaunchpad();
  await sleep(500);
  restartLaunchpad();
}

function sortByColor(imageCacheMap: Record<string, RawImageCache>, a: Item, b: Item): number {
  if (a.kind !== 'app' || b.kind !== 'app') {
    return 0;
  }
  return 0;
}

async function main() {
  const db = getDB();
  const root = getRoot(db);

  let s = '';
  const groups: Record<
    string,
    {
      name: string;
      hsl: [number, number, number];
      image: ArrayBuffer
    }[]
  > = {};
  for (const app of db.apps) {
    const miniImage = db.imageCacheMap[app.item_id].image_data_mini.buffer;
    const image = db.imageCacheMap[app.item_id].image_data_mini.buffer as ArrayBuffer;
    const rgb = await getDominantColor(miniImage as ArrayBuffer);
    const hsl = rgbToHSL(rgb);
    const class_ = classifyHSL(hsl);
    const result = {
      name: app.title,
      hsl,
      image
    };
    if (groups[class_]) {
      groups[class_].push(result);
    } else {
      groups[class_] = [result];
    }
  }
  for (const [class_, group] of Object.entries(groups)) {
    // language=html
    s += `
        <div class="list"><p>${class_}</p>`;
    for (const { image, name, hsl } of group) {
      // language=html
      s += `
          <div class="item">
              <img class="image" src="data:image/png;base64,${Buffer.from(image).toString('base64')}"
                   alt="${name}"/>
              <div class="block" style="background: hsl(${hsl[0]} ${hsl[1]} ${hsl[2]})"></div>
          </div>
      `;
    }
    s += '</div>';
  }
  // language=html
  console.log(`
      <meta charset="utf-8">
      <html lang="zh">
      <head>
          <style>
              .list {
                  display: flex;
                  flex-direction: row;
                  flex-wrap: wrap;
                  justify-content: flex-start;
                  align-items: flex-start;
                  gap: 16px;
                  margin-top: 30px;
              }

              .item {
                  display: flex;
                  flex-direction: row;
                  justify-content: flex-start;
                  align-items: center;
                  gap: 8px;
              }

              .image {
                  width: 50px;
                  height: 50px;
              }

              .block {
                  width: 50px;
                  height: 50px;
              }
          </style>
      </head>
      <body>
      ${s}
      </body>
      </html>
  `);

  // const newRoot = Operations.from(root)
  //   .flatted()
  //   .sorted()
  //   .root;
  // applyRoot(newRoot);
  // console.log(JSON.stringify(newRoot, function (k, v) {
  //   if (
  //     Array.isArray(this) ||
  //     ['', 'name', 'children'].indexOf(k) >= 0
  //   ) {
  //     return v;
  //   }
  //   return undefined;
  // }, 2));
  // restartLaunchpad();
}

if (require.main === module) {
  main().catch(console.error);
  // TODO
  // 检查是否有downloading
  // 检查是否有未识别的字段
}