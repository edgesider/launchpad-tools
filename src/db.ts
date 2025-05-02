import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { associateWith, classifyHSL, ColorClass, getDominantColor, rgbToHSL } from './utils';

export enum ItemType {
  Placeholder = 2,
  Group = 3,
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
  isPlaceholder?: boolean;
}

export interface RootGroup extends Group {
  id: 1;
}

export type Item = App | Group;

export interface LaunchpadDB {
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
    lastSystemItemId,
    apps, items, groups,
    appMap, itemMap, groupMap,
    imageCaches: imageCache, imageCacheMap
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
        if (item.type === ItemType.Group || item.type === ItemType.Placeholder) {
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
      isPlaceholder: item.type === ItemType.Placeholder,
      children,
    };
  };

  return itemToGroup(itemMap[1]) as RootGroup;
}

/**
 * 使用{@link walker}遍历{@link group}
 */
export function walkGroup(
  group: Group,
  walker: (item: Item, parent: Group, index: number, depth: number) => Item | void,
  depth = 0
) {
  for (let i = 0; i < group.children.length; i++) {
    const item = group.children[i];
    const newItem = walker(item, group, i, depth);
    if (newItem) {
      group.children[i] = newItem;
    }
    if (item.kind === 'group') {
      walkGroup(item, walker, depth + 1);
    }
  }
}

export function applyRoot(root: RootGroup) {
  const { groupMap, itemMap, items: oldItems, apps, imageCaches, lastSystemItemId } = getDB();

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
        uuid: randomUUID().toUpperCase(),
        flags: 0,
        type: item.kind === 'group'
          ? (item.isPlaceholder ? ItemType.Placeholder : ItemType.Group)
          : ItemType.App,
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


export function findItemByName(root: RootGroup, kind: 'app', expectedName: string | RegExp): App[];
export function findItemByName(root: RootGroup, kind: 'group', expectedName: string | RegExp): Group[];
export function findItemByName(root: RootGroup, kind: Item['kind'], expectedName: string | RegExp): Item[] {
  const items: Item[] = [];
  expectedName = expectedName instanceof RegExp ? expectedName : new RegExp(expectedName);
  walkGroup(root, item => {
    if (item.kind === kind && item.name && expectedName.test(item.name)) {
      items.push(item);
    }
  });
  return items;
}