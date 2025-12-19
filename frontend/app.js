const { useState, useEffect, useMemo } = React;
const { Tabs, Select, ListCard, StatGrid, tabs } = Components;
const { useAuthFetch } = API;

function App() {
  const [activeTab, setActiveTab] = useState('auth');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });

  const [authMsg, setAuthMsg] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', username: '', email: '', password: '' });
  const [groups, setGroups] = useState([]);
  const [groupForm, setGroupForm] = useState({ name: '' });
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [memberSearchStatus, setMemberSearchStatus] = useState('');
  const [expenseForm, setExpenseForm] = useState({
    groupId: '',
    desc: '',
    amount: '',
    paidBy: '',
    splitType: 'equal',
  });
  const [shareRows, setShareRows] = useState([]);
  const [expenseStatus, setExpenseStatus] = useState('');

  const [settleForm, setSettleForm] = useState({ groupId: '', from: '', to: '', amount: '' });
  const [settleStatus, setSettleStatus] = useState('');

  const [balances, setBalances] = useState({ groupId: '', data: null, error: '' });

  const authed = !!token && !!user;
  const authFetch = useAuthFetch(token, () => handleLogout());
  const visibleTabs = useMemo(() => {
    if (!authed) return [{ id: 'auth', label: 'Auth' }];
    return tabs.filter((t) => t.id !== 'auth');
  }, [authed]);

  useEffect(() => {
    if (!authed && activeTab !== 'auth') setActiveTab('auth');
    if (authed && activeTab === 'auth') setActiveTab('groups');
  }, [authed, activeTab]);

  function handleLogout() {
    setToken('');
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setGroups([]);
    setSelectedMembers([]);
    setMemberResults([]);
    setMemberSearch('');
    setBalances({ groupId: '', data: null, error: '' });
    setActiveTab('auth');
  }

  function saveAuth(newToken, newUser) {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setActiveTab('groups');
  }

  const groupOptions = useMemo(() => groups.map((g) => ({ value: g.id, label: g.name })), [groups]);
  const memberOptions = useMemo(() => {
    const group = groups.find((g) => g.id === expenseForm.groupId) || groups.find((g) => g.id === settleForm.groupId) || groups[0];
    const members = group?.members || [];
    return members.map((m) => {
      const value = m.userId || m.id;
      const label = m.username ? `${m.username} (${m.name})` : m.name || value;
      return { value, label };
    });
  }, [groups, expenseForm.groupId, settleForm.groupId]);

  const currentGroupMembers = useMemo(() => {
    const g = groups.find((gr) => gr.id === expenseForm.groupId) || groups[0];
    return g ? g.members : [];
  }, [groups, expenseForm.groupId]);

  const nameById = useMemo(() => {
    const map = {};
    (balances.data?.memberDetails || []).forEach((m) => {
      map[m.userId] = m.name || m.username || m.userId;
    });
    return map;
  }, [balances.data]);

  const expenseHelpText = useMemo(() => {
    const group = groups.find((g) => g.id === expenseForm.groupId) || groups[0];
    const count = group ? group.members.length : 0;
    if (expenseForm.splitType === 'equal') {
      return count ? `Equal split: amount / ${count} members. Shares ignored.` : 'Equal split: pick a group to split evenly.';
    }
    if (expenseForm.splitType === 'exact') return 'Exact: assign amounts per user. Sum should equal total amount.';
    if (expenseForm.splitType === 'percentage') return 'Percentage: assign percents per user. Sum should be 100%.';
    return '';
  }, [expenseForm.splitType, expenseForm.groupId, groups]);

  async function fetchGroups() {
    const g = await authFetch('/groups');
    setGroups(g);
    const firstGroupId = g[0]?.id || '';
    const firstMemberId = g[0]?.members?.[0]?.userId || g[0]?.members?.[0]?.id || '';
    const secondMemberId = g[0]?.members?.[1]?.userId || g[0]?.members?.[1]?.id || '';
    setExpenseForm((f) => ({ ...f, groupId: f.groupId || firstGroupId, paidBy: f.paidBy || firstMemberId }));
    setSettleForm((f) => ({ ...f, groupId: f.groupId || firstGroupId, from: f.from || firstMemberId, to: f.to || secondMemberId }));
    setBalances((b) => ({ ...b, groupId: b.groupId || firstGroupId }));
  }

  useEffect(() => {
    if (!token || !user) return;
    fetchGroups().catch((e) => setAuthMsg(e.message));
  }, [token, user]);

  useEffect(() => {
    if (balances.groupId) refreshBalances(balances.groupId);
  }, [balances.groupId]);

  useEffect(() => {
    if (expenseForm.splitType === 'equal') {
      setShareRows([]);
      return;
    }
    if (shareRows.length === 0) {
      const first = currentGroupMembers[0]?.userId || currentGroupMembers[0]?.id || '';
      setShareRows([{ id: Date.now(), userId: first, value: '' }]);
    }
  }, [expenseForm.splitType, expenseForm.groupId, currentGroupMembers, shareRows.length]);

  function addShareRow() {
    const first = currentGroupMembers[0]?.userId || currentGroupMembers[0]?.id || '';
    setShareRows((rows) => [...rows, { id: Date.now() + Math.random(), userId: first, value: '' }]);
  }

  function updateShareRow(index, key, value) {
    setShareRows((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function removeShareRow(index) {
    setShareRows((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleAuthSubmit() {
    const isLogin = authMode === 'login';
    if (!authForm.email || !authForm.password || (!isLogin && (!authForm.name || !authForm.username))) return;
    setAuthLoading(true);
    setAuthMsg('');
    try {
      const path = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin ? { email: authForm.email, password: authForm.password } : { ...authForm };
      const data = await authFetch(path, { method: 'POST', body: JSON.stringify(payload) });
      saveAuth(data.token, data.user);
      setAuthMsg(isLogin ? 'Logged in' : 'Registered and logged in');
      await fetchGroups();
    } catch (err) {
      setAuthMsg(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreateGroup() {
    if (!groupForm.name || selectedMembers.length === 0) {
      setMemberSearchStatus('Enter a group name and add at least one member by username');
      return;
    }
    try {
      await authFetch('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupForm.name, memberIds: selectedMembers.map((m) => m.id || m.userId) }),
      });
      setGroupForm({ name: '' });
      setSelectedMembers([]);
      setMemberSearch('');
      setMemberResults([]);
      setMemberSearchStatus('Group created');
      await fetchGroups();
    } catch (err) {
      setMemberSearchStatus(err.message);
    }
  }

  async function handleLeaveGroup(groupId) {
    try {
      await authFetch(`/groups/${groupId}/members/me`, { method: 'DELETE' });
      setMemberSearchStatus('Left group');
      await fetchGroups();
    } catch (err) {
      setMemberSearchStatus(err.message);
    }
  }

  async function handleDeleteGroup(groupId) {
    try {
      await authFetch(`/groups/${groupId}`, { method: 'DELETE' });
      setMemberSearchStatus('Group deleted');
      await fetchGroups();
    } catch (err) {
      setMemberSearchStatus(err.message);
    }
  }

  async function handleSearchMembers() {
    const term = memberSearch.trim();
    if (!term) {
      setMemberSearchStatus('Enter a username to search');
      return;
    }
    try {
      const results = await authFetch(`/users/search?q=${encodeURIComponent(term)}`);
      setMemberResults(results);
      setMemberSearchStatus(results.length ? `Found ${results.length} match(es)` : 'No users found');
    } catch (err) {
      setMemberSearchStatus(err.message);
    }
  }

  function addMemberFromSearch(userToAdd) {
    const id = userToAdd.id;
    if (!id) return;
    if (selectedMembers.some((m) => m.id === id || m.userId === id)) {
      setMemberSearchStatus('Already added');
      return;
    }
    setSelectedMembers((prev) => [...prev, userToAdd]);
    setMemberSearchStatus('Added');
  }

  function removeSelectedMember(id) {
    setSelectedMembers((prev) => prev.filter((m) => (m.id || m.userId) !== id));
  }

  async function handleAddExpense() {
    if (!expenseForm.groupId || !expenseForm.desc || !expenseForm.amount || !expenseForm.paidBy) return;
    const split = { type: expenseForm.splitType };
    if (expenseForm.splitType === 'exact' || expenseForm.splitType === 'percentage') {
      const rows = shareRows.filter((r) => r.userId && r.value !== '');
      if (rows.length === 0) {
        setExpenseStatus('Add at least one split row.');
        return;
      }
      split.shares = rows.map((r) => (
        expenseForm.splitType === 'exact'
          ? { userId: r.userId, amount: Number(r.value) }
          : { userId: r.userId, percent: Number(r.value) }
      ));
    }
    try {
      await authFetch(`/groups/${expenseForm.groupId}/expenses`, {
        method: 'POST',
        body: JSON.stringify({ description: expenseForm.desc, amount: Number(expenseForm.amount), paidBy: expenseForm.paidBy, split }),
      });
      setExpenseForm((f) => ({ ...f, desc: '', amount: '' }));
      setShareRows([]);
      setExpenseStatus('Expense recorded');
      refreshBalances(expenseForm.groupId);
    } catch (err) {
      setExpenseStatus(err.message);
    }
  }

  async function handleSettlement() {
    if (!settleForm.groupId || !settleForm.from || !settleForm.to || !settleForm.amount) return;
    try {
      await authFetch(`/groups/${settleForm.groupId}/settlements`, {
        method: 'POST',
        body: JSON.stringify({ fromUserId: settleForm.from, toUserId: settleForm.to, amount: Number(settleForm.amount) }),
      });
      setSettleForm((f) => ({ ...f, amount: '' }));
      setSettleStatus('Settlement recorded');
      refreshBalances(settleForm.groupId);
    } catch (err) {
      setSettleStatus(err.message);
    }
  }

  async function refreshBalances(groupId) {
    if (!groupId) return;
    try {
      const data = await authFetch(`/groups/${groupId}/balances`);
      setBalances({ groupId, data, error: '' });
    } catch (err) {
      setBalances({ groupId, data: null, error: err.message });
    }
  }

  return (
    <div>
      <header className="header-row">
        <div>
          <h1>Expense Sharing</h1>
          <p>Track group expenses, settle up, and view simplified balances. React SPA.</p>
        </div>
        {authed ? (
          <button className="secondary" onClick={handleLogout} style={{ height: '42px', alignSelf: 'center' }}>
            Logout
          </button>
        ) : null}
      </header>
      <Tabs active={activeTab} setActive={setActiveTab} items={visibleTabs} />

      {!authed && activeTab !== 'auth' ? <div className="status error">Login to continue.</div> : null}

      {/* Auth */}
      {activeTab === 'auth' && (
        <section className="panel auth-panel">
          <div className="auth-top">
            <div>
              <p className="eyebrow">Secure access</p>
              <h2>Welcome back</h2>
              <p className="muted">Smooth sign-in, modern security, and instant access to your expense workspace.</p>
            </div>
            <div className="auth-meta">
              <span className="pill">JWT · SQLite</span>
              <span className="pill ghost">Local first</span>
            </div>
          </div>

          <div className="auth-layout">
            <div className="auth-hero glow">
              <div className="eyebrow">Why sign in</div>
              <h3>Stay coordinated</h3>
              <ul>
                <li>Keep groups, expenses, and balances synced.</li>
                <li>Token-based auth for safe, fast requests.</li>
                <li>Modern UI built for daily use.</li>
              </ul>
              <div className="meta-row">
                <span className="pill">Live at :4000</span>
                <span className="pill">Auto-balance</span>
              </div>
            </div>

            <div className="auth-forms">
              <div className="auth-card glass slide-up">
                <div className="card-head">
                  <div>
                    <p className="muted">Single form</p>
                    <h3>{authMode === 'login' ? 'Log in' : 'Create account'}</h3>
                  </div>
                  <div className="toggle">
                    <button className={authMode === 'login' ? 'pill' : 'pill ghost'} onClick={() => setAuthMode('login')} disabled={authMode === 'login'}>Login</button>
                    <button className={authMode === 'register' ? 'pill' : 'pill ghost'} onClick={() => setAuthMode('register')} disabled={authMode === 'register'}>Sign up</button>
                  </div>
                </div>
                <div className="stack">
                  {authMode === 'register' ? (
                    <>
                      <label>Name
                        <input
                          value={authForm.name}
                          onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                          placeholder="Full name"
                          autoComplete="name"
                        />
                      </label>
                      <label>Username
                        <input
                          value={authForm.username}
                          onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
                          placeholder="unique_username"
                          autoComplete="username"
                        />
                      </label>
                    </>
                  ) : null}
                  <label>Email
                    <input
                      value={authForm.email}
                      onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                      placeholder="you@example.com"
                      autoComplete={authMode === 'login' ? 'email' : 'new-email'}
                    />
                  </label>
                  <label>Password
                    <input
                      type="password"
                      value={authForm.password}
                      onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                      placeholder={authMode === 'register' ? 'Create a password' : 'Your password'}
                      autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    />
                  </label>
                </div>
                <button className="shadow" style={{ marginTop: '0.65rem', width: '100%' }} onClick={handleAuthSubmit} disabled={authLoading}>
                  {authLoading ? (authMode === 'login' ? 'Signing in…' : 'Creating…') : authMode === 'login' ? 'Login' : 'Register'}
                </button>
                <div className="hint">{authMode === 'login' ? 'Access your groups and balances.' : 'We keep you signed in across tabs.'}</div>
              </div>
            </div>
          </div>

          <div className="auth-footer">
            <span className="pill ghost">{user ? `Signed in as ${user.name}` : 'Not signed in'}</span>
            <button className="secondary" onClick={handleLogout} disabled={!authed}>Logout</button>
            <span className={`status ${authMsg ? (authMsg.toLowerCase().includes('error') ? 'error' : 'ok') : ''}`}>{authMsg}</span>
          </div>
        </section>
      )}

      {/* Groups */}
      {activeTab === 'groups' && (
        <section className={`panel ${!authed ? 'disabled' : ''}`}>
          <div className="panel-head">
            <div>
              <h2>Groups</h2>
              <p className="muted">Create a group and pick members. You are added automatically.</p>
            </div>
            <div className="chip">Step 1</div>
          </div>
          <div className="form-row">
            <input
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              placeholder="Group name"
            />
            <button onClick={handleCreateGroup}>Create Group</button>
          </div>
          <div className="form-row">
            <input
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search by username"
            />
            <button type="button" className="secondary" onClick={handleSearchMembers}>Search username</button>
          </div>
          <div className="list">
            {memberResults.map((u) => (
              <ListCard key={u.id} title={u.username} tag={u.name}>
                <button className="secondary" type="button" onClick={() => addMemberFromSearch(u)}>Add</button>
              </ListCard>
            ))}
          </div>
          <div className="list">
            {selectedMembers.map((m) => (
              <ListCard key={m.id || m.userId} title={m.username} tag={m.name}>
                <button className="secondary" type="button" onClick={() => removeSelectedMember(m.id || m.userId)}>Remove</button>
              </ListCard>
            ))}
          </div>
          <div className="help">You will be added automatically to every new group.</div>
          <div className="status">{memberSearchStatus}</div>
          <div className="list">
            {groups.map((g) => {
              const isMember = g.members?.some((m) => (m.userId || m.id) === user?.id);
              const isOwner = g.createdBy === user?.id;
              return (
                <ListCard key={g.id} title={g.name} tag={`${g.members?.length || 0} members`}>
                  <div className="form-row" style={{ justifyContent: 'flex-end' }}>
                    {isMember ? (
                      <button className="secondary" type="button" onClick={() => handleLeaveGroup(g.id)}>
                        Leave
                      </button>
                    ) : null}
                    {isOwner ? (
                      <button className="secondary" type="button" onClick={() => handleDeleteGroup(g.id)}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </ListCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Expenses */}
      {activeTab === 'expenses' && (
        <section className={`panel ${!authed ? 'disabled' : ''}`}>
          <div className="panel-head">
            <div>
              <h2>Add Expense</h2>
              <p className="muted">Choose group, payer, amount, and how the cost is split.</p>
            </div>
            <div className="chip">Step 2</div>
          </div>
          <div className="form-grid">
            <Select label="Group" value={expenseForm.groupId} onChange={(e) => setExpenseForm({ ...expenseForm, groupId: e.target.value })} options={groupOptions} />
            <label>Description
              <input value={expenseForm.desc} onChange={(e) => setExpenseForm({ ...expenseForm, desc: e.target.value })} placeholder="e.g., Dinner" />
            </label>
            <label>Amount
              <input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
            </label>
            <Select
              label="Paid By"
              value={expenseForm.paidBy}
              onChange={(e) => setExpenseForm({ ...expenseForm, paidBy: e.target.value })}
              options={memberOptions}
            />
            <Select
              label="Split Type"
              value={expenseForm.splitType}
              onChange={(e) => setExpenseForm({ ...expenseForm, splitType: e.target.value })}
              options={[
                { value: 'equal', label: 'Equal' },
                { value: 'exact', label: 'Exact' },
                { value: 'percentage', label: 'Percentage' },
              ]}
            />
            {expenseForm.splitType !== 'equal' ? (
              <div className="full-row share-rows">
                <div className="share-rows-head">
                  <span>Custom split</span>
                  <button className="secondary" onClick={addShareRow} type="button">Add row</button>
                </div>
                <div className="share-rows-list">
                  {shareRows.map((row, idx) => (
                    <div key={row.id || idx} className="share-row">
                      <select value={row.userId} onChange={(e) => updateShareRow(idx, 'userId', e.target.value)}>
                        <option value="">Pick member</option>
                        {memberOptions.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.value}
                        onChange={(e) => updateShareRow(idx, 'value', e.target.value)}
                        placeholder={expenseForm.splitType === 'percentage' ? 'Percent' : 'Amount'}
                      />
                      <button className="secondary" type="button" onClick={() => removeShareRow(idx)} disabled={shareRows.length <= 1}>Remove</button>
                    </div>
                  ))}
                </div>
                <div className="help">{expenseHelpText}</div>
              </div>
            ) : (
              <div className="full-row help">{expenseHelpText}</div>
            )}
          </div>
          <button onClick={handleAddExpense}>Add Expense</button>
          <div className="status">{expenseStatus}</div>
        </section>
      )}

      {/* Settlements */}
      {activeTab === 'settlements' && (
        <section className={`panel ${!authed ? 'disabled' : ''}`}>
          <div className="panel-head">
            <div>
              <h2>Record Settlement</h2>
              <p className="muted">Log real payments between members to reduce balances.</p>
            </div>
            <div className="chip">Optional</div>
          </div>
          <div className="form-grid">
            <Select label="Group" value={settleForm.groupId} onChange={(e) => setSettleForm({ ...settleForm, groupId: e.target.value })} options={groupOptions} />
            <Select label="From" value={settleForm.from} onChange={(e) => setSettleForm({ ...settleForm, from: e.target.value })} options={memberOptions} />
            <Select label="To" value={settleForm.to} onChange={(e) => setSettleForm({ ...settleForm, to: e.target.value })} options={memberOptions} />
            <label>Amount
              <input type="number" min="0" step="0.01" value={settleForm.amount} onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })} />
            </label>
          </div>
          <button onClick={handleSettlement}>Record Payment</button>
          <div className="status">{settleStatus}</div>
        </section>
      )}

      {/* Balances */}
      {activeTab === 'balances' && (
        <section className={`panel ${!authed ? 'disabled' : ''}`}>
          <div className="panel-head">
            <div>
              <h2>Balances</h2>
              <p className="muted">See per-person net positions and simplified suggested paybacks.</p>
            </div>
            <div className="chip">Step 3</div>
          </div>
          <div className="form-row">
            <Select label="Group" value={balances.groupId} onChange={(e) => setBalances((b) => ({ ...b, groupId: e.target.value }))} options={groupOptions} />
            <button onClick={() => refreshBalances(balances.groupId)}>Refresh</button>
          </div>
          {balances.data ? <StatGrid netBalances={balances.data.netBalances} simplified={balances.data.simplified} /> : null}
          <div className="list">
            {balances.data?.memberDetails?.map((d) => (
              <ListCard
                key={d.userId}
                title={d.name}
                tag={d.username ? `@${d.username}` : d.userId}
                valueClass={d.net >= 0 ? 'pos' : 'neg'}
                value={d.net.toFixed(2)}
              />
            ))}
          </div>
          <div className="list" style={{ marginTop: '0.75rem' }}>
            {balances.data?.simplified?.length
              ? balances.data.simplified.map((s, idx) => {
                  const from = nameById[s.fromUserId] || s.fromUserId;
                  const to = nameById[s.toUserId] || s.toUserId;
                  return (
                    <div key={idx} className="list-card">
                      <div className="row"><span className="neg">{from}</span><span className="arrow">→</span><span className="pos">{to}</span></div>
                      <div className="amount">{s.amount.toFixed(2)}</div>
                    </div>
                  );
                })
              : <div>All settled up!</div>}
          </div>
          {balances.error ? <div className="status error">{balances.error}</div> : null}
        </section>
      )}

      <footer>
        <p>Data is stored in local SQLite (data.db). Backend: http://localhost:4000</p>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
