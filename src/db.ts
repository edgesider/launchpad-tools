import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { collectApps } from './operations';
import { assert, associateWith, classifyHSL, ColorClass, getDominantColor, rgbToHSL } from './utils';

export enum ItemType {
  RootFolder = 1,
  Folder = 2,
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

// TODO 结构具体到App/Page/Folder/Page/Root
export interface App {
  kind: 'app';
  id: number;
  bundle_id: string;
  name: string;
}

export interface Page {
  kind: 'page';
  id: number;
  children: (App | Folder)[];
}

export interface Folder {
  kind: 'folder';
  id: number;
  name: string;
  children: Page[];
}

export interface RootFolder extends Folder {
  id: 1;
  name: 'root';
}

export type Item = App | Folder | Page;
export type Group = Folder | Page;

export function itemIsGroup(item: Item): item is Group {
  return item.kind === 'folder' || item.kind === 'page';
}

export function itemGetName(item: Item): string | null {
  return item.kind === 'page' ? null : item.name;
}

export interface LaunchpadDB {
  db: DatabaseSync;
  apps: RawApp[];
  items: RawItem[];
  groups: RawGroup[];
  imageCaches: RawImageCache[];
  appMap: Record<string, RawApp>;
  itemMap: Record<string, RawItem>;
  groupMap: Record<string, RawGroup>;
  imageCacheMap: Record<string, RawImageCache>;
  lastSystemItemId: number;
}

export function getDBPath(): string {
  return path.join(
    spawnSync('getconf', ['DARWIN_USER_DIR']).stdout.toString().trim(),
    'com.apple.dock.launchpad/db/db'
  );
}

export function getDB(): LaunchpadDB {
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
    db,
    lastSystemItemId,
    apps, items, groups,
    appMap, itemMap, groupMap,
    imageCaches: imageCache, imageCacheMap
  };
}

export function getRoot(db?: LaunchpadDB): RootFolder {
  const { appMap, groupMap, items, itemMap, lastSystemItemId } = db ?? getDB();

  const itemToGroup = (item: RawItem): App | Page | Folder => {
    const g = groupMap[item.rowid];
    if (!g) {
      throw Error(`no such group ${item.rowid}`);
    }
    const children: (App | Page | Folder)[] = items
      .filter(item => item.parent_id === g.item_id)
      .sort((i1, i2) => i1.ordering - i2.ordering)
      .map((item): App | Page | Folder | null => {
        if (item.rowid <= lastSystemItemId) {
          return null;
        }
        switch (item.type) {
          case ItemType.Page:
          case ItemType.Folder:
            return itemToGroup(item);
          case ItemType.App: {
            const app = appMap[item.rowid];
            return {
              kind: 'app',
              id: item.rowid,
              bundle_id: app.bundleid,
              name: app.title,
            } satisfies App;
          }
          default:
            return null;
        }
      })
      .filter((r): r is (App | Page | Folder) => Boolean(r));
    switch (item.type) {
      case ItemType.RootFolder:
      case ItemType.Folder:
        return {
          kind: 'folder',
          id: item.rowid,
          name: g.title!,
          children: children as Page[],
        };
      case ItemType.Page:
        return {
          kind: 'page',
          id: item.rowid,
          children: children as (App | Folder)[],
        };
      case ItemType.App: {
        const app = appMap[item.rowid];
        return {
          kind: 'app',
          id: item.rowid,
          bundle_id: app.bundleid,
          name: app.title,
        } satisfies App;
      }
      default:
        throw Error(`unknown item type ${item.type}`);
    }
  };

  return itemToGroup(itemMap[1]) as RootFolder;
}

/**
 * 使用{@link walker}遍历{@link group}
 */
export function walkGroup(
  group: Page | Folder,
  walker: (item: Item, parents: (Page | Folder)[], index: number, depth: number) => Item | void,
  depth = 0,
  parents: (Page | Folder)[] = [],
) {
  for (let i = 0; i < group.children.length; i++) {
    const item = group.children[i];
    const newParents = [...parents, group];
    const newItem = walker(item, newParents, i, depth);
    if (newItem) {
      group.children[i] = newItem;
    }
    if (item.kind === 'page' || item.kind === 'folder') {
      walkGroup(item, walker, depth + 1, newParents);
    }
  }
}

export function applyRoot(root: RootFolder) {
  const launchpadDB = getDB();
  const { db, groupMap, itemMap, items: oldItems, apps, imageCaches, lastSystemItemId } = launchpadDB;

  const currentRoot = getRoot(launchpadDB);
  verifyRoot(collectApps(currentRoot), root);

  // 创建新项目时的下一个id
  let nextId = Math.max(...oldItems.map(item => item.rowid)) + 1;

  const updateGroups: RawGroup[] = [];
  const updateItems: RawItem[] = [];

  walkGroup(root, (item, parents, index) => {
    if (item.id >= 1 && item.id <= lastSystemItemId) {
      return;
    }
    const parent = parents[parents.length - 1];
    const dbItem = itemMap[item.id];
    // parent.id=1时序号需要从1开始，因为有个系统内置的HOLDINGPAGE
    const ordering = parent.id === 1 ? index + 1 : index;
    if (dbItem) {
      // 已存在的item，更新
      dbItem.parent_id = parent.id;
      dbItem.ordering = ordering;
      updateItems.push(dbItem);

      if (itemIsGroup(item)) {
        // 同时更新group
        const dbGroup = groupMap[item.id];
        dbGroup.title = item.kind === 'folder' ? item.name : null;
        updateGroups.push(dbGroup);
      }
    } else {
      // 不存在的item，创建
      item.id = item.id === 0 ? nextId++ : item.id;
      updateItems.push({
        rowid: item.id,
        uuid: randomUUID().toUpperCase(),
        flags: 0,
        type: {
          app: ItemType.App,
          folder: ItemType.Folder,
          page: ItemType.Page,
        }[item.kind],
        parent_id: parent.id,
        ordering
      });
      if (itemIsGroup(item)) {
        // 同时创建group
        updateGroups.push({
          item_id: item.id,
          title: item.kind === 'folder' ? item.name : null,
          category_id: null,
        });
      }
    }
  });

  /// 删掉所有数据重建数据库
  let sql: StatementSync;
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

  db.prepare('delete from image_cache').run();
  sql = db.prepare(`insert into image_cache (item_id, size_big, size_mini, image_data, image_data_mini)
                    values (?, ?, ?, ?, ?)`);
  for (const imageCache of imageCaches) {
    sql.run(
      imageCache.item_id, imageCache.size_big, imageCache.size_mini,
      imageCache.image_data, imageCache.image_data_mini);
  }
}

/**
 * 构建从item_id到图标主色调的映射
 */
export async function buildDominantColorClassMap(db: LaunchpadDB): Promise<Record<number, ColorClass>> {
  const colorClassMap: Record<number, ColorClass> = {};
  for (const image of db.imageCaches) {
    const miniImage = db.imageCacheMap[image.item_id].image_data_mini.buffer;
    const rgb = await getDominantColor(miniImage as ArrayBuffer);
    const hsl = rgbToHSL(rgb);
    colorClassMap[image.item_id] = classifyHSL(hsl);
  }
  return colorClassMap;
}


export function findItemByName(root: RootFolder, kind: 'app', expectedName: string | RegExp): App[];
export function findItemByName(root: RootFolder, kind: 'folder', expectedName: string | RegExp): Page[];
export function findItemByName(root: RootFolder, kind: 'app' | 'folder', expectedName: string | RegExp): Item[] {
  const items: Item[] = [];
  expectedName = expectedName instanceof RegExp ? expectedName : new RegExp(expectedName);
  walkGroup(root, item => {
    if ((item.kind === 'app' || item.kind === 'folder') && item.name && expectedName.test(item.name)) {
      items.push(item);
    }
  });
  return items;
}

export class VerifyError extends Error {
}

export function verifyRoot(oldApps: App[], root: RootFolder) {
  const newApps = collectApps(root);
  const newAppSet = new Set(newApps.map(app => app.name));
  const oldAppSet = new Set(oldApps.map(app => app.name));

  if (newApps.length !== newAppSet.size) {
    const newAppNames = newApps.map(app => app.name);
    for (const app of newAppSet) {
      newAppNames.splice(newAppNames.indexOf(app), 1);
    }
    throw new VerifyError(`有些App出现多次: ${[...newAppNames].join(',')}`);
  }

  if (oldApps.length !== newApps.length) {
    const unexpected = newAppSet.difference(oldAppSet);
    const missing = oldAppSet.difference(newAppSet);
    let info = 'App数量不匹配: ';
    if (unexpected.size > 0) {
      info += `多余 ${[...unexpected].join(',')}`;
    }
    if (missing.size > 0) {
      info += `缺少 ${[...missing].join(',')}`;
    }
    throw new VerifyError(info);
  }
}