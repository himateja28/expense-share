const { useMemo } = React;

const Components = (() => {
  const tabs = [
    { id: 'auth', label: 'Auth' },
    { id: 'groups', label: 'Groups' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'settlements', label: 'Settlements' },
    { id: 'balances', label: 'Balances' },
  ];

  function Tabs({ active, setActive, items }) {
    const list = items && items.length ? items : tabs;
    return (
      <nav className="tabs">
        {list.map((t) => (
          <button key={t.id} className={t.id === active ? 'active' : ''} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    );
  }

  function Select({ label, value, onChange, options, multiple = false }) {
    return (
      <label>
        {label}
        <select value={value} onChange={onChange} multiple={multiple}>
          {!multiple && options.length === 0 ? <option value="">No options</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function ListCard({ title, tag, valueClass, value, children }) {
    return (
      <div className="list-card">
        <div className="row">
          <strong>{title}</strong>
          {tag ? <span className="tag">{tag}</span> : null}
        </div>
        {value !== undefined ? <div className={`net ${valueClass || ''}`}>{value}</div> : null}
        {children}
      </div>
    );
  }

  function StatGrid({ netBalances = {}, simplified = [] }) {
    const { totalOwed, totalOwe } = useMemo(() => {
      const owed = Object.values(netBalances).filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const owe = Math.abs(Object.values(netBalances).filter((v) => v < 0).reduce((a, b) => a + b, 0));
      return { totalOwed: owed, totalOwe: owe };
    }, [netBalances]);

    return (
      <div className="stat-grid">
        <div className="stat-card"><div className="label">Total to receive</div><div className="value">{totalOwed.toFixed(2)}</div></div>
        <div className="stat-card"><div className="label">Total to pay</div><div className="value">{totalOwe.toFixed(2)}</div></div>
        <div className="stat-card"><div className="label">Suggested transfers</div><div className="value">{simplified.length}</div></div>
      </div>
    );
  }

  return { Tabs, Select, ListCard, StatGrid, tabs };
})();
