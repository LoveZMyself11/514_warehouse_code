# 514 仓库项目交接（给 Claude）

> 交接日期：2026-09-18（Asia/Shanghai）  
> 项目目录：`/Users/love_zmyself/all_school_work/514base_hub`  
> 当前开发地址：`http://localhost:4173/`

这份文件描述当前真实代码状态，不代表所有规划中的功能都已经上线。接手前请先读本文件，再读 `README.md`、`src/App.tsx` 和 `supabase/schema.sql`。

## 一句话状态

已经完成 92 张微信物品照片的视觉整理、编号和重命名，并做了一个可运行的 React/Vite 仓库管理台。管理台库存目前仍是浏览器本地存储版本，支持按货架查看、搜索、新增、查看、编辑中文名/数量、移动位置、删除和查看移动历史；已接入 Supabase Auth 客户端和受保护路由，但库存尚未切换到 Supabase，也没有借用/归还流程。

## 当前数据事实

- 图片：`data/` 下 92 张 JPG，均已重命名为 `ITEM0001_中文名.jpg` 至 `ITEM0092_中文名.jpg`。
- 物品：92 条，编号连续且唯一：`ITEM0001` 到 `ITEM0092`。
- 数量：当前全部暂记为 `若干`，没有从照片可靠推导数量。
- 图片清单：`inventory_image_manifest.csv` 是图片映射的上游清单；`新路径` 全部有效。
- 派生数据：`inventory.csv`、`inventory.json`、`src/inventory-data.json`、`supabase/seed.sql`。
- 视觉状态：83 项 `已确认`，7 项名称/用途仍待核对，2 项是区域总览照片。
- 待分层：33 项只有货架字母，暂放在 `PENDING_A/B/C/D`，没有擅自猜测层数。
- 当前待分层分布：`PENDING_A=14`、`PENDING_B=10`、`PENDING_C=9`、`PENDING_D=0`。
- 当前正式位置分布：`D3=13`、`D2=12`、`C4=10`、`B3=7`、`FLOOR=7`、`B4=4`、`DOOR=3`、`C3=2`、`D4=1`。

### 位置编码约定

正式货架层只允许：

```text
A1 A2 A3 A4
B1 B2 B3 B4
C1 C2 C3 C4
D1 D2 D3 D4
```

其他正式区域是 `FLOOR`（地板）和 `DOOR`（门后）。`PENDING_A` 到 `PENDING_D` 是“已知货架、尚未知道具体层”的工作队列，不是第 0 层，也不是正式货架层号。不要重新引入 `A0/B0/C0/D0`。

### 仍需人工确认的项目

| 编号 | 当前名称 | 当前来源位置 | 状态 |
|---|---|---|---|
| `ITEM0003` | 充气活动道具 | A? / `PENDING_A` | 待确认具体类型 |
| `ITEM0009` | 折叠桌收纳包 | A? / `PENDING_A` | 待确认是否含桌具 |
| `ITEM0018` | 绿色袋装服装 | B? / `PENDING_B` | 待确认具体服装 |
| `ITEM0059` | 红色罐装喷剂 | D2 | 待确认具体用途 |
| `ITEM0069` | 透明塑料扎带 | D3 | 待确认具体类型 |
| `ITEM0082` | 展架支撑杆 | FLOOR | 待确认具体展架 |
| `ITEM0084` | 黑色卷筒物料 | FLOOR | 待确认具体类型 |

区域总览照片：`ITEM0079`（落地宣传牌与配重）和 `ITEM0091`（宣传横幅与展板）。后续需要决定它们是保留为库存项、拆成多个物品，还是改为纯位置/场景照片。

最近已根据视觉复核修正：

- `ITEM0062`：`迷彩油彩`
- `ITEM0088`：`拾物夹`
- `ITEM0089`：`不锈钢伸缩杆`

## 前端现状

技术栈：Vite + React 19 + TypeScript + `lucide-react`。

主要入口：

- `src/main.tsx`：React 入口。
- `src/App.tsx`：目前几乎全部管理台业务逻辑和 UI。
- `src/styles.css`：桌面与手机响应式样式。
- `src/types.ts`：`InventoryItem`、`LocationHistory` 类型。
- `src/locations.ts`：A-D 四个货架的 1-4 层、FLOOR、DOOR、PENDING 位置定义。
- `src/inventory-data.json`：前端初始种子。

已实现：

- 全部物品、A/B/C/D 货架、具体 1-4 层、FLOOR、DOOR、待分层筛选。
- 按名称、`ITEM` 编号、位置搜索。
- 新增物品。
- 查看详情和图片。
- 编辑中文名称、数量、位置。
- 删除物品。
- 位置变化历史：记录原位置、新位置、时间。
- 物品 `ITEMxxxx` 编号在编辑界面不可修改；新增编号从当前最大编号之后递增，删除后不复用。
- 桌面和 390px 手机布局均已检查，无横向溢出。

### 当前持久化边界

管理台目前只使用浏览器 `localStorage`：

```text
key = 514base-inventory-v3
value = { version, items, history, lastIssuedNumber }
```

因此：

- 同一浏览器可保留改名、移动、新增和删除结果。
- 换浏览器、换设备或清除站点数据不会共享这些修改。
- UI 修改不会回写 `inventory.csv`、`inventory.json`、manifest 或 SQL。
- 已存在的 localStorage 会优先于新的 `src/inventory-data.json`；接手开发时要先决定是否迁移或清空本地状态。
- 当前 UI 删除会连同该物品的本地移动历史一起删除；如果未来需要审计留痕，应改成软删除或保留历史。
- 新增物品没有图片上传，`imagePath` 为空时显示占位图。
- 名称识别状态不能在 UI 中修改，只能编辑名称/数量/位置。

当前 `InventoryStore` 接口中的 `version` 仍写作 `2`，但 storage key 已经是 `v3`；这是小的技术债，做存储迁移时应统一版本号并增加 schema migration。

## 数据生成和图片处理

### 当前推荐数据链

```text
inventory_image_manifest.csv
        |
        v
tools/generate_inventory_assets.py
        |
        +--> src/inventory-data.json
        +--> inventory.json
        +--> inventory.csv
        +--> supabase/seed.sql
```

运行生成脚本：

```bash
python3 tools/generate_inventory_assets.py
```

注意：脚本会把数量统一生成成 `若干`，并刷新所有记录的 `createdAt` / `updatedAt`。它适合初始化或重新生成派生文件，不适合覆盖已经发生的业务编辑。

### 不要直接运行的脚本

`rename_inventory_images.py` 是一次性重命名脚本。它仍以原始微信文件名为输入，而原始文件已经被重命名；再次运行会因为源文件不存在或目标文件已存在而失败。若需要再次改名，先逐项确认当前文件，再安全地执行 `mv`，同步修改 manifest、脚本元数据，最后重新生成派生数据。

`wechat_inventory_processor.py` 是早期“手动粘贴聊天文本”的原型，不是当前 92 项资产的数据源。它会生成/覆盖旧格式的 `inventory.csv`、`inventory.json`，而且位置处理逻辑与当前图片清单流程不一致。不要用它重建当前库存。

manifest 的 `原始路径` 仍记录重命名前的微信文件名，当前这些原始路径大多不存在；使用时以 `新路径` 为准。

## Supabase 当前状态

数据库库存结构已经准备但尚未接入前端 CRUD：

- `supabase/schema.sql`：
  - `inventory_locations`
  - `inventory_items`
  - `inventory_location_history`
  - 位置更新 trigger，自动写移动历史
- `supabase/seed.sql`：92 条初始化 upsert。

执行顺序：先执行 `schema.sql`，再执行 `seed.sql`。

当前没有：

- 前端查询/写入 API。
- Storage bucket、图片上传和远程图片 URL。
- Realtime 同步。
- 借用/归还记录。

当前 Auth 状态：

- 已安装并固定 `@supabase/supabase-js`，Supabase URL 已写入 `.env.local` 和 `.env.example`。
- publishable key 尚未提供，`.env.local` 中该值保持为空；不要使用 secret key 或 `service_role` key。
- `/login` 提供邮箱/密码登录，`/` 通过 React Router guard 保护，管理台顶部可退出登录。
- 前端不开放自行注册。需要在 Supabase Dashboard 中关闭公开注册，并邀请或创建账户。
- `supabase/auth_and_rls.sql` 已准备 authenticated policies 和受保护的位置历史 trigger，但尚未在远程项目执行。

`seed.sql` 中的 `image_path` 仍是站点本地路径 `/data/...`，不是 Supabase Storage URL。接入 Storage 后需要先上传图片、建立 bucket policy，再回填公共 URL 或签名 URL。

### 接 Supabase 时必须处理的数据库问题

1. 目前新增编号依赖浏览器的 `lastIssuedNumber + 1`，多用户并发会撞号。应改为数据库 sequence/RPC/事务分配。
2. 当前本地新建物品的 `sourceSequence` 写成 `0`；数据库中该字段有 unique 约束，正式接入时应对人工录入使用 `NULL`，不要重复写 0。
3. 需要设计 RLS 和身份模型，不能把没有权限控制的表直接暴露给公网。
4. 需要决定删除是硬删除还是软删除；当前 schema 与 localStorage 都会删除移动历史（数据库通过 `ON DELETE CASCADE`）。
5. `PENDING_*` 是工作流状态。如果最终要求数据库只允许正式位置，应改成独立的 `shelf_code` + 可空 `level`，而不是把 PENDING 当成正式位置码。
6. README 早期示例里的 `items` / `borrow_records` 表与实际 `inventory_*` schema 不一致，接手时不要按旧示例直接建表。

## 运行和验证

环境曾验证：Node `v25.9.0`、npm `11.12.1`。依赖已经安装，但重新进入环境仍应执行：

```bash
npm install
```

开发服务：

```bash
npm run dev
```

默认端口是 5173。当前交接时已有服务运行在 4173，若需复用：

```bash
npm run dev -- --port 4173
```

生产构建和预览：

```bash
npx tsc --noEmit
npm run build
npm run preview -- --port 4174
```

`npm run build` 会执行 `vite build && cp -R data dist/data`，所以构建产物包含约 64MB 图片。构建时可能出现 lucide-react 的 `use client` module-level warning，这是当前非致命 warning，不影响构建结果。

已做过的验证：

- `npx tsc --noEmit` 通过。
- `npm run build` 通过。
- 92 条数据、92 张图片、连续 ID、无重复 ID、无缺图、无 `A0-D0` 通过脚本校验。
- 桌面 1280px 和手机 390px 浏览器检查通过。
- 真实操作验证过编辑名称、移动到 `A1`、位置历史、新增 `ITEM0093`；测试数据未写入最终种子，最终页面恢复为 92 条。
- 浏览器控制台无错误。

当前没有自动化测试、lint 或 CI 脚本。

## 推荐接手顺序

### 第一阶段：锁定业务语义和现场数据

- 确认永久不变的是物品 `ITEMxxxx` 编号，而不是货架位置码。
- 现场为 33 项 `PENDING_*` 物品分配具体 1-4 层。
- 核对 7 项待确认名称/用途。
- 决定 `ITEM0079`、`ITEM0091` 是否是库存项还是场景照片。
- 盘点数量，将 `若干` 替换为真实数量或设计可用单位字段。

### 第二阶段：做数据迁移和在线化

- 明确是否需要导出当前浏览器 localStorage 的修改。
- 配置 Supabase 项目、环境变量、Storage bucket、认证和 RLS。
- 将前端读写从 localStorage 切换到 Supabase。
- 用数据库原子策略分配新 ITEM 编号。
- 将图片上传到 Storage 并更新 URL。
- 增加 loading/error/空状态和离线策略。

### 第三阶段：扩展仓库业务

- 借用、归还、逾期和借用人记录（README 背景提到，但当前尚未实现）。
- 角色权限：管理员、仓库管理员、普通查询/借用用户。
- 导入/导出、备份、操作审计。
- 图片上传、替换和批量更新。
- 服务器和现有域名部署，验证国内访问和 Supabase 网络可达性。

## 接手时的安全规则

- 不要重跑 `rename_inventory_images.py`。
- 不要运行 `wechat_inventory_processor.py` 覆盖当前派生数据。
- 不要把 `PENDING_A` 解释为 `A0`。
- 不要在改名或移动时生成新的 ITEM 编号。
- 修改 manifest 后，检查图片实际文件名，再运行生成脚本和完整校验。
- 没有确认 Supabase 迁移策略前，不要清除用户浏览器里的 `514base-inventory-v3`。
- 当前目录不是 Git 仓库，没有提交历史可回滚；接手后建议先建立 `.gitignore`（至少忽略 `node_modules/`、`dist/`、`.DS_Store`、`.env*`），再初始化版本库。

## 接手验收清单

- [ ] 读取本文件、README、App、schema 和 manifest。
- [ ] 启动本地页面并确认首页显示 92 件物品。
- [ ] 确认货架层只显示 1、2、3、4。
- [ ] 确认 `PENDING_*` 单独显示为待分层，不显示为 0 层。
- [ ] 确认编辑名称或位置不会改变 ITEM 编号。
- [ ] 确认位置移动历史可见。
- [ ] 决定 localStorage 修改是否需要迁移。
- [ ] 决定 Supabase 接入和借还功能的优先级后再大规模重构。
