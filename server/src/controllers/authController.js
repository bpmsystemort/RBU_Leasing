import {
  loginUser, registerUser, signupPortalUser, listUsers, updateUser, deleteUser,
  listPendingAccounts, approveAccount, rejectAccount, reviseAccount,
  getApplication, resubmitApplication, suspendUser, restoreUser,
} from "../services/authService.js";
import {
  registerSchema, signupSchema, updateUserSchema, approveSchema, rejectAccountSchema, reviseAccountSchema,
  resubmitSchema,
} from "../validation/user.js";

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await loginUser({ email, password });
    res.json(result);
  } catch (err) { next(err); }
}

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const user = await registerUser(data);
    res.status(201).json(user);
  } catch (err) { next(err); }
}

// Public: a lessor/lessee applies for an account. No session is returned — the
// application waits for an ADMIN or LEASING_OFFICER to approve it.
export async function signup(req, res, next) {
  try {
    const data = signupSchema.parse(req.body);
    res.status(201).json(await signupPortalUser(data));
  } catch (err) { next(err); }
}

export async function pendingAccounts(req, res, next) {
  try {
    res.json(await listPendingAccounts());
  } catch (err) { next(err); }
}

export async function approve(req, res, next) {
  try {
    // Approving with no body at all is the common case (nothing to link to):
    // req.body is left undefined rather than {} when the request carries no
    // JSON payload, so default it before validating an all-optional schema.
    const { existingUnitOwnerId } = approveSchema.parse(req.body || {});
    res.json(await approveAccount(req.params.id, req.user, { existingUnitOwnerId }));
  } catch (err) { next(err); }
}

export async function reject(req, res, next) {
  try {
    const { reason } = rejectAccountSchema.parse(req.body);
    res.json(await rejectAccount(req.params.id, req.user, reason));
  } catch (err) { next(err); }
}

export async function revise(req, res, next) {
  try {
    const { remarks } = reviseAccountSchema.parse(req.body);
    res.json(await reviseAccount(req.params.id, req.user, remarks));
  } catch (err) { next(err); }
}

export async function users(req, res, next) {
  try {
    res.json(await listUsers());
  } catch (err) { next(err); }
}

export async function editUser(req, res, next) {
  try {
    const data = updateUserSchema.parse(req.body);
    res.json(await updateUser(req.params.id, data));
  } catch (err) { next(err); }
}

export async function removeUser(req, res, next) {
  try {
    await deleteUser(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
}

export async function suspend(req, res, next) {
  try {
    res.json(await suspendUser(req.params.id));
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    res.json(await restoreUser(req.params.id));
  } catch (err) { next(err); }
}

export async function application(req, res, next) {
  try {
    res.json(await getApplication(req.user.userId));
  } catch (err) { next(err); }
}

export async function resubmit(req, res, next) {
  try {
    const { unit } = resubmitSchema.parse(req.body);
    res.json(await resubmitApplication(req.user.userId, unit));
  } catch (err) { next(err); }
}

export async function me(req, res) {
  res.json({ userId: req.user.userId, role: req.user.role });
}
