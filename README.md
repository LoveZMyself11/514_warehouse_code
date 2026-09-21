# 514 学部仓库物品借用管理系统

武汉纺织大学外经贸学院信息技术学部 514 仓库管理系统，由 lovezmyself 于 2026 年设计。

## 项目背景

浙江某高校学部仓库数字化管理平台，用于管理物品借用、归还、库存查询等功能。

### 仓库布局
- **货架区域**: A、B、C、D 四个货架，每个货架4层（A1-A4, B1-B4, C1-C4, D1-D4）
- **其他区域**: 地板（FLOOR）、门后（DOOR）

## 技术方案

### 数据存储
- **Supabase** 免费套餐（PostgreSQL + Storage）
- 图片存储在 Supabase Storage
- 物品数据存储在 PostgreSQL

### 前端部署
- 单页 Web 应用（H5响应式）
- 部署在现有轻量云服务器（国内）
- 通过现有域名访问

### 开源框架参考
- [Shelf.nu](https://github.com/Shelf-nu/shelf.nu) - IT资产管理系统
- [minorCoder/Goods](https://github.com/minorCoder/Goods) - 国内物品借用管理

## 数据初始化

### 工具：微信聊天记录批量提取

使用 `wechat_inventory_processor.py` 脚本处理300多条微信消息（图片+文字描述）

#### 使用方法

1. 运行脚本：
```bash
python3 wechat_inventory_processor.py
```

2. 复制微信聊天记录粘贴到终端，格式示例：
```
kt板
[图片]
彩色纸 5包
[图片]
a1
剪刀 2把
[图片]
胶带
b2
```

3. 输入 `END` 结束，脚本自动生成：
   - `inventory.csv` - Excel可直接打开
   - `inventory.json` - 程序导入用
   - `inventory_import.sql` - Supabase SQL脚本

#### 数据格式

| 编号 | 物品名称 | 位置 | 数量 | 原始描述 |
|------|---------|------|------|---------|
| ITEM0001 | kt板 | A2 | 若干 | kt板 |
| ITEM0002 | 彩色纸 | B3 | 5 | 彩色纸 5包 |

#### 位置编码规范

- `A1`-`A4`: A货架1-4层
- `B1`-`B4`: B货架1-4层
- `C1`-`C4`: C货架1-4层
- `D1`-`D4`: D货架1-4层
- `FLOOR`: 地板
- `DOOR`: 门后

## 数据库设计（Supabase）

```sql
-- 物品表
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  quantity TEXT,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 借用记录表
CREATE TABLE borrow_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id TEXT REFERENCES items(id),
  borrower_name TEXT NOT NULL,
  borrower_contact TEXT,
  borrow_date TIMESTAMPTZ DEFAULT NOW(),
  expected_return_date DATE,
  actual_return_date TIMESTAMPTZ,
  status TEXT CHECK (status IN ('borrowed', 'returned', 'overdue')),
  notes TEXT
);
```

## 当前数据

- 已完成 92 张物品图片的视觉整理与编号，唯一物品编号为 `ITEM0001` 至 `ITEM0092`
- 唯一编号与中文名称、存放位置分离：改名或移动物品不会改变 `ITEM` 编号
- 正式货架位置仅使用 `A1-A4`、`B1-B4`、`C1-C4`、`D1-D4`
- 原始图片只能确认货架、不能确认层数的物品使用 `PENDING_A` 至 `PENDING_D`，需要在管理台中完成分层
- 地板和门后区域使用 `FLOOR`、`DOOR`

数据文件：

- `inventory.csv`：Excel 可打开的当前库存
- `inventory.json`：前端或程序导入数据
- `inventory_image_manifest.csv`：图片原文件与新文件的完整映射
- `supabase/schema.sql`：货架、物品和位置移动历史表
- `supabase/seed.sql`：92 项初始化数据

## 仓库管理台

管理台支持按货架和层级查看物品，并管理编号、名称、规格、数量、图片文件名、位置和借用状态。正式库存与普通用户提交的变更申请相互隔离，只有超级管理员审批后才会改变正式数据。

权限分为三层：

- `super_admin`：维护全部库存、部门、人员、借用订单和审批数据。
- `admin`：分配给各部门部长或副部长，只能维护本部门普通用户，并监管本部门借用订单状态。
- `member`：查看库存、提交库存变更申请、提交借用申请并查看自己的订单。

部门由超级管理员动态新增、编辑和删除。删除部门不会删除用户或历史订单，其部门字段会变为未分配。

管理台使用 Supabase Auth 的邮箱/密码登录保护。`/` 是受保护路由；未登录访问会跳转到 `/login`。为避免任何访客自行注册后取得库存权限，前端不开放注册入口，请在 Supabase Dashboard 的 Authentication > Users 中邀请或创建账户。

```bash
npm install
cp .env.example .env.local
npm run dev
```

在 `.env.local` 中填入 Supabase Dashboard > Project Settings > API 中的 publishable key：

```dotenv
VITE_SUPABASE_URL=https://cvurrazwebjtfffmkymn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

publishable key 可以安全地用于浏览器；不要把 secret key 或 `service_role` key 放进任何 `VITE_` 环境变量。

默认访问 `http://localhost:5173/`。生产构建：

```bash
npm run build
```

构建结果位于 `dist/`，其中包含全部物品图片。

## Supabase 初始化

在 Supabase SQL Editor 中依次执行：

1. `supabase/schema_v2.sql`
2. `supabase/auth_and_rls.sql`
3. `supabase/inventory_workflow.sql`
4. `supabase/verify_setup.sql`（只读验证）

然后在 Authentication > Providers 中启用 Email，并关闭公开注册（Allow new users to sign up）。在 Authentication > Users 中邀请或创建获准使用的账户；触发器会自动创建默认停用的 `member` 用户资料，再由超级管理员在后台分配角色、部门、职位并启用。在 Authentication > URL Configuration 中设置站点 URL。生产服务器需把未知路径回退到 `index.html`，确保直接访问 `/login` 时仍由 React Router 处理。

首次启用时，在 Supabase Authentication 中创建第一个账号，再执行一次 SQL 将该账号对应的 `public.users.role` 改为 `super_admin`。不要在浏览器端使用 `service_role` 或 secret key。

统一账号模板位于 `outputs/2026-09-21-account-import-template/account_import_template.xlsx`，包括 5 个超级管理员、10 个普通管理员和 100 个普通用户占位行。模板不包含真实密码，已填写的密码文件不得提交到 GitHub。

`inventory_location_history` 会在物品位置改变时自动记录原位置、新位置和时间。

## 下一步

1. ✅ 微信图片视觉整理与编号
2. ✅ 货架 CRUD 管理台
3. ✅ Supabase 表结构与初始化数据
4. ✅ Supabase Auth、三层 RLS 权限与在线数据库
5. ✅ 部门、人员、库存审批与借用监管后台
6. ⏳ 创建真实账号并完成端到端角色验收
7. ⏳ 部署到现有服务器和域名

## 约束条件

- ❌ 不使用微信小程序（300元认证费）
- ❌ 学校/学部不出资
- ✅ 使用现有服务器和域名
- ✅ 数据存储用 Supabase 免费套餐
- ✅ 国内访问稳定性优先

## 联系方式

项目负责人：love_zmyself
