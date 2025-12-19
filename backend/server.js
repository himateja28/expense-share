const express = require('express');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DB_PATH = path.join(__dirname, 'data.db');

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(DB_PATH);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb() {
  await dbRun('PRAGMA foreign_keys = ON');

  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  )`);

  await ensureUsernameColumn();

  await dbRun(`CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    paid_by TEXT NOT NULL,
    split_type TEXT NOT NULL,
    split_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(paid_by) REFERENCES users(id)
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS expense_shares (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    share REAL NOT NULL,
    FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(from_user_id) REFERENCES users(id),
    FOREIGN KEY(to_user_id) REFERENCES users(id)
  )`);
}

async function ensureUsernameColumn() {
  const columns = await dbAll('PRAGMA table_info(users)');
  const hasUsername = columns.some((c) => c.name === 'username');
  if (!hasUsername) {
    await dbRun('ALTER TABLE users ADD COLUMN username TEXT UNIQUE');
    await dbRun('UPDATE users SET username = email WHERE username IS NULL');
  }
}

function generateToken(user) {
  return jwt.sign({ userId: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function calculateShares(memberIds, amount, split) {
  const memberSet = new Set(memberIds);
  const shares = {};

  if (split.type === 'equal') {
    const perHead = amount / memberIds.length;
    memberIds.forEach((memberId) => {
      shares[memberId] = perHead;
    });
    return shares;
  }

  if (split.type === 'exact') {
    let sum = 0;
    split.shares.forEach((s) => {
      if (!memberSet.has(s.userId)) {
        throw new Error('Exact split includes non-member user');
      }
      shares[s.userId] = (shares[s.userId] || 0) + Number(s.amount);
      sum += Number(s.amount);
    });
    if (Math.abs(sum - amount) > 0.01) {
      throw new Error('Exact split amounts must sum to total amount');
    }
    return shares;
  }

  if (split.type === 'percentage') {
    let percentSum = 0;
    split.shares.forEach((s) => {
      if (!memberSet.has(s.userId)) {
        throw new Error('Percentage split includes non-member user');
      }
      percentSum += Number(s.percent);
      shares[s.userId] = (shares[s.userId] || 0) + (Number(s.percent) / 100) * amount;
    });
    if (Math.abs(percentSum - 100) > 0.01) {
      throw new Error('Percentage split percents must sum to 100');
    }
    return shares;
  }

  throw new Error('Unsupported split type');
}

function simplify(netBalances) {
  const positives = [];
  const negatives = [];

  Object.entries(netBalances).forEach(([userId, amount]) => {
    if (Math.abs(amount) < 0.01) return;
    if (amount > 0) {
      positives.push({ userId, amount });
    } else {
      negatives.push({ userId, amount });
    }
  });

  positives.sort((a, b) => b.amount - a.amount);
  negatives.sort((a, b) => a.amount - b.amount);

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < positives.length && j < negatives.length) {
    const credit = positives[i];
    const debt = negatives[j];
    const settleAmount = Math.min(credit.amount, -debt.amount);

    settlements.push({ fromUserId: debt.userId, toUserId: credit.userId, amount: Number(settleAmount.toFixed(2)) });

    credit.amount -= settleAmount;
    debt.amount += settleAmount;

    if (credit.amount < 0.01) i += 1;
    if (debt.amount > -0.01) j += 1;
  }

  return settlements;
}

async function resolveUserIds(identifiers) {
  const unique = Array.from(new Set((identifiers || []).filter(Boolean)));
  if (!unique.length) return [];

  const idPlaceholders = unique.map(() => '?').join(',');
  const lowered = unique.map((v) => v.toLowerCase());
  const namePlaceholders = lowered.map(() => '?').join(',');

  const rows = await dbAll(
    `SELECT id
     FROM users
     WHERE id IN (${idPlaceholders})
        OR LOWER(username) IN (${namePlaceholders})
        OR LOWER(email) IN (${namePlaceholders})`,
    [...unique, ...lowered, ...lowered]
  );

  return Array.from(new Set(rows.map((r) => r.id)));
}

async function getGroupMembers(groupId) {
  const rows = await dbAll(
    `SELECT gm.user_id as userId, u.name, u.username
     FROM group_members gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = ?`,
    [groupId]
  );
  return rows;
}

async function getUserMap(userIds) {
  if (!userIds.length) return {};
  const placeholders = userIds.map(() => '?').join(',');
  const rows = await dbAll(`SELECT id, name, username FROM users WHERE id IN (${placeholders})`, userIds);
  return rows.reduce((acc, row) => {
    acc[row.id] = { name: row.name, username: row.username };
    return acc;
  }, {});
}

app.post('/auth/register', async (req, res) => {
  const { name, email, username, password } = req.body;
  if (!name || !email || !username || !password) {
    return res.status(400).json({ error: 'name, email, username, and password are required' });
  }
  try {
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const existingUsername = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existingUsername) return res.status(400).json({ error: 'Username already taken' });

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users (id, name, email, username, password_hash) VALUES (?, ?, ?, ?, ?)', [id, name, email, username, passwordHash]);
    const user = { id, name, email, username };
    const token = generateToken(user);
    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  try {
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const safeUser = { id: user.id, name: user.name, email: user.email, username: user.username };
    const token = generateToken(safeUser);
    res.json({ user: safeUser, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/me', authMiddleware, async (req, res) => {
  const user = await dbGet('SELECT id, name, email, username FROM users WHERE id = ?', [req.user.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.get('/users/search', authMiddleware, async (req, res) => {
  const term = (req.query.q || '').trim();
  if (!term) return res.status(400).json({ error: 'Query param q is required' });
  const like = `%${term.toLowerCase()}%`;
  const rows = await dbAll(
    `SELECT id, name, username, email
     FROM users
     WHERE LOWER(username) LIKE ?
        OR LOWER(name) LIKE ?
        OR LOWER(email) LIKE ?
     LIMIT 10`,
    [like, like, like]
  );
  res.json(rows);
});

app.post('/groups', authMiddleware, async (req, res) => {
  const { name, memberIds } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: 'memberIds array is required' });
  }

  const creator = await dbGet('SELECT id FROM users WHERE id = ?', [req.user.userId]);
  if (!creator) {
    return res.status(401).json({ error: 'User not found in this database. Please log out and log back in.' });
  }

  const uniqueRequested = Array.from(new Set(memberIds));
  const resolvedMemberIds = await resolveUserIds(uniqueRequested);
  if (resolvedMemberIds.length !== uniqueRequested.length) {
    return res.status(400).json({ error: 'All members must be valid users (register first, then search by username/email)' });
  }

  const uniqueMembers = Array.from(new Set([...resolvedMemberIds, req.user.userId]));

  const groupId = randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await dbRun('INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, ?, ?)', [groupId, name, req.user.userId, createdAt]);
    for (const userId of uniqueMembers) {
      await dbRun('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [groupId, userId]);
    }
    const members = await getGroupMembers(groupId);
    res.json({ id: groupId, name, members, createdBy: req.user.userId, createdAt });
  } catch (err) {
    console.error('Create group failed', err);
    res.status(500).json({ error: err.message || 'Failed to create group' });
  }
});

app.get('/groups', authMiddleware, async (req, res) => {
  const groups = await dbAll('SELECT id, name, created_by as createdBy, created_at as createdAt FROM groups');
  const result = [];
  for (const g of groups) {
    const members = await getGroupMembers(g.id);
    result.push({ ...g, members });
  }
  res.json(result);
});

app.get('/groups/:groupId', authMiddleware, async (req, res) => {
  const group = await dbGet('SELECT id, name, created_by as createdBy, created_at as createdAt FROM groups WHERE id = ?', [req.params.groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const members = await getGroupMembers(group.id);
  res.json({ ...group, members });
});

app.delete('/groups/:groupId/members/me', authMiddleware, async (req, res) => {
  const groupId = req.params.groupId;
  const group = await dbGet('SELECT id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const membership = await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.userId]);
  if (!membership) return res.status(404).json({ error: 'You are not a member of this group' });

  try {
    await dbRun('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.userId]);
    const remaining = await dbGet('SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?', [groupId]);
    if (remaining.cnt === 0) {
      await dbRun('DELETE FROM groups WHERE id = ?', [groupId]);
      return res.json({ left: true, groupDeleted: true });
    }
    return res.json({ left: true, groupDeleted: false });
  } catch (err) {
    console.error('Leave group failed', err);
    res.status(500).json({ error: err.message || 'Failed to leave group' });
  }
});

app.delete('/groups/:groupId', authMiddleware, async (req, res) => {
  const groupId = req.params.groupId;
  const group = await dbGet('SELECT id, created_by FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'Only the creator can delete this group' });
  }
  try {
    await dbRun('DELETE FROM groups WHERE id = ?', [groupId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete group failed', err);
    res.status(500).json({ error: err.message || 'Failed to delete group' });
  }
});

app.post('/groups/:groupId/expenses', authMiddleware, async (req, res) => {
  const groupId = req.params.groupId;
  const group = await dbGet('SELECT id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const memberDetails = await getGroupMembers(groupId);
  const memberIds = memberDetails.map((m) => m.userId);
  const { description, amount, paidBy, split } = req.body;
  if (!description || !amount || !paidBy || !split) {
    return res.status(400).json({ error: 'description, amount, paidBy, and split are required' });
  }
  if (!memberIds.includes(paidBy)) {
    return res.status(400).json({ error: 'Payer must be a member of the group' });
  }

  try {
    const amountNum = Number(amount);
    const shares = calculateShares(memberIds, amountNum, split);
    const expenseId = randomUUID();
    const createdAt = new Date().toISOString();

    await dbRun(
      'INSERT INTO expenses (id, group_id, description, amount, paid_by, split_type, split_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [expenseId, groupId, description, amountNum, paidBy, split.type, JSON.stringify(split), createdAt]
    );

    for (const [userId, share] of Object.entries(shares)) {
      await dbRun('INSERT INTO expense_shares (id, expense_id, user_id, share) VALUES (?, ?, ?, ?)', [randomUUID(), expenseId, userId, share]);
    }

    res.json({ id: expenseId, description, amount: amountNum, paidBy, split, shares, createdAt });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to add expense' });
  }
});

app.post('/groups/:groupId/settlements', authMiddleware, async (req, res) => {
  const groupId = req.params.groupId;
  const group = await dbGet('SELECT id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const memberDetails = await getGroupMembers(groupId);
  const memberIds = memberDetails.map((m) => m.userId);
  const { fromUserId, toUserId, amount } = req.body;
  if (!fromUserId || !toUserId || !amount) {
    return res.status(400).json({ error: 'fromUserId, toUserId, and amount are required' });
  }
  if (!memberIds.includes(fromUserId) || !memberIds.includes(toUserId)) {
    return res.status(400).json({ error: 'Both users must belong to the group' });
  }

  try {
    const settlementId = randomUUID();
    const createdAt = new Date().toISOString();
    await dbRun(
      'INSERT INTO settlements (id, group_id, from_user_id, to_user_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [settlementId, groupId, fromUserId, toUserId, Number(amount), createdAt]
    );
    res.json({ id: settlementId, fromUserId, toUserId, amount: Number(amount), createdAt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record settlement' });
  }
});

app.get('/groups/:groupId/balances', authMiddleware, async (req, res) => {
  const groupId = req.params.groupId;
  const group = await dbGet('SELECT id FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const memberDetails = await getGroupMembers(groupId);
  const members = memberDetails.map((m) => m.userId);
  const netBalances = {};
  members.forEach((id) => {
    netBalances[id] = 0;
  });

  const expenses = await dbAll('SELECT id, amount, paid_by FROM expenses WHERE group_id = ?', [groupId]);
  for (const exp of expenses) {
    netBalances[exp.paid_by] += exp.amount;
    const shares = await dbAll('SELECT user_id as userId, share FROM expense_shares WHERE expense_id = ?', [exp.id]);
    shares.forEach((s) => {
      netBalances[s.userId] -= s.share;
    });
  }

  const settlements = await dbAll('SELECT from_user_id as fromUserId, to_user_id as toUserId, amount FROM settlements WHERE group_id = ?', [groupId]);
  settlements.forEach((s) => {
    netBalances[s.fromUserId] += s.amount;
    netBalances[s.toUserId] -= s.amount;
  });

  const simplified = simplify({ ...netBalances });
  const userMap = await getUserMap(members);
  res.json({
    netBalances,
    simplified,
    memberDetails: members.map((id) => ({
      userId: id,
      name: userMap[id]?.name || 'Unknown',
      username: userMap[id]?.username || '',
      net: Number(netBalances[id].toFixed(2)),
    })),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Expense sharing app running on http://localhost:${PORT}`);
  });
});
