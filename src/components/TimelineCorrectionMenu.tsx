export type CorrectionAxisOption = {
  value: string; // an axis value, e.g. "proposal" or "meeting_process"
  label: string; // Japanese display label, e.g. "提案"
};

type TimelineCorrectionMenuProps = {
  axisLabel: string; // which axis this menu corrects, e.g. "意味" / "範囲"
  currentValue: string; // the currently-effective value (parser reading or human override)
  isCorrected: boolean; // true when a person has overridden THIS axis
  options: CorrectionAxisOption[];
  onChange: (value: string) => void;
};

// One menu per axis. A correction overrides only the axis it names, so fixing the
// role does not silently reset the commitment (ADR 0022 §5).
export function TimelineCorrectionMenu({
  axisLabel,
  currentValue,
  isCorrected,
  options,
  onChange,
}: TimelineCorrectionMenuProps) {
  return (
    <span className="timeline-correction-menu">
      <select
        aria-label={`${axisLabel}を修正`}
        value={currentValue}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isCorrected ? (
        <span className="timeline-correction-badge" title="参加者が修正しました">
          修正済み
        </span>
      ) : null}
    </span>
  );
}
