const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify");
const path = require("path");

const { db, init } = require("./db");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const nowIso = () => new Date().toISOString();

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const requireNonNegative = (value, field, res) => {
  if (value < 0) {
    res.status(400).json({ error: `${field} must be non-negative` });
    return false;
  }
  return true;
};

const parseNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const safePage = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
};

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = uuidv4();
  await run(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    [userId, email, passwordHash, nowIso()]
  );

  const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ token });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const user = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ token });
});

app.get("/api/accounts", requireAuth, async (req, res) => {
  const rows = await all("SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC", [
    req.user.id,
  ]);
  res.json(rows);
});

app.post("/api/accounts", requireAuth, async (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: "Name and type required" });

  const id = uuidv4();
  await run(
    "INSERT INTO accounts (id, user_id, name, type, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, req.user.id, name, type, nowIso()]
  );
  res.status(201).json({ id, name, type });
});

app.put("/api/accounts/:id", requireAuth, async (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: "Name and type required" });

  await run(
    "UPDATE accounts SET name = ?, type = ? WHERE id = ? AND user_id = ?",
    [name, type, req.params.id, req.user.id]
  );
  res.json({ id: req.params.id, name, type });
});

app.delete("/api/accounts/:id", requireAuth, async (req, res) => {
  await run("DELETE FROM accounts WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.status(204).end();
});

app.post("/api/accounts/import", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });

  parse(req.file.buffer, { columns: true, trim: true }, async (err, parsed) => {
    if (err) return res.status(400).json({ error: "Invalid CSV" });

    let imported = 0;
    for (const row of parsed) {
      if (!row.name || !row.type) continue;
      const id = uuidv4();
      await run(
        "INSERT INTO accounts (id, user_id, name, type, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, req.user.id, row.name, row.type, nowIso()]
      );
      imported += 1;
    }

    res.json({ imported });
  });
});

app.get("/api/accounts/export", requireAuth, async (req, res) => {
  const rows = await all(
    "SELECT name, type FROM accounts WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=accounts.csv");

  stringify(rows, { header: true }, (err, output) => {
    if (err) return res.status(500).json({ error: "Failed to export" });
    res.send(output);
  });
});

app.get("/api/categories", requireAuth, async (req, res) => {
  const rows = await all(
    "SELECT * FROM categories WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/categories", requireAuth, async (req, res) => {
  const { name, kind } = req.body;
  if (!name || !kind) return res.status(400).json({ error: "Name and kind required" });

  const id = uuidv4();
  await run(
    "INSERT INTO categories (id, user_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, req.user.id, name, kind, nowIso()]
  );
  res.status(201).json({ id, name, kind });
});

app.put("/api/categories/:id", requireAuth, async (req, res) => {
  const { name, kind } = req.body;
  if (!name || !kind) return res.status(400).json({ error: "Name and kind required" });

  await run(
    "UPDATE categories SET name = ?, kind = ? WHERE id = ? AND user_id = ?",
    [name, kind, req.params.id, req.user.id]
  );
  res.json({ id: req.params.id, name, kind });
});

app.delete("/api/categories/:id", requireAuth, async (req, res) => {
  await run("DELETE FROM categories WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.status(204).end();
});

app.post("/api/categories/merge", requireAuth, async (req, res) => {
  const { fromCategoryId, toCategoryId } = req.body;
  if (!fromCategoryId || !toCategoryId || fromCategoryId === toCategoryId) {
    return res.status(400).json({ error: "fromCategoryId and toCategoryId required" });
  }

  const from = await get("SELECT id FROM categories WHERE id = ? AND user_id = ?", [
    fromCategoryId,
    req.user.id,
  ]);
  const to = await get("SELECT id FROM categories WHERE id = ? AND user_id = ?", [
    toCategoryId,
    req.user.id,
  ]);
  if (!from || !to) return res.status(404).json({ error: "Category not found" });

  await run("UPDATE transactions SET category_id = ? WHERE category_id = ? AND user_id = ?", [
    toCategoryId,
    fromCategoryId,
    req.user.id,
  ]);
  await run("UPDATE budgets SET category_id = ? WHERE category_id = ? AND user_id = ?", [
    toCategoryId,
    fromCategoryId,
    req.user.id,
  ]);
  await run(
    "UPDATE recurring_transactions SET category_id = ? WHERE category_id = ? AND user_id = ?",
    [toCategoryId, fromCategoryId, req.user.id]
  );

  await run("DELETE FROM categories WHERE id = ? AND user_id = ?", [
    fromCategoryId,
    req.user.id,
  ]);

  res.json({ merged: true });
});

app.get("/api/budgets", requireAuth, async (req, res) => {
  const { month } = req.query;
  const rows = await all(
    "SELECT * FROM budgets WHERE user_id = ? AND (? IS NULL OR month = ?) ORDER BY month DESC",
    [req.user.id, month || null, month || null]
  );
  res.json(rows);
});

app.post("/api/budgets", requireAuth, async (req, res) => {
  const { categoryId, month, amount } = req.body;
  const parsedAmount = parseNumber(amount);
  const monthValue = month || "default";
  if (!categoryId || parsedAmount === null) {
    return res.status(400).json({ error: "categoryId and amount required" });
  }
  if (!requireNonNegative(parsedAmount, "amount", res)) return;

  await run(
    "DELETE FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?",
    [req.user.id, categoryId, monthValue]
  );

  const id = uuidv4();
  await run(
    "INSERT INTO budgets (id, user_id, category_id, month, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, req.user.id, categoryId, monthValue, parsedAmount, nowIso()]
  );
  res.status(201).json({ id, categoryId, month: monthValue, amount: parsedAmount });
});

app.put("/api/budgets/:id", requireAuth, async (req, res) => {
  const { categoryId, month, amount } = req.body;
  const parsedAmount = parseNumber(amount);
  if (!categoryId || !month || parsedAmount === null) {
    return res.status(400).json({ error: "categoryId, month, amount required" });
  }
  if (!requireNonNegative(parsedAmount, "amount", res)) return;

  await run(
    "UPDATE budgets SET category_id = ?, month = ?, amount = ? WHERE id = ? AND user_id = ?",
    [categoryId, month, parsedAmount, req.params.id, req.user.id]
  );
  res.json({ id: req.params.id, categoryId, month, amount: parsedAmount });
});

app.delete("/api/budgets/:id", requireAuth, async (req, res) => {
  await run("DELETE FROM budgets WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.status(204).end();
});

app.get("/api/budgets/summary", requireAuth, async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: "month required" });

  const rows = await all(
    `SELECT c.id as category_id, c.name as category, COALESCE(b.amount, d.amount, 0) as budget,
            IFNULL(a.actual, 0) as actual
     FROM categories c
     LEFT JOIN budgets b
       ON b.category_id = c.id AND b.user_id = c.user_id AND b.month = ?
     LEFT JOIN budgets d
       ON d.category_id = c.id AND d.user_id = c.user_id AND d.month = 'default'
     LEFT JOIN (
       SELECT category_id, SUM(amount) as actual
       FROM transactions
       WHERE user_id = ? AND kind = 'expense' AND substr(txn_date, 1, 7) = ?
       GROUP BY category_id
     ) a ON a.category_id = c.id
     WHERE c.user_id = ? AND c.kind = 'expense'
     ORDER BY c.name`,
    [month, req.user.id, month, req.user.id]
  );

  res.json(rows);
});

app.get("/api/transactions", requireAuth, async (req, res) => {
  const page = safePage(req.query.page, 1);
  const pageSize = safePage(req.query.pageSize, 20);
  const offset = (page - 1) * pageSize;

  const filters = [];
  const params = [req.user.id];

  if (req.query.accountId) {
    filters.push("account_id = ?");
    params.push(req.query.accountId);
  }
  if (req.query.categoryId) {
    filters.push("category_id = ?");
    params.push(req.query.categoryId);
  }
  if (req.query.kind) {
    filters.push("kind = ?");
    params.push(req.query.kind);
  }
  if (req.query.from) {
    filters.push("txn_date >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    filters.push("txn_date <= ?");
    params.push(req.query.to);
  }
  if (req.query.min) {
    const minAmount = parseNumber(req.query.min);
    if (minAmount !== null) {
      filters.push("amount >= ?");
      params.push(minAmount);
    }
  }
  if (req.query.max) {
    const maxAmount = parseNumber(req.query.max);
    if (maxAmount !== null) {
      filters.push("amount <= ?");
      params.push(maxAmount);
    }
  }
  if (req.query.search) {
    filters.push("note LIKE ?");
    params.push(`%${req.query.search}%`);
  }

  const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  const totalRow = await get(
    `SELECT COUNT(*) as total FROM transactions WHERE user_id = ?${where}`,
    params
  );

  const rows = await all(
    `SELECT * FROM transactions WHERE user_id = ?${where} ORDER BY txn_date DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({
    data: rows,
    page,
    pageSize,
    total: totalRow ? totalRow.total : 0,
  });
});

app.post("/api/transactions", requireAuth, async (req, res) => {
  const { accountId, categoryId, amount, kind, note, txnDate } = req.body;
  const parsedAmount = parseNumber(amount);
  if (!accountId || !categoryId || !kind || !txnDate || parsedAmount === null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!requireNonNegative(parsedAmount, "amount", res)) return;

  const id = uuidv4();
  await run(
    "INSERT INTO transactions (id, user_id, account_id, category_id, amount, kind, note, txn_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, req.user.id, accountId, categoryId, parsedAmount, kind, note || null, txnDate, nowIso()]
  );
  res.status(201).json({
    id,
    accountId,
    categoryId,
    amount: parsedAmount,
    kind,
    note: note || null,
    txnDate,
  });
});

app.put("/api/transactions/:id", requireAuth, async (req, res) => {
  const { accountId, categoryId, amount, kind, note, txnDate } = req.body;
  const parsedAmount = parseNumber(amount);
  if (!accountId || !categoryId || !kind || !txnDate || parsedAmount === null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!requireNonNegative(parsedAmount, "amount", res)) return;

  await run(
    "UPDATE transactions SET account_id = ?, category_id = ?, amount = ?, kind = ?, note = ?, txn_date = ? WHERE id = ? AND user_id = ?",
    [
      accountId,
      categoryId,
      parsedAmount,
      kind,
      note || null,
      txnDate,
      req.params.id,
      req.user.id,
    ]
  );
  res.json({
    id: req.params.id,
    accountId,
    categoryId,
    amount: parsedAmount,
    kind,
    note: note || null,
    txnDate,
  });
});

app.delete("/api/transactions/:id", requireAuth, async (req, res) => {
  await run("DELETE FROM transactions WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.status(204).end();
});

app.get("/api/transactions/summary", requireAuth, async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: "month required" });

  const totals = await all(
    `SELECT kind, SUM(amount) as total
     FROM transactions
     WHERE user_id = ? AND substr(txn_date, 1, 7) = ?
     GROUP BY kind`,
    [req.user.id, month]
  );

  const contributionRow = await get(
    `SELECT SUM(amount) as total
     FROM transactions
     WHERE user_id = ? AND kind = 'income' AND substr(txn_date, 1, 7) = ? AND note LIKE 'Goal contribution:%'`,
    [req.user.id, month]
  );

  const monthlyGoal = await get(
    "SELECT amount FROM monthly_expense_goals WHERE user_id = ?",
    [req.user.id]
  );

  const recurringItems = await all(
    "SELECT amount, kind FROM recurring_transactions WHERE user_id = ?",
    [req.user.id]
  );

  const recurringTotals = recurringItems.reduce(
    (acc, item) => {
      const value = Number(item.amount) || 0;
      if (item.kind === "income") acc.income += value;
      else acc.expense += value;
      return acc;
    },
    { income: 0, expense: 0 }
  );

  const transactionTotals = totals.reduce(
    (acc, row) => {
      if (row.kind === "income") acc.income += Number(row.total) || 0;
      if (row.kind === "expense") acc.expense += Number(row.total) || 0;
      return acc;
    },
    { income: 0, expense: 0 }
  );

  res.json({
    month,
    transactions: transactionTotals,
    recurring: recurringTotals,
    totals: {
      income: transactionTotals.income + recurringTotals.income,
      expense: transactionTotals.expense + recurringTotals.expense,
    },
    contributions: Number(contributionRow?.total || 0),
    monthlyGoal: Number(monthlyGoal?.amount || 0),
  });
});

app.get("/api/monthly-goal", requireAuth, async (req, res) => {
  const row = await get("SELECT amount FROM monthly_expense_goals WHERE user_id = ?", [
    req.user.id,
  ]);
  res.json({ amount: Number(row?.amount || 0) });
});

app.put("/api/monthly-goal", requireAuth, async (req, res) => {
  const { amount } = req.body;
  const parsedAmount = parseNumber(amount);
  if (parsedAmount === null) {
    return res.status(400).json({ error: "amount required" });
  }
  if (!requireNonNegative(parsedAmount, "amount", res)) return;

  await run(
    "INSERT OR REPLACE INTO monthly_expense_goals (user_id, amount, updated_at) VALUES (?, ?, ?)",
    [req.user.id, parsedAmount, nowIso()]
  );

  res.json({ amount: parsedAmount });
});

app.post("/api/transactions/import", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });

  const records = [];
  parse(req.file.buffer, { columns: true, trim: true }, async (err, parsed) => {
    if (err) return res.status(400).json({ error: "Invalid CSV" });

    for (const row of parsed) {
      const amount = parseNumber(row.amount);
      if (amount === null || amount < 0) continue;

      const id = uuidv4();
      await run(
        "INSERT INTO transactions (id, user_id, account_id, category_id, amount, kind, note, txn_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          req.user.id,
          row.account_id,
          row.category_id,
          amount,
          row.kind,
          row.note || null,
          row.txn_date,
          nowIso(),
        ]
      );
      records.push(id);
    }

    res.json({ imported: records.length });
  });
});

app.get("/api/transactions/export", requireAuth, async (req, res) => {
  const rows = await all(
    "SELECT id, account_id, category_id, amount, kind, note, txn_date FROM transactions WHERE user_id = ? ORDER BY txn_date DESC",
    [req.user.id]
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=transactions.csv");

  stringify(rows, { header: true }, (err, output) => {
    if (err) return res.status(500).json({ error: "Failed to export" });
    res.send(output);
  });
});

app.get("/api/recurring", requireAuth, async (req, res) => {
  const rows = await all(
    "SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/recurring", requireAuth, async (req, res) => {
  const { accountId, categoryId, amount, kind, note, startDate, frequency, intervalCount } = req.body;
  const parsedAmount = parseNumber(amount);
  const parsedInterval = Number(intervalCount);
  if (!accountId || !categoryId || !kind || !startDate || !frequency || !parsedInterval || parsedAmount === null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!requireNonNegative(parsedAmount, "amount", res)) return;

  const id = uuidv4();
  await run(
    "INSERT INTO recurring_transactions (id, user_id, account_id, category_id, amount, kind, note, start_date, frequency, interval_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      req.user.id,
      accountId,
      categoryId,
      parsedAmount,
      kind,
      note || null,
      startDate,
      frequency,
      parsedInterval,
      nowIso(),
    ]
  );
  res.status(201).json({ id });
});

app.put("/api/recurring/:id", requireAuth, async (req, res) => {
  const { accountId, categoryId, amount, kind, note, startDate, frequency, intervalCount } = req.body;
  const parsedAmount = parseNumber(amount);
  const parsedInterval = Number(intervalCount);
  if (!accountId || !categoryId || !kind || !startDate || !frequency || !parsedInterval || parsedAmount === null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!requireNonNegative(parsedAmount, "amount", res)) return;

  await run(
    "UPDATE recurring_transactions SET account_id = ?, category_id = ?, amount = ?, kind = ?, note = ?, start_date = ?, frequency = ?, interval_count = ? WHERE id = ? AND user_id = ?",
    [
      accountId,
      categoryId,
      parsedAmount,
      kind,
      note || null,
      startDate,
      frequency,
      parsedInterval,
      req.params.id,
      req.user.id,
    ]
  );
  res.json({ id: req.params.id });
});

app.delete("/api/recurring/:id", requireAuth, async (req, res) => {
  await run("DELETE FROM recurring_transactions WHERE id = ? AND user_id = ?", [
    req.params.id,
    req.user.id,
  ]);
  res.status(204).end();
});

app.get("/api/goals", requireAuth, async (req, res) => {
  const rows = await all(
    "SELECT * FROM savings_goals WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/goals", requireAuth, async (req, res) => {
  const { name, targetAmount, currentAmount, targetDate } = req.body;
  const parsedTarget = parseNumber(targetAmount);
  const parsedCurrent = parseNumber(currentAmount || 0);
  if (!name || parsedTarget === null || parsedCurrent === null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!requireNonNegative(parsedTarget, "targetAmount", res)) return;
  if (!requireNonNegative(parsedCurrent, "currentAmount", res)) return;

  const id = uuidv4();
  await run(
    "INSERT INTO savings_goals (id, user_id, name, target_amount, current_amount, target_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, req.user.id, name, parsedTarget, parsedCurrent, targetDate || null, nowIso()]
  );
  res.status(201).json({ id });
});

app.put("/api/goals/:id", requireAuth, async (req, res) => {
  const { name, targetAmount, currentAmount, targetDate } = req.body;
  const parsedTarget = parseNumber(targetAmount);
  const parsedCurrent = parseNumber(currentAmount || 0);
  if (!name || parsedTarget === null || parsedCurrent === null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!requireNonNegative(parsedTarget, "targetAmount", res)) return;
  if (!requireNonNegative(parsedCurrent, "currentAmount", res)) return;

  await run(
    "UPDATE savings_goals SET name = ?, target_amount = ?, current_amount = ?, target_date = ? WHERE id = ? AND user_id = ?",
    [name, parsedTarget, parsedCurrent, targetDate || null, req.params.id, req.user.id]
  );
  res.json({ id: req.params.id });
});

app.delete("/api/goals/:id", requireAuth, async (req, res) => {
  await run("DELETE FROM savings_goals WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.status(204).end();
});

app.post("/api/goals/import", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });

  parse(req.file.buffer, { columns: true, trim: true }, async (err, parsed) => {
    if (err) return res.status(400).json({ error: "Invalid CSV" });

    let imported = 0;
    for (const row of parsed) {
      if (!row.name) continue;
      const target = parseNumber(row.target_amount);
      const current = parseNumber(row.current_amount || 0);
      if (target === null || current === null) continue;
      const id = uuidv4();
      await run(
        "INSERT INTO savings_goals (id, user_id, name, target_amount, current_amount, target_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, req.user.id, row.name, target, current, row.target_date || null, nowIso()]
      );
      imported += 1;
    }

    res.json({ imported });
  });
});

app.get("/api/goals/export", requireAuth, async (req, res) => {
  const rows = await all(
    "SELECT name, target_amount, current_amount, target_date FROM savings_goals WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id]
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=goals.csv");

  stringify(rows, { header: true }, (err, output) => {
    if (err) return res.status(500).json({ error: "Failed to export" });
    res.send(output);
  });
});

app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  res.status(500).json({ error: "Server error" });
});

init();

app.listen(PORT, () => {
  console.log(`Budget Tracker running on port ${PORT}`);
});
