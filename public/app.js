const getStoredToken = () => localStorage.getItem("token") || sessionStorage.getItem("token");
const state = {
  token: getStoredToken(),
  accounts: [],
  categories: [],
  goals: [],
  recurring: [],
};

const setStatus = (id, message) => {
  const el = document.getElementById(id);
  if (el) el.textContent = message || "";
};

const setAuthState = (isAuthed) => {
  const ids = [
    "category-create",
    "category-merge",
    "account-create",
    "txn-create",
    "summary-load",
    "budget-target-save",
    "budget-load",
    "csv-import",
    "csv-export",
    "search-btn",
    "goal-create",
    "recurring-create",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isAuthed;
  });
  const goalButton = document.getElementById("goal-create");
  if (goalButton) goalButton.disabled = !isAuthed;

  const authTab = document.querySelector(".tab[data-page=\"auth\"]");
  if (authTab) authTab.style.display = isAuthed ? "none" : "inline-flex";

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.style.display = isAuthed ? "inline-flex" : "none";
};

const apiFetch = async (path, options = {}) => {
  const headers = options.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  if (response.status === 204) return null;
  return response.json();
};

const refreshLookups = async () => {
  if (!state.token) return;
  state.accounts = await apiFetch("/api/accounts");
  state.categories = await apiFetch("/api/categories");

  const accountSelect = document.getElementById("txn-account");
  accountSelect.innerHTML = state.accounts
    .map((a) => `<option value="${a.id}">${a.name}</option>`)
    .join("");

  const categorySelect = document.getElementById("txn-category");
  categorySelect.innerHTML = state.categories
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  const budgetTargetCategory = document.getElementById("budget-target-category");
  if (budgetTargetCategory) {
    const options = state.categories
      .filter((c) => c.kind === "expense")
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join("");
    budgetTargetCategory.innerHTML = options || `<option value="">Create an expense category</option>`;
  }

  const recurringAccount = document.getElementById("recurring-account");
  if (recurringAccount) {
    recurringAccount.innerHTML = state.accounts
      .map((a) => `<option value="${a.id}">${a.name}</option>`)
      .join("");
  }

  const recurringCategory = document.getElementById("recurring-category");
  if (recurringCategory) {
    recurringCategory.innerHTML = state.categories
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join("");
  }

  const mergeFrom = document.getElementById("category-merge-from");
  const mergeTo = document.getElementById("category-merge-to");
  if (mergeFrom && mergeTo) {
    const options = state.categories
      .map((c) => `<option value="${c.id}">${c.name} (${c.kind})</option>`)
      .join("");
    mergeFrom.innerHTML = options;
    mergeTo.innerHTML = options;
  }

  const goalAccount = document.getElementById("goal-contribution-account");
  if (goalAccount) {
    goalAccount.innerHTML = state.accounts
      .map((a) => `<option value="${a.id}">${a.name}</option>`)
      .join("");
  }

  renderAccounts();
  renderCategories();
};

const drawChart = (canvas, data) => {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!data.length) {
    ctx.fillStyle = "#6b7280";
    ctx.fillText("No data for selected month", 20, 30);
    return;
  }

  const max = Math.max(...data.map((d) => d.total));
  const barWidth = canvas.width / data.length - 12;

  data.forEach((item, index) => {
    const barHeight = (item.total / max) * (canvas.height - 40);
    const x = 10 + index * (barWidth + 12);
    const y = canvas.height - barHeight - 20;

    ctx.fillStyle = "#4f46e5";
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = "#1a1f2b";
    ctx.font = "12px Segoe UI";
    ctx.fillText(item.category, x, canvas.height - 6);
  });
};

const loadTransactions = async (search = "") => {
  if (!state.token) return;
  const data = await apiFetch(`/api/transactions?search=${encodeURIComponent(search)}`);
  const tbody = document.getElementById("txn-table");
  const lookupCategory = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));

  tbody.innerHTML = data.data
    .map(
      (txn) => `
      <tr>
        <td>${txn.txn_date}</td>
        <td>${lookupCategory[txn.category_id] || ""}</td>
        <td>${txn.amount.toFixed(2)}</td>
        <td>${txn.kind}</td>
        <td>${txn.note || ""}</td>
      </tr>`
    )
    .join("");
};

const loadIncomeTransactions = async () => {
  if (!state.token) return;
  const data = await apiFetch("/api/transactions?kind=income&page=1&pageSize=20");
  const tbody = document.getElementById("income-table");
  if (!tbody) return;
  const lookupCategory = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));

  tbody.innerHTML = data.data
    .map(
      (txn) => `
      <tr>
        <td>${txn.txn_date}</td>
        <td>${lookupCategory[txn.category_id] || ""}</td>
        <td>${txn.amount.toFixed(2)}</td>
        <td>${txn.note || ""}</td>
      </tr>`
    )
    .join("");
};

const register = async () => {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value.trim();
  const remember = document.getElementById("remember-me").checked;
  try {
    const { token } = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    state.token = token;
    if (remember) {
      localStorage.setItem("token", token);
      sessionStorage.removeItem("token");
    } else {
      sessionStorage.setItem("token", token);
      localStorage.removeItem("token");
    }
    setStatus("auth-status", "Registered and logged in.");
    setAuthState(true);
    setActivePage("setup");
    await refreshLookups();
    await loadTransactions();
    await loadIncomeTransactions();
    await loadGoals();
  } catch (err) {
    setStatus("auth-status", err.message);
  }
};

const login = async () => {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value.trim();
  const remember = document.getElementById("remember-me").checked;
  try {
    const { token } = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    state.token = token;
    if (remember) {
      localStorage.setItem("token", token);
      sessionStorage.removeItem("token");
    } else {
      sessionStorage.setItem("token", token);
      localStorage.removeItem("token");
    }
    setStatus("auth-status", "Logged in.");
    setAuthState(true);
    setActivePage("setup");
    await refreshLookups();
    await loadTransactions();
    await loadIncomeTransactions();
    await loadGoals();
  } catch (err) {
    setStatus("auth-status", err.message);
  }
};

const addCategory = async () => {
  if (!state.token) {
    setStatus("category-status", "Please log in first.");
    return;
  }
  try {
    const name = document.getElementById("category-name").value.trim();
    const kind = document.getElementById("category-kind").value;
    if (!name) {
      setStatus("category-status", "Category name is required.");
      return;
    }
    await apiFetch("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name, kind }),
    });
    setStatus("category-status", "Category created.");
    await refreshLookups();
  } catch (err) {
    setStatus("category-status", err.message);
  }
};

const renderCategories = () => {
  const list = document.getElementById("category-list");
  const empty = document.getElementById("category-empty");
  if (!list) return;
  if (!state.categories.length) {
    list.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  list.innerHTML = state.categories
    .map(
      (category) => `
      <tr>
        <td>${category.name}</td>
        <td>${category.kind}</td>
        <td>
          <button class="secondary small" data-category-action="delete" data-category-id="${category.id}">Remove</button>
        </td>
      </tr>
    `
    )
    .join("");
};

const deleteCategory = async (categoryId) => {
  await apiFetch(`/api/categories/${categoryId}`, { method: "DELETE" });
  setStatus("category-merge-status", "Category removed.");
  await refreshLookups();
};

const mergeCategories = async () => {
  const fromCategoryId = document.getElementById("category-merge-from").value;
  const toCategoryId = document.getElementById("category-merge-to").value;
  if (!fromCategoryId || !toCategoryId || fromCategoryId === toCategoryId) {
    setStatus("category-merge-status", "Select two different categories.");
    return;
  }
  await apiFetch("/api/categories/merge", {
    method: "POST",
    body: JSON.stringify({ fromCategoryId, toCategoryId }),
  });
  setStatus("category-merge-status", "Categories merged.");
  await refreshLookups();
};

const addAccount = async () => {
  if (!state.token) {
    setStatus("account-status", "Please log in first.");
    return;
  }
  try {
    const name = document.getElementById("account-name").value.trim();
    const type = document.getElementById("account-type").value;
    if (!name) {
      setStatus("account-status", "Account name is required.");
      return;
    }
    await apiFetch("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ name, type }),
    });
    setStatus("account-status", "Account created.");
    await refreshLookups();
    renderAccounts();
  } catch (err) {
    setStatus("account-status", err.message);
  }
};

const renderAccounts = () => {
  const list = document.getElementById("account-list");
  const empty = document.getElementById("account-empty");
  if (!list) return;
  if (!state.accounts.length) {
    list.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  list.innerHTML = state.accounts
    .map(
      (account) => `
      <tr>
        <td>${account.name}</td>
        <td>${account.type}</td>
        <td>
          <button class="secondary small" data-account-action="delete" data-account-id="${account.id}">Remove</button>
        </td>
      </tr>
    `
    )
    .join("");
};

const deleteAccount = async (accountId) => {
  await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
  setStatus("account-status", "Account removed.");
  await refreshLookups();
};

const addTransaction = async () => {
  if (!state.token) {
    setStatus("txn-status", "Please log in first.");
    return;
  }
  try {
    const accountId = document.getElementById("txn-account").value;
    const categoryId = document.getElementById("txn-category").value;
    const amount = document.getElementById("txn-amount").value;
    const kind = document.getElementById("txn-kind").value;
    const txnDate = document.getElementById("txn-date").value;
    const note = document.getElementById("txn-note").value.trim();

    if (!accountId || !categoryId || !amount || !txnDate) {
      setStatus("txn-status", "Account, category, amount, and date are required.");
      return;
    }

    await apiFetch("/api/transactions", {
      method: "POST",
      body: JSON.stringify({ accountId, categoryId, amount, kind, txnDate, note }),
    });
    setStatus("txn-status", "Transaction added.");
    await loadTransactions();
    await loadIncomeTransactions();
    await loadSummary();
  } catch (err) {
    setStatus("txn-status", err.message);
  }
};

const loadSummary = async () => {
  if (!state.token) {
    const totalEl = document.getElementById("summary-total");
    const breakdownEl = document.getElementById("summary-breakdown");
    if (totalEl) totalEl.textContent = "Select a month to view totals.";
    if (breakdownEl) breakdownEl.textContent = "";
    return;
  }
  try {
    const month = document.getElementById("summary-month").value;
    if (!month) {
      const totalEl = document.getElementById("summary-total");
      const breakdownEl = document.getElementById("summary-breakdown");
      if (totalEl) totalEl.textContent = "Select a month to view totals.";
      if (breakdownEl) breakdownEl.textContent = "";
      return;
    }
    const data = await apiFetch(`/api/transactions/summary?month=${month}`);
    const totalEl = document.getElementById("summary-total");
    const breakdownEl = document.getElementById("summary-breakdown");

    let txIncome = 0;
    let txExpense = 0;
    let recIncome = 0;
    let recExpense = 0;

    if (Array.isArray(data)) {
      txExpense = data.reduce((sum, row) => sum + Number(row.total || 0), 0);
      if (state.recurring.length) {
        recIncome = state.recurring
          .filter((item) => item.kind === "income")
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        recExpense = state.recurring
          .filter((item) => item.kind === "expense")
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      }
    } else {
      txIncome = Number(data.transactions?.income || 0);
      txExpense = Number(data.transactions?.expense || 0);
      recIncome = Number(data.recurring?.income || 0);
      recExpense = Number(data.recurring?.expense || 0);
    }

    const totalIncome = txIncome + recIncome;
    const totalExpense = txExpense + recExpense;

    let contributions = Number(data.contributions || 0);
    if (!Number.isFinite(contributions) || contributions === 0) {
      const from = `${month}-01`;
      const to = `${month}-31`;
      const contribData = await apiFetch(
        `/api/transactions?kind=income&from=${from}&to=${to}&search=${encodeURIComponent("Goal contribution:")}&page=1&pageSize=200`
      );
      contributions = contribData.data.reduce((sum, txn) => sum + Number(txn.amount || 0), 0);
    }

    const monthlyGoal = Number(data.monthlyGoal || 0);
    const remainingGoal = monthlyGoal ? monthlyGoal - totalExpense : 0;

    if (totalEl) {
      totalEl.textContent = `Total spending for ${month}: $${formatMoney(totalExpense)}`;
    }
    if (breakdownEl) {
      breakdownEl.textContent = `Income: $${formatMoney(totalIncome)} • Expenses: $${formatMoney(totalExpense)} | Transactions: +$${formatMoney(txIncome)} / -$${formatMoney(txExpense)} • Recurring: +$${formatMoney(recIncome)} / -$${formatMoney(recExpense)} • Savings contributions: $${formatMoney(contributions)}${monthlyGoal ? ` • Goal: $${formatMoney(monthlyGoal)} • Remaining: $${formatMoney(remainingGoal)}` : ""}`;
    }
  } catch (err) {
    const totalEl = document.getElementById("summary-total");
    const breakdownEl = document.getElementById("summary-breakdown");
    if (totalEl) totalEl.textContent = "Unable to load summary.";
    if (breakdownEl) breakdownEl.textContent = "";
  }
};

const importCsv = async () => {
  if (!state.token) return;
  const fileInput = document.getElementById("csv-file");
  if (!fileInput.files.length) return;

  const form = new FormData();
  form.append("file", fileInput.files[0]);

  try {
    await apiFetch("/api/transactions/import", { method: "POST", body: form });
  } catch (err) {
    alert(err.message);
  }
};


const exportCsv = async () => {
  if (!state.token) return;
  const response = await fetch("/api/transactions/export", {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "transactions.csv";
  anchor.click();
  URL.revokeObjectURL(url);
};

const searchTransactions = async () => {
  if (!state.token) return;
  const query = document.getElementById("search-input").value.trim();
  await loadTransactions(query);
};

const loadBudgetSummary = async () => {
  if (!state.token) return;
  const month = document.getElementById("budget-month").value;
  const table = document.getElementById("budget-table");
  const empty = document.getElementById("budget-empty");
  if (!table) return;
  if (!month) {
    table.innerHTML = "";
    if (empty) empty.textContent = "Select a month to view budgets.";
    if (empty) empty.style.display = "block";
    return;
  }
  const rows = await apiFetch(`/api/budgets/summary?month=${month}`);
  if (!rows.length) {
    table.innerHTML = "";
    if (empty) empty.textContent = "No budget data yet.";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  table.innerHTML = rows
    .map((row) => {
      const remaining = Number(row.budget || 0) - Number(row.actual || 0);
      return `
        <tr>
          <td>${row.category}</td>
          <td>${formatMoney(row.budget)}</td>
          <td>${formatMoney(row.actual)}</td>
          <td>${formatMoney(remaining)}</td>
        </tr>
      `;
    })
    .join("");
};

const formatMoney = (value) => Number(value || 0).toFixed(2);

const loadGoals = async () => {
  if (!state.token) return;
  state.goals = await apiFetch("/api/goals");
  renderGoals();
};

const loadRecurring = async () => {
  if (!state.token) return;
  state.recurring = await apiFetch("/api/recurring");
  renderRecurring();
};

const renderGoals = () => {
  const list = document.getElementById("goal-list");
  if (!state.goals.length) {
    list.textContent = "No goals yet.";
    return;
  }

  list.innerHTML = state.goals
    .map((goal) => {
      const current = Number(goal.current_amount || 0);
      const target = Number(goal.target_amount || 0);
      const progress = target ? Math.min(100, Math.round((current / target) * 100)) : 0;
      return `
        <div class="notice" data-goal-id="${goal.id}">
          <strong>${goal.name}</strong><br />
          ${formatMoney(current)} / ${formatMoney(target)} (${progress}%)
          ${goal.target_date ? `<div class="muted">Target: ${goal.target_date}</div>` : ""}
          <div class="flex">
            <input type="number" step="0.01" placeholder="Add amount" data-goal-input="${goal.id}" />
            <button data-goal-action="add" data-goal-id="${goal.id}">Add</button>
            <button class="secondary small" data-goal-action="delete" data-goal-id="${goal.id}">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");
};

const addGoal = async () => {
  if (!state.token) {
    setStatus("goal-status", "Please log in first.");
    return;
  }

  try {
    const name = document.getElementById("goal-name").value.trim();
    const targetAmount = document.getElementById("goal-target").value;
    const currentAmount = document.getElementById("goal-current").value || 0;
    const targetDate = document.getElementById("goal-date").value || null;

    if (!name) {
      setStatus("goal-status", "Goal name is required.");
      return;
    }
    if (!targetAmount || Number(targetAmount) <= 0) {
      setStatus("goal-status", "Target amount must be greater than 0.");
      return;
    }

    await apiFetch("/api/goals", {
      method: "POST",
      body: JSON.stringify({ name, targetAmount, currentAmount, targetDate }),
    });

    setStatus("goal-status", "Goal created.");
    await loadGoals();
  } catch (err) {
    setStatus("goal-status", err.message);
  }
};

const renderRecurring = () => {
  const list = document.getElementById("recurring-list");
  const totalEl = document.getElementById("recurring-total");
  if (!list) return;
  if (!state.recurring.length) {
    list.textContent = "No recurring items yet.";
    if (totalEl) totalEl.textContent = "Total recurring expense: $0.00";
    return;
  }

  const accountMap = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
  const categoryMap = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));

  const totalExpense = state.recurring
    .filter((item) => item.kind === "expense")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (totalEl) totalEl.textContent = `Total recurring expense: $${formatMoney(totalExpense)}`;

  list.innerHTML = state.recurring
    .map((item) => {
      return `
        <div class="notice">
          <strong>${categoryMap[item.category_id] || ""}</strong> (${item.kind})<br />
          ${formatMoney(item.amount)} • ${accountMap[item.account_id] || ""}<br />
          Starts: ${item.start_date} • Every ${item.interval_count} ${item.frequency}
          ${item.note ? `<div class="muted">${item.note}</div>` : ""}
          <div>
            <button class="secondary small" data-recurring-action="delete" data-recurring-id="${item.id}">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");
};

const addRecurring = async () => {
  if (!state.token) {
    setStatus("recurring-status", "Please log in first.");
    return;
  }

  try {
    const accountId = document.getElementById("recurring-account").value;
    const categoryId = document.getElementById("recurring-category").value;
    const amount = document.getElementById("recurring-amount").value;
    const kind = document.getElementById("recurring-kind").value;
    const startDate = document.getElementById("recurring-start").value;
    const frequency = document.getElementById("recurring-frequency").value;
    const intervalCount = document.getElementById("recurring-interval").value || 1;
    const note = document.getElementById("recurring-note").value.trim();

    if (!accountId || !categoryId || !amount || !startDate) {
      setStatus("recurring-status", "Account, category, amount, and start date are required.");
      return;
    }

    await apiFetch("/api/recurring", {
      method: "POST",
      body: JSON.stringify({
        accountId,
        categoryId,
        amount,
        kind,
        note,
        startDate,
        frequency,
        intervalCount,
      }),
    });

    setStatus("recurring-status", "Recurring item added.");
    await loadRecurring();
  } catch (err) {
    setStatus("recurring-status", err.message);
  }
};

const deleteRecurring = async (recurringId) => {
  await apiFetch(`/api/recurring/${recurringId}`, { method: "DELETE" });
  setStatus("recurring-status", "Recurring item removed.");
  await loadRecurring();
};

const contributeGoal = async (goalId, amount) => {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return;
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    setStatus("goal-status", "Contribution must be positive.");
    return;
  }

  if (!state.accounts.length) {
    setStatus("goal-status", "Create at least one account first.");
    return;
  }

  const accountId = document.getElementById("goal-contribution-account").value;
  if (!accountId) {
    setStatus("goal-status", "Select a contribution account.");
    return;
  }
  let incomeCategory = state.categories.find((c) => c.kind === "income");
  if (!incomeCategory) {
    const created = await apiFetch("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "Savings Contribution", kind: "income" }),
    });
    await refreshLookups();
    incomeCategory = { id: created.id };
  }
  const categoryId = incomeCategory.id;
  const txnDate = new Date().toISOString().slice(0, 10);

  const current = Number(goal.current_amount || 0);
  const target = Number(goal.target_amount || 0);
  const payload = {
    name: goal.name,
    targetAmount: target,
    currentAmount: current + parsed,
    targetDate: goal.target_date || null,
  };

  await apiFetch(`/api/goals/${goal.id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  await apiFetch("/api/transactions", {
    method: "POST",
    body: JSON.stringify({
      accountId,
      categoryId,
      amount: parsed,
      kind: "income",
      txnDate,
      note: `Goal contribution: ${goal.name}`,
    }),
  });

  setStatus("goal-status", "Goal updated.");
  await loadGoals();
  await loadIncomeTransactions();
  await loadSummary();
};

const deleteGoal = async (goalId) => {
  await apiFetch(`/api/goals/${goalId}`, { method: "DELETE" });
  setStatus("goal-status", "Goal removed.");
  await loadGoals();
};

const init = async () => {
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      state.token = null;
      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
      setStatus("auth-status", "Logged out.");
      setAuthState(false);
      setActivePage("auth");
    });
  }

  document.getElementById("register-btn").addEventListener("click", register);
  document.getElementById("login-btn").addEventListener("click", login);
  document.getElementById("category-create").addEventListener("click", addCategory);
  document.getElementById("category-merge").addEventListener("click", () => {
    mergeCategories().catch((err) => setStatus("category-merge-status", err.message));
  });
  document.getElementById("account-create").addEventListener("click", addAccount);
  document.getElementById("txn-create").addEventListener("click", addTransaction);
  document.getElementById("summary-load").addEventListener("click", loadSummary);
  document.getElementById("budget-target-save").addEventListener("click", () => {
    saveBudgetTarget().catch((err) => setStatus("budget-target-status", err.message));
  });
  document.getElementById("budget-load").addEventListener("click", loadBudgetSummary);
  document.getElementById("csv-import").addEventListener("click", importCsv);
  document.getElementById("csv-export").addEventListener("click", exportCsv);
  document.getElementById("search-btn").addEventListener("click", searchTransactions);
  document.getElementById("goal-create").addEventListener("click", addGoal);
  document.getElementById("recurring-create").addEventListener("click", addRecurring);
  document.getElementById("recurring-list").addEventListener("click", (event) => {
    const target = event.target;
    if (!target.dataset || target.dataset.recurringAction !== "delete") return;
    const recurringId = target.dataset.recurringId;
    deleteRecurring(recurringId).catch((err) => setStatus("recurring-status", err.message));
  });
  document.getElementById("goal-list").addEventListener("click", (event) => {
    const target = event.target;
    if (!target.dataset) return;
    const goalId = target.dataset.goalId;
    if (target.dataset.goalAction === "add") {
      const input = document.querySelector(`[data-goal-input="${goalId}"]`);
      const amount = input ? input.value : 0;
      contributeGoal(goalId, amount).catch((err) => setStatus("goal-status", err.message));
    }
    if (target.dataset.goalAction === "delete") {
      deleteGoal(goalId).catch((err) => setStatus("goal-status", err.message));
    }
  });
  document.getElementById("category-list").addEventListener("click", (event) => {
    const target = event.target;
    if (!target.dataset || target.dataset.categoryAction !== "delete") return;
    const categoryId = target.dataset.categoryId;
    deleteCategory(categoryId).catch((err) => setStatus("category-merge-status", err.message));
  });
  document.getElementById("account-list").addEventListener("click", (event) => {
    const target = event.target;
    if (!target.dataset || target.dataset.accountAction !== "delete") return;
    const accountId = target.dataset.accountId;
    deleteAccount(accountId).catch((err) => setStatus("account-status", err.message));
  });

  if (state.token) {
    setStatus("auth-status", "Using stored session token.");
    setAuthState(true);
    setActivePage("setup");
    await refreshLookups();
    await loadTransactions();
    await loadIncomeTransactions();
    await loadGoals();
    await loadRecurring();
    await loadMonthlyGoal();
    await loadBudgetTargets();
  } else {
    setAuthState(false);
  }
};

const loadMonthlyGoal = async () => {
  if (!state.token) return;
  const data = await apiFetch("/api/monthly-goal");
  const input = document.getElementById("monthly-goal");
  if (input) input.value = data.amount ? Number(data.amount).toFixed(2) : "";
};

const saveBudgetTarget = async () => {
  if (!state.token) return;
  const categoryId = document.getElementById("budget-target-category").value;
  const amount = document.getElementById("budget-target-amount").value;
  if (!categoryId || !amount) {
    setStatus("budget-target-status", "Category and amount are required.");
    return;
  }

  await apiFetch("/api/budgets", {
    method: "POST",
    body: JSON.stringify({ categoryId, amount }),
  });

  setStatus("budget-target-status", "Budget target saved.");
  await loadBudgetSummary();
  await loadBudgetTargets();
};

const loadBudgetTargets = async () => {
  if (!state.token) return;
  const table = document.getElementById("budget-target-list");
  const empty = document.getElementById("budget-target-empty");
  if (!table) return;
  const rows = await apiFetch("/api/budgets?month=default");
  if (!rows.length) {
    table.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  const categoryMap = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));
  table.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${categoryMap[row.category_id] || ""}</td>
        <td>${formatMoney(row.amount)}</td>
      </tr>
    `
    )
    .join("");
};

init();

const setActivePage = (page) => {
  document.querySelectorAll("main [data-page]").forEach((section) => {
    section.style.display = section.getAttribute("data-page") === page ? "block" : "none";
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.page === page);
  });

  if (!state.token) return;
  if (page === "transactions") {
    refreshLookups().catch(() => {});
    loadTransactions().catch(() => {});
    loadMonthlyGoal().catch(() => {});
    loadBudgetTargets().catch(() => {});
  }
  if (page === "setup") {
    refreshLookups().catch(() => {});
  }
  if (page === "recurring") {
    loadRecurring().catch(() => {});
  }
  if (page === "goals") {
    loadGoals().catch(() => {});
    loadIncomeTransactions().catch(() => {});
  }
};

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setActivePage(tab.dataset.page));
});

setActivePage("auth");
