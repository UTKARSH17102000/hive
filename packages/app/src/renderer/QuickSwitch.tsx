import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SquareTerminal, CornerDownLeft } from 'lucide-react';

export interface QItem {
  id: string;
  name: string;
  folder: string;
  cwd: string;
  status: 'running' | 'exited';
  attention: boolean;
}

// ⌘K-style palette to jump to any session across every folder.
export function QuickSwitch({
  items,
  onPick,
  onClose
}: {
  items: QItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        it.folder.toLowerCase().includes(q) ||
        it.cwd.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[index];
      if (pick) onPick(pick.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="qs-backdrop" onMouseDown={onClose}>
      <div className="qs-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qs-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            className="qs-input"
            placeholder="Jump to a session across all folders…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>esc</kbd>
        </div>
        <div className="qs-list">
          {filtered.length === 0 ? (
            <div className="qs-empty">No matching sessions.</div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={it.id}
                className={`qs-item ${i === index ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(it.id)}
              >
                <span className="qs-icon">
                  <SquareTerminal size={16} />
                </span>
                <span className="qs-name">{it.name}</span>
                <span className="qs-folder">{it.folder}</span>
                <span className={`badge ${it.status}`}>
                  <span className="bdot" />
                  {it.status}
                </span>
                {i === index && (
                  <span className="qs-enter">
                    <CornerDownLeft size={13} />
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        <div className="qs-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>{filtered.length} sessions</span>
        </div>
      </div>
    </div>
  );
}
