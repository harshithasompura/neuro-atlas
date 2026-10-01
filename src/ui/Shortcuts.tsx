"use client";

import { useEffect, useRef } from "react";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Find",
    rows: [
      ["/", "Search papers, authors, topics"],
      ["Esc", "Step back: close paper, clear search, reset filters"],
      ["?", "This sheet"],
    ],
  },
  {
    title: "Move on the map",
    rows: [
      ["Arrow keys", "Pan (Shift for bigger steps)"],
      ["+  -", "Zoom"],
      ["0", "Fit the whole brain"],
      ["Enter", "Select the paper nearest the centre"],
      [".  ,", "Next or previous related paper"],
    ],
  },
  {
    title: "Time lens",
    rows: [
      ["Tab", "Focus the lens or either edge"],
      ["Left  Right", "Move the lens, or the focused edge"],
      ["Home  End", "Jump to the first or last year"],
      ["Space", "Play or pause the year sweep"],
    ],
  },
];

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="sheet-title">
      <h2 id="sheet-title" className="sheet-title">
        Keyboard
      </h2>
      <div className="sheet-grid">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.rows.map(([k, d]) => (
                <div key={k}>
                  <dt>
                    {k.split("  ").map((part) => (
                      <kbd key={part}>{part}</kbd>
                    ))}
                  </dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <button className="btn" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
