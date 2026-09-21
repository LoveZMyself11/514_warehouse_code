import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Ban,
  Box,
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  CalendarClock,
  ClipboardList,
  Clock3,
  Building2,
  DoorOpen,
  Edit3,
  Layers3,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  PackagePlus,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { locationLabel, locations } from "./locations";
import type {
  BorrowOrder,
  BorrowOrderStatus,
  Department,
  InventoryChangeRequest,
  InventoryItem,
  InventoryStatus,
  LocationHistory,
  ManagedUser,
  UserRole,
} from "./types";

type Selection = "ALL" | "PENDING" | string;
type EditorMode = "create" | "edit";
type AppView = "inventory" | "requests" | "departments" | "users" | "borrows";

interface DbInventoryRow {
  id: string;
  name: string;
  location_code: string;
  specification: string | null;
  quantity: string;
  image_name: string | null;
  image_path: string | null;
  recognition_status: string;
  source_sequence: number | null;
  created_at: string;
  updated_at: string;
}

interface DbHistoryRow {
  id: number;
  item_id: string;
  from_location: string | null;
  to_location: string;
  moved_at: string;
}

interface DbRequestRow {
  id: number;
  request_type: InventoryChangeRequest["requestType"];
  item_id: string | null;
  result_item_id: string | null;
  proposed_name: string | null;
  proposed_location_code: string | null;
  proposed_specification: string | null;
  proposed_quantity: string | null;
  proposed_image_name: string | null;
  proposed_image_path: string | null;
  reason: string | null;
  status: InventoryChangeRequest["status"];
  requested_by: number;
  reviewed_by: number | null;
  review_note: string | null;
  created_at: string;
}

interface DbDepartmentRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

interface DbUserRow {
  id: number;
  student_id: string | null;
  name: string;
  department_id: number | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  notes: string | null;
  role: UserRole;
  is_active: boolean;
  auth_user_id: string | null;
  created_at: string;
}

interface DbBorrowOrderRow {
  id: number;
  order_number: string;
  user_id: number;
  department_id: number | null;
  status: BorrowOrderStatus;
  reason: string | null;
  expected_return_date: string | null;
  actual_return_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DbBorrowItemRow {
  id: number;
  order_id: number;
  item_id: string;
  quantity_borrowed: number;
  quantity_returned: number;
  item_condition: string;
  notes: string | null;
}

const isPendingLocation = (code: string) => code.startsWith("PENDING_");
const isShelf = (selection: string) => /^[A-D]$/.test(selection);

const matchesSelection = (item: InventoryItem, selection: Selection) => {
  if (selection === "ALL") return true;
  if (selection === "PENDING") return isPendingLocation(item.locationCode);
  if (isShelf(selection)) return item.locationCode.startsWith(selection) || item.locationCode === `PENDING_${selection}`;
  return item.locationCode === selection;
};

const inventoryStatus = (recognitionStatus: string): InventoryStatus => {
  if (recognitionStatus === "区域总览") return "overview";
  if (recognitionStatus.includes("待确认")) return "pending";
  return "confirmed";
};

const mapItem = (row: DbInventoryRow): InventoryItem => ({
  id: row.id,
  name: row.name,
  locationCode: row.location_code,
  specification: row.specification ?? "",
  quantity: row.quantity,
  imageName: row.image_name ?? "",
  imagePath: row.image_path ?? "",
  recognitionStatus: row.recognition_status,
  status: inventoryStatus(row.recognition_status),
  sourceSequence: row.source_sequence ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapHistory = (row: DbHistoryRow): LocationHistory => ({
  id: String(row.id),
  itemId: row.item_id,
  fromLocation: row.from_location,
  toLocation: row.to_location,
  movedAt: row.moved_at,
});

const mapRequest = (row: DbRequestRow): InventoryChangeRequest => ({
  id: row.id,
  requestType: row.request_type,
  itemId: row.item_id,
  resultItemId: row.result_item_id,
  proposedName: row.proposed_name,
  proposedLocationCode: row.proposed_location_code,
  proposedSpecification: row.proposed_specification,
  proposedQuantity: row.proposed_quantity,
  proposedImageName: row.proposed_image_name,
  proposedImagePath: row.proposed_image_path,
  reason: row.reason,
  status: row.status,
  requestedBy: row.requested_by,
  reviewedBy: row.reviewed_by,
  reviewNote: row.review_note,
  createdAt: row.created_at,
});

const mapDepartment = (row: DbDepartmentRow): Department => ({
  id: row.id,
  name: row.name,
  description: row.description ?? "",
  createdAt: row.created_at,
});

const mapUser = (row: DbUserRow): ManagedUser => ({
  id: row.id,
  studentId: row.student_id,
  name: row.name,
  departmentId: row.department_id,
  phone: row.phone,
  email: row.email,
  position: row.position,
  notes: row.notes,
  role: row.role,
  isActive: row.is_active,
  authUserId: row.auth_user_id,
  createdAt: row.created_at,
});

const mapBorrowOrder = (row: DbBorrowOrderRow): BorrowOrder => ({
  id: row.id,
  orderNumber: row.order_number,
  userId: row.user_id,
  departmentId: row.department_id,
  status: row.status,
  reason: row.reason,
  expectedReturnDate: row.expected_return_date,
  actualReturnDate: row.actual_return_date,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const statusMeta = (item: InventoryItem) => {
  if (item.status === "overview") return { text: "区域总览", className: "overview" };
  if (item.status === "pending") return { text: "待核对", className: "pending" };
  return { text: "已确认", className: "confirmed" };
};

const requestMeta = {
  create: { label: "新增", className: "confirmed" },
  update: { label: "修改", className: "overview" },
  delete: { label: "删除", className: "pending" },
};

const requestStatusMeta = {
  pending: { label: "待审批", className: "pending" },
  approved: { label: "已批准", className: "confirmed" },
  rejected: { label: "已拒绝", className: "overview" },
};

const roleMeta: Record<UserRole, string> = {
  super_admin: "超级管理员",
  admin: "普通管理员",
  member: "普通用户",
};

const borrowStatusMeta: Record<BorrowOrderStatus, { label: string; className: string }> = {
  pending: { label: "待审批", className: "pending" },
  approved: { label: "已批准", className: "overview" },
  borrowed: { label: "借出中", className: "borrowed" },
  returned: { label: "已归还", className: "confirmed" },
  cancelled: { label: "已取消", className: "cancelled" },
};

const selectionTitle = (selection: Selection) => {
  if (selection === "ALL") return "全部物品";
  if (selection === "PENDING") return "待分层物品";
  if (isShelf(selection)) return `${selection} 货架`;
  return locationLabel(selection);
};

const defaultCreateLocation = (selection: Selection) => {
  if (locations.some((location) => location.code === selection)) return selection;
  if (isShelf(selection)) return `${selection}1`;
  if (selection === "PENDING") return "PENDING_A";
  return "A1";
};

function LocationSelect({ defaultValue }: { defaultValue: string }) {
  const groups = useMemo(() => Array.from(new Set(locations.map((location) => location.group))), []);
  return (
    <select name="locationCode" defaultValue={defaultValue} required>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {locations.filter((location) => location.group === group).map((location) => (
            <option key={location.code} value={location.code}>{location.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function App() {
  const { client, session, profile } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";
  const isAdmin = profile?.role === "admin";
  const canManageUsers = isSuperAdmin || isAdmin;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [history, setHistory] = useState<LocationHistory[]>([]);
  const [requests, setRequests] = useState<InventoryChangeRequest[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [borrowOrders, setBorrowOrders] = useState<BorrowOrder[]>([]);
  const [borrowItems, setBorrowItems] = useState<DbBorrowItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("inventory");
  const [selection, setSelection] = useState<Selection>("ALL");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ mode: EditorMode; item?: InventoryItem } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [departmentEditor, setDepartmentEditor] = useState<{ mode: EditorMode; department?: Department } | null>(null);
  const [deleteDepartmentId, setDeleteDepartmentId] = useState<number | null>(null);
  const [userEditor, setUserEditor] = useState<ManagedUser | null>(null);
  const [borrowEditorOpen, setBorrowEditorOpen] = useState(false);
  const [borrowStatusFilter, setBorrowStatusFilter] = useState<"all" | BorrowOrderStatus>("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!client || !profile) return;
    setLoading(true);
    setError(null);

    const [itemsResult, historyResult, requestsResult, departmentsResult, usersResult, ordersResult, orderItemsResult] = await Promise.all([
      client.from("inventory_items").select("*").order("id"),
      client.from("inventory_location_history").select("*").order("moved_at", { ascending: false }),
      client.from("inventory_change_requests").select("*").order("created_at", { ascending: false }),
      client.from("departments").select("id, name, description, created_at").order("name"),
      client.from("users").select("id, student_id, name, department_id, phone, email, position, notes, role, is_active, auth_user_id, created_at").order("name"),
      client.from("borrow_orders").select("*").order("created_at", { ascending: false }),
      client.from("borrow_items").select("id, order_id, item_id, quantity_borrowed, quantity_returned, item_condition, notes").order("id"),
    ]);

    const firstError = itemsResult.error ?? historyResult.error ?? requestsResult.error ?? departmentsResult.error
      ?? usersResult.error ?? ordersResult.error ?? orderItemsResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setItems(((itemsResult.data ?? []) as DbInventoryRow[]).map(mapItem));
      setHistory(((historyResult.data ?? []) as DbHistoryRow[]).map(mapHistory));
      setRequests(((requestsResult.data ?? []) as DbRequestRow[]).map(mapRequest));
      setDepartments(((departmentsResult.data ?? []) as DbDepartmentRow[]).map(mapDepartment));
      setManagedUsers(((usersResult.data ?? []) as DbUserRow[]).map(mapUser));
      setBorrowOrders(((ordersResult.data ?? []) as DbBorrowOrderRow[]).map(mapBorrowOrder));
      setBorrowItems((orderItemsResult.data ?? []) as DbBorrowItemRow[]);
    }
    setLoading(false);
  }, [client, profile]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const counts = useMemo(() => {
    const byLocation = new Map<string, number>();
    items.forEach((item) => byLocation.set(item.locationCode, (byLocation.get(item.locationCode) ?? 0) + 1));
    return byLocation;
  }, [items]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return items.filter((item) => matchesSelection(item, selection)).filter((item) =>
      !needle || item.name.toLocaleLowerCase("zh-CN").includes(needle) || item.id.toLowerCase().includes(needle) ||
      item.specification.toLocaleLowerCase("zh-CN").includes(needle) || item.imageName.toLocaleLowerCase("zh-CN").includes(needle) ||
      locationLabel(item.locationCode).toLocaleLowerCase("zh-CN").includes(needle),
    );
  }, [items, query, selection]);

  const pendingLocationCount = items.filter((item) => isPendingLocation(item.locationCode)).length;
  const reviewCount = items.filter((item) => item.status === "pending").length;
  const pendingRequestCount = requests.filter((request) => request.status === "pending").length;
  const pendingBorrowCount = borrowOrders.filter((order) => order.status === "pending").length;
  const selectedDetail = items.find((item) => item.id === detailId) ?? null;
  const visibleManagedUsers = isSuperAdmin ? managedUsers : managedUsers.filter((user) => user.role === "member");
  const visibleBorrowOrders = borrowStatusFilter === "all"
    ? borrowOrders
    : borrowOrders.filter((order) => order.status === borrowStatusFilter);

  const departmentName = (departmentId: number | null) =>
    departments.find((department) => department.id === departmentId)?.name ?? "未分配";

  const userName = (userId: number) => managedUsers.find((user) => user.id === userId)?.name
    ?? (profile?.id === userId ? profile.name : `用户 #${userId}`);

  const orderItemSummary = (orderId: number) => {
    const lines = borrowItems.filter((line) => line.order_id === orderId);
    if (lines.length === 0) return "未读取到借用明细";
    return lines.map((line) => {
      const item = items.find((candidate) => candidate.id === line.item_id);
      return `${item?.name ?? line.item_id} x ${line.quantity_borrowed}`;
    }).join("、");
  };

  const isOverdue = (order: BorrowOrder) => Boolean(
    order.expectedReturnDate
    && !["returned", "cancelled"].includes(order.status)
    && new Date(`${order.expectedReturnDate}T23:59:59`).getTime() < Date.now(),
  );

  const selectLocation = (value: Selection) => {
    setSelection(value);
    setView("inventory");
    setMobileNavOpen(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile || !editor) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const locationCode = String(form.get("locationCode") ?? "PENDING_A");
    const specification = String(form.get("specification") ?? "").trim();
    const quantity = String(form.get("quantity") ?? "若干").trim() || "若干";
    const imageName = String(form.get("imageName") ?? "").trim();
    const imagePath = String(form.get("imagePath") ?? "").trim();
    const recognitionStatus = String(form.get("recognitionStatus") ?? "已确认").trim() || "已确认";
    const reason = String(form.get("reason") ?? "").trim();
    if (!name) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    let succeeded = false;
    if (isSuperAdmin) {
      const result = editor.mode === "create"
        ? await client.rpc("create_inventory_item", {
            p_name: name, p_location_code: locationCode, p_quantity: quantity, p_specification: specification,
            p_image_name: imageName, p_image_path: imagePath, p_recognition_status: recognitionStatus,
          })
        : await client.rpc("update_inventory_item", {
            p_item_id: editor.item!.id, p_name: name, p_location_code: locationCode, p_quantity: quantity,
            p_specification: specification, p_image_name: imageName, p_image_path: imagePath,
            p_recognition_status: recognitionStatus,
          });
      if (result.error) setError(result.error.message);
      else {
        succeeded = true;
        setNotice(editor.mode === "create" ? "物品已创建并写入正式库存。" : "正式库存已更新。");
      }
    } else {
      const { error: requestError } = await client.from("inventory_change_requests").insert({
        request_type: editor.mode === "create" ? "create" : "update",
        item_id: editor.item?.id ?? null,
        proposed_name: name,
        proposed_location_code: locationCode,
        proposed_specification: specification,
        proposed_quantity: quantity,
        proposed_image_name: imageName,
        proposed_image_path: imagePath,
        proposed_recognition_status: recognitionStatus,
        reason: reason || null,
        requested_by: profile.id,
      });
      if (requestError) setError(requestError.message);
      else {
        succeeded = true;
        setNotice("变更请求已提交，批准前不会影响正式库存。");
      }
    }
    setSubmitting(false);
    if (succeeded) {
      setEditor(null);
      await loadData();
    }
  };

  const confirmDelete = async () => {
    if (!client || !profile || !deleteId) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    let succeeded = false;
    if (isSuperAdmin) {
      const { error: deleteError } = await client.rpc("delete_inventory_item", { p_item_id: deleteId });
      if (deleteError) setError(deleteError.message);
      else {
        succeeded = true;
        setNotice("物品已从正式库存删除，编号不会重新分配。");
      }
    } else {
      const { error: requestError } = await client.from("inventory_change_requests").insert({
        request_type: "delete",
        item_id: deleteId,
        reason: "申请删除物品",
        requested_by: profile.id,
      });
      if (requestError) setError(requestError.message);
      else {
        succeeded = true;
        setNotice("删除请求已提交，批准前物品仍保留在正式库存中。");
      }
    }
    setSubmitting(false);
    if (succeeded) {
      setDeleteId(null);
      setDetailId(null);
      await loadData();
    }
  };

  const reviewRequest = async (requestId: number, approve: boolean) => {
    if (!client || !isSuperAdmin) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: reviewError } = await client.rpc("review_inventory_change_request", {
      p_request_id: requestId,
      p_approve: approve,
      p_review_note: approve ? "批准" : "拒绝",
    });
    if (reviewError) setError(reviewError.message);
    else setNotice(approve ? "请求已批准，正式库存已同步。" : "请求已拒绝，正式库存未改变。");
    setSubmitting(false);
    if (!reviewError) await loadData();
  };

  const handleUserSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile || !userEditor || !canManageUsers) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const position = String(form.get("position") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const isActive = form.get("isActive") === "on";
    if (!name) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const result = isSuperAdmin
      ? await client.from("users").update({
          name,
          student_id: String(form.get("studentId") ?? "").trim() || null,
          phone: phone || null,
          email: String(form.get("email") ?? "").trim() || null,
          position: position || null,
          notes: notes || null,
          role: String(form.get("role") ?? userEditor.role),
          department_id: String(form.get("departmentId") ?? "") ? Number(form.get("departmentId")) : null,
          is_active: isActive,
        }).eq("id", userEditor.id)
      : await client.rpc("update_department_member", {
          p_user_id: userEditor.id,
          p_name: name,
          p_phone: phone || null,
          p_position: position || null,
          p_notes: notes || null,
          p_is_active: isActive,
        });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNotice("人员资料已更新。");
    setUserEditor(null);
    await loadData();
  };

  const handleBorrowSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: createError } = await client.rpc("create_borrow_order", {
      p_item_id: String(form.get("itemId") ?? ""),
      p_quantity: Number(form.get("quantity") ?? 1),
      p_reason: String(form.get("reason") ?? "").trim(),
      p_expected_return_date: String(form.get("expectedReturnDate") ?? ""),
      p_notes: String(form.get("notes") ?? "").trim() || null,
    });
    setSubmitting(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setNotice("借用申请已提交，等待管理员审批。");
    setBorrowEditorOpen(false);
    setView("borrows");
    await loadData();
  };

  const updateBorrowStatus = async (orderId: number, status: BorrowOrderStatus) => {
    if (!client || (!isSuperAdmin && !isAdmin)) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: updateError } = await client.rpc("update_borrow_order_status", {
      p_order_id: orderId,
      p_status: status,
      p_notes: null,
    });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNotice("借用订单状态已更新。");
    await loadData();
  };

  const handleDepartmentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !isSuperAdmin || !departmentEditor) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!name) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const result = departmentEditor.mode === "create"
      ? await client.from("departments").insert({ name, description: description || null })
      : await client.from("departments").update({ name, description: description || null }).eq("id", departmentEditor.department!.id);
    setSubmitting(false);

    if (result.error) {
      setError(result.error.code === "23505" ? "部门名称已存在，请使用其他名称。" : result.error.message);
      return;
    }

    setNotice(departmentEditor.mode === "create" ? "部门已新增。" : "部门信息已更新。");
    setDepartmentEditor(null);
    await loadData();
  };

  const confirmDepartmentDelete = async () => {
    if (!client || !isSuperAdmin || deleteDepartmentId === null) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: deleteError } = await client.from("departments").delete().eq("id", deleteDepartmentId);
    setSubmitting(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setNotice("部门已删除，原有关联用户和历史订单已改为未分配部门。");
    setDeleteDepartmentId(null);
    await loadData();
  };

  const departmentUsage = (departmentId: number) => ({
    users: managedUsers.filter((user) => user.departmentId === departmentId).length,
    orders: borrowOrders.filter((order) => order.departmentId === departmentId).length,
  });

  const navCount = (code: string) => counts.get(code) ?? 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen((open) => !open)} aria-label="打开位置导航" title="位置导航"><Menu size={20} /></button>
        <div className="brand-mark"><Boxes size={20} /></div>
        <div className="brand-copy"><strong>514 仓库</strong><span>物品管理台</span></div>
        <div className="topbar-summary"><span><Box size={16} /> {items.length} 件物品</span><span><ClipboardList size={16} /> {pendingRequestCount} 个待审批</span><span><PackageCheck size={16} /> {pendingBorrowCount} 个借用待处理</span></div>
        <span className="account-email" title={session?.user.email}>{profile?.name} · {profile?.role}</span>
        <button className="icon-button sign-out-button" onClick={() => client?.auth.signOut()} aria-label="退出登录" title="退出登录"><LogOut size={18} /></button>
        <button className="primary-button" onClick={() => { setView("inventory"); setEditor({ mode: "create" }); }}><PackagePlus size={18} /><span>{isSuperAdmin ? "新增物品" : "申请新增"}</span></button>
      </header>

      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-header"><span>存放位置</span><button className="icon-button close-nav" onClick={() => setMobileNavOpen(false)} aria-label="关闭导航"><X size={18} /></button></div>
        <nav aria-label="仓库位置">
          <button className={`nav-row ${selection === "ALL" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("ALL")}><Archive size={17} /><span>全部物品</span><b>{items.length}</b></button>
          {['A', 'B', 'C', 'D'].map((shelf) => (
            <div className="shelf-group" key={shelf}>
              <button className={`nav-row shelf ${selection === shelf && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation(shelf)}><Layers3 size={17} /><span>{shelf} 货架</span><b>{items.filter((item) => matchesSelection(item, shelf)).length}</b></button>
              <div className="level-grid">{[1, 2, 3, 4].map((level) => { const code = `${shelf}${level}`; return <button key={code} className={selection === code && view === "inventory" ? "active" : ""} onClick={() => selectLocation(code)}><span>{level} 层</span><b>{navCount(code)}</b></button>; })}</div>
            </div>
          ))}
          <div className="nav-divider" />
          <button className={`nav-row ${selection === "FLOOR" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("FLOOR")}><MapPin size={17} /><span>地板区域</span><b>{navCount("FLOOR")}</b></button>
          <button className={`nav-row ${selection === "DOOR" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("DOOR")}><DoorOpen size={17} /><span>门后区域</span><b>{navCount("DOOR")}</b></button>
          <button className={`nav-row pending-nav ${selection === "PENDING" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("PENDING")}><CircleAlert size={17} /><span>待分层</span><b>{pendingLocationCount}</b></button>
          <div className="nav-divider" />
          <button className={`nav-row ${view === "requests" ? "active" : ""}`} onClick={() => { setView("requests"); setMobileNavOpen(false); }}><ClipboardList size={17} /><span>{isSuperAdmin ? "变更审批" : "我的申请"}</span><b>{pendingRequestCount}</b></button>
          <button className={`nav-row ${view === "borrows" ? "active" : ""}`} onClick={() => { setView("borrows"); setMobileNavOpen(false); }}><PackageCheck size={17} /><span>借用监管</span><b>{pendingBorrowCount}</b></button>
          {canManageUsers && <button className={`nav-row ${view === "users" ? "active" : ""}`} onClick={() => { setView("users"); setMobileNavOpen(false); }}><UsersRound size={17} /><span>人员管理</span><b>{visibleManagedUsers.length}</b></button>}
          {isSuperAdmin && <button className={`nav-row ${view === "departments" ? "active" : ""}`} onClick={() => { setView("departments"); setMobileNavOpen(false); }}><Building2 size={17} /><span>部门管理</span><b>{departments.length}</b></button>}
        </nav>
      </aside>

      {mobileNavOpen && <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-content">
        {notice && <div className="page-notice" role="status"><Check size={17} />{notice}<button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={15} /></button></div>}
        {error && <div className="page-error" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError(null)} aria-label="关闭错误"><X size={15} /></button></div>}

        {view === "inventory" ? (
          <>
            <div className="content-heading">
              <div><p className="eyebrow">正式库存</p><h1>{selectionTitle(selection)}</h1><p>{visibleItems.length} 件匹配物品</p></div>
              <button className="primary-button heading-add" onClick={() => setEditor({ mode: "create" })}><PackagePlus size={18} />{isSuperAdmin ? "新增" : "申请新增"}</button>
            </div>

            <section className="metrics" aria-label="库存概览">
              <div><span>库存总数</span><strong>{items.length}</strong><small>仅含已批准数据</small></div>
              <div><span>正式归位</span><strong>{items.length - pendingLocationCount}</strong><small>A1-D4 / 区域</small></div>
              <div className={pendingLocationCount ? "attention" : ""}><span>待分层</span><strong>{pendingLocationCount}</strong><small>保留原货架线索</small></div>
              <div className={reviewCount ? "attention" : ""}><span>名称待核对</span><strong>{reviewCount}</strong><small>视觉识别待确认</small></div>
            </section>

            <section className="inventory-panel">
              <div className="toolbar">
                <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、编号、规格、图片或位置" />{query && <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={16} /></button>}</label>
                <button className="icon-button" onClick={() => void loadData()} aria-label="刷新数据" title="刷新"><RefreshCw size={17} /></button>
                <span className="result-count">显示 {visibleItems.length} / {items.length}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>物品</th><th>唯一编号</th><th>当前位置</th><th>规格 / 数量</th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead>
                  <tbody>{visibleItems.map((item) => { const meta = statusMeta(item); return (
                    <tr key={item.id} onClick={() => setDetailId(item.id)}>
                      <td><div className="item-cell">{item.imagePath ? <img src={item.imagePath} alt="" /> : <div className="image-placeholder"><Box size={20} /></div>}<div><strong>{item.name}</strong><small>{item.imageName || item.recognitionStatus}</small></div></div></td>
                      <td><code>{item.id}</code></td>
                      <td><span className={`location-pill ${isPendingLocation(item.locationCode) ? "pending" : ""}`}><MapPin size={14} />{locationLabel(item.locationCode)}</span></td>
                      <td><div className="spec-cell"><span>{item.specification || "未填写规格"}</span><strong>{item.quantity}</strong></div></td>
                      <td><span className={`status-badge ${meta.className}`}>{meta.text}</span></td>
                      <td className="action-cell"><button className="icon-button" onClick={(event) => { event.stopPropagation(); setEditor({ mode: "edit", item }); }} aria-label={`${isSuperAdmin ? "编辑" : "申请修改"} ${item.name}`} title={isSuperAdmin ? "编辑" : "申请修改"}><Edit3 size={17} /></button><button className="icon-button more" onClick={(event) => { event.stopPropagation(); setDetailId(item.id); }} aria-label={`查看 ${item.name}`} title="查看详情"><MoreHorizontal size={18} /></button></td>
                    </tr>
                  ); })}</tbody>
                </table>
                {!loading && visibleItems.length === 0 && <div className="empty-state"><Search size={26} /><strong>没有匹配的物品</strong><span>调整位置筛选或搜索内容</span></div>}
                {loading && <div className="empty-state"><RefreshCw className="spin" size={24} /><strong>正在读取正式库存</strong></div>}
              </div>
            </section>
          </>
        ) : view === "requests" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">数据请求</p><h1>{isSuperAdmin ? "变更审批" : "我的申请"}</h1><p>{pendingRequestCount} 个待处理请求</p></div><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button></div>
            <section className="inventory-panel request-panel">
              <div className="table-wrap"><table>
                <thead><tr><th>请求</th><th>目标</th><th>建议数据</th><th>提交时间</th><th>状态</th>{isSuperAdmin && <th>审批</th>}</tr></thead>
                <tbody>{requests.map((request) => { const type = requestMeta[request.requestType]; const state = requestStatusMeta[request.status]; return (
                  <tr key={request.id}>
                    <td><span className={`status-badge ${type.className}`}>{type.label}</span></td>
                    <td><code>{request.itemId ?? request.resultItemId ?? "待分配编号"}</code></td>
                    <td><div className="request-summary"><strong>{request.proposedName ?? items.find((item) => item.id === request.itemId)?.name ?? "-"}</strong><span>{request.proposedSpecification || "无规格变更"} · {request.proposedQuantity || "无数量变更"}</span>{request.reason && <small>{request.reason}</small>}</div></td>
                    <td>{new Date(request.createdAt).toLocaleString("zh-CN")}</td>
                    <td><span className={`status-badge ${state.className}`}>{state.label}</span></td>
                    {isSuperAdmin && <td className="review-actions">{request.status === "pending" ? <><button className="icon-button approve" onClick={() => void reviewRequest(request.id, true)} disabled={submitting} aria-label="批准" title="批准"><Check size={17} /></button><button className="icon-button reject" onClick={() => void reviewRequest(request.id, false)} disabled={submitting} aria-label="拒绝" title="拒绝"><Ban size={17} /></button></> : <span>-</span>}</td>}
                  </tr>
                ); })}</tbody>
              </table>{!loading && requests.length === 0 && <div className="empty-state"><ClipboardList size={26} /><strong>暂无变更请求</strong><span>库存正式数据与请求数据保持隔离</span></div>}</div>
            </section>
          </>
        ) : view === "users" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">账户与权限</p><h1>人员管理</h1><p>{isSuperAdmin ? "超级管理员可调整角色、部门与启用状态。" : `仅显示${departmentName(profile?.departmentId ?? null)}的普通用户，可维护人员资料。`}</p></div><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button></div>
            <section className="inventory-panel user-panel">
              <div className="table-wrap"><table><thead><tr><th>人员</th><th>角色</th><th>部门 / 职位</th><th>联系方式</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>{visibleManagedUsers.map((user) => (
                <tr key={user.id}>
                  <td><div className="user-cell"><strong>{user.name}</strong><small>{user.studentId || `用户 #${user.id}`} · {user.email || "未绑定邮箱"}</small></div></td>
                  <td><span className={`status-badge ${user.role === "super_admin" ? "overview" : user.role === "admin" ? "borrowed" : "confirmed"}`}>{roleMeta[user.role]}</span></td>
                  <td><div className="user-cell"><strong>{departmentName(user.departmentId)}</strong><small>{user.position || "未填写职位"}</small></div></td>
                  <td>{user.phone || "未填写"}</td>
                  <td><span className={`status-badge ${user.isActive ? "confirmed" : "cancelled"}`}>{user.isActive ? "启用" : "已停用"}</span></td>
                  <td className="action-cell"><button className="secondary-button compact-button" onClick={() => setUserEditor(user)}><Edit3 size={15} />编辑</button></td>
                </tr>
              ))}</tbody></table>{!loading && visibleManagedUsers.length === 0 && <div className="empty-state"><UsersRound size={27} /><strong>暂无可管理人员</strong><span>先在 Supabase Auth 创建账号，再关联用户资料</span></div>}</div>
            </section>
          </>
        ) : view === "borrows" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">借用状态监管</p><h1>借用订单</h1><p>{isSuperAdmin ? "查看并处理全部部门订单。" : isAdmin ? `查看${departmentName(profile?.departmentId ?? null)}本部门订单。` : "查看自己的借用申请和归还状态。"}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button><button className="primary-button" onClick={() => setBorrowEditorOpen(true)}><CalendarClock size={17} />申请借用</button></div></div>
            <section className="borrow-filters" aria-label="订单状态筛选">{(["all", "pending", "approved", "borrowed", "returned", "cancelled"] as const).map((status) => <button key={status} className={borrowStatusFilter === status ? "active" : ""} onClick={() => setBorrowStatusFilter(status)}>{status === "all" ? "全部" : borrowStatusMeta[status].label}</button>)}</section>
            <section className="inventory-panel borrow-panel"><div className="table-wrap"><table><thead><tr><th>订单</th><th>借用人 / 部门</th><th>物品明细</th><th>预计归还</th><th>状态</th><th>处理</th></tr></thead><tbody>{visibleBorrowOrders.map((order) => { const status = borrowStatusMeta[order.status]; return <tr key={order.id}><td><div className="user-cell"><strong>{order.orderNumber}</strong><small>{new Date(order.createdAt).toLocaleString("zh-CN")}</small></div></td><td><div className="user-cell"><strong>{userName(order.userId)}</strong><small>{departmentName(order.departmentId)}</small></div></td><td><div className="request-summary"><strong>{orderItemSummary(order.id)}</strong>{order.reason && <small>{order.reason}</small>}</div></td><td><span className={isOverdue(order) ? "overdue" : ""}>{order.expectedReturnDate || "未填写"}</span>{isOverdue(order) && <small className="overdue-label">已逾期</small>}</td><td><span className={`status-badge ${status.className}`}>{status.label}</span></td><td>{(isSuperAdmin || isAdmin) ? <select className="status-select" value={order.status} onChange={(event) => void updateBorrowStatus(order.id, event.target.value as BorrowOrderStatus)} disabled={submitting}>{Object.entries(borrowStatusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select> : <span className="muted-text">等待管理员</span>}</td></tr>; })}</tbody></table>{!loading && visibleBorrowOrders.length === 0 && <div className="empty-state"><PackageCheck size={27} /><strong>暂无借用订单</strong><span>提交借用申请后，订单会显示在这里</span></div>}</div></section>
          </>
        ) : (
          <>
            <div className="content-heading">
              <div><p className="eyebrow">组织架构</p><h1>部门管理</h1><p>维护当前可用部门，删除部门不会删除用户或借用订单。</p></div>
              <div className="heading-actions"><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button><button className="primary-button" onClick={() => setDepartmentEditor({ mode: "create" })}><Building2 size={17} />新增部门</button></div>
            </div>
            <section className="department-grid" aria-label="部门列表">
              {departments.map((department) => {
                const usage = departmentUsage(department.id);
                return (
                  <article className="department-card" key={department.id}>
                    <div className="department-card-header"><div className="department-icon"><Building2 size={19} /></div><div><h2>{department.name}</h2><span>部门编号 #{department.id}</span></div></div>
                    <p>{department.description || "暂无部门说明"}</p>
                    <dl className="department-stats"><div><dt>关联用户</dt><dd>{usage.users}</dd></div><div><dt>借用订单</dt><dd>{usage.orders}</dd></div></dl>
                    <div className="department-actions"><button className="secondary-button" onClick={() => setDepartmentEditor({ mode: "edit", department })}><Edit3 size={16} />编辑</button><button className="danger-button" onClick={() => setDeleteDepartmentId(department.id)}><Trash2 size={16} />删除</button></div>
                  </article>
                );
              })}
              {!loading && departments.length === 0 && <div className="empty-state"><Building2 size={27} /><strong>暂无部门</strong><span>使用右上角按钮添加部门</span></div>}
            </section>
          </>
        )}
      </main>

      {editor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
            <header><div><p className="eyebrow">{isSuperAdmin ? "正式库存" : "变更申请"}</p><h2 id="editor-title">{editor.mode === "create" ? (isSuperAdmin ? "新增物品" : "申请新增物品") : (isSuperAdmin ? "编辑物品" : "申请修改物品")}</h2></div><button className="icon-button" onClick={() => setEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleSubmit}>
              {editor.mode === "edit" && <label><span>唯一编号</span><input value={editor.item?.id} disabled /><small>编号由数据库永久分配，不能修改或复用</small></label>}
              <label><span>物品名称</span><input name="name" defaultValue={editor.item?.name ?? ""} autoFocus required maxLength={80} /></label>
              <label><span>规格</span><input name="specification" defaultValue={editor.item?.specification ?? ""} maxLength={100} placeholder="尺寸、型号或包装规格" /></label>
              <label><span>数量</span><input name="quantity" defaultValue={editor.item?.quantity ?? "若干"} maxLength={30} /></label>
              <label><span>存放位置</span><LocationSelect defaultValue={editor.item?.locationCode ?? defaultCreateLocation(selection)} /></label>
              <label><span>图片文件名</span><input name="imageName" defaultValue={editor.item?.imageName ?? ""} maxLength={180} /></label>
              <label><span>图片路径</span><input name="imagePath" defaultValue={editor.item?.imagePath ?? ""} maxLength={300} /></label>
              <label><span>识别状态</span><input name="recognitionStatus" defaultValue={editor.item?.recognitionStatus ?? "已确认"} maxLength={80} /></label>
              {!isSuperAdmin && <label><span>申请说明</span><textarea name="reason" rows={3} maxLength={300} placeholder="说明新增或修改原因" required /></label>}
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "提交中..." : isSuperAdmin ? "写入正式库存" : <><Send size={16} />提交审批</>}</button></div>
            </form>
          </section>
        </div>
      )}

      {departmentEditor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setDepartmentEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="department-editor-title">
            <header><div><p className="eyebrow">组织架构</p><h2 id="department-editor-title">{departmentEditor.mode === "create" ? "新增部门" : "编辑部门"}</h2></div><button className="icon-button" onClick={() => setDepartmentEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleDepartmentSubmit}>
              <label><span>部门名称</span><input name="name" defaultValue={departmentEditor.department?.name ?? ""} autoFocus required maxLength={80} placeholder="例如：宣传部" /></label>
              <label><span>部门说明</span><textarea name="description" defaultValue={departmentEditor.department?.description ?? ""} rows={4} maxLength={300} placeholder="描述部门职责或备注（可选）" /></label>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setDepartmentEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "保存中..." : "保存部门"}</button></div>
            </form>
          </section>
        </div>
      )}

      {userEditor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setUserEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="user-editor-title">
            <header><div><p className="eyebrow">账户与权限</p><h2 id="user-editor-title">编辑人员</h2></div><button className="icon-button" onClick={() => setUserEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleUserSubmit}>
              <label><span>姓名</span><input name="name" defaultValue={userEditor.name} autoFocus required maxLength={80} /></label>
              <label><span>学号 / 工号</span><input name="studentId" defaultValue={userEditor.studentId ?? ""} disabled={!isSuperAdmin} maxLength={80} /></label>
              <label><span>邮箱</span><input name="email" type="email" defaultValue={userEditor.email ?? ""} disabled={!isSuperAdmin} maxLength={160} /></label>
              <label><span>电话</span><input name="phone" defaultValue={userEditor.phone ?? ""} maxLength={40} /></label>
              <label><span>职位</span><input name="position" defaultValue={userEditor.position ?? ""} placeholder="部长、副部长、干事" maxLength={40} /></label>
              {isSuperAdmin && <label><span>角色</span><select name="role" defaultValue={userEditor.role}>{Object.entries(roleMeta).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              {isSuperAdmin && <label><span>部门</span><select name="departmentId" defaultValue={userEditor.departmentId ?? ""}><option value="">未分配</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
              <label><span>备注</span><textarea name="notes" defaultValue={userEditor.notes ?? ""} rows={3} maxLength={300} /></label>
              <label className="checkbox-label"><input type="checkbox" name="isActive" defaultChecked={userEditor.isActive} /><span>账号启用</span></label>
              {!isSuperAdmin && <small className="form-hint">普通管理员只能维护本部门普通用户的资料，不能修改角色、部门或 Auth 绑定。</small>}
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setUserEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "保存中..." : "保存人员"}</button></div>
            </form>
          </section>
        </div>
      )}

      {borrowEditorOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setBorrowEditorOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="borrow-editor-title">
            <header><div><p className="eyebrow">库存借用</p><h2 id="borrow-editor-title">申请借用物品</h2></div><button className="icon-button" onClick={() => setBorrowEditorOpen(false)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleBorrowSubmit}>
              <label><span>物品</span><select name="itemId" defaultValue={items[0]?.id ?? ""} required>{items.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name} · {item.quantity}</option>)}</select></label>
              <label><span>借用数量</span><input name="quantity" type="number" min={1} defaultValue={1} required /></label>
              <label><span>预计归还日期</span><input name="expectedReturnDate" type="date" min={new Date().toISOString().slice(0, 10)} required /></label>
              <label><span>借用理由</span><textarea name="reason" rows={3} required maxLength={300} placeholder="填写活动或工作用途" /></label>
              <label><span>备注</span><textarea name="notes" rows={2} maxLength={300} placeholder="可选" /></label>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setBorrowEditorOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "提交中..." : "提交借用申请"}</button></div>
            </form>
          </section>
        </div>
      )}

      {selectedDetail && (
        <div className="drawer-layer" onMouseDown={(event) => event.currentTarget === event.target && setDetailId(null)}>
          <aside className="detail-drawer" aria-label="物品详情">
            <header><div><p className="eyebrow">正式库存</p><h2>{selectedDetail.name}</h2></div><button className="icon-button" onClick={() => setDetailId(null)} aria-label="关闭"><X size={20} /></button></header>
            {selectedDetail.imagePath ? <img className="detail-image" src={selectedDetail.imagePath} alt={selectedDetail.name} /> : <div className="detail-image placeholder"><Box size={38} /></div>}
            <dl className="detail-list"><div><dt>唯一编号</dt><dd><code>{selectedDetail.id}</code></dd></div><div><dt>存放位置</dt><dd>{locationLabel(selectedDetail.locationCode)}</dd></div><div><dt>规格</dt><dd>{selectedDetail.specification || "未填写"}</dd></div><div><dt>数量</dt><dd>{selectedDetail.quantity}</dd></div><div><dt>图片文件名</dt><dd>{selectedDetail.imageName || "未填写"}</dd></div><div><dt>识别状态</dt><dd>{selectedDetail.recognitionStatus}</dd></div></dl>
            <div className="drawer-actions"><button className="primary-button" onClick={() => { setEditor({ mode: "edit", item: selectedDetail }); setDetailId(null); }}><Edit3 size={17} />{isSuperAdmin ? "编辑" : "申请修改"}</button><button className="danger-button" onClick={() => setDeleteId(selectedDetail.id)}><Trash2 size={17} />{isSuperAdmin ? "删除物品" : "申请删除"}</button></div>
            <section className="history-section"><h3><Clock3 size={17} />位置记录</h3>{history.filter((entry) => entry.itemId === selectedDetail.id).length === 0 ? <p>暂无位置变更记录</p> : <ol>{history.filter((entry) => entry.itemId === selectedDetail.id).map((entry) => <li key={entry.id}><span>{locationLabel(entry.fromLocation ?? "")}</span><ChevronRight size={15} /><strong>{locationLabel(entry.toLocation)}</strong><time>{new Date(entry.movedAt).toLocaleString("zh-CN")}</time></li>)}</ol>}</section>
          </aside>
        </div>
      )}

      {deleteId && (
        <div className="modal-layer" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 size={22} /></div><h2>{isSuperAdmin ? "删除这个物品？" : "提交删除申请？"}</h2><p>{items.find((item) => item.id === deleteId)?.name}（{deleteId}）{isSuperAdmin ? "将从正式库存中移除，编号不会再次分配。" : "会保留在正式库存中，直到超级管理员批准。"}</p><div className="form-actions"><button className="secondary-button" onClick={() => setDeleteId(null)}>取消</button><button className="danger-button solid" onClick={() => void confirmDelete()} disabled={submitting}>{isSuperAdmin ? "确认删除" : "提交申请"}</button></div></section></div>
      )}

      {deleteDepartmentId !== null && (
        <div className="modal-layer" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 size={22} /></div><h2>删除这个部门？</h2><p>“{departments.find((department) => department.id === deleteDepartmentId)?.name}”删除后，关联用户和借用订单会保留，但部门字段会变为未分配。</p><div className="form-actions"><button className="secondary-button" onClick={() => setDeleteDepartmentId(null)}>取消</button><button className="danger-button solid" onClick={() => void confirmDepartmentDelete()} disabled={submitting}>{submitting ? "删除中..." : "确认删除"}</button></div></section></div>
      )}
    </div>
  );
}

export default App;
