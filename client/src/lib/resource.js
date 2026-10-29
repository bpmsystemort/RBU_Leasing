import { api } from "./api.js";

export function resource(path) {
  return {
    list: (params) => api.get(path, { params }).then((r) => r.data),
    get: (id) => api.get(`${path}/${id}`).then((r) => r.data),
    create: (data) => api.post(path, data).then((r) => r.data),
    update: (id, data) => api.patch(`${path}/${id}`, data).then((r) => r.data),
    remove: (id) => api.delete(`${path}/${id}`).then((r) => r.data),
  };
}

export const owners = resource("/owners");
owners.profile = (id) => api.get(`/owners/${id}/profile`).then((r) => r.data);
export function ownerMe() { return api.get("/owners/me").then((r) => r.data); }
export function tenantMe() { return api.get("/tenants/me").then((r) => r.data); }
export const units = resource("/units");
export const tenants = resource("/tenants");
export const leases = resource("/leases");
export const estates = resource("/estates");
export const towers = resource("/towers");
export const cmsForms = resource("/cms/forms");

// CMS page-form slots (Super Admin configures a field set per role + nav page).
export const pageForms = {
  list: () => api.get("/cms/page-forms").then((r) => r.data),
  get: (role, pageKey) => api.get(`/cms/page-forms/${role}/${pageKey}`).then((r) => r.data),
  save: (role, pageKey, data) => api.put(`/cms/page-forms/${role}/${pageKey}`, data).then((r) => r.data),
  remove: (role, pageKey) => api.delete(`/cms/page-forms/${role}/${pageKey}`).then((r) => r.data),
  entries: (role, pageKey) => api.get(`/cms/page-forms/${role}/${pageKey}/entries`).then((r) => r.data),
};

// The signed-in user's own view of a page form (the fields configured for their
// role + the page they're on, and their saved answers).
export const myPageForm = {
  get: (pageKey) => api.get(`/page-forms/mine/${pageKey}`).then((r) => r.data),
  save: (pageKey, data) => api.put(`/page-forms/mine/${pageKey}`, { data }).then((r) => r.data),
};

// Leasing process tracker — one shared transaction per leasing deal.
export const leasingTransactions = {
  list: () => api.get("/leasing-transactions").then((r) => r.data),
  get: (id) => api.get(`/leasing-transactions/${id}`).then((r) => r.data),
  create: (data) => api.post("/leasing-transactions", data).then((r) => r.data),
  setStatus: (id, data) => api.patch(`/leasing-transactions/${id}/status`, data).then((r) => r.data),
  advance: (id, data) => api.patch(`/leasing-transactions/${id}/advance`, data || {}).then((r) => r.data),
  returnStage: (id, data) => api.patch(`/leasing-transactions/${id}/return`, data || {}).then((r) => r.data),
  link: (id, data) => api.patch(`/leasing-transactions/${id}/link`, data).then((r) => r.data),
  remove: (id) => api.delete(`/leasing-transactions/${id}`).then((r) => r.data),
  mine: () => api.get("/leasing-transactions/mine").then((r) => r.data),
  getMine: (id) => api.get(`/leasing-transactions/mine/${id}`).then((r) => r.data),
  // supporting documents
  uploadDocument: (id, file, docType = null) => {
    const form = new FormData();
    form.append("file", file);
    if (docType) form.append("docType", docType);
    return api.post(`/leasing-transactions/${id}/documents`, form).then((r) => r.data);
  },
  deleteDocument: (id, docId) => api.delete(`/leasing-transactions/${id}/documents/${docId}`).then((r) => r.data),
  async downloadDocument(id, docId, filename) {
    const res = await api.get(`/leasing-transactions/${id}/documents/${docId}/download`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
  // approval routing
  approvalSteps: (id) => api.get(`/leasing-transactions/${id}/approval-steps`).then((r) => r.data),
  decideStep: (id, stepId, data) => api.patch(`/leasing-transactions/${id}/approval-steps/${stepId}`, data).then((r) => r.data),
};

export function assignOwner(id, assignedOfficerId) {
  return api.patch(`/owners/${id}/assign`, { assignedOfficerId }).then((r) => r.data);
}
export function approveUnit(id) {
  return api.patch(`/units/${id}/approve`).then((r) => r.data);
}
export function rejectUnit(id, remarks) {
  return api.patch(`/units/${id}/reject`, { remarks }).then((r) => r.data);
}
export function submitUnit(id) {
  return api.patch(`/units/${id}/submit`).then((r) => r.data);
}
export function createUser(payload) {
  return api.post("/auth/register", payload).then((r) => r.data);
}
// Account approval queue — portal self-signups awaiting an ADMIN or O-Lease
// decision. Approving is what creates the linked Owner/Tenant record.
export const pendingAccounts = {
  list: () => api.get("/auth/pending").then((r) => r.data),
  approve: (id) => api.patch(`/auth/pending/${id}/approve`).then((r) => r.data),
  reject: (id, reason) => api.patch(`/auth/pending/${id}/reject`, { reason }).then((r) => r.data),
  revise: (id, remarks) => api.patch(`/auth/pending/${id}/revise`, { remarks }).then((r) => r.data),
};

export function listUsers() {
  return api.get("/auth/users").then((r) => r.data);
}
export function updateUser(id, payload) {
  return api.patch(`/auth/users/${id}`, payload).then((r) => r.data);
}
export function deleteUser(id) {
  return api.delete(`/auth/users/${id}`).then((r) => r.data);
}

export const appointments = {
  forTransaction: (txnId) => api.get(`/appointments/transaction/${txnId}`).then((r) => r.data),
  mine: () => api.get("/appointments/mine").then((r) => r.data),
  schedule: (txnId, stage, body) => api.post(`/appointments/transaction/${txnId}/${stage}`, body).then((r) => r.data),
  confirm: (id) => api.patch(`/appointments/${id}/confirm`).then((r) => r.data),
  propose: (id, body) => api.patch(`/appointments/${id}/propose`, body).then((r) => r.data),
  reschedule: (id, body) => api.patch(`/appointments/${id}/reschedule`, body).then((r) => r.data),
  complete: (id, body) => api.patch(`/appointments/${id}/complete`, body).then((r) => r.data),
  cancel: (id, body) => api.patch(`/appointments/${id}/cancel`, body).then((r) => r.data),
};

export const lessorRequirements = {
  mine: () => api.get("/lessor-requirements/mine").then((r) => r.data),
  forOwner: (id) => api.get(`/lessor-requirements/${id}`).then((r) => r.data),
  uploadMine: (key, file) => {
    const form = new FormData(); form.append("file", file);
    return api.post(`/lessor-requirements/mine/${key}`, form).then((r) => r.data);
  },
  uploadFor: (ownerId, key, file) => {
    const form = new FormData(); form.append("file", file);
    return api.post(`/lessor-requirements/${ownerId}/${key}`, form).then((r) => r.data);
  },
  review: (id, body) => api.patch(`/lessor-requirements/${id}/review`, body).then((r) => r.data),
  download: async (id) => {
    const res = await api.get(`/lessor-requirements/${id}/download`, { responseType: "blob" });
    return res.data;
  },
};

// Admin bulk portfolio upload (.xlsx) — see PortfolioImportView.
export const portfolioImport = {
  preview: (file) => { const f = new FormData(); f.append("file", file); return api.post("/import/portfolio/preview", f).then((r) => r.data); },
  commit: (file) => { const f = new FormData(); f.append("file", file); return api.post("/import/portfolio/commit", f).then((r) => r.data); },
};

// The lessee's document checklist — the mirror of lessorRequirements above.
export const lesseeRequirements = {
  mine: () => api.get("/lessee-requirements/mine").then((r) => r.data),
  forTenant: (id) => api.get(`/lessee-requirements/${id}`).then((r) => r.data),
  uploadMine: (key, file) => {
    const form = new FormData(); form.append("file", file);
    return api.post(`/lessee-requirements/mine/${key}`, form).then((r) => r.data);
  },
  uploadFor: (tenantId, key, file) => {
    const form = new FormData(); form.append("file", file);
    return api.post(`/lessee-requirements/${tenantId}/${key}`, form).then((r) => r.data);
  },
  review: (id, body) => api.patch(`/lessee-requirements/${id}/review`, body).then((r) => r.data),
  download: async (id) => {
    const res = await api.get(`/lessee-requirements/${id}/download`, { responseType: "blob" });
    return res.data;
  },
};

export const unitListings = {
  listAll: () => api.get("/unit-listings").then((r) => r.data),
  get: (unitId) => api.get(`/unit-listings/${unitId}`).then((r) => r.data),
  update: (unitId, body) => api.patch(`/unit-listings/${unitId}`, body).then((r) => r.data),
  addPhoto: (unitId, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/unit-listings/${unitId}/photos`, form).then((r) => r.data);
  },
  deletePhoto: (unitId, photoId) => api.delete(`/unit-listings/${unitId}/photos/${photoId}`).then((r) => r.data),
  reorder: (unitId, orderedIds) => api.patch(`/unit-listings/${unitId}/photos/reorder`, { orderedIds }).then((r) => r.data),
  caption: (unitId, photoId, caption) => api.patch(`/unit-listings/${unitId}/photos/${photoId}`, { caption }).then((r) => r.data),
  setCover: (unitId, photoId) => api.patch(`/unit-listings/${unitId}/cover`, { photoId }).then((r) => r.data),
  publish: (unitId) => api.patch(`/unit-listings/${unitId}/publish`).then((r) => r.data),
  unpublish: (unitId) => api.patch(`/unit-listings/${unitId}/unpublish`).then((r) => r.data),
  staffImageUrl: (unitId, photoId) => `/api/unit-listings/${unitId}/photos/${photoId}/image`,
};
export const publicUnits = {
  list: (params) => api.get("/public/units", { params }).then((r) => r.data),
  get: (unitId) => api.get(`/public/units/${unitId}`).then((r) => r.data),
  photoUrl: (photoId) => `/api/public/units/photo/${photoId}`,
};

// Reference data for the signed-out signup page — names only. The staff-facing
// `estates`/`towers` above require a token and cannot be used there.
export const publicRefs = {
  estates: () => api.get("/public/estates").then((r) => r.data),
  towers: (estateId) => api.get("/public/towers", { params: { estateId } }).then((r) => r.data),
};

// A non-approved account's session is restricted to these two routes on the
// server. This page is the only thing such a session can reach.
export const application = {
  get: () => api.get("/auth/application").then((r) => r.data),
  resubmit: (unit) => api.patch("/auth/application", { unit }).then((r) => r.data),
};
