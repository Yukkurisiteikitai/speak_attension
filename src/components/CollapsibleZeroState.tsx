import type { ReactNode } from "react";

type CollapsibleZeroStateProps = {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  emptyLabel?: string;
  children: ReactNode;
};

export function CollapsibleZeroState({
  title,
  count,
  open,
  onToggle,
  emptyLabel,
  children,
}: CollapsibleZeroStateProps) {
  // If count > 0: always show full section, ignore open/onToggle
  if (count > 0) {
    return (
      <>
        <div className="section-head">
          <h2>{title}</h2>
          <span>{count}件</span>
        </div>
        {children}
      </>
    );
  }

  // If count === 0 and open === false: show compact one-line row only
  if (!open) {
    return (
      <div className="zero-state-row">
        <span className="zero-state-title">{title}</span>
        <span className="zero-state-count">{emptyLabel ?? "0件"}</span>
        <button type="button" onClick={onToggle}>
          表示
        </button>
      </div>
    );
  }

  // If count === 0 and open === true: show full section with collapse button
  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        <span>{count}件</span>
        <button type="button" className="zero-state-collapse" onClick={onToggle}>
          閉じる
        </button>
      </div>
      {children}
    </>
  );
}
