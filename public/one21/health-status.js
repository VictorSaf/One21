(function () {
  const { useEffect, useMemo, useState } = React;

  function Badge({ ok, label }) {
    const style = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 10px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.18)',
      background: ok ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)',
      color: '#e7eaf3',
      fontSize: '13px',
      fontWeight: 600,
      width: 'fit-content',
    };

    const dotStyle = {
      width: '10px',
      height: '10px',
      borderRadius: '999px',
      background: ok ? '#10b981' : '#ef4444',
      boxShadow: ok ? '0 0 0 3px rgba(16, 185, 129, 0.18)' : '0 0 0 3px rgba(239, 68, 68, 0.18)',
    };

    return React.createElement(
      'div',
      { style },
      React.createElement('span', { style: dotStyle }),
      React.createElement('span', null, label)
    );
  }

  function Row({ k, v }) {
    const wrap = {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      fontSize: '13px',
    };
    const keyStyle = { opacity: 0.85 };
    const valStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', opacity: 0.95 };

    return React.createElement(
      'div',
      { style: wrap },
      React.createElement('div', { style: keyStyle }, k),
      React.createElement('div', { style: valStyle }, v)
    );
  }

  function HealthStatus() {
    const [state, setState] = useState({ loading: true, ok: false, data: null, error: null });

    const fetchHealth = async () => {
      setState(s => ({ ...s, loading: true }));
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((json && (json.error || json.status)) || `HTTP ${res.status}`);
        }
        setState({ loading: false, ok: true, data: json, error: null });
      } catch (e) {
        setState({ loading: false, ok: false, data: null, error: String(e && e.message ? e.message : e) });
      }
    };

    useEffect(() => {
      fetchHealth();
      const id = setInterval(fetchHealth, 5000);
      return () => clearInterval(id);
    }, []);

    const summary = useMemo(() => {
      if (state.loading) return { ok: false, label: 'Verific...' };
      if (state.ok) return { ok: true, label: 'OK' };
      return { ok: false, label: 'DOWN' };
    }, [state.loading, state.ok]);

    const containerStyle = { display: 'grid', gap: '12px' };
    const panelStyle = { padding: '12px 14px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', background: 'rgba(0,0,0,0.12)' };
    const codeStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '12px', opacity: 0.9 };

    return React.createElement(
      'div',
      { style: containerStyle },
      React.createElement(Badge, { ok: summary.ok, label: summary.label }),
      state.ok && state.data
        ? React.createElement(
            'div',
            { style: panelStyle },
            React.createElement(Row, { k: 'status', v: String(state.data.status) }),
            React.createElement(Row, { k: 'env', v: String(state.data.env) }),
            React.createElement(Row, { k: 'uptime', v: `${state.data.uptime}s` }),
            state.data.stats
              ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(Row, { k: 'users', v: String(state.data.stats.users) }),
                  React.createElement(Row, { k: 'rooms', v: String(state.data.stats.rooms) }),
                  React.createElement(Row, { k: 'messages', v: String(state.data.stats.messages) })
                )
              : null,
            React.createElement('div', { style: { marginTop: '10px' } },
              React.createElement('div', { style: { opacity: 0.8, fontSize: '12px', marginBottom: '6px' } }, 'raw'),
              React.createElement('pre', { style: codeStyle }, JSON.stringify(state.data, null, 2))
            )
          )
        : React.createElement(
            'div',
            { style: panelStyle },
            React.createElement('div', { style: { opacity: 0.9, fontSize: '13px', marginBottom: '8px' } }, 'Nu pot accesa /health'),
            state.error ? React.createElement('div', { style: codeStyle }, state.error) : null
          )
    );
  }

  const rootEl = document.getElementById('root');
  const root = ReactDOM.createRoot(rootEl);
  root.render(React.createElement(HealthStatus));
})();
