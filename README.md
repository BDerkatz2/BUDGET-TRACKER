# Budget Tracker

Budgeting Tracker API and simple UI to manage accounts, categories, budgets, transactions, recurring items, and savings goals.

## Features
- JWT authentication
- CRUD for accounts, categories, budgets, transactions
- Filters, search, and pagination for transactions
- Monthly spending summary chart
- CSV import/export
- Recurring transactions and savings goals
- Validation for non-negative amounts

## Getting Started
1. Install Node.js (includes npm).
2. Install dependencies:
   - npm install
3. Start the server:
   - npm run dev
4. Open the app in your browser at http://localhost:3000

## API Notes
- Use the `Authorization: Bearer <token>` header for authenticated endpoints.
- Pagination parameters: `page`, `pageSize`.
- Transaction filters: `accountId`, `categoryId`, `kind`, `from`, `to`, `min`, `max`, `search`.

## CSV Import
CSV columns: `account_id`, `category_id`, `amount`, `kind`, `note`, `txn_date`.

## Database
SQLite file stored in `data/budget-tracker.db`.
